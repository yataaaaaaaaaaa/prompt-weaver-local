// Outputs store: single truth holder of the output list and of the output being viewed.
// Persisted as 'current-image-store' ({ currentId }); version 1 - version 0 stored { currentName: number | null }
// and is migrated (zero-padded to the 10-digit id). Outputs are read through the backend API only.
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ApiError, api } from '../api/client';
import { outputImageUrl } from '../api/config';
import type { GenerationSelection, OutputRecord } from '../api/types';
import type { CategoryKey, SubPromptKey } from '../domain/categories';
import {
	FILMSTRIP_RADIUS,
	formatOutputId,
	indexSelections,
	insertOutputId,
	nearestOutputId,
	nextOutputId,
	normalizeOutputIds,
	outputDetails,
	outputIdWindow,
	previousOutputId,
	removeOutputId,
	type CurrentOutputDetails,
	type SelectionIndex,
} from '../domain/outputs';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';
import { selectModelName, useLibraryStore } from './libraryStore';
import { copyTextWithFeedback } from './clipboardActions';
import { reportError, useNotificationsStore } from './notificationsStore';
import { useUndoStore } from './undoStore';

export type { CurrentOutputDetails };

export type OutputsState = {
	/** Complete output ids, ascending. */
	ids: string[];
	currentId: string | null;
	/** Metadata of currentId (null while loading or when there is none). */
	record: OutputRecord | null;
	loadingRecord: boolean;
};

export type OutputsActions = {
	/** Called once by the session store at boot: sets ids and shows `preferredId` (or the latest). */
	initialize: (ids: string[], preferredId: string | null) => Promise<void>;
	/** Re-reads the id list from the backend (external changes); keeps the current output when it still exists,
	 *  else shows its nearest neighbour. Failures -> notification, returns the known ids. */
	refreshIds: () => Promise<string[]>;
	/** Shows an output (null = none). A 404 refreshes the id list and shows the nearest output instead. */
	select: (outputId: string | null) => Promise<void>;
	first: () => Promise<void>;
	/** Previous/next refresh the id list first when already at the end (picks up external changes). */
	previous: () => Promise<void>;
	next: () => Promise<void>;
	last: () => Promise<void>;
	/** A finished generation: appends its id, makes it current with the returned record (no refetch). */
	showGenerated: (record: OutputRecord) => void;
	/** Moves the current output to the app trash, shows its neighbour and pushes {type:'delete-output'} to undo. */
	deleteCurrent: () => Promise<void>;
	/** Restores a trashed output and shows it (used by undo). Throws when the backend refuses, so the
	 *  caller can keep its undo entry. */
	restore: (outputId: string) => Promise<void>;
	copyCurrentPrompt: () => Promise<void>;
	/** Copies the prompt text of selection #index of the current output. */
	copySelectionPrompt: (index: number) => Promise<void>;
};

export type OutputsStore = OutputsState & OutputsActions;

type PersistedOutputsState = Pick<OutputsState, 'currentId'>;

/** v0 ({ currentName: number | null }) -> v1 ({ currentId: string | null }). */
export function migrateOutputsState(persisted: unknown, version: number): PersistedOutputsState {
	const state = (persisted ?? {}) as { currentName?: unknown; currentId?: unknown };
	if (version === 0) {
		const name = state.currentName;
		return { currentId: typeof name === 'number' && Number.isSafeInteger(name) && name >= 0 ? formatOutputId(name) : null };
	}
	return { currentId: typeof state.currentId === 'string' ? state.currentId : null };
}

/**
 * Navigation token: every navigation takes a new token and only applies its result while the token is
 * still the latest, so a slow load can never overwrite a newer selection.
 */
let navigationToken = 0;

function isNotFound(error: unknown): boolean {
	return error instanceof ApiError && error.status === 404;
}

