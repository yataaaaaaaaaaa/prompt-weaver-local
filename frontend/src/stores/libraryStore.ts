// Model/LoRA library store: single truth holder of known models and LoRAs and of the user's model/LoRA
// selection with per-LoRA weights (persisted as 'library-store'). Library algorithms live in src/domain/library.ts,
// selection edits in src/domain/loraSelection.ts.
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { InstalledModel, LoraWeight, LoRASpec, ModelSpec } from '../api/types';
import { collectLinkedLoraIds } from '../domain/categories';
import { isRecord } from '../domain/guards';
import {
	addLoraPaths,
	addModelPath,
	lorasFromLegacyIds,
	registerInstalledEntry,
	sanitizeLibrary,
	type LibraryData,
	type LibraryEntryKind,
} from '../domain/library';
import { addLorasToSelection, filterKnownLoras, resolveLoraSelection, withLoraWeight } from '../domain/loraSelection';
import type { Size } from '../domain/layout';
import { dirname } from '../domain/paths';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';
import { desktop } from '../services/desktop';
import { useCategoriesStore } from './categoriesStore';
import { useGenerationSettingsStore } from './generationSettingsStore';
import { reportError, useNotificationsStore } from './notificationsStore';

/** Persisted format (version 2): defined once in src/domain/library.ts. */
export type LibraryState = LibraryData;

export type RegisterInstalledOptions = {
	/** Select the entry for generation: a checkpoint becomes the selected model, a LoRA is added to the selected
	 *  LoRAs (default weight). Default true. */
	select?: boolean;
};

export type LibraryActions = {
	/** Wholesale replacement (legacy import); unknown selected ids are dropped, missing model -> first model. */
	replaceAll: (library: Partial<LibraryState>) => void;
	selectModel: (modelId: string) => void;
	/** Desktop file dialog (.safetensors/.ckpt) starting in lastModelDir; adds + selects the model. */
	addModelFile: () => Promise<void>;
	/** Desktop folder dialog for a Diffusers model directory; adds + selects the model. */
	addModelDirectory: () => Promise<void>;
	/** Desktop multi-file dialog (.safetensors/.bin/.pt) starting in lastLoraDir; adds the LoRAs and selects them at
	 *  the default weight (paths already in the library are reused, compared case-insensitively; LoRAs already
	 *  selected keep their weight). */
	addLoraFiles: () => Promise<void>;
	/** Desktop folder dialog: adds a LoRA entry pointing at a directory and selects it (default weight). */
	addLoraDirectory: () => Promise<void>;
	/** Selects a known LoRA at the default weight (appended; no-op when already selected) or unselects it. */
	setLoraSelected: (loraId: string, selected: boolean) => void;
	clearSelectedLoras: () => void;
	/** Replaces the LoRA selection with exactly `items`, in order (unknown ids dropped, the first of duplicate ids
	 *  wins, weights through clampLoraWeight of src/domain/loraSelection.ts). The image library's "Use these
	 *  LoRAs" ends with it. */
	setLoraSelection: (items: readonly LoraWeight[]) => void;
	/** Sets the weight of a selected LoRA (clampLoraWeight); no-op when it is not selected or unchanged. */
	setLoraWeight: (loraId: string, weight: number) => void;
	/** Removes the LoRA from the library and the selection, and unlinks it from every sub-prompt
	 *  (useCategoriesStore.unlinkLora). */
	removeLora: (loraId: string) => void;
	/** Registers a file installed by the model library (src/domain/library.ts registerInstalledEntry) and selects
	 *  it for generation: a checkpoint becomes the selected model, a LoRA is added to the selected LoRAs at the
	 *  default weight (a LoRA already selected keeps its weight). The entry with the same path (case-insensitive) is
	 *  reused (its missing source is attached), else the entry with the same provenance (moved to the installed
	 *  path); new checkpoints get the current generation size.
	 *  Embeddings have no library entry: returns null and changes nothing. Returns the entry id otherwise.
	 *  options.select false: registers without changing the selection (the image library selects afterwards). */
	registerInstalled: (installed: InstalledModel, options?: RegisterInstalledOptions) => string | null;
};

export type LibraryStore = LibraryState & LibraryActions;

export const DESKTOP_DIALOGS_UNAVAILABLE = 'File and folder dialogs need the desktop app (they are not available in the browser).';

const MODEL_FILE_FILTERS = [{ name: 'Checkpoint files', extensions: ['safetensors', 'ckpt'] }];
const LORA_FILE_FILTERS = [{ name: 'LoRA files', extensions: ['safetensors', 'bin', 'pt'] }];

