// The co-writer's pure logic (the user's Codex in the Story section): the conversations as the frontend keeps them
// (one per story, the draft while no story is selected; the backend owns them: services/codex/conversations.py), the
// events that change them, what a running tool shows ('Generating The storm…'), and what the app's tools answer Codex
// (the stories, characters and categories as compact data). The tools themselves run in src/stores/coWriterTools.ts.
import type { Character, CodexConversation, CodexEntry, CodexToolName, Scene, Story } from '../api/types';
import type { Category } from './categories';
import { sortCategories } from './categories';
import { missingSceneIds, sceneIllustrationId } from './stories';

/** The key of the draft conversation (used while no story is selected) among the stories' keys. */
export const DRAFT_KEY = '';

export function conversationKey(storyId: string | null): string {
	return storyId ?? DRAFT_KEY;
}

/** The conversations the frontend knows, and which one each story (or the draft) has. */
export type ConversationIndex = {
	conversations: Record<string, CodexConversation>;
	/** Story id (DRAFT_KEY: the draft) -> conversation id. */
	byStory: Record<string, string>;
};

/** `index` with a conversation as the backend sent it: it replaces the one of its id, and becomes the conversation of
 *  its stories (or of the draft); a story it no longer lists keeps pointing at it until it gets another one. A copy
 *  older than the one shown (a lower revision: an HTTP answer that lost the race with the events) is ignored. */
export function withConversation(index: ConversationIndex, conversation: CodexConversation): ConversationIndex {
	const shown = index.conversations[conversation.id];
	if (shown && shown.revision > conversation.revision) {
		return index;
	}
	const byStory = { ...index.byStory };
	for (const storyId of conversation.story_ids) {
		byStory[storyId] = conversation.id;
	}
	if (conversation.draft) {
		byStory[DRAFT_KEY] = conversation.id;
	} else if (byStory[DRAFT_KEY] === conversation.id) {
		delete byStory[DRAFT_KEY];
	}
	return { conversations: { ...index.conversations, [conversation.id]: conversation }, byStory };
}

/** The conversation with `entry` added, or replacing the entry of its id, at `revision` (unchanged when the
 *  conversation shown is already at that revision or newer: it holds the entry). */
export function withEntry(conversation: CodexConversation, entry: CodexEntry, revision: number): CodexConversation {
	if (revision <= conversation.revision) {
		return conversation;
	}
	const index = conversation.entries.findIndex((item) => item.id === entry.id);
	const entries = index < 0 ? [...conversation.entries, entry] : conversation.entries.map((item, position) => (position === index ? entry : item));
	return { ...conversation, entries, revision };
}

/** The conversation with streamed text appended to an entry at `revision` (unchanged when it already holds that text,
 *  or has no such entry yet: the entry event that follows carries the whole text). */
export function withDelta(conversation: CodexConversation, entryId: string, delta: string, revision: number): CodexConversation {
	if (revision <= conversation.revision || !conversation.entries.some((entry) => entry.id === entryId)) {
		return conversation;
	}
	return {
		...conversation,
		entries: conversation.entries.map((entry) => (entry.id === entryId ? { ...entry, text: entry.text + delta } : entry)),
		revision,
	};
}

// ---------------------------------------------------------------------------
// Tool activity (what a tool entry says)
// ---------------------------------------------------------------------------

/** A scene as people read it in the conversation: 'Scene 2 · The storm'. */
export function sceneLabel(story: Pick<Story, 'scenes'>, sceneId: string): string | null {
	const index = story.scenes.findIndex((scene) => scene.id === sceneId);
	return index < 0 ? null : `Scene ${index + 1} · ${story.scenes[index].title}`;
}

const RUNNING_LABELS: Readonly<Record<CodexToolName, (scene: string | null, story: string | null) => string>> = {
	list_stories: () => 'Reading the stories…',
	get_story: (_scene, story) => `Reading ${story ?? 'the story'}…`,
	list_characters: () => 'Reading the characters…',
	list_categories: () => 'Reading the prompt categories…',
	create_story: () => 'Creating a story…',
	update_story: (_scene, story) => `Editing ${story ?? 'the story'}…`,
	add_scene: () => 'Adding a scene…',
	update_scene: (scene) => `Editing ${scene ?? 'a scene'}…`,
	lock_sub_prompt: (scene) => `Locking a sub-prompt of ${scene ?? 'a scene'}…`,
	unlock_category: (scene) => `Unlocking a category of ${scene ?? 'a scene'}…`,
	move_scene: (scene) => `Moving ${scene ?? 'a scene'}…`,
	duplicate_scene: (scene) => `Duplicating ${scene ?? 'a scene'}…`,
	delete_scene: (scene) => `Deleting ${scene ?? 'a scene'}…`,
	generate_scene: (scene) => `Generating ${scene ?? 'a scene'}…`,
	generate_missing_scenes: (_scene, story) => `Generating the missing scenes of ${story ?? 'the story'}…`,
};

