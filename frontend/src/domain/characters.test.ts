import { describe, expect, it } from 'vitest';
import { BOB, character } from '../test/characterData';
import { makeCategory, type Category } from './categories';
import {
	appendNegativeTags,
	castCategories,
	castNegativePrompt,
	CHARACTER_CATEGORY_NAME,
	CHARACTER_OUTFIT_CATEGORY_NAME,
	characterCategories,
	characterGallery,
	characterMatchesQuery,
	characterNegativePrompt,
	lockedCastSeed,
	lockedCharacterSeed,
} from './characters';

describe('characterMatchesQuery', () => {
	const mira = character({ name: 'Mira Vale', identity_tags: ['1girl', 'short red hair', 'green eyes'], outfit_tags: ['leather jacket'] });

	it('matches the name, an identity tag or an outfit tag, ignoring case and extra spaces', () => {
		expect(characterMatchesQuery(mira, 'mira')).toBe(true);
		expect(characterMatchesQuery(mira, 'VALE')).toBe(true);
		expect(characterMatchesQuery(mira, 'red   hair')).toBe(true);
		expect(characterMatchesQuery(mira, 'Jacket')).toBe(true);
		expect(characterMatchesQuery(mira, 'blue eyes')).toBe(false);
	});

	it('needs every comma-separated term to match (each in any field)', () => {
		expect(characterMatchesQuery(mira, '1girl, red hair')).toBe(true);
		expect(characterMatchesQuery(mira, 'mira, jacket')).toBe(true);
		expect(characterMatchesQuery(mira, '1girl, silver hair')).toBe(false);
		// Empty terms are ignored.
		expect(characterMatchesQuery(mira, ', red ,, ')).toBe(true);
	});

	it('does not search the negative tags', () => {
		expect(characterMatchesQuery(character({ negative_tags: ['long hair'] }), 'long hair')).toBe(false);
	});

	it('matches every character with a blank query', () => {
		expect(characterMatchesQuery(mira, '')).toBe(true);
		expect(characterMatchesQuery(mira, '  ,  ')).toBe(true);
		expect(characterMatchesQuery(character({ identity_tags: [], outfit_tags: [] }), ' ')).toBe(true);
	});
});

describe('characterGallery', () => {
	const zed = character({ id: 'chr-zzzzzzzzzzz1', name: 'zed', identity_tags: ['1boy'] });
	const alice = character({ id: 'chr-aaaaaaaaaaa1', name: 'Alice', identity_tags: ['1girl'] });
	const alice2 = character({ id: 'chr-aaaaaaaaaaa2', name: 'alice', identity_tags: ['1girl', 'hat'] });

	it('orders by name (case-insensitive), then in the given (creation) order', () => {
		const characters = [zed, alice2, alice, BOB];
		expect(characterGallery(characters).map((item) => item.id)).toEqual([alice2.id, alice.id, BOB.id, zed.id]);
		// The input is left untouched.
		expect(characters.map((item) => item.id)).toEqual([zed.id, alice2.id, alice.id, BOB.id]);
	});

	it('keeps only the characters matching the query', () => {
		expect(characterGallery([zed, alice, alice2, BOB], '1girl').map((item) => item.id)).toEqual([alice.id, alice2.id]);
		expect(characterGallery([zed, alice, alice2, BOB], 'hat, 1girl')).toEqual([alice2]);
		expect(characterGallery([zed, BOB], 'nobody')).toEqual([]);
		expect(characterGallery([], 'x')).toEqual([]);
	});
});

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

describe('casts (several characters)', () => {
	const alice = character();
	const user: Category[] = [makeCategory('Subject')];

	it('pins the first character like the active one, the next ones numbered', () => {
		const pinned = castCategories([alice, BOB], user);

		expect(pinned.map((category) => category.text)).toEqual(['Character', 'Character outfit', 'Character 2']);
		expect(pinned.map((category) => category.subPrompts[0].text)).toEqual(['1girl, silver hair, blue eyes', 'school uniform', '1boy, black hair']);
		expect(castCategories([alice], user)).toEqual(characterCategories(alice, user));
		expect(castCategories([], user)).toEqual([]);
	});

	it('keeps every pinned name unique against the user categories and the names before it', () => {
		const pinned = castCategories([alice, BOB], [makeCategory('Character 2')]);

		expect(pinned.map((category) => category.text)).toEqual(['Character', 'Character outfit', 'character-2-2']);
	});

	it('appends every character negative tag once, in cast order, and takes the first locked seed', () => {
		const locked = character({ id: 'chr-000000000009', negative_tags: ['blurry', 'short hair'], seed: 99, seed_locked: true });

		expect(castNegativePrompt('ugly', [alice, locked])).toBe('ugly, short hair, blurry');
		expect(appendNegativeTags('ugly, blurry', ['Blurry', 'lowres', ''])).toBe('ugly, blurry, lowres');
		expect(appendNegativeTags('ugly', [])).toBe('ugly');
		expect(lockedCastSeed([alice, locked, character({ seed: 5, seed_locked: true })])).toBe(99);
		expect(lockedCastSeed([alice, BOB])).toBeNull();
	});
});
