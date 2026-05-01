import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PromptCategorySeedStateEntry, SeedBehavior } from '../types';
import { createFileBackedStorage } from '../utils/createFileBackedStorage';

type SettingsStore = {
    width: number;
    height: number;
    steps: number;
    guidanceScale: number;
    negativePrompt: string;
    promptSeedInput: string;
    seedInput: string;
    promptSeedBehavior: SeedBehavior;
    imageSeedBehavior: SeedBehavior;
    promptCategorySeedState: Record<string, PromptCategorySeedStateEntry>;
    setWidth: (value: number) => void;
    setHeight: (value: number) => void;
    setSteps: (value: number) => void;
    setGuidanceScale: (value: number) => void;
    setNegativePrompt: (value: string) => void;
    setPromptSeedInput: (value: string) => void;
    setSeedInput: (value: string) => void;
    setPromptSeedBehavior: (value: SeedBehavior) => void;
    setImageSeedBehavior: (value: SeedBehavior) => void;
    setPromptCategorySeedState: (value: Record<string, PromptCategorySeedStateEntry>) => void;
    hydrate: (payload: Partial<Pick<SettingsStore, 'width' | 'height' | 'steps' | 'guidanceScale' | 'negativePrompt' | 'promptSeedInput' | 'seedInput' | 'promptSeedBehavior' | 'imageSeedBehavior' | 'promptCategorySeedState'>>) => void;
};

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set) => ({
            width: 1024,
            height: 1024,
            steps: 30,
            guidanceScale: 7,
            negativePrompt: '',
            promptSeedInput: '',
            seedInput: '',
            promptSeedBehavior: 'fixed',
            imageSeedBehavior: 'fixed',
            promptCategorySeedState: {},
            setWidth: (width) => set({ width }),
            setHeight: (height) => set({ height }),
            setSteps: (steps) => set({ steps }),
            setGuidanceScale: (guidanceScale) => set({ guidanceScale }),
            setNegativePrompt: (negativePrompt) => set({ negativePrompt }),
            setPromptSeedInput: (promptSeedInput) => set({ promptSeedInput }),
            setSeedInput: (seedInput) => set({ seedInput }),
            setPromptSeedBehavior: (promptSeedBehavior) => set({ promptSeedBehavior }),
            setImageSeedBehavior: (imageSeedBehavior) => set({ imageSeedBehavior }),
            setPromptCategorySeedState: (promptCategorySeedState) => set({ promptCategorySeedState }),
            hydrate: (payload) => set(payload),
        }),
        {
            name: 'settings-store',
            storage: createJSONStorage(() => createFileBackedStorage('settings-store')),
        },
    ),
);
