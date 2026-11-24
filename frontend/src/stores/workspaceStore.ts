// Workspace store: single truth holder of the floating-window layout (panes + category cards share one
// z-order), pane visibility and the visibility mode. Persisted as 'workspace-store' ({ windows, hiddenPaneIds });
// when absent it is migrated from the legacy 'panel-layouts-store' + 'workspace-z-index-store' through
// persistedStoreOptions({ legacy }). Layout algorithms live in src/domain/layout.ts.
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
	arrangeGrid,
	backZ,
	DEFAULT_WINDOW_RECT,
	frontZ,
	maxWindowZ,
	migrateLegacyWorkspace,
	paneWindowKey,
	sanitizeRect,
	sanitizeWindowLayout,
	sanitizeWindowLayouts,
	type ArrangeItem,
	type Rect,
	type Viewport,
	type WindowKey,
	type WindowLayout,
	type WindowLayouts,
} from '../domain/layout';
import { persistedStoreOptions } from '../persistence/persist';
import { LEGACY_STORE_NAMES, STORE_NAMES } from '../persistence/storeNames';

/** Ctrl+H cycles all -> categories-only -> panes-only -> all. Not persisted. */
export type VisibilityMode = 'all' | 'categories-only' | 'panes-only';

export const NEXT_VISIBILITY_MODE: Record<VisibilityMode, VisibilityMode> = {
	all: 'categories-only',
	'categories-only': 'panes-only',
	'panes-only': 'all',
};

export type WorkspaceState = {
	windows: Partial<Record<WindowKey, WindowLayout>>;
	/** Registered panes (src/workspace/paneRegistry.tsx) the user closed. */
	hiddenPaneIds: string[];
	visibilityMode: VisibilityMode;
};

export type WorkspaceActions = {
	/** End of a drag/resize (or keyboard move): stores the rect (sanitized: x,y >= 8, size >= 1), keeps z. */
	commitWindowRect: (key: WindowKey, rect: Rect) => void;
	/** Brings the window to the front (z = max + 1; no-op when already on top). */
	focusWindow: (key: WindowKey) => void;
	/** Sends the window behind every other window. */
	sendWindowToBack: (key: WindowKey) => void;
	renameWindow: (from: WindowKey, to: WindowKey) => void;
	removeWindow: (key: WindowKey) => void;
	/** Grid arrangement used by "Reorganize categories": rows left-to-right inside the viewport, row height
	 *  capped at 30% of the viewport height, stacked above every other window in item order.
	 *  A window's stored size takes precedence over the item's preferred (estimated) size. */
	arrangeCategoryWindows: (items: ArrangeItem[], viewport: Viewport) => void;
	setPaneVisible: (paneId: string, visible: boolean) => void;
	/** Shows a registered pane in front of every window: makes it visible, brings its window to the front and leaves
	 *  'categories-only' for 'all' (where panes are hidden). Cross-pane flows use it (e.g. "Create character" opens
	 *  the Characters pane). */
	revealPane: (paneId: string) => void;
	cycleVisibilityMode: () => void;
	/** Wholesale replacement (legacy import from app_state.json); incomplete rects are dropped. */
	replaceWindows: (windows: Partial<Record<WindowKey, WindowLayout>>) => void;
};

export type WorkspaceStore = WorkspaceState & WorkspaceActions;

/**
 * Rect each window is currently drawn at while it has no stored layout (its view's fallback, registered
 * by useWindowLayout). Focusing or sending back such a window stores this rect with the new z, so the
 * window does not jump. Not state: a cache of view defaults.
 */
const renderedFallbacks = new Map<WindowKey, Rect>();

function currentRect(windows: WindowLayouts, key: WindowKey): Rect {
	const stored = windows[key];
	const fallback = renderedFallbacks.get(key) ?? DEFAULT_WINDOW_RECT;
	return stored ? sanitizeRect(stored, fallback) : fallback;
}

function withZ(windows: WindowLayouts, key: WindowKey, z: number): WindowLayouts {
	return { ...windows, [key]: { ...currentRect(windows, key), z } };
}

