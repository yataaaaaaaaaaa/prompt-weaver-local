import { describe, expect, it } from 'vitest';
import type { Category } from './categories';
import {
	CATEGORY_PROMPT_LIMIT,
	categoriesForCodex,
	charactersForCodex,
	conversationKey,
	DRAFT_KEY,
	sceneLabel,
	storiesForCodex,
	storyForCodex,
	toolActivityText,
	withConversation,
	withDelta,
	withEntry,
	type ConversationIndex,
} from './coWriter';
import { BOB, character } from '../test/characterData';
import { conversation, CONVERSATION_ID, entry, OTHER_CONVERSATION_ID } from '../test/codexData';
import { illustratedScene, scene, SCENE_IDS, story, STORY_ID, OTHER_STORY_ID } from '../test/storyData';

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
		const running = entry({ id: 't', kind: 'tool', tool: 'generate_scene', status: 'running', story_id: STORY_ID, scene_id: SCENE_IDS[1] });
		expect(toolActivityText(running, [tale])).toBe('Generating Scene 2 · The storm…');
		expect(toolActivityText({ ...running, tool: 'add_scene' }, [tale])).toBe('Adding a scene…');
		expect(toolActivityText({ ...running, tool: 'get_story', scene_id: null }, [tale])).toBe('Reading The lighthouse…');
		expect(toolActivityText({ ...running, status: 'completed', text: 'Illustrated Scene 2 · The storm' }, [tale])).toBe('Illustrated Scene 2 · The storm');
		expect(toolActivityText({ ...running, status: 'failed', text: '' }, [tale])).toBe('Generating Scene 2 · The storm did not finish');
		expect(toolActivityText({ ...running, story_id: null, scene_id: null }, [])).toBe('Generating a scene…');
		expect(toolActivityText({ ...running, tool: 'web_search' }, [tale])).toBe('Using web_search…');
	});
});

describe('what the tools answer Codex', () => {
	const outputs = new Set(['0000000001', '0000000003']);

	it('lists the stories with their progress and the one viewed', () => {
		expect(storiesForCodex([story(), story({ id: OTHER_STORY_ID, title: 'Other', scenes: [] })], STORY_ID, outputs)).toEqual([
			{ story_id: STORY_ID, title: 'The lighthouse', scenes: 3, illustrated: 2, viewing: true },
			{ story_id: OTHER_STORY_ID, title: 'Other', scenes: 0, illustrated: 0, viewing: false },
		]);
	});

	it('reads a story with every scene', () => {
		const tale = story({
			scenes: [
				illustratedScene(['0000000001'], { id: SCENE_IDS[0], title: 'Arrival', locks: [{ category_name: 'Mood', prompt_text: 'calm' }], seed: 7 }),
				scene({ id: SCENE_IDS[1], title: 'Storm', character_ids: [] }),
			],
		});

		const read = storyForCodex(tale, [character()], outputs);

		expect(read.characters).toEqual([{ character_id: character().id, name: character().name }]);
		expect(read.scenes).toEqual([
			{ scene_id: SCENE_IDS[0], position: 1, title: 'Arrival', text: 'Mira climbed the stairs.', extra_tags: [], negative_tags: [], locked_sub_prompts: [{ category: 'Mood', sub_prompt: 'calm' }], characters: 'story', seed: 7, illustrated: true, pictures: 1 },
			{ scene_id: SCENE_IDS[1], position: 2, title: 'Storm', text: 'Mira climbed the stairs.', extra_tags: [], negative_tags: [], locked_sub_prompts: [], characters: [], seed: 'random', illustrated: false, pictures: 0 },
		]);
		expect(storyForCodex(story({ character_ids: ['chr-999999999999'] }), [], outputs).characters).toEqual([{ character_id: 'chr-999999999999', name: '(deleted)' }]);
	});

	it('lists the characters and which one Create uses', () => {
		expect(charactersForCodex([character(), BOB], BOB.id)).toEqual([
			{ character_id: character().id, name: character().name, identity_tags: character().identity_tags, outfit_tags: character().outfit_tags, negative_tags: character().negative_tags, active_in_create: false },
			{ character_id: BOB.id, name: BOB.name, identity_tags: BOB.identity_tags, outfit_tags: BOB.outfit_tags, negative_tags: BOB.negative_tags, active_in_create: true },
		]);
	});

	it('lists the categories in generation order, shortened unless one is asked for', () => {
		const many = Array.from({ length: CATEGORY_PROMPT_LIMIT + 5 }, (_unused, index) => ({ text: `tag ${index}`, state: 'normal' as const, extraLoraIds: [] }));
		const categories: Category[] = [
			{ text: 'Weather', activation_text: '', priority: 2, state: 'normal', subPrompts: [{ text: 'rain', state: 'normal', extraLoraIds: [] }, { text: 'snow', state: 'skip', extraLoraIds: [] }, { text: ' ', state: 'normal', extraLoraIds: [] }] },
			{ text: 'Place', activation_text: 'outdoors', priority: 1, state: 'skip', subPrompts: many },
		];

		const all = categoriesForCodex(categories, null);
		expect(all.map((item) => item.category)).toEqual(['Place', 'Weather']);
		expect(all[0]).toMatchObject({ skipped: true, activation_text: 'outdoors', more_sub_prompts: 5 });
		expect(all[0].sub_prompts).toHaveLength(CATEGORY_PROMPT_LIMIT);
		expect(all[1]).toEqual({ category: 'Weather', skipped: false, activation_text: null, sub_prompts: ['rain'] });
		const place = categoriesForCodex(categories, 'PLA');
		expect(place).toHaveLength(1);
		expect(place[0].sub_prompts).toHaveLength(CATEGORY_PROMPT_LIMIT + 5);
	});
});