/** Version of the persisted 'library-store'. v1: entries may carry `source` (model library provenance).
 *  v2: the LoRA selection carries per-LoRA weights (`selectedLoras: LoraWeight[]` replaces `selectedLoraIds`). */
export const LIBRARY_STORE_VERSION = 2;

/** Older persisted states -> v2. v0/v1: `selectedLoraIds` becomes `selectedLoras` at the default weight and the
 *  legacy key is removed (src/domain/library.ts lorasFromLegacyIds); v0 entries have no `source`, which merge
 *  (sanitizeLibrary) fills with null while dropping anything malformed. v2 states are returned unchanged. */
export function migrateLibraryState(persisted: unknown, version: number): LibraryState {
	if (version >= 2 || !isRecord(persisted) || 'selectedLoras' in persisted) {
		return persisted as LibraryState;
	}
	const { selectedLoraIds, ...rest } = persisted;
	return { ...rest, selectedLoras: lorasFromLegacyIds(selectedLoraIds) } as LibraryState;
}

/** Default size of new checkpoint entries: the current generation size. */
function currentGenerationSize(): Size {
	const { width, height } = useGenerationSettingsStore.getState();
	return { width, height };
}

function selectLibraryData(state: LibraryState): LibraryData {
	return {
		models: state.models,
		loras: state.loras,
		selectedModelId: state.selectedModelId,
		selectedLoras: state.selectedLoras,
		lastModelDir: state.lastModelDir,
		lastLoraDir: state.lastLoraDir,
	};
}

/** Runs a desktop dialog flow: warns when dialogs are unavailable, reports failures. */
async function withDesktopDialog(failureTitle: string, flow: () => Promise<void>): Promise<void> {
	if (!desktop.isAvailable()) {
		useNotificationsStore.getState().notify('warning', DESKTOP_DIALOGS_UNAVAILABLE);
		return;
	}
	try {
		await flow();
	} catch (error) {
		reportError(error, failureTitle);
	}
}

export const useLibraryStore = create<LibraryStore>()(
	persist(
		(set, get) => {
			const addModel = (path: string) => {
				const { models, modelId } = addModelPath(get().models, path, currentGenerationSize());
				set({ models, selectedModelId: modelId, lastModelDir: dirname(path) });
			};
			const addLoras = (paths: string[], kind: 'file' | 'directory') => {
				const { loras, loraIds } = addLoraPaths(get().loras, paths, kind);
				set({ loras, selectedLoras: addLorasToSelection(get().selectedLoras, loraIds, { loras }), lastLoraDir: dirname(paths[0]) });
			};
			return {
				models: [],
				loras: [],
				selectedModelId: '',
				selectedLoras: [],
				lastModelDir: null,
				lastLoraDir: null,
				replaceAll: (library) => set(sanitizeLibrary(library, selectLibraryData(get()))),
				selectModel: (modelId) => {
					if (modelId === '' || get().models.some((model) => model.id === modelId)) {
						set({ selectedModelId: modelId });
					}
				},
				addModelFile: () =>
					withDesktopDialog('Could not add the model', async () => {
						const path = await desktop.pickFile({ defaultPath: get().lastModelDir, title: 'Select checkpoint', filters: MODEL_FILE_FILTERS });
						if (path) {
							addModel(path);
						}
					}),
				addModelDirectory: () =>
					withDesktopDialog('Could not add the model', async () => {
						const path = await desktop.pickDirectory({ defaultPath: get().lastModelDir, title: 'Select a Diffusers model folder' });
						if (path) {
							addModel(path);
						}
					}),
				addLoraFiles: () =>
					withDesktopDialog('Could not add the LoRAs', async () => {
						const paths = await desktop.pickFiles({ defaultPath: get().lastLoraDir, title: 'Add LoRA', filters: LORA_FILE_FILTERS });
						if (paths.length) {
							addLoras(paths, 'file');
						}
					}),
				addLoraDirectory: () =>
					withDesktopDialog('Could not add the LoRA', async () => {
						const path = await desktop.pickDirectory({ defaultPath: get().lastLoraDir, title: 'Add LoRA folder' });
						if (path) {
							addLoras([path], 'directory');
						}
					}),
				setLoraSelected: (loraId, selected) => {
					const { loras, selectedLoras } = get();
					const next = selected ? addLorasToSelection(selectedLoras, [loraId], { loras }) : selectedLoras.filter((item) => item.id !== loraId);
					if (next.length !== selectedLoras.length) {
						set({ selectedLoras: next });
					}
				},
				clearSelectedLoras: () => {
					if (get().selectedLoras.length) {
						set({ selectedLoras: [] });
					}
				},
				setLoraSelection: (items) => set({ selectedLoras: filterKnownLoras(items, get()) }),
				setLoraWeight: (loraId, weight) => {
					const { selectedLoras } = get();
					const next = withLoraWeight(selectedLoras, loraId, weight);
					if (next !== selectedLoras) {
						set({ selectedLoras: next });
					}
				},
				registerInstalled: (installed, { select = true } = {}) => {
					const { models, loras, entryId } = registerInstalledEntry(get(), installed, currentGenerationSize());
					if (entryId === null) {
						return null;
					}
					if (!select) {
						set({ models, loras });
					} else if (installed.kind === 'checkpoint') {
						set({ models, selectedModelId: entryId });
					} else {
						set({ loras, selectedLoras: addLorasToSelection(get().selectedLoras, [entryId], { loras }) });
					}
					return entryId;
				},
				removeLora: (loraId) => {
					set((state) => ({
						loras: state.loras.filter((lora) => lora.id !== loraId),
						selectedLoras: state.selectedLoras.filter((item) => item.id !== loraId),
					}));
					useCategoriesStore.getState().unlinkLora(loraId);
				},
			};
		},
		persistedStoreOptions<LibraryStore, LibraryState>({
			name: STORE_NAMES.library,
			version: LIBRARY_STORE_VERSION,
			partialize: selectLibraryData,
			migrate: migrateLibraryState,
			// Malformed entries dropped, selection restricted to known ids with clamped weights (missing model -> first model).
			merge: (persisted, current) => (persisted === undefined ? current : { ...current, ...sanitizeLibrary(persisted, selectLibraryData(current)) }),
		}),
	),
);

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