export const useWorkspaceStore = create<WorkspaceStore>()(
	persist(
		(set) => ({
			windows: {},
			hiddenPaneIds: [],
			visibilityMode: 'all' as VisibilityMode,
			commitWindowRect: (key, rect) =>
				set((state) => {
					const stored = state.windows[key];
					const fallback = stored ? currentRect(state.windows, key) : (renderedFallbacks.get(key) ?? DEFAULT_WINDOW_RECT);
					return { windows: { ...state.windows, [key]: sanitizeWindowLayout({ ...rect, z: stored?.z }, fallback) } };
				}),
			focusWindow: (key) =>
				set((state) => {
					const z = frontZ(state.windows, key);
					return z === null ? state : { windows: withZ(state.windows, key, z) };
				}),
			sendWindowToBack: (key) =>
				set((state) => {
					const z = backZ(state.windows, key);
					return z === null ? state : { windows: withZ(state.windows, key, z) };
				}),
			renameWindow: (from, to) =>
				set((state) => {
					const layout = state.windows[from];
					if (from === to || !layout) {
						return state;
					}
					const windows: WindowLayouts = { ...state.windows, [to]: layout };
					delete windows[from];
					return { windows };
				}),
			removeWindow: (key) =>
				set((state) => {
					if (!(key in state.windows)) {
						return state;
					}
					const windows = { ...state.windows };
					delete windows[key];
					return { windows };
				}),
			arrangeCategoryWindows: (items, viewport) =>
				set((state) => {
					const resolved = items.map((item) => {
						const stored = state.windows[item.key];
						return stored ? { key: item.key, preferred: { width: stored.width, height: stored.height } } : item;
					});
					return { windows: { ...state.windows, ...arrangeGrid(resolved, viewport, maxWindowZ(state.windows)) } };
				}),
			setPaneVisible: (paneId, visible) =>
				set((state) => {
					const hidden = state.hiddenPaneIds.includes(paneId);
					if (hidden === !visible) {
						return state;
					}
					return {
						hiddenPaneIds: visible ? state.hiddenPaneIds.filter((id) => id !== paneId) : [...state.hiddenPaneIds, paneId],
					};
				}),
			revealPane: (paneId) =>
				set((state) => {
					const key = paneWindowKey(paneId);
					const z = frontZ(state.windows, key);
					return {
						hiddenPaneIds: state.hiddenPaneIds.includes(paneId) ? state.hiddenPaneIds.filter((id) => id !== paneId) : state.hiddenPaneIds,
						windows: z === null ? state.windows : withZ(state.windows, key, z),
						visibilityMode: state.visibilityMode === 'categories-only' ? 'all' : state.visibilityMode,
					};
				}),
			cycleVisibilityMode: () => set((state) => ({ visibilityMode: NEXT_VISIBILITY_MODE[state.visibilityMode] })),
			replaceWindows: (windows) => set({ windows: sanitizeWindowLayouts(windows) }),
		}),
		persistedStoreOptions<WorkspaceStore, Pick<WorkspaceState, 'windows' | 'hiddenPaneIds'>>({
			name: STORE_NAMES.workspace,
			version: 0,
			partialize: (state) => ({ windows: state.windows, hiddenPaneIds: state.hiddenPaneIds }),
			legacy: {
				names: [LEGACY_STORE_NAMES.panelLayouts, LEGACY_STORE_NAMES.workspaceZIndex],
				combine: (envelopes) =>
					migrateLegacyWorkspace(envelopes[LEGACY_STORE_NAMES.panelLayouts], envelopes[LEGACY_STORE_NAMES.workspaceZIndex]),
			},
		}),
	),
);

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

/** Categories are shown in 'all' and 'categories-only'. */
export const selectShowCategories = (state: WorkspaceState): boolean => state.visibilityMode !== 'panes-only';

/** Panes are shown in 'all' and 'panes-only'. */
export const selectShowPanes = (state: WorkspaceState): boolean => state.visibilityMode !== 'categories-only';

/** Layout of a window: the stored one (sanitized), else `fallback` with z = 1. Referentially stable while
 *  the stored layout and the fallback values are unchanged. */
export function useWindowLayout(key: WindowKey, fallback: Rect): WindowLayout {
	const stored = useWorkspaceStore((state) => state.windows[key]);
	const { x, y, width, height } = fallback;
	useEffect(() => {
		renderedFallbacks.set(key, { x, y, width, height });
	}, [key, x, y, width, height]);
	return useMemo(() => sanitizeWindowLayout(stored ?? { x, y, width, height }, { x, y, width, height }), [stored, x, y, width, height]);
}

/** The window is drawn above every other window (it gets the raised elevation). */
export function useIsTopWindow(key: WindowKey): boolean {
	return useWorkspaceStore((state) => frontZ(state.windows, key) === null);
}

export function useIsPaneVisible(paneId: string): boolean {
	return useWorkspaceStore((state) => !state.hiddenPaneIds.includes(paneId));
}
