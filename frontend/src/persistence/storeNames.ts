// Single owner of persisted store names (= directory names under <data_dir>/stores on the backend).
// Existing names must never change: the user's data lives under them.

export const STORE_NAMES = {
	/** Historical spelling, kept because existing data lives there. */
	categories: 'categorie-store',
	forbiddenRules: 'forbidden-associations-store',
	library: 'library-store',
	generationSettings: 'settings-store',
	outputs: 'current-image-store',
	/** Replaces panel-layouts-store + workspace-z-index-store (migrated on first load). */
	workspace: 'workspace-store',
} as const;

/** Stores that were merged into another one; only read by legacy migrations. */
export const LEGACY_STORE_NAMES = {
	panelLayouts: 'panel-layouts-store',
	workspaceZIndex: 'workspace-z-index-store',
} as const;

export type StoreName = (typeof STORE_NAMES)[keyof typeof STORE_NAMES];
export type LegacyStoreName = (typeof LEGACY_STORE_NAMES)[keyof typeof LEGACY_STORE_NAMES];
