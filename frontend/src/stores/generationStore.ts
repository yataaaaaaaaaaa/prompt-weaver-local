// Generation store: runs single and continuous generations (not persisted).
// Progress is NOT stored here: it comes from the tasks store (useGenerationProgress).
import { create } from 'zustand';
import { api } from '../api/client';
import { buildGenerationRequest, nextSeedSnapshot } from '../domain/generationRequest';
import { isRecord } from '../domain/guards';
import { useCategoriesStore } from './categoriesStore';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { selectGenerationSettings, selectSeedSnapshot, useGenerationSettingsStore } from './generationSettingsStore';
import { selectSelectedModel, useLibraryStore } from './libraryStore';
import { reportError, useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { useUndoStore } from './undoStore';

export type GenerationState = {
	generating: boolean;
	continuous: boolean;
};

export type GenerationActions = {
	/** Builds the request from categories + forbidden rules + settings + library (src/domain/generationRequest.ts),
	 *  calls api.generate, advances seeds (applySeedSnapshot), shows the output (useOutputsStore.showGenerated)
	 *  and pushes an undo entry {type:'generate'} (useUndoStore.push). Errors -> reportError. No-op while generating. */
	generate: () => Promise<void>;
	/** Starts the continuous loop, or stops it (aborts the request and calls api.cancelGeneration). */
	toggleContinuous: () => Promise<void>;
	cancel: () => Promise<void>;
};

export type GenerationStore = GenerationState & GenerationActions;

export const GENERATION_FAILED_TITLE = 'Generation failed';

/** The request in flight (aborted by cancel / stopping the continuous loop). */
let abortController: AbortController | null = null;
/** Incremented to stop the running continuous loop (a new loop never sees an older stop request). */
let continuousRun = 0;

function isAbortError(error: unknown): boolean {
	return isRecord(error) && error.name === 'AbortError';
}

export const useGenerationStore = create<GenerationStore>()((set, get) => {
	/** One generation; throws on failure. `warnedMissingLoraIds` limits the missing-LoRA warning to once per id
	 *  per generate() call / continuous run. */
	const runOnce = async (warnedMissingLoraIds: Set<string>): Promise<void> => {
		const settings = selectGenerationSettings(useGenerationSettingsStore.getState());
		const seedsBefore = selectSeedSnapshot(settings);
		const previousOutputId = useOutputsStore.getState().currentId;
		const { request, nextCategorySeedState, missingLoraIds } = buildGenerationRequest({
			categories: useCategoriesStore.getState().categories,
			rules: useForbiddenRulesStore.getState().rules,
			settings,
			library: useLibraryStore.getState(),
		});
		const newlyMissing = missingLoraIds.filter((id) => !warnedMissingLoraIds.has(id));
		if (newlyMissing.length) {
			newlyMissing.forEach((id) => warnedMissingLoraIds.add(id));
			useNotificationsStore
				.getState()
				.notify('warning', `LoRAs missing from the library were ignored: ${newlyMissing.join(', ')}.`, { title: 'Missing LoRAs' });
		}

		const controller = new AbortController();
		abortController = controller;
		set({ generating: true });
		try {
			const record = await api.generate(request, controller.signal);
			useGenerationSettingsStore.getState().applySeedSnapshot(nextSeedSnapshot(settings, record, nextCategorySeedState));
			useOutputsStore.getState().showGenerated(record);
			useUndoStore.getState().push({ type: 'generate', previousOutputId, seeds: seedsBefore });
		} finally {
			if (abortController === controller) {
				abortController = null;
			}
			set({ generating: false });
		}
	};

	const stopCurrentRequest = async (): Promise<void> => {
		abortController?.abort();
		abortController = null;
		await api.cancelGeneration().catch(() => undefined);
	};

	return {
		generating: false,
		continuous: false,
		generate: async () => {
			if (get().generating || get().continuous) {
				return;
			}
			try {
				await runOnce(new Set());
			} catch (error) {
				if (!isAbortError(error)) {
					reportError(error, GENERATION_FAILED_TITLE);
				}
			}
		},
		toggleContinuous: async () => {
			if (get().continuous) {
				continuousRun += 1;
				set({ continuous: false });
				await stopCurrentRequest();
				return;
			}
			if (get().generating) {
				return;
			}
			const run = ++continuousRun;
			const warnedMissingLoraIds = new Set<string>();
			set({ continuous: true });
			try {
				while (run === continuousRun) {
					await runOnce(warnedMissingLoraIds);
				}
			} catch (error) {
				if (run === continuousRun && !isAbortError(error)) {
					reportError(error, GENERATION_FAILED_TITLE);
				}
			} finally {
				if (run === continuousRun) {
					set({ continuous: false });
				}
			}
		},
		cancel: async () => {
			continuousRun += 1;
			set({ continuous: false });
			await stopCurrentRequest();
		},
	};
});

/** A model is selected and no single generation is running. */
export function useCanGenerate(): boolean {
	const hasModel = useLibraryStore((state) => selectSelectedModel(state) != null);
	const generating = useGenerationStore((state) => state.generating);
	return hasModel && !generating;
}

/** The continuous toggle can stop a running loop, or start one when a model is selected and no single
 *  generation is running (toggleContinuous ignores the click otherwise). */
export function useCanToggleContinuous(): boolean {
	const hasModel = useLibraryStore((state) => selectSelectedModel(state) != null);
	const generating = useGenerationStore((state) => state.generating);
	const continuous = useGenerationStore((state) => state.continuous);
	return continuous || (hasModel && !generating);
}