export function isCodexToolName(tool: string | null): tool is CodexToolName {
	return tool !== null && Object.hasOwn(RUNNING_LABELS, tool);
}

/** What a tool entry says: its summary once done; while it runs, what it does ('Generating Scene 3 · The storm…'). */
export function toolActivityText(entry: CodexEntry, stories: readonly Story[]): string {
	if (entry.status !== 'running' && entry.text) {
		return entry.text;
	}
	const story = entry.story_id ? (stories.find((item) => item.id === entry.story_id) ?? null) : null;
	const scene = story && entry.scene_id ? sceneLabel(story, entry.scene_id) : null;
	if (!isCodexToolName(entry.tool)) {
		return entry.status === 'running' ? `Using ${entry.tool ?? 'a tool'}…` : `Used ${entry.tool ?? 'a tool'}`;
	}
	const running = RUNNING_LABELS[entry.tool](scene, story?.title ?? null);
	return entry.status === 'running' ? running : `${running.replace(/…$/, '')} did not finish`;
}

/** The tools whose call runs a generation (Stop cancels it). */
export const GENERATION_TOOLS: ReadonlySet<CodexToolName> = new Set<CodexToolName>(['generate_scene', 'generate_missing_scenes']);

// ---------------------------------------------------------------------------
// What the tools answer Codex (compact data; ids for the next calls)
// ---------------------------------------------------------------------------

/** A story's scene as Codex reads it. */
function sceneForCodex(scene: Scene, position: number, outputIds: ReadonlySet<string>) {
	return {
		scene_id: scene.id,
		position,
		title: scene.title,
		text: scene.text,
		extra_tags: scene.extra_tags,
		negative_tags: scene.negative_tags,
		locked_sub_prompts: scene.locks.map((lock) => ({ category: lock.category_name, sub_prompt: lock.prompt_text })),
		characters: scene.character_ids === null ? 'story' : scene.character_ids,
		seed: scene.seed ?? 'random',
		illustrated: sceneIllustrationId(scene, outputIds) !== null,
		pictures: scene.variants.length,
	};
}

export function storyForCodex(story: Story, characters: readonly Character[], outputIds: ReadonlySet<string>) {
	return {
		story_id: story.id,
		title: story.title,
		characters: story.character_ids.map((id) => ({ character_id: id, name: characters.find((item) => item.id === id)?.name ?? '(deleted)' })),
		scenes: story.scenes.map((scene, index) => sceneForCodex(scene, index + 1, outputIds)),
	};
}

export function storiesForCodex(stories: readonly Story[], selectedId: string | null, outputIds: ReadonlySet<string>) {
	return stories.map((story) => ({
		story_id: story.id,
		title: story.title,
		scenes: story.scenes.length,
		illustrated: story.scenes.length - missingSceneIds(story, outputIds).length,
		viewing: story.id === selectedId,
	}));
}

export function charactersForCodex(characters: readonly Character[], activeId: string | null) {
	return characters.map((character) => ({
		character_id: character.id,
		name: character.name,
		identity_tags: character.identity_tags,
		outfit_tags: character.outfit_tags,
		negative_tags: character.negative_tags,
		active_in_create: character.id === activeId,
	}));
}

/** At most this many sub-prompts per category, unless one category is asked for. */
export const CATEGORY_PROMPT_LIMIT = 30;

/** The prompt categories in generation order with their sub-prompts (shortened unless `query` picks categories). */
export function categoriesForCodex(categories: readonly Category[], query: string | null) {
	const needle = query?.trim().toLowerCase() ?? '';
	const picked = sortCategories(categories).filter((category) => !needle || category.text.toLowerCase().includes(needle));
	return picked.map((category) => {
		const prompts = category.subPrompts.filter((subPrompt) => subPrompt.text.trim() && subPrompt.state !== 'skip').map((subPrompt) => subPrompt.text);
		const limit = needle ? prompts.length : CATEGORY_PROMPT_LIMIT;
		return {
			category: category.text,
			skipped: category.state === 'skip',
			activation_text: category.activation_text || null,
			sub_prompts: prompts.slice(0, limit),
			...(prompts.length > limit ? { more_sub_prompts: prompts.length - limit } : {}),
		};
	});
}
