import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createFileBackedStorage } from '../utils/createFileBackedStorage';

export type PanelName = string;

export type PanelLayout = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type PanelLayoutsState = {
    panels: Record<PanelName, PanelLayout>;
    setPanelLayout: (name: PanelName, layout: PanelLayout) => void;
    patchPanelLayout: (name: PanelName, patch: Partial<PanelLayout>) => void;
    setPanelPosition: (name: PanelName, x: number, y: number) => void;
    setPanelSize: (name: PanelName, width: number, height: number) => void;
    renamePanel: (previousName: PanelName, nextName: PanelName) => void;
    removePanel: (name: PanelName) => void;
    clear: () => void;
};

const DefaultPanelLayout: PanelLayout = { x: 8, y: 8, width: 320, height: 240 };
const MinVisiblePanelOffset = 8;

function clampPositive(value: number): number {
    return Number.isFinite(value) ? Math.max(MinVisiblePanelOffset, value) : MinVisiblePanelOffset;
}

function clampPositiveSize(value: number, fallback: number): number {
    return Number.isFinite(value) ? Math.max(1, value) : fallback;
}

function sanitizeLayout(layout: PanelLayout): PanelLayout {
    return {
        x: clampPositive(layout.x),
        y: clampPositive(layout.y),
        width: clampPositiveSize(layout.width, DefaultPanelLayout.width),
        height: clampPositiveSize(layout.height, DefaultPanelLayout.height),
    };
}

function mergeWithDefault(layout: Partial<PanelLayout> | undefined, fallback?: Partial<PanelLayout>): PanelLayout {
    return sanitizeLayout({
        x: layout?.x ?? fallback?.x ?? DefaultPanelLayout.x,
        y: layout?.y ?? fallback?.y ?? DefaultPanelLayout.y,
        width: layout?.width ?? fallback?.width ?? DefaultPanelLayout.width,
        height: layout?.height ?? fallback?.height ?? DefaultPanelLayout.height,
    });
}

export const usePanelLayoutsStore = create<PanelLayoutsState>()(
    persist(
        (set) => ({
            panels: {},
            setPanelLayout: (name, layout) => set((state) => ({ panels: { ...state.panels, [name]: mergeWithDefault(layout) } })),
            patchPanelLayout: (name, patch) => set((state) => ({ panels: { ...state.panels, [name]: mergeWithDefault({ ...state.panels[name], ...patch }) } })),
            setPanelPosition: (name, x, y) => set((state) => ({ panels: { ...state.panels, [name]: mergeWithDefault({ ...state.panels[name], x, y }) } })),
            setPanelSize: (name, width, height) => set((state) => ({ panels: { ...state.panels, [name]: mergeWithDefault({ ...state.panels[name], width, height }) } })),
            renamePanel: (previousName, nextName) => set((state) => {
                if (previousName === nextName || !state.panels[previousName]) {
                    return state;
                }
                const nextPanels = { ...state.panels, [nextName]: state.panels[previousName] };
                delete nextPanels[previousName];
                return { panels: nextPanels };
            }),
            removePanel: (name) => set((state) => {
                const nextPanels = { ...state.panels };
                delete nextPanels[name];
                return { panels: nextPanels };
            }),
            clear: () => ({ panels: {} }),
        }),
        {
            name: 'panel-layouts-store',
            storage: createJSONStorage(() => createFileBackedStorage('panel-layouts-store')),
            partialize: (state) => ({ panels: state.panels }),
        },
    ),
);

export function usePanelLayout(name: PanelName, fallback?: Partial<PanelLayout>) {
    const storedLayout = usePanelLayoutsStore((state) => state.panels[name]);
    const layout = useMemo(() => mergeWithDefault(storedLayout, fallback), [storedLayout, fallback]);
    const setPanelLayout = usePanelLayoutsStore((state) => state.setPanelLayout);
    const patchPanelLayout = usePanelLayoutsStore((state) => state.patchPanelLayout);
    const setPanelPosition = usePanelLayoutsStore((state) => state.setPanelPosition);
    const setPanelSize = usePanelLayoutsStore((state) => state.setPanelSize);
    const renamePanel = usePanelLayoutsStore((state) => state.renamePanel);
    const removePanel = usePanelLayoutsStore((state) => state.removePanel);

    useEffect(() => {
        if (!storedLayout) {
            return;
        }
        const sanitizedLayout = sanitizeLayout(storedLayout);
        if (
            sanitizedLayout.x !== storedLayout.x
            || sanitizedLayout.y !== storedLayout.y
            || sanitizedLayout.width !== storedLayout.width
            || sanitizedLayout.height !== storedLayout.height
        ) {
            patchPanelLayout(name, sanitizedLayout);
        }
    }, [name, patchPanelLayout, storedLayout]);

    return useMemo(() => ({
        ...layout,
        setLayout: (nextLayout: PanelLayout) => setPanelLayout(name, nextLayout),
        setPosition: (x: number, y: number) => setPanelPosition(name, x, y),
        setSize: (width: number, height: number) => setPanelSize(name, width, height),
        patchLayout: (patch: Partial<PanelLayout>) => patchPanelLayout(name, patch),
        rename: (nextName: string) => renamePanel(name, nextName),
        remove: () => removePanel(name),
    }), [layout, name, patchPanelLayout, removePanel, renamePanel, setPanelLayout, setPanelPosition, setPanelSize]);
}
