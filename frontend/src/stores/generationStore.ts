// Generation store: runs single and continuous generations, and the generations of story scenes (not persisted). THE
// generate path of the app: every generation is built by buildGenerationRequest (src/domain/generationRequest.ts) and
// sent by runOnce, one at a time. Progress is NOT stored here: it comes from the tasks store (useGenerationProgress).
import { create } from 'zustand';
import { api } from '../api/client';
import type { OutputRecord } from '../api/types';
import { buildGenerationRequest, nextSeedSnapshot } from '../domain/generationRequest';
import type { SceneGenerationInput } from '../domain/stories';
import { isRecord } from '../domain/guards';
import { useCategoriesStore } from './categoriesStore';
import { selectActiveCharacter, useCharactersStore } from './charactersStore';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { selectGenerationSettings, selectSeedSnapshot, useGenerationSettingsStore } from './generationSettingsStore';
import { selectSelectedModel, useLibraryStore } from './libraryStore';
import { reportError, useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { selectGenerationEvent, useTasksStore } from './tasksStore';
import { useUndoStore } from './undoStore';

export type GenerationState = {
	generating: boolean;
	continuous: boolean;
};

export type GenerationActions = {
	/** Builds the request from categories + forbidden rules + settings + library + the active character
	 *  (selectActiveCharacter; src/domain/generationRequest.ts), calls api.generate, advances seeds (applySeedSnapshot;
	 *  the image seed field is kept when the character locks the seed), shows the output
	 *  (useOutputsStore.showGenerated) and pushes an undo entry {type:'generate'} (useUndoStore.push). Errors ->
	 *  reportError. No-op while generating. */
	generate: () => Promise<void>;
	/** Starts the continuous loop, or stops it (aborts the request and calls api.cancelGeneration). */
	toggleContinuous: () => Promise<void>;
	/** One generation illustrating a story scene (the story store calls it): the same request building as generate()
	 *  with the scene's input (its cast replaces the active character; src/domain/stories.ts), the same missing-LoRA
	 *  warning; the output is listed (useOutputsStore.addGenerated) without changing the output viewed; the seed fields
	 *  are left unchanged and no undo entry is pushed. Resolves with the saved record; rejects on failure (an
	 *  AbortError when cancelled; GENERATION_BUSY_MESSAGE while another generation runs): the caller reports. */
	generateScene: (scene: SceneGenerationInput) => Promise<OutputRecord>;
	cancel: () => Promise<void>;
};

export type GenerationStore = GenerationState & GenerationActions;

export const GENERATION_FAILED_TITLE = 'Generation failed';
/** Why generateScene refused to start. */
export const GENERATION_BUSY_MESSAGE = 'A generation is already running: wait for it or cancel it first.';

/** The request in flight (aborted by cancel / stopping the continuous loop). */
let abortController: AbortController | null = null;
/** Incremented to stop the running continuous loop (a new loop never sees an older stop request). */
let continuousRun = 0;
/** A request was abandoned (Cancel, or stopping continuous generation): the backend may still finish that generation
 *  (it was already saving), and its output then has to be listed. */
let abandonedRequest = false;

/** The rejection of a request aborted by Cancel (generateScene callers stop quietly on it). */
export function isAbortError(error: unknown): boolean {
	return isRecord(error) && error.name === 'AbortError';
}

export const useGenerationStore = create<GenerationStore>()((set, get) => {
	/** One generation (of a story scene with `scene`); throws on failure. `warnedMissingLoraIds` limits the
	 *  missing-LoRA warning to once per id per generate() call / continuous run / scene generation. */
	const runOnce = async (warnedMissingLoraIds: Set<string>, scene: SceneGenerationInput | null = null): Promise<OutputRecord> => {
		const settings = selectGenerationSettings(useGenerationSettingsStore.getState());
		const seedsBefore = selectSeedSnapshot(settings);
		const previousOutputId = useOutputsStore.getState().currentId;
		const { request, nextCategorySeedState, missingLoraIds, imageSeedLocked } = buildGenerationRequest({
			categories: useCategoriesStore.getState().categories,
			rules: useForbiddenRulesStore.getState().rules,
			settings,
			library: useLibraryStore.getState(),
			character: selectActiveCharacter(useCharactersStore.getState()),
			scene,
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
			if (scene) {
				// Shown by the Story section; Create's seed fields, viewer and undo history are left alone.
				useOutputsStore.getState().addGenerated(record);
			} else {
				useGenerationSettingsStore.getState().applySeedSnapshot(nextSeedSnapshot(settings, record, nextCategorySeedState, { imageSeedLocked }));
				useOutputsStore.getState().showGenerated(record);
				useUndoStore.getState().push({ type: 'generate', previousOutputId, seeds: seedsBefore });
			}
			return record;
		} finally {
			if (abortController === controller) {
				abortController = null;
			}
			set({ generating: false });
		}
	};

	const stopCurrentRequest = async (): Promise<void> => {
		if (abortController) {
			abandonedRequest = true;
		}
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
		generateScene: async (scene) => {
			if (get().generating || get().continuous) {
				throw new Error(GENERATION_BUSY_MESSAGE);
			}
			return runOnce(new Set(), scene);
		},
		cancel: async () => {
			continuousRun += 1;
			set({ continuous: false });
			await stopCurrentRequest();
		},
	};
});

// The output of an abandoned request that the backend still completed is listed (the Output browser's position and
// Last reach it), from the generation's 'complete' progress event.
useTasksStore.subscribe((state, previous) => {
	const event = selectGenerationEvent(state);
	if (abandonedRequest && event?.stage === 'complete' && event !== selectGenerationEvent(previous)) {
		abandonedRequest = false;
		void useOutputsStore.getState().refreshIds();
	}
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
