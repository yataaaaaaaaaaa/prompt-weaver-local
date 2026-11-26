// Layout store: single truth holder of the docked layout of the Create section (src/domain/layout.ts CreateLayout):
// the stored widths of the viewer and the generation panel, which regions are collapsed, and the output details panel
// of the viewer (open, tab). Persisted as 'layout-store' (version 0). When absent it is derived once from the legacy
// floating workspace ('workspace-store', else 'panel-layouts-store' + 'workspace-z-index-store'; those files are only
// read, never written) through persistedStoreOptions({ legacy }); the session store seeds it from app_state.json's
// pane layouts when no layout store at all exists (importLegacyWorkspace).
//
// Layout algorithms live in src/domain/layout.ts; the measured width of the window is view state (the shell's Create
// layout measures it and calls fitRegions).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CreateRegionId } from '../app/sections';
import { legacyWorkspaceFromEnvelopes, LEGACY_WORKSPACE_STORE_NAMES, type LegacyWorkspaceState } from '../domain/legacyLayout';
import {
	clampRegionWidth,
	DEFAULT_CREATE_LAYOUT,
	generationPanelInset,
	layoutFromLegacyWorkspace,
	nextFocusLayout,
	sanitizeCreateLayout,
	withRegionCollapsed,
	type CreateLayout,
	type DetailsTab,
	type ResizableRegionId,
} from '../domain/layout';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';

export type LayoutState = CreateLayout;

export type LayoutActions = {
	/** Stores a region's width (clamped to its minimum / maximum). Splitters call it with the dragged width. */
	setRegionWidth: (region: ResizableRegionId, width: number) => void;
	/** Collapses (strip) or expands a region. Collapsing the last expanded region is refused (withRegionCollapsed). */
	setRegionCollapsed: (region: CreateRegionId, collapsed: boolean) => void;
	toggleRegionCollapsed: (region: CreateRegionId) => void;
	/** Ctrl+H: all regions -> the prompt board alone -> the image and the generation panel -> all regions
	 *  (nextFocusLayout). */
	cycleFocusLayout: () => void;
	setDetailsOpen: (open: boolean) => void;
	/** Shows a tab of the output details panel (opens the panel and expands the viewer when needed). */
	showDetailsTab: (tab: DetailsTab) => void;
	/** Wholesale replacement from a legacy workspace (session store: app_state.json pane layouts). */
	importLegacyWorkspace: (legacy: LegacyWorkspaceState) => void;
};

export type LayoutStore = LayoutState & LayoutActions;

export const useLayoutStore = create<LayoutStore>()(
	persist(
		(set, get) => ({
			...DEFAULT_CREATE_LAYOUT,
			setRegionWidth: (region, width) => {
				const next = clampRegionWidth(region, width);
				if (get().widths[region] !== next) {
					set((state) => ({ widths: { ...state.widths, [region]: next } }));
				}
			},
			setRegionCollapsed: (region, collapsed) => {
				const next = withRegionCollapsed(get().collapsed, region, collapsed);
				if (next !== get().collapsed) {
					set({ collapsed: next });
				}
			},
			toggleRegionCollapsed: (region) => get().setRegionCollapsed(region, !get().collapsed[region]),
			cycleFocusLayout: () => set((state) => ({ collapsed: nextFocusLayout(state.collapsed) })),
			setDetailsOpen: (open) => {
				if (get().details.open !== open) {
					set((state) => ({ details: { ...state.details, open } }));
				}
			},
			showDetailsTab: (tab) =>
				set((state) => ({
					details: { open: true, tab },
					collapsed: state.collapsed.viewer ? { ...state.collapsed, viewer: false } : state.collapsed,
				})),
			importLegacyWorkspace: (legacy) => set(layoutFromLegacyWorkspace(legacy)),
		}),
		persistedStoreOptions<LayoutStore, CreateLayout>({
			name: STORE_NAMES.layout,
			version: 0,
			partialize: (state) => ({ widths: state.widths, collapsed: state.collapsed, details: state.details }),
			merge: (persisted, current) => (persisted === undefined ? current : { ...current, ...sanitizeCreateLayout(persisted) }),
			legacy: {
				names: LEGACY_WORKSPACE_STORE_NAMES,
				combine: (envelopes) => {
					const legacy = legacyWorkspaceFromEnvelopes(envelopes);
					return legacy ? { state: layoutFromLegacyWorkspace(legacy), version: 0 } : null;
				},
			},
		}),
	),
);

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

export function useIsRegionCollapsed(region: CreateRegionId): boolean {
	return useLayoutStore((state) => state.collapsed[region]);
}

/** The end inset that keeps something clear of the generation panel (domain/layout.ts generationPanelInset). */
export const selectGenerationPanelInset = (state: LayoutState): number => generationPanelInset(state);
