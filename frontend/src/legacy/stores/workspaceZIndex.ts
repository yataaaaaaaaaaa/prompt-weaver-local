import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PaneKey } from '../types';
import { createFileBackedStorage } from '../utils/createFileBackedStorage';

const STORE_FILE_PATH = 'workspace-z-index-store';

type WorkspaceZIndexState = {
    maxZ: number;
    paneZ: Partial<Record<PaneKey, number>>;
    categoryZ: Record<string, number>;

    focusPane: (pane: PaneKey) => number;
    focusCategory: (categoryId: string) => number;
    lowerPane: (pane: PaneKey) => number;
    lowerCategory: (categoryId: string) => number;

    setPaneZIndex: (pane: PaneKey, zIndex: number) => void;
    setCategoryZIndex: (categoryId: string, zIndex: number) => void;

    getPaneZIndex: (pane: PaneKey, fallback?: number) => number;
    getCategoryZIndex: (categoryId: string, fallback?: number) => number;

    clearPane: (pane: PaneKey) => void;
    clearCategory: (categoryId: string) => void;

    reset: () => void;
};

const InitialMaxZ = 1;

function getMinimumAssignedZ(state: Pick<WorkspaceZIndexState, 'paneZ' | 'categoryZ'>): number {
    const values = [
        ...Object.values(state.paneZ),
        ...Object.values(state.categoryZ),
    ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    if (values.length === 0) {
        return InitialMaxZ;
    }

    return Math.min(...values);
}

export const useWorkspaceZIndexStore = create<WorkspaceZIndexState>()(
    persist(
        (set, get) => ({
            maxZ: InitialMaxZ,
            paneZ: {},
            categoryZ: {},

            focusPane: (pane) => {
                const state = get();
                const current = state.paneZ[pane] ?? 0;
                if (current === state.maxZ) {
                    return current;
                }

                const zIndex = state.maxZ + 1;
                set((previous) => ({
                    maxZ: zIndex,
                    paneZ: {
                        ...previous.paneZ,
                        [pane]: zIndex,
                    },
                }));
                return zIndex;
            },

            focusCategory: (categoryId) => {
                const state = get();
                const current = state.categoryZ[categoryId] ?? 0;
                if (current === state.maxZ) {
                    return current;
                }

                const zIndex = state.maxZ + 1;
                set((previous) => ({
                    maxZ: zIndex,
                    categoryZ: {
                        ...previous.categoryZ,
                        [categoryId]: zIndex,
                    },
                }));
                return zIndex;
            },

            lowerPane: (pane) => {
                const state = get();
                const current = state.paneZ[pane] ?? InitialMaxZ;
                const minimum = getMinimumAssignedZ(state);
                const zIndex = current <= minimum ? current : minimum - 1;

                set((previous) => ({
                    paneZ: {
                        ...previous.paneZ,
                        [pane]: zIndex,
                    },
                }));
                return zIndex;
            },

            lowerCategory: (categoryId) => {
                const state = get();
                const current = state.categoryZ[categoryId] ?? InitialMaxZ;
                const minimum = getMinimumAssignedZ(state);
                const zIndex = current <= minimum ? current : minimum - 1;

                set((previous) => ({
                    categoryZ: {
                        ...previous.categoryZ,
                        [categoryId]: zIndex,
                    },
                }));
                return zIndex;
            },

            setPaneZIndex: (pane, zIndex) =>
                set((state) => ({
                    maxZ: Math.max(state.maxZ, zIndex),
                    paneZ: {
                        ...state.paneZ,
                        [pane]: zIndex,
                    },
                })),

            setCategoryZIndex: (categoryId, zIndex) =>
                set((state) => ({
                    maxZ: Math.max(state.maxZ, zIndex),
                    categoryZ: {
                        ...state.categoryZ,
                        [categoryId]: zIndex,
                    },
                })),

            getPaneZIndex: (pane, fallback = 1) => get().paneZ[pane] ?? fallback,
            getCategoryZIndex: (categoryId, fallback = 1) => get().categoryZ[categoryId] ?? fallback,

            clearPane: (pane) =>
                set((state) => {
                    const paneZ = { ...state.paneZ };
                    delete paneZ[pane];
                    return { paneZ };
                }),

            clearCategory: (categoryId) =>
                set((state) => {
                    const categoryZ = { ...state.categoryZ };
                    delete categoryZ[categoryId];
                    return { categoryZ };
                }),

            reset: () => ({
                maxZ: InitialMaxZ,
                paneZ: {},
                categoryZ: {},
            }),
        }),
        {
            name: 'workspace-z-index-store',
            storage: createJSONStorage(() => createFileBackedStorage(STORE_FILE_PATH)),
            partialize: (state) => ({
                maxZ: state.maxZ,
                paneZ: state.paneZ,
                categoryZ: state.categoryZ,
            }),
        },
    ),
);

export function usePaneZIndex(pane: PaneKey, fallback = 1): number {
    return useWorkspaceZIndexStore((state) => state.paneZ[pane] ?? fallback);
}

export function useCategoryZIndex(categoryId: string, fallback = 1): number {
    return useWorkspaceZIndexStore((state) => state.categoryZ[categoryId] ?? fallback);
}
