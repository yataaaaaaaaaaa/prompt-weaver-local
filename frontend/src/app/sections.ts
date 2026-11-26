// THE single owner of the app's navigation vocabulary: the task sections of the navigation rail (Create, Models,
// Images, Characters), the docked regions of the Create section, and the accessible names of the shell landmarks.
// Views render these names (the shell, the section views), the stores use the ids (navigationStore, layoutStore),
// and the e2e suite (frontend/e2e/support/app.ts) finds the landmarks by these names: a rename fails everywhere at
// once. Pure data (no React, no icons) so the Node-side e2e helpers can import it.

/** The task sections, in navigation rail order (Ctrl+1..4). */
export const SECTION_IDS = ['create', 'models', 'images', 'characters'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The section's name: the rail item's accessible name and the section <main> landmark's accessible name. */
export const SECTION_LABELS: Readonly<Record<SectionId, string>> = {
	create: 'Create',
	models: 'Models',
	images: 'Images',
	characters: 'Characters',
};

/** What each section is for (rail item tooltips). */
export const SECTION_DESCRIPTIONS: Readonly<Record<SectionId, string>> = {
	create: 'Compose prompts, generate and review outputs',
	models: 'Find, download and pick checkpoints, LoRAs and embeddings',
	images: 'Find online images and reuse their LoRAs, tags and checkpoint',
	characters: 'Keep the same character across generations',
};

/** The app command (src/app/commands.ts, keymap.json) that shows each section. */
export const SECTION_COMMANDS = {
	create: 'show-create',
	models: 'show-models',
	images: 'show-images',
	characters: 'show-characters',
} as const satisfies Readonly<Record<SectionId, string>>;

/** The section shown at startup. */
export const DEFAULT_SECTION: SectionId = 'create';

/** The docked regions of the Create section, left to right. */
export const CREATE_REGION_IDS = ['board', 'viewer', 'generation'] as const;
export type CreateRegionId = (typeof CREATE_REGION_IDS)[number];

/** Accessible name of each Create region (a role="region" landmark rendered by the shell). */
export const CREATE_REGION_LABELS: Readonly<Record<CreateRegionId, string>> = {
	board: 'Prompt board',
	viewer: 'Current image',
	generation: 'Generation',
};

/** Accessible names of the other shell landmarks. */
export const SHELL_LABELS = {
	/** The navigation rail (<nav>). */
	navigation: 'Sections',
	/** The compact command bar at the top of Create (role="toolbar"): current model, active character, LoRA count. */
	createCommandBar: 'Generation inputs',
} as const;

/** Attribute marking the landmarks F6 / Shift+F6 cycle through, in DOM order (the rail, then the shown section's
 *  regions). Its value is a stable id ('nav', a CreateRegionId, 'commands', or a section's own region id). */
export const F6_REGION_ATTRIBUTE = 'data-f6-region';

/** Attribute marking the search box Ctrl+F focuses in the shown section (one per section at most). */
export const SECTION_SEARCH_ATTRIBUTE = 'data-section-search';
