import { describe, expect, it } from 'vitest';
import type { OutputRecord, SceneLock } from '../api/types';
import { ALICE_ID, BOB, BOB_ID, character, outputCharacter } from '../test/characterData';
import { illustratedScene, scene, SCENE_IDS, story, STORY_ID } from '../test/storyData';
import type { Category } from './categories';
import {
	availableVariantIds,
	clampReaderPage,
	isLockOverriddenByCast,
	missingSceneIds,
	newStoryTitle,
	readerPageForKey,
	resolveCharacters,
	sceneCast,
	sceneCastSource,
	sceneFromOutput,
	sceneGenerationInput,
	sceneIllustrationId,
	sceneLockOptions,
	sceneOrderAfterDrop,
	sceneOrderWithSceneAt,
	sceneOrderAfterMove,
	scenePinnedCategories,
	sceneStatus,
	storyCoverId,
	storyExportFileName,
	storyProgress,
	storyProgressText,
	withSceneLock,
	withScenePatch,
	withStory,
	withoutSceneLock,
} from './stories';

const ALICE = character();
const OUTPUTS = new Set(['0000000001', '0000000002', '0000000003']);

function category(text: string, prompts: [string, string[]?][], extra: Partial<Category> = {}): Category {
	return {
		text,
		activation_text: '',
		priority: 1,
		state: 'normal',
		subPrompts: prompts.map(([promptText, loras = []]) => ({ text: promptText, state: 'normal', extraLoraIds: loras })),
		...extra,
	};
}

const USER: Category[] = [
	category('Subject', [['1girl, silver hair'], ['1boy']], { priority: 1 }),
	category('Outfit', [['red dress'], ['school uniform', ['lineart']]], { priority: 2 }),
	category('Background', [['beach'], ['castle']], { priority: 3 }),
];

const lock = (category_name: string, prompt_text: string): SceneLock => ({ category_name, prompt_text });

describe('scenePinnedCategories', () => {
	it('pins the cast, then one category per lock replacing its user category, then the scene tags', () => {
		const { pinned, userCategories } = scenePinnedCategories(
			{ cast: [ALICE], locks: [lock('outfit', 'school uniform'), lock('Weather', 'rain')], extraTags: ['storm', ' night '] },
			USER,
		);

		expect(pinned.map((item) => [item.text, item.subPrompts.map((subPrompt) => [subPrompt.text, subPrompt.state])])).toEqual([
			['Character', [['1girl, silver hair, blue eyes', 'lock']]],
			['Character outfit', [['school uniform', 'lock']]],
			// The user category's own name; its sub-prompt's prompt-linked LoRAs come along.
			['Outfit', [['school uniform', 'lock']]],
			// A category the board no longer has keeps the lock's name.
			['Weather', [['rain', 'lock']]],
			['Scene', [['storm, night', 'lock']]],
		]);
		expect(pinned[2].subPrompts[0].extraLoraIds).toEqual(['lineart']);
		expect(userCategories.map((item) => item.text)).toEqual(['Subject', 'Background']);
	});

	it('ignores a lock of a category the cast pins, and every lock of a category after the first', () => {
		const { pinned, userCategories } = scenePinnedCategories(
			{ cast: [ALICE], locks: [lock('Character', '1boy'), lock('Background', 'beach'), lock('background', 'castle')], extraTags: [] },
			USER,
		);

		expect(pinned.map((item) => [item.text, item.subPrompts[0].text])).toEqual([
			['Character', '1girl, silver hair, blue eyes'],
			['Character outfit', 'school uniform'],
			['Background', 'beach'],
		]);
		expect(userCategories.map((item) => item.text)).toEqual(['Subject', 'Outfit']);
	});

	it('makes the scene category name unique and pins nothing without overrides', () => {
		const withScene = [...USER, category('Scene', [['user scene']])];

		expect(scenePinnedCategories({ cast: [], locks: [], extraTags: ['dawn'] }, withScene).pinned.map((item) => item.text)).toEqual(['scene-2']);
		expect(scenePinnedCategories({ cast: [], locks: [], extraTags: [] }, USER)).toEqual({ pinned: [], userCategories: USER });
	});
});

