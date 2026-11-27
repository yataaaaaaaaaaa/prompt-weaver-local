// The co-writer's pure logic (the user's Codex in the Story section): the conversations as the frontend keeps them
// (one per story, the draft while no story is selected; the backend owns them: services/codex/conversations.py), the
// events that change them, and what a tool entry says ('Generating Scene 3 · The storm…') and links to. What the app's
// tools answer Codex is src/domain/coWriterViews.ts; the tools themselves run in src/stores/coWriterTools.ts.
import type { Character, CodexConversation, CodexEntry, CodexToolName, Story } from '../api/types';

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

/** What a tool entry names: its scene ('Scene 2 · The storm'), its story's title and its character's name (null when
 *  it names none or they no longer exist). */
export type ToolTargets = { scene: string | null; story: string | null; character: string | null };

const RUNNING_LABELS: Readonly<Record<CodexToolName, (target: ToolTargets) => string>> = {
	list_stories: () => 'Reading the stories…',
	get_story: ({ story }) => `Reading ${story ?? 'the story'}…`,
	list_characters: () => 'Reading the characters…',
	list_categories: () => 'Reading the prompt board…',
	list_loras: () => 'Reading the LoRAs…',
	get_generation_setup: () => 'Reading the generation setup…',
	preview_scenes: ({ scene, story }) => `Previewing the prompts of ${scene ?? story ?? 'the scenes'}…`,
	consistency_report: ({ story }) => `Checking the consistency of ${story ?? 'the story'}…`,
	view_images: ({ story, character }) => `Looking at the pictures of ${story ?? character ?? 'the story'}…`,
	create_story: () => 'Creating a story…',
	update_story: ({ story }) => `Editing ${story ?? 'the story'}…`,
	delete_story: ({ story }) => `Deleting ${story ?? 'a story'}…`,
	add_scenes: ({ story }) => `Adding scenes to ${story ?? 'the story'}…`,
	update_scenes: ({ scene, story }) => `Editing ${scene ?? `the scenes of ${story ?? 'the story'}`}…`,
	reorder_scenes: ({ story }) => `Reordering the scenes of ${story ?? 'the story'}…`,
	duplicate_scene: ({ scene }) => `Duplicating ${scene ?? 'a scene'}…`,
	delete_scenes: ({ story }) => `Deleting scenes of ${story ?? 'the story'}…`,
	generate_scenes: ({ scene, story }) => `Generating ${scene ?? `the scenes of ${story ?? 'the story'}`}…`,
	edit_variants: ({ scene }) => `Changing the pictures of ${scene ?? 'a scene'}…`,
	create_character: () => 'Creating a character…',
	update_character: ({ character }) => `Editing ${character ?? 'a character'}…`,
	delete_character: ({ character }) => `Deleting ${character ?? 'a character'}…`,
	install_ip_adapter: () => 'Starting the download of the IP-Adapter files…',
};

export function isCodexToolName(tool: string | null): tool is CodexToolName {
	return tool !== null && Object.hasOwn(RUNNING_LABELS, tool);
}

/** The scene, story and character a tool entry names (ToolTargets). */
export function toolTargets(entry: CodexEntry, stories: readonly Story[], characters: readonly Pick<Character, 'id' | 'name'>[] = []): ToolTargets {
	const story = entry.story_id ? (stories.find((item) => item.id === entry.story_id) ?? null) : null;
	const character = entry.character_id ? (characters.find((item) => item.id === entry.character_id) ?? null) : null;
	return {
		scene: story && entry.scene_id ? sceneLabel(story, entry.scene_id) : null,
		story: story?.title ?? null,
		character: character?.name ?? null,
	};
}

/** What a tool entry says: its summary once done; while it runs, what it does ('Generating Scene 3 · The storm…'). */
export function toolActivityText(entry: CodexEntry, stories: readonly Story[], characters: readonly Pick<Character, 'id' | 'name'>[] = []): string {
	if (entry.status !== 'running' && entry.text) {
		return entry.text;
	}
	if (!isCodexToolName(entry.tool)) {
		return entry.status === 'running' ? `Using ${entry.tool ?? 'a tool'}…` : `Used ${entry.tool ?? 'a tool'}`;
	}
	const running = RUNNING_LABELS[entry.tool](toolTargets(entry, stories, characters));
	return entry.status === 'running' ? running : `${running.replace(/…$/, '')} did not finish`;
}

/** The tools whose call runs a generation (Stop cancels it). */
export const GENERATION_TOOLS: ReadonlySet<CodexToolName> = new Set<CodexToolName>(['generate_scenes']);
