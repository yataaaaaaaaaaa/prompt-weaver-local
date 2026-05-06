import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { filterKnownLoraIds } from '../app/loraSelection';
import type { LibraryState, LoRASpec, ModelSpec } from '../types';
import { createFileBackedStorage } from '../utils/createFileBackedStorage';

type LibraryStore = {
    models: ModelSpec[];
    loras: LoRASpec[];
    selectedModelId: string;
    selectedLoraIds: string[];
    lastModelDir: string | null;
    lastLoraDir: string | null;
    setLibrary: (library: LibraryState) => void;
    setSelectedModelId: (modelId: string) => void;
    setSelectedLoraIds: (loraIds: string[]) => void;
    toggleSelectedLoraId: (loraId: string) => void;
    addModel: (model: ModelSpec) => void;
    addLoras: (loras: LoRASpec[]) => void;
    removeLora: (loraId: string) => void;
    setLastModelDir: (value: string | null) => void;
    setLastLoraDir: (value: string | null) => void;
    reset: () => void;
};

export const useLibraryStore = create<LibraryStore>()(
    persist(
        (set) => ({
            models: [],
            loras: [],
            selectedModelId: '',
            selectedLoraIds: [],
            lastModelDir: null,
            lastLoraDir: null,
            setLibrary: (library) => set((state) => ({
                models: library.models,
                loras: library.loras,
                selectedModelId: state.selectedModelId && library.models.some((item) => item.id === state.selectedModelId)
                    ? state.selectedModelId
                    : library.models[0]?.id ?? '',
                selectedLoraIds: state.selectedLoraIds.filter((item) => library.loras.some((lora) => lora.id === item)),
            })),
            setSelectedModelId: (selectedModelId) => set({ selectedModelId }),
            setSelectedLoraIds: (selectedLoraIds) => set((state) => ({
                selectedLoraIds: filterKnownLoraIds(selectedLoraIds, state),
            })),
            toggleSelectedLoraId: (loraId) => set((state) => ({
                selectedLoraIds: !state.loras.some((item) => item.id === loraId)
                    ? state.selectedLoraIds
                    : state.selectedLoraIds.includes(loraId)
                        ? state.selectedLoraIds.filter((item) => item !== loraId)
                        : [...state.selectedLoraIds, loraId],
            })),
            addModel: (model) => set((state) => ({
                models: state.models.some((item) => item.id === model.id) ? state.models : [...state.models, model],
                selectedModelId: model.id,
            })),
            addLoras: (loras) => set((state) => {
                const existingById = new Map(state.loras.map((item) => [item.id, item]));
                for (const lora of loras) {
                    existingById.set(lora.id, lora);
                }
                return { loras: Array.from(existingById.values()) };
            }),
            removeLora: (loraId) => set((state) => ({
                loras: state.loras.filter((item) => item.id !== loraId),
                selectedLoraIds: state.selectedLoraIds.filter((item) => item !== loraId),
            })),
            setLastModelDir: (lastModelDir) => set({ lastModelDir }),
            setLastLoraDir: (lastLoraDir) => set({ lastLoraDir }),
            reset: () => set({ models: [], loras: [], selectedModelId: '', selectedLoraIds: [], lastModelDir: null, lastLoraDir: null }),
        }),
        {
            name: 'library-store',
            storage: createJSONStorage(() => createFileBackedStorage('library-store')),
            partialize: (state) => ({
                models: state.models,
                loras: state.loras,
                selectedModelId: state.selectedModelId,
                selectedLoraIds: state.selectedLoraIds,
                lastModelDir: state.lastModelDir,
                lastLoraDir: state.lastLoraDir,
            }),
            merge: (persisted, current) => {
                const persistedState = persisted as Partial<LibraryStore>;
                const next = {
                    ...current,
                    ...persistedState,
                    models: persistedState.models ?? current.models,
                    loras: persistedState.loras ?? current.loras,
                    selectedModelId: persistedState.selectedModelId ?? current.selectedModelId,
                    selectedLoraIds: persistedState.selectedLoraIds ?? current.selectedLoraIds,
                    lastModelDir: persistedState.lastModelDir ?? current.lastModelDir,
                    lastLoraDir: persistedState.lastLoraDir ?? current.lastLoraDir,
                };
                return {
                    ...next,
                    selectedModelId: next.models.some((item) => item.id === next.selectedModelId)
                        ? next.selectedModelId
                        : next.models[0]?.id ?? '',
                    selectedLoraIds: filterKnownLoraIds(next.selectedLoraIds, next),
                };
            },
        },
    ),
);