/** The LoRA selection with weights (LoraWeight: the one representation, see src/api/types.ts), in selection order.
 *  The stored array itself: a stable reference until the selection changes. */
export const selectSelectedLoras = (state: LibraryState): LoraWeight[] => state.selectedLoras;

export const selectSelectedModel = (state: LibraryState): ModelSpec | null =>
	state.models.find((model) => model.id === state.selectedModelId) ?? null;

export const selectModelName = (modelId: string) => (state: LibraryState): string =>
	state.models.find((model) => model.id === modelId)?.name ?? modelId;

/** True when the library entry is selected for generation: the selected checkpoint, or one of the selected LoRAs
 *  (false without an entry id or for kinds without library entries). */
export const selectIsEntrySelected =
	(kind: LibraryEntryKind | 'embedding', entryId: string | null) =>
	(state: LibraryState): boolean => {
		if (entryId === null) {
			return false;
		}
		if (kind === 'checkpoint') {
			return state.selectedModelId === entryId;
		}
		return kind === 'lora' && state.selectedLoras.some((item) => item.id === entryId);
	};

export type LoraRow = {
	lora: LoRASpec;
	selected: boolean;
	/** The selected weight; null when the LoRA is not selected. */
	weight: number | null;
	/** Some sub-prompt induces this LoRA through extraLoraIds. */
	promptLinked: boolean;
};

/** LoRA ids induced by some sub-prompt (categories store); stable while the set of ids is unchanged. */
function usePromptLinkedLoraIds(): string[] {
	return useCategoriesStore(useShallow((state) => collectLinkedLoraIds(state.categories)));
}

/** LoRA list rows (library + selection with weights + prompt links from the categories store). */
export function useLoraRows(): LoraRow[] {
	const loras = useLibraryStore((state) => state.loras);
	const selectedLoras = useLibraryStore(selectSelectedLoras);
	const linkedLoraIds = usePromptLinkedLoraIds();
	return useMemo(() => {
		const weights = new Map(selectedLoras.map((item) => [item.id, item.weight]));
		const linked = new Set(linkedLoraIds);
		return loras.map((lora) => {
			const weight = weights.get(lora.id) ?? null;
			return { lora, selected: weight !== null, weight, promptLinked: linked.has(lora.id) };
		});
	}, [loras, selectedLoras, linkedLoraIds]);
}

export type LoraSummary = {
	selected: number;
	promptLinked: number;
	/** |selected ∪ prompt-linked| */
	possibleActive: number;
};

export function useLoraSummary(): LoraSummary {
	const loras = useLibraryStore((state) => state.loras);
	const selectedLoras = useLibraryStore(selectSelectedLoras);
	const linkedLoraIds = usePromptLinkedLoraIds();
	return useMemo(() => {
		const resolved = resolveLoraSelection({ loras }, selectedLoras, [{ induced_lora_ids: linkedLoraIds }]);
		return { selected: resolved.selectedIds.length, promptLinked: resolved.promptLinkedIds.length, possibleActive: resolved.activeIds.length };
	}, [loras, selectedLoras, linkedLoraIds]);
}
