import { describe, expect, it } from 'vitest';
import { BOB, character } from '../test/characterData';
import { makeCategory, type Category } from './categories';
import {
	CHARACTER_CATEGORY_NAME,
	CHARACTER_OUTFIT_CATEGORY_NAME,
	CHARACTERS_PANE_ID,
	characterCategories,
	characterNegativePrompt,
	lockedCharacterSeed,
} from './characters';

const pinnedCategory = (text: string, promptText: string): Category => ({
	text,
	activation_text: '',
	priority: 1,
	state: 'normal',
	subPrompts: [{ text: promptText, state: 'lock', extraLoraIds: [] }],
});

describe('characterCategories', () => {
	it('pins the identity then the outfit, each as one locked sub-prompt', () => {
		expect(characterCategories(character(), [makeCategory('Main')])).toEqual([
			pinnedCategory(CHARACTER_CATEGORY_NAME, '1girl, silver hair, blue eyes'),
			pinnedCategory(CHARACTER_OUTFIT_CATEGORY_NAME, 'school uniform'),
		]);
	});

	it('omits a category whose tags are empty (blank tags included)', () => {
		expect(characterCategories(BOB, [])).toEqual([pinnedCategory('Character', '1boy, black hair')]);
		expect(characterCategories(character({ identity_tags: [], outfit_tags: [' ', 'jacket'] }), [])).toEqual([
			pinnedCategory('Character outfit', 'jacket'),
		]);
		expect(characterCategories(character({ identity_tags: ['  '], outfit_tags: [] }), [])).toEqual([]);
	});

	it('is empty without a character', () => {
		expect(characterCategories(null, [makeCategory('Main')])).toEqual([]);
	});

	it('makes a name unique when a user category already has its key', () => {
		const user = [makeCategory('character'), makeCategory('Character 2'), makeCategory('CHARACTER OUTFIT')];
		expect(characterCategories(character(), user).map((category) => category.text)).toEqual(['character-3', 'character-outfit-2']);
		// Only the colliding name changes.
		expect(characterCategories(character(), [makeCategory('Character outfit')]).map((category) => category.text)).toEqual([
			'Character',
			'character-outfit-2',
		]);
	});
});

describe('characterNegativePrompt', () => {
	it('appends the negative tags the prompt does not contain yet (tag identity)', () => {
		const alice = character({ negative_tags: ['short hair', 'Bad_Hands', 'hat', 'HAT'] });
		expect(characterNegativePrompt('lowres, bad hands', alice)).toBe('lowres, bad hands, short hair, hat');
		expect(characterNegativePrompt('', alice)).toBe('short hair, Bad_Hands, hat');
	});

	it('leaves the prompt unchanged without a character or new tags', () => {
		expect(characterNegativePrompt('lowres, ', null)).toBe('lowres, ');
		expect(characterNegativePrompt('lowres', BOB)).toBe('lowres');
		expect(characterNegativePrompt('short hair, lowres', character())).toBe('short hair, lowres');
	});
});

describe('lockedCharacterSeed', () => {
	it('is the seed only when it is locked', () => {
		expect(lockedCharacterSeed(character({ seed: 1234, seed_locked: true }))).toBe(1234);
		expect(lockedCharacterSeed(character({ seed: 0, seed_locked: true }))).toBe(0);
		expect(lockedCharacterSeed(character({ seed: 1234, seed_locked: false }))).toBeNull();
		expect(lockedCharacterSeed(character({ seed: null, seed_locked: true }))).toBeNull();
		expect(lockedCharacterSeed(null)).toBeNull();
	});
});

describe('CHARACTERS_PANE_ID', () => {
	it('keeps the id window layouts are persisted under (pane:characters)', () => {
		expect(CHARACTERS_PANE_ID).toBe('characters');
	});
});
