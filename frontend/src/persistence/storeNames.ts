// Single owner of persisted store names (= directory names under <data_dir>/stores on the backend).
// Existing names must never change: the user's data lives under them.

export const STORE_NAMES = {
	/** Historical spelling, kept because existing data lives there. */
	categories: 'categorie-store',
	forbiddenRules: 'forbidden-associations-store',
	library: 'library-store',
	generationSettings: 'settings-store',
	outputs: 'current-image-store',
	/** The docked layout of the Create section (region widths, collapsed regions, the output details panel).
	 *  Derived once from the legacy floating workspace (src/domain/legacyLayout.ts) when absent. */
	layout: 'layout-store',
	/** The prompt board (category card order, collapsed cards). Derived once from the legacy floating workspace
	 *  (window positions: top-to-bottom, left-to-right) when absent. */
	board: 'board-store',
	/** The Story section's layout (whether its dock, the co-writer panel, is collapsed). */
	story: 'story-store',
} as const;

/** Stores of older versions; only read by legacy migrations, never written (they stay untouched on disk). */
export const LEGACY_STORE_NAMES = {
	/** The floating-window workspace (version 0: windows + hiddenPaneIds); replaced by layout-store + board-store. */
	workspace: 'workspace-store',
	/** Merged into workspace-store by older versions. */
	panelLayouts: 'panel-layouts-store',
	workspaceZIndex: 'workspace-z-index-store',
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];
export type LegacyStoreName = (typeof LEGACY_STORE_NAMES)[keyof typeof LEGACY_STORE_NAMES];
