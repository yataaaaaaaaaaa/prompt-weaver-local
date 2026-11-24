// Generation settings store: size/steps/CFG/negative prompt/seed inputs and behaviors
// (persisted as 'settings-store', version 0 - field names are the existing persisted format).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_GENERATION_SETTINGS, sanitizeGenerationSettings, type GenerationSettings } from '../domain/generationRequest';
import type { SeedBehavior, SeedSnapshot } from '../domain/seeds';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';

/** Persisted format (version 0): defined once in src/domain/generationRequest.ts. */
export type GenerationSettingsState = GenerationSettings;

export type GenerationSettingsActions = {
	setWidth: (value: number) => void;
	setHeight: (value: number) => void;
	setSteps: (value: number) => void;
	setGuidanceScale: (value: number) => void;
	setNegativePrompt: (value: string) => void;
	setPromptSeedInput: (value: string) => void;
	setSeedInput: (value: string) => void;
	setPromptSeedBehavior: (value: SeedBehavior) => void;
	setImageSeedBehavior: (value: SeedBehavior) => void;
	/** Seed advance after a generation and undo restore. */
	applySeedSnapshot: (snapshot: Partial<SeedSnapshot>) => void;
	/** Wholesale replacement (legacy import). */
	replaceAll: (settings: Partial<GenerationSettingsState>) => void;
};

export type GenerationSettingsStore = GenerationSettingsState & GenerationSettingsActions;

/** Initial state and fallback of invalid persisted values: derived from the backend's GenerationDefaults. */
export { DEFAULT_GENERATION_SETTINGS };

/** The settings fields only (persisted part, generation request input). */
export function selectGenerationSettings(state: GenerationSettingsState): GenerationSettings {
	return {
		width: state.width,
		height: state.height,
		steps: state.steps,
		guidanceScale: state.guidanceScale,
		negativePrompt: state.negativePrompt,
		promptSeedInput: state.promptSeedInput,
		seedInput: state.seedInput,
		promptSeedBehavior: state.promptSeedBehavior,
		imageSeedBehavior: state.imageSeedBehavior,
		promptCategorySeedState: state.promptCategorySeedState,
	};
}

export const useGenerationSettingsStore = create<GenerationSettingsStore>()(
	persist(
		(set, get) => ({
			...DEFAULT_GENERATION_SETTINGS,
			setWidth: (width) => set({ width }),
			setHeight: (height) => set({ height }),
			setSteps: (steps) => set({ steps }),
			setGuidanceScale: (guidanceScale) => set({ guidanceScale }),
			setNegativePrompt: (negativePrompt) => set({ negativePrompt }),
			setPromptSeedInput: (promptSeedInput) => set({ promptSeedInput }),
			setSeedInput: (seedInput) => set({ seedInput }),
			setPromptSeedBehavior: (promptSeedBehavior) => set({ promptSeedBehavior }),
			setImageSeedBehavior: (imageSeedBehavior) => set({ imageSeedBehavior }),
			applySeedSnapshot: (snapshot) => set(snapshot),
			replaceAll: (settings) => set(sanitizeGenerationSettings(settings, selectGenerationSettings(get()))),
		}),
		persistedStoreOptions<GenerationSettingsStore, GenerationSettingsState>({
			name: STORE_NAMES.generationSettings,
			version: 0,
			partialize: (state) => selectGenerationSettings(state),
			// Invalid persisted values fall back to the current (default) ones.
			merge: (persisted, current) => ({ ...current, ...sanitizeGenerationSettings(persisted, selectGenerationSettings(current)) }),
		}),
	),
);

export const selectSeedSnapshot = (state: GenerationSettingsState): SeedSnapshot => ({
	promptSeedInput: state.promptSeedInput,
	seedInput: state.seedInput,
	promptSeedBehavior: state.promptSeedBehavior,
	imageSeedBehavior: state.imageSeedBehavior,
	promptCategorySeedState: state.promptCategorySeedState,
});

/** The prompt seed field is disabled in 'per_category_cycle' (each category keeps its own counter). */
export const selectPromptSeedManagedPerCategory = (state: GenerationSettingsState): boolean =>
	state.promptSeedBehavior === 'per_category_cycle';