describe('characters of a scene', () => {
	const characters = [ALICE, BOB];

	it("uses the scene's characters, else the story's, else the active character", () => {
		const withCast = story();
		const noCast = story({ character_ids: [] });

		expect(sceneCastSource(withCast, scene())).toBe('story');
		expect(sceneCast(withCast, scene(), characters, BOB)).toEqual({ cast: [ALICE], missingIds: [] });
		expect(sceneCastSource(withCast, scene({ character_ids: [BOB_ID] }))).toBe('scene');
		expect(sceneCast(withCast, scene({ character_ids: [BOB_ID, ALICE_ID] }), characters, null).cast).toEqual([BOB, ALICE]);
		expect(sceneCast(withCast, scene({ character_ids: [] }), characters, BOB).cast).toEqual([]);
		expect(sceneCastSource(noCast, scene())).toBe('active');
		expect(sceneCast(noCast, scene(), characters, BOB).cast).toEqual([BOB]);
		expect(sceneCast(noCast, scene(), characters, null).cast).toEqual([]);
	});

	it('skips (and reports) ids naming no character, once each', () => {
		expect(resolveCharacters(['chr-gone00000000', ALICE_ID, ALICE_ID], characters)).toEqual({ cast: [ALICE], missingIds: ['chr-gone00000000'] });
	});

	it('builds the generation input of a scene', () => {
		const storm = illustratedScene(['0000000002'], { id: SCENE_IDS[1], extra_tags: ['storm'], negative_tags: ['sunny'], seed: 42, locks: [lock('Mood', 'calm')] });

		expect(sceneGenerationInput(story({ character_ids: [ALICE_ID, 'chr-gone00000000'] }), storm, characters, null)).toEqual({
			input: { storyId: STORY_ID, sceneId: SCENE_IDS[1], cast: [ALICE], locks: [lock('Mood', 'calm')], extraTags: ['storm'], negativeTags: ['sunny'], seed: 42 },
			missingCharacterIds: ['chr-gone00000000'],
		});
	});
});

describe('illustration state', () => {
	it('knows the illustration of a scene while its output exists', () => {
		expect(sceneIllustrationId(illustratedScene(['0000000001']), OUTPUTS)).toBe('0000000001');
		expect(sceneIllustrationId(illustratedScene(['0000000009']), OUTPUTS)).toBeNull();
		expect(sceneIllustrationId(scene(), OUTPUTS)).toBeNull();
		expect(availableVariantIds(illustratedScene(['0000000001', '0000000009', '0000000003']), OUTPUTS)).toEqual(['0000000001', '0000000003']);
	});

	it('lists the scenes without an illustration, in story order, and the cover and progress of a story', () => {
		const tale = story();

		expect(missingSceneIds(tale, OUTPUTS)).toEqual([SCENE_IDS[2]]);
		expect(missingSceneIds(tale, new Set(['0000000003']))).toEqual([SCENE_IDS[0], SCENE_IDS[2]]);
		expect(storyCoverId(tale, OUTPUTS)).toBe('0000000001');
		expect(storyCoverId(tale, new Set(['0000000003']))).toBe('0000000003');
		expect(storyCoverId(tale, new Set())).toBeNull();
		expect(storyProgress(tale, OUTPUTS)).toEqual({ scenes: 3, illustrated: 2 });
		expect(storyProgressText({ scenes: 3, illustrated: 2 })).toBe('3 scenes · 2 illustrated');
		expect(storyProgressText({ scenes: 1, illustrated: 0 })).toBe('1 scene · not illustrated');
		expect(storyProgressText({ scenes: 2, illustrated: 2 })).toBe('2 scenes · all illustrated');
		expect(storyProgressText({ scenes: 0, illustrated: 0 })).toBe('No scenes');
	});

	it('puts generating and queued before the illustration state', () => {
		const run = { currentSceneId: SCENE_IDS[0], queuedSceneIds: [SCENE_IDS[1]] };
		const [arrival, storm, calm] = story().scenes;

		expect(sceneStatus(arrival, OUTPUTS, run)).toBe('generating');
		expect(sceneStatus(storm, OUTPUTS, run)).toBe('queued');
		expect(sceneStatus(storm, OUTPUTS, null)).toBe('illustrated');
		expect(sceneStatus(calm, OUTPUTS, run)).toBe('missing');
	});
});

