// Model/LoRA library store: single truth holder of known models and LoRAs and of the user's model/LoRA
// selection (persisted as 'library-store'). Library algorithms live in src/domain/library.ts.
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { InstalledModel, LoRASpec, ModelSpec } from '../api/types';
import { collectLinkedLoraIds } from '../domain/categories';
import { addLoraPaths, addModelPath, registerInstalledEntry, sanitizeLibrary, type LibraryData, type LibraryEntryKind } from '../domain/library';
import { filterKnownLoraIds, resolveLoraSelection } from '../domain/loraSelection';
import type { Size } from '../domain/layout';
import { dirname } from '../domain/paths';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';
import { desktop } from '../services/desktop';
import { useCategoriesStore } from './categoriesStore';
import { useGenerationSettingsStore } from './generationSettingsStore';
import { reportError, useNotificationsStore } from './notificationsStore';

/** Persisted format (version 1): defined once in src/domain/library.ts. */
export type LibraryState = LibraryData;

export type LibraryActions = {
	/** Wholesale replacement (legacy import); unknown selected ids are dropped, missing model -> first model. */
	replaceAll: (library: Partial<LibraryState>) => void;
	selectModel: (modelId: string) => void;
	/** Desktop file dialog (.safetensors/.ckpt) starting in lastModelDir; adds + selects the model. */
	addModelFile: () => Promise<void>;
	/** Desktop folder dialog for a Diffusers model directory; adds + selects the model. */
	addModelDirectory: () => Promise<void>;
	/** Desktop multi-file dialog (.safetensors/.bin/.pt) starting in lastLoraDir; adds and selects the LoRAs
	 *  (paths already in the library are reused, compared case-insensitively). */
	addLoraFiles: () => Promise<void>;
	/** Desktop folder dialog: adds a LoRA entry pointing at a directory and selects it. */
	addLoraDirectory: () => Promise<void>;
	setLoraSelected: (loraId: string, selected: boolean) => void;
	clearSelectedLoras: () => void;
	/** Removes the LoRA from the library and the selection, and unlinks it from every sub-prompt
	 *  (useCategoriesStore.unlinkLora). */
	removeLora: (loraId: string) => void;
	/** Registers a file installed by the model library (src/domain/library.ts registerInstalledEntry) and selects
	 *  it for generation: a checkpoint becomes the selected model, a LoRA is added to the selected LoRAs. The entry
	 *  with the same path (case-insensitive) is reused (its missing source is attached), else the entry with the
	 *  same provenance (moved to the installed path); new checkpoints get the current generation size.
	 *  Embeddings have no library entry: returns null and changes nothing. Returns the entry id otherwise. */
	registerInstalled: (installed: InstalledModel) => string | null;
};

export type LibraryStore = LibraryState & LibraryActions;

export const DESKTOP_DIALOGS_UNAVAILABLE = 'File and folder dialogs need the desktop app (they are not available in the browser).';

const MODEL_FILE_FILTERS = [{ name: 'Checkpoint files', extensions: ['safetensors', 'ckpt'] }];
const LORA_FILE_FILTERS = [{ name: 'LoRA files', extensions: ['safetensors', 'bin', 'pt'] }];

/** Version of the persisted 'library-store'. v1: entries may carry `source` (model library provenance). */
export const LIBRARY_STORE_VERSION = 1;

/** Older persisted states -> v1. v0 is v1 without `source` on entries: returned unchanged, merge (sanitizeLibrary)
 *  fills `source: null` and drops anything malformed. */
export function migrateLibraryState(persisted: unknown): LibraryState {
	return persisted as LibraryState;
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
		selectedLoraIds: state.selectedLoraIds,
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
				set({
					loras,
					selectedLoraIds: filterKnownLoraIds([...get().selectedLoraIds, ...loraIds], { loras }),
					lastLoraDir: dirname(paths[0]),
				});
			};
			return {
				models: [],
				loras: [],
				selectedModelId: '',
				selectedLoraIds: [],
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
					const { loras, selectedLoraIds } = get();
					if (!loras.some((lora) => lora.id === loraId) || selectedLoraIds.includes(loraId) === selected) {
						return;
					}
					set({ selectedLoraIds: selected ? [...selectedLoraIds, loraId] : selectedLoraIds.filter((id) => id !== loraId) });
				},
				clearSelectedLoras: () => {
					if (get().selectedLoraIds.length) {
						set({ selectedLoraIds: [] });
					}
				},
				registerInstalled: (installed) => {
					const { models, loras, entryId } = registerInstalledEntry(get(), installed, currentGenerationSize());
					if (entryId === null) {
						return null;
					}
					if (installed.kind === 'checkpoint') {
						set({ models, selectedModelId: entryId });
					} else {
						set({ loras, selectedLoraIds: filterKnownLoraIds([...get().selectedLoraIds, entryId], { loras }) });
					}
					return entryId;
				},
				removeLora: (loraId) => {
					set((state) => ({
						loras: state.loras.filter((lora) => lora.id !== loraId),
						selectedLoraIds: state.selectedLoraIds.filter((id) => id !== loraId),
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
			// Malformed entries dropped, selection restricted to known ids (missing model -> first model).
			merge: (persisted, current) => (persisted === undefined ? current : { ...current, ...sanitizeLibrary(persisted, selectLibraryData(current)) }),
		}),
	),
);

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

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
		return kind === 'lora' && state.selectedLoraIds.includes(entryId);
	};

export type LoraRow = {
	lora: LoRASpec;
	selected: boolean;
	/** Some sub-prompt induces this LoRA through extraLoraIds. */
	promptLinked: boolean;
};

/** LoRA ids induced by some sub-prompt (categories store); stable while the set of ids is unchanged. */
function usePromptLinkedLoraIds(): string[] {
	return useCategoriesStore(useShallow((state) => collectLinkedLoraIds(state.categories)));
}

/** LoRA list rows (library + selection + prompt links from the categories store). */
export function useLoraRows(): LoraRow[] {
	const loras = useLibraryStore((state) => state.loras);
	const selectedLoraIds = useLibraryStore((state) => state.selectedLoraIds);
	const linkedLoraIds = usePromptLinkedLoraIds();
	return useMemo(() => {
		const selected = new Set(selectedLoraIds);
		const linked = new Set(linkedLoraIds);
		return loras.map((lora) => ({ lora, selected: selected.has(lora.id), promptLinked: linked.has(lora.id) }));
	}, [loras, selectedLoraIds, linkedLoraIds]);
}

export type LoraSummary = {
	selected: number;
	promptLinked: number;
	/** |selected ∪ prompt-linked| */
	possibleActive: number;
};

export function useLoraSummary(): LoraSummary {
	const loras = useLibraryStore((state) => state.loras);
	const selectedLoraIds = useLibraryStore((state) => state.selectedLoraIds);
	const linkedLoraIds = usePromptLinkedLoraIds();
	return useMemo(() => {
		const resolved = resolveLoraSelection({ loras }, selectedLoraIds, [{ induced_lora_ids: linkedLoraIds }]);
		return { selected: resolved.selectedIds.length, promptLinked: resolved.promptLinkedIds.length, possibleActive: resolved.activeIds.length };
	}, [loras, selectedLoraIds, linkedLoraIds]);
}
