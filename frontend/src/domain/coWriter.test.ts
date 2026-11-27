import { describe, expect, it } from 'vitest';
import {
	conversationKey,
	DRAFT_KEY,
	GENERATION_TOOLS,
	isCodexToolName,
	sceneLabel,
	toolActivityText,
	toolTargets,
	withConversation,
	withDelta,
	withEntry,
	type ConversationIndex,
} from './coWriter';
import { BOB, character } from '../test/characterData';
import { conversation, CONVERSATION_ID, entry, OTHER_CONVERSATION_ID } from '../test/codexData';
import { SCENE_IDS, story, STORY_ID, OTHER_STORY_ID } from '../test/storyData';

const EMPTY: ConversationIndex = { conversations: {}, byStory: {} };

describe('conversations', () => {
	it('keys the draft conversation apart from the stories', () => {
		expect(conversationKey(null)).toBe(DRAFT_KEY);
		expect(conversationKey(STORY_ID)).toBe(STORY_ID);
	});

	it('maps each story (and the draft) to its conversation', () => {
		const draft = withConversation(EMPTY, conversation({ draft: true }));
		expect(draft.byStory).toEqual({ [DRAFT_KEY]: CONVERSATION_ID });

		// The draft created a story: it is that story's conversation now.
		const adopted = withConversation(draft, conversation({ story_ids: [STORY_ID] }));
		expect(adopted.byStory).toEqual({ [STORY_ID]: CONVERSATION_ID });
		expect(adopted.conversations[CONVERSATION_ID].story_ids).toEqual([STORY_ID]);

		// New conversation: the story points at the new one; the old one keeps its other story.
		const shared = withConversation(adopted, conversation({ story_ids: [STORY_ID, OTHER_STORY_ID] }));
		const fresh = withConversation(withConversation(shared, conversation({ id: OTHER_CONVERSATION_ID, story_ids: [STORY_ID] })), conversation({ story_ids: [OTHER_STORY_ID] }));
		expect(fresh.byStory).toEqual({ [STORY_ID]: OTHER_CONVERSATION_ID, [OTHER_STORY_ID]: CONVERSATION_ID });
	});

	it('adds, replaces and streams entries, each change at its revision', () => {
		const start = conversation({ revision: 1, entries: [entry({ id: 'u', kind: 'user', text: 'Hi' })] });
		const answering = withEntry(start, entry({ id: 'a', text: 'Once', status: 'running' }), 2);
		const streamed = withDelta(answering, 'a', ' upon', 3);

		expect(streamed.entries.map((item) => item.text)).toEqual(['Hi', 'Once upon']);
		expect(streamed.revision).toBe(3);
		expect(withDelta(streamed, 'unknown', 'x', 4)).toBe(streamed);
		// Changes the shown copy already holds are not applied twice.
		expect(withDelta(streamed, 'a', ' upon', 3)).toBe(streamed);
		expect(withEntry(streamed, entry({ id: 'a', text: 'Once' }), 2)).toBe(streamed);
		const done = withEntry(streamed, entry({ id: 'a', text: 'Once upon a time.' }), 4);
		expect(done.entries).toHaveLength(2);
		expect(done.entries[1]).toMatchObject({ text: 'Once upon a time.', status: 'completed' });
	});

	it('ignores a copy older than the one shown (an HTTP answer that lost the race with the events)', () => {
		const ended = withConversation(EMPTY, conversation({ story_ids: [STORY_ID], running: false, revision: 9 }));

		const stale = withConversation(ended, conversation({ story_ids: [STORY_ID], running: true, revision: 7 }));

		expect(stale).toBe(ended);
		expect(withConversation(ended, conversation({ story_ids: [STORY_ID], running: true, revision: 10 })).conversations[CONVERSATION_ID].running).toBe(true);
	});
});

describe('tool activity', () => {
	const tale = story();

	it('names a scene by its position and title', () => {
		expect(sceneLabel(tale, SCENE_IDS[1])).toBe('Scene 2 · The storm');
		expect(sceneLabel(tale, 'scn-999999999999')).toBeNull();
	});

	it('says what a running tool does, then its summary', () => {
		const running = entry({ id: 't', kind: 'tool', tool: 'generate_scenes', status: 'running', story_id: STORY_ID, scene_id: SCENE_IDS[1] });
		expect(toolActivityText(running, [tale])).toBe('Generating Scene 2 · The storm…');
		expect(toolActivityText({ ...running, scene_id: null }, [tale])).toBe('Generating the scenes of The lighthouse…');
		expect(toolActivityText({ ...running, tool: 'add_scenes' }, [tale])).toBe('Adding scenes to The lighthouse…');
		expect(toolActivityText({ ...running, tool: 'get_story', scene_id: null }, [tale])).toBe('Reading The lighthouse…');
		expect(toolActivityText({ ...running, tool: 'update_scenes', scene_id: null }, [tale])).toBe('Editing the scenes of The lighthouse…');
		expect(toolActivityText({ ...running, status: 'completed', text: 'Illustrated Scene 2 · The storm' }, [tale])).toBe('Illustrated Scene 2 · The storm');
		expect(toolActivityText({ ...running, status: 'failed', text: '' }, [tale])).toBe('Generating Scene 2 · The storm did not finish');
		expect(toolActivityText({ ...running, story_id: null, scene_id: null }, [])).toBe('Generating the scenes of the story…');
		expect(toolActivityText({ ...running, tool: 'web_search' }, [tale])).toBe('Using web_search…');
		// An entry of a tool that no longer exists (an older conversation) shows its summary.
		expect(toolActivityText({ ...running, tool: 'add_scene', status: 'completed', text: 'Added Scene 4 · The harbor' }, [tale])).toBe('Added Scene 4 · The harbor');
	});

	it('names the character a tool acts on', () => {
		const editing = entry({ id: 't', kind: 'tool', tool: 'update_character', status: 'running', character_id: BOB.id });
		expect(toolActivityText(editing, [], [character(), BOB])).toBe('Editing Bob…');
		expect(toolActivityText(editing, [], [])).toBe('Editing a character…');
		expect(toolTargets(editing, [tale], [BOB])).toEqual({ scene: null, story: null, character: 'Bob' });
		expect(toolTargets(entry({ id: 'u', kind: 'tool', story_id: STORY_ID, scene_id: SCENE_IDS[2] }), [tale])).toEqual({ scene: 'Scene 3 · Morning calm', story: 'The lighthouse', character: null });
	});

	it('knows which tools generate (Stop cancels them)', () => {
		expect([...GENERATION_TOOLS]).toEqual(['generate_scenes']);
		expect(isCodexToolName('view_images')).toBe(true);
		expect(isCodexToolName('generate_scene')).toBe(false);
	});
});