describe('sceneFromOutput (Add to story)', () => {
	const record: Pick<OutputRecord, 'output_id' | 'selections' | 'character' | 'image_seed' | 'seed'> = {
		output_id: '0000000007',
		selections: [
			{ category_name: 'Character', prompt_text: '1girl, silver hair, blue eyes', locked: true, induced_lora_ids: [] },
			{ category_name: 'Character outfit', prompt_text: 'school uniform', locked: true, induced_lora_ids: [] },
			{ category_name: 'Subject', prompt_text: '1girl', locked: false, induced_lora_ids: [] },
			{ category_name: 'Background', prompt_text: 'beach', locked: false, induced_lora_ids: [] },
			{ category_name: 'background', prompt_text: 'castle', locked: false, induced_lora_ids: [] },
			{ category_name: 'Empty', prompt_text: ' ', locked: false, induced_lora_ids: [] },
		],
		character: outputCharacter(),
		image_seed: 51111,
		seed: 51111,
	};

	it("reproduces the output: its picture, its selections as locks (the characters' left out), its seed", () => {
		expect(sceneFromOutput(record, [ALICE_ID], [ALICE, BOB], USER)).toEqual({
			output_id: '0000000007',
			text: '',
			character_ids: null,
			locks: [lock('Subject', '1girl'), lock('Background', 'beach')],
			seed: 51111,
		});
	});

	it("names the output's character when the story has other characters, or none when the output had none", () => {
		expect(sceneFromOutput(record, [BOB_ID], [ALICE, BOB], USER).character_ids).toEqual([ALICE_ID]);
		const plain = { ...record, character: null, image_seed: null, seed: 9 };
		const fromPlain = sceneFromOutput(plain, [BOB_ID], [ALICE, BOB], USER);
		expect(fromPlain.character_ids).toEqual([]);
		// Without characters the 'Character' selections are plain locks; the record's seed is the fallback.
		expect(fromPlain.locks?.map((item) => item.category_name)).toEqual(['Character', 'Character outfit', 'Subject', 'Background']);
		expect(fromPlain.seed).toBe(9);
		expect(sceneFromOutput(plain, [], [ALICE, BOB], USER).character_ids).toBeNull();
	});

	it("keeps the character's selections as locks when the character no longer exists", () => {
		expect(sceneFromOutput(record, [ALICE_ID], [BOB], USER).locks?.map((item) => item.category_name)).toEqual([
			'Character',
			'Character outfit',
			'Subject',
			'Background',
		]);
	});
});

describe('scene locks', () => {
	it('replaces the lock of a category in place, or appends one; removes by category key', () => {
		const locks = [lock('Subject', '1girl'), lock('Mood', 'calm')];

		expect(withSceneLock(locks, 'subject', '1boy')).toEqual([lock('subject', '1boy'), lock('Mood', 'calm')]);
		expect(withSceneLock(locks, 'Outfit', 'red dress')).toEqual([...locks, lock('Outfit', 'red dress')]);
		expect(withSceneLock(locks, 'SUBJECT', '1boy', { replace: false })).toEqual(locks);
		expect(withoutSceneLock(locks, 'mood')).toEqual([lock('Subject', '1girl')]);
	});

	it('offers the sub-prompts of every user category in generation order, blank ones left out', () => {
		const categories = [category('Z last', [['z']], { priority: 9 }), category('A first', [['a'], ['  ']], { priority: 1 }), category('Blank', [[' ']], { priority: 2 })];

		expect(sceneLockOptions(categories)).toEqual([
			{ categoryName: 'A first', prompts: ['a'] },
			{ categoryName: 'Z last', prompts: ['z'] },
		]);
	});

	it('tells which locks the characters replace', () => {
		expect(isLockOverriddenByCast(lock('character', 'x'), [ALICE], USER)).toBe(true);
		expect(isLockOverriddenByCast(lock('Character outfit', 'x'), [BOB], USER)).toBe(false);
		expect(isLockOverriddenByCast(lock('Subject', 'x'), [ALICE], USER)).toBe(false);
	});
});