export const useOutputsStore = create<OutputsStore>()(
	persist(
		(set, get) => {
			const isLatest = (token: number) => token === navigationToken;

			/** Loads and shows `outputId` under `token`; `recover` = on 404, refresh ids and show the nearest. */
			const show = async (outputId: string | null, token: number, recover: boolean): Promise<void> => {
				if (outputId === null) {
					set({ currentId: null, record: null, loadingRecord: false });
					return;
				}
				set({ currentId: outputId, record: null, loadingRecord: true });
				try {
					const record = await api.getOutput(outputId);
					if (isLatest(token)) {
						set({ record, loadingRecord: false });
					}
				} catch (error) {
					if (!isLatest(token)) {
						return;
					}
					set({ loadingRecord: false });
					if (!recover || !isNotFound(error)) {
						reportError(error, `Could not load output ${outputId}`);
						return;
					}
					const ids = await fetchIds();
					if (ids === null || !isLatest(token)) {
						return;
					}
					set({ ids });
					await show(nearestOutputId(ids, outputId), token, false);
				}
			};

			/** Fresh id list from the backend, or null (reported) when it cannot be read. */
			const fetchIds = async (): Promise<string[] | null> => {
				try {
					return normalizeOutputIds(await api.listOutputIds());
				} catch (error) {
					reportError(error, 'Could not list the outputs');
					return null;
				}
			};

			/** previous/next: move in `direction`, refreshing the list once when nothing is found. */
			const step = async (find: (ids: readonly string[], currentId: string | null) => string | null): Promise<void> => {
				const token = ++navigationToken;
				const startId = get().currentId;
				let target = find(get().ids, startId);
				if (target === null) {
					const ids = await get().refreshIds();
					if (!isLatest(token) || get().currentId !== startId) {
						return;
					}
					target = find(ids, startId);
				}
				if (target !== null && target !== startId) {
					await show(target, token, true);
				}
			};

			/** first/last: refresh the list when it is empty. */
			const jump = async (pick: (ids: readonly string[]) => string | undefined): Promise<void> => {
				const token = ++navigationToken;
				let ids = get().ids;
				if (ids.length === 0) {
					ids = await get().refreshIds();
					if (!isLatest(token)) {
						return;
					}
				}
				const target = pick(ids);
				if (target !== undefined && target !== get().currentId) {
					await show(target, token, true);
				}
			};

			return {
				ids: [],
				currentId: null,
				record: null,
				loadingRecord: false,

				initialize: async (ids, preferredId) => {
					const token = ++navigationToken;
					const sorted = normalizeOutputIds(ids);
					set({ ids: sorted });
					const target = preferredId !== null && sorted.includes(preferredId) ? preferredId : (sorted[sorted.length - 1] ?? null);
					await show(target, token, true);
				},

				refreshIds: async () => {
					const token = navigationToken;
					const ids = await fetchIds();
					if (ids === null) {
						return get().ids;
					}
					set({ ids });
					const { currentId } = get();
					if (currentId !== null && !ids.includes(currentId) && isLatest(token)) {
						await show(nearestOutputId(ids, currentId), ++navigationToken, false);
					}
					return ids;
				},

				select: (outputId) => show(outputId, ++navigationToken, true),
				first: () => jump((ids) => ids[0]),
				previous: () => step(previousOutputId),
				next: () => step(nextOutputId),
				last: () => jump((ids) => ids[ids.length - 1]),

				showGenerated: (record) => {
					navigationToken += 1;
					set((state) => ({
						ids: insertOutputId(state.ids, record.output_id),
						currentId: record.output_id,
						record,
						loadingRecord: false,
					}));
				},

				deleteCurrent: async () => {
					const outputId = get().currentId;
					if (outputId === null) {
						return;
					}
					try {
						await api.trashOutput(outputId);
					} catch (error) {
						reportError(error, `Could not delete output ${outputId}`);
						return;
					}
					const ids = removeOutputId(get().ids, outputId);
					set({ ids });
					useUndoStore.getState().push({ type: 'delete-output', outputId });
					if (get().currentId === outputId) {
						await show(nearestOutputId(ids, outputId), ++navigationToken, true);
					}
				},

				restore: async (outputId) => {
					await api.restoreOutput(outputId);
					set((state) => ({ ids: insertOutputId(state.ids, outputId) }));
					await get().select(outputId);
				},

				copyCurrentPrompt: () => copyTextWithFeedback(get().record?.prompt, 'Prompt'),
				copySelectionPrompt: (index) => copyTextWithFeedback(get().record?.selections[index]?.prompt_text, 'Sub-prompt'),
			};
		},
		persistedStoreOptions<OutputsStore, PersistedOutputsState>({
			name: STORE_NAMES.outputs,
			version: 1,
			partialize: (state) => ({ currentId: state.currentId }),
			migrate: migrateOutputsState,
		}),
	),
);

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

