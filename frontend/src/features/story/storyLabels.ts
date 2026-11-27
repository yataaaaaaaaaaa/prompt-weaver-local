// THE accessible names of the Story section's landmarks and controls: the views render them, their component tests and
// the e2e helpers (frontend/e2e/story/storyDriver.ts) find the elements by them. Pure data (no React, no Fluent), so the
// Node-side e2e suite can import it.

export const STORY_LABELS = {
	/** The navigation pane listing the stories. */
	storyList: 'Stories',
	/** The results region: the selected story's settings and its scenes. */
	scenes: 'Scenes',
	/** The detail panel: the selected scene's editor. */
	sceneDetails: 'Scene details',
	/** The results region in read mode. */
	reader: 'Reader',
	/** The section's command toolbar. */
	commands: 'Story commands',
	newStory: 'New story',
	addScene: 'Add scene',
	generateMissing: 'Generate missing',
	cancelGeneration: 'Cancel',
	read: 'Read',
	exportStory: 'Export',
	storyTitle: 'Story title',
	storyCharacters: 'Story characters',
	logline: 'Logline',
	/** The disclosure of the story's synopsis and style notes. */
	storyFlow: 'Synopsis and style',
	synopsis: 'Synopsis',
	styleNotes: 'Style and tone',
	deleteStory: 'Delete story',
	/** The list of the scene cards. */
	sceneList: 'Scene cards',
	sceneTitle: 'Scene title',
	sceneText: 'Scene text',
	/** The scene's flow notes (never part of the prompt). */
	flow: 'Flow',
	beat: 'Beat',
	shot: 'Shot',
	setting: 'Setting',
	mood: 'Mood',
	sceneLoras: 'Scene LoRAs',
	extraTags: 'Scene tags',
	negativeTags: 'Negative tags',
	lockedSubPrompts: 'Locked sub-prompts',
	lockSubPrompt: 'Lock a sub-prompt',
	sameCharacters: "Same characters as the story",
	sceneCharacters: 'Scene characters',
	seed: 'Fixed seed',
	randomSeed: 'Random seed',
	variants: 'Variants',
	generate: 'Generate',
	regenerate: 'Regenerate',
	useCurrentOutput: 'Use the current output',
	duplicateScene: 'Duplicate scene',
	deleteScene: 'Delete scene',
	previousPage: 'Previous page',
	nextPage: 'Next page',
	closeReader: 'Close reader',
	/** The Create viewer's menu button. */
	addToStory: 'Add to story',
	/** The "Add to story" menu item creating a story. */
	addToNewStory: 'New story',
} as const;

/** The accessible name of a scene card: 'Scene 2: The storm' (its 1-based position and title). */
export function sceneCardName(position: number, title: string): string {
	return `Scene ${position}: ${title}`;
}

/** The accessible name of a scene card's reorder handle. */
export function reorderSceneName(title: string): string {
	return `Reorder ${title}`;
}

/** The name of a scene's illustration (alt text; the HTML export uses the same words). */
export function sceneIllustrationName(title: string): string {
	return `Illustration of ${title}`;
}

/** The name of a variant option: 'Variant <output id>'. */
export function sceneVariantName(outputId: string): string {
	return `Variant ${outputId}`;
}

/** The name of a variant's Remove button: 'Remove variant <output id>'. */
export function removeVariantName(outputId: string): string {
	return `Remove variant ${outputId}`;
}

/** The reader's page position: 'Page 2 of 5' (0-based page in, 1-based out). */
export function readerPageText(page: number, total: number): string {
	return `Page ${page + 1} of ${total}`;
}