describe('local copies', () => {
	it('applies the fields a patch sends to one scene', () => {
		const tale = story();
		const patched = withScenePatch(tale, SCENE_IDS[1], { text: 'Rain.', seed: null, extra_tags: undefined });

		expect(patched.scenes[1]).toEqual({ ...tale.scenes[1], text: 'Rain.', seed: null });
		expect(patched.scenes[0]).toBe(tale.scenes[0]);
		expect(withScenePatch(tale, 'scn-unknown00000', { text: 'x' })).toBe(tale);
	});

	it('replaces a story by id or appends it', () => {
		const tale = story();
		const other = story({ id: 'sty-000000000009', title: 'Other' });

		expect(withStory([tale], { ...tale, title: 'Renamed' })).toEqual([{ ...tale, title: 'Renamed' }]);
		expect(withStory([tale], other)).toEqual([tale, other]);
	});
});

describe('scene order', () => {
	const ids = ['a', 'b', 'c'];

	it('moves with the keys of the prompt board', () => {
		expect(sceneOrderAfterMove(ids, 'b', 'previous')).toEqual(['b', 'a', 'c']);
		expect(sceneOrderAfterMove(ids, 'b', 'last')).toEqual(['a', 'c', 'b']);
		expect(sceneOrderAfterMove(ids, 'a', 'first')).toBeNull();
		expect(sceneOrderAfterMove(ids, 'x', 'next')).toBeNull();
	});

	it('drops next to another scene', () => {
		expect(sceneOrderAfterDrop(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
		expect(sceneOrderAfterDrop(ids, 'a', 'b', 'before')).toBeNull();
	});

	it('puts a scene at a 1-based position (the co-writer), clamped to the story', () => {
		expect(sceneOrderWithSceneAt(ids, 'c', 1)).toEqual(['c', 'a', 'b']);
		expect(sceneOrderWithSceneAt(ids, 'a', 2)).toEqual(['b', 'a', 'c']);
		expect(sceneOrderWithSceneAt(ids, 'a', 99)).toEqual(['b', 'c', 'a']);
		expect(sceneOrderWithSceneAt(ids, 'b', 2)).toBeNull();
		expect(sceneOrderWithSceneAt(ids, 'x', 1)).toBeNull();
	});
});

describe('names, reader and export', () => {
	it('titles new stories uniquely', () => {
		expect(newStoryTitle([])).toBe('New story');
		expect(newStoryTitle([{ title: 'New story' }, { title: 'new-story 2' }])).toBe('New story 3');
	});

	it('keeps reader pages inside the story and maps the reader keys', () => {
		expect(clampReaderPage(7, 3)).toBe(2);
		expect(clampReaderPage(-1, 3)).toBe(0);
		expect(clampReaderPage(1.7, 3)).toBe(1);
		expect(clampReaderPage(2, 0)).toBe(0);
		expect(clampReaderPage(Number.NaN, 3)).toBe(0);
		expect(readerPageForKey('ArrowRight', 0, 3)).toBe(1);
		expect(readerPageForKey('PageDown', 2, 3)).toBe(2);
		expect(readerPageForKey(' ', 1, 3)).toBe(2);
		expect(readerPageForKey('ArrowUp', 1, 3)).toBe(0);
		expect(readerPageForKey('End', 0, 3)).toBe(2);
		expect(readerPageForKey('Home', 2, 3)).toBe(0);
		expect(readerPageForKey('Enter', 0, 3)).toBeNull();
	});

	it('names the export file after the story, without the characters file systems forbid', () => {
		expect(storyExportFileName('The lighthouse keeper')).toBe('The lighthouse keeper.html');
		expect(storyExportFileName('  A/B: "test"?  ')).toBe('A B test.html');
		expect(storyExportFileName('Ends with dots...')).toBe('Ends with dots.html');
		expect(storyExportFileName('<>|*')).toBe('Story.html');
		expect(storyExportFileName('x'.repeat(200))).toBe(`${'x'.repeat(120)}.html`);
	});
});