export const selectCurrentImageUrl = (state: OutputsState): string | null =>
	state.currentId ? outputImageUrl(state.currentId) : null;

export type OutputNavigation = {
	/** -1 when there is no current output. */
	index: number;
	count: number;
	canFirst: boolean;
	canPrevious: boolean;
	canNext: boolean;
	canLast: boolean;
};

/** Use with useShallow (returns a new object). */
export const selectNavigation = (state: OutputsState): OutputNavigation => {
	const index = state.currentId ? state.ids.indexOf(state.currentId) : -1;
	const count = state.ids.length;
	const hasLater = index >= 0 && index < count - 1;
	return { index, count, canFirst: index > 0, canPrevious: index > 0, canNext: hasLater, canLast: hasLater };
};

/** The ids of the filmstrip: a window of at most 2 * radius + 1 ids around the current output (domain outputIdWindow),
 *  so a history of thousands of outputs never renders thousands of thumbnails. Use with useShallow (new array). */
export const selectFilmstripIds = (state: OutputsState, radius: number = FILMSTRIP_RADIUS): string[] =>
	outputIdWindow(state.ids, state.currentId, radius);

/** The latest output id (the one "Jump to latest" shows), or null without outputs. */
export const selectLatestOutputId = (state: OutputsState): string | null => state.ids[state.ids.length - 1] ?? null;

const EMPTY_SELECTIONS: GenerationSelection[] = [];

export const selectCurrentSelections = (state: OutputsState): GenerationSelection[] => state.record?.selections ?? EMPTY_SELECTIONS;

const EMPTY_SELECTION_INDEX: SelectionIndex = new Map();
const selectionIndexCache = new WeakMap<readonly GenerationSelection[], SelectionIndex>();

/** Category key -> sub-prompt keys used by the current output (computed once per record). */
export const selectCurrentSelectionIndex = (state: OutputsState): SelectionIndex => {
	const selections = state.record?.selections;
	if (!selections || selections.length === 0) {
		return EMPTY_SELECTION_INDEX;
	}
	let index = selectionIndexCache.get(selections);
	if (!index) {
		index = indexSelections(selections);
		selectionIndexCache.set(selections, index);
	}
	return index;
};

/** The sub-prompt was used by the output being viewed (highlighted + scrolled into view in its category card). */
export function useIsSubPromptInCurrentOutput(key: CategoryKey, promptKey: SubPromptKey): boolean {
	return useOutputsStore((state) => selectCurrentSelectionIndex(state).get(key)?.includes(promptKey) ?? false);
}

/** Key of the sub-prompt the current output used in this category, or null. */
export function useCurrentSelectionKey(key: CategoryKey): SubPromptKey | null {
	return useOutputsStore((state) => selectCurrentSelectionIndex(state).get(key)?.[0] ?? null);
}

/** Metadata shown by the output browser (model/LoRA names resolved through the library store). */
export function useCurrentOutputDetails(): CurrentOutputDetails | null {
	const record = useOutputsStore((state) => state.record);
	const modelId = record?.model_id ?? '';
	const modelName = useLibraryStore((state) => selectModelName(modelId)(state));
	const loras = useLibraryStore((state) => state.loras);
	return useMemo(() => (record ? outputDetails(record, modelName, loras) : null), [record, modelName, loras]);
}
