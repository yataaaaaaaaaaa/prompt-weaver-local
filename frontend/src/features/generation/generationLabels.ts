// THE accessible names of the generation panel's own landmarks and controls (the 'Generation' region of Create): the
// views render them, their component tests and the e2e helpers (frontend/e2e/generation/generationPane.ts) find the
// elements by them. Pure data (no React, no Fluent), so the Node-side e2e suite can import it.

export const GENERATION_LABELS = {
	/** The sticky action area (and the compact strip's actions): a group holding Generate, Continuous and Cancel. */
	actions: 'Generation actions',
	/** The progressive disclosure at the end of the panel body. */
	moreOptions: 'More options',
	/** The progress bar. */
	progress: 'Generation progress',
} as const;

/** The action buttons' names (the e2e suite and the README use these exact names). */
export const GENERATION_ACTION_NAMES = {
	generate: 'Generate',
	generating: 'Generating…',
	continuous: 'Continuous',
	cancel: 'Cancel',
} as const;
