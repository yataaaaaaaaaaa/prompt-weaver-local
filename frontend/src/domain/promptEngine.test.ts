// Ports every case of the pre-refactor tests/promptEngine.test.ts (prompt engine part) plus selectPrompts coverage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ForbiddenRule } from '../api/types';
import { character } from '../test/characterData';
import type { Category, SubPrompt } from './categories';
import { characterCategories } from './characters';
import { categoryMatcher, containsMatcher, makeRule, specificMatcher, tagMatcher } from './forbiddenRules';
import { PromptSelectionError, selectPrompts, selectPromptsWithCategoryCycle } from './promptEngine';

function makeCategory(text: string, subPrompts: (string | Partial<SubPrompt>)[], options: Partial<Category> = {}): Category {
	return {
		text,
		activation_text: '',
		priority: 1,
		state: 'normal',
		subPrompts: subPrompts.map((item) => ({ state: 'normal', extraLoraIds: [], text: '', ...(typeof item === 'string' ? { text: item } : item) })),
		...options,
	};
}

function withMockedRandom<T>(value: number, callback: () => T): T {
	const spy = vi.spyOn(Math, 'random').mockReturnValue(value);
	try {
		return callback();
	} finally {
		spy.mockRestore();
	}
}

const alphaPromptVsBeta = (betaPrompt: string | null): ForbiddenRule => ({
	left: { kind: 'specific', category_name: 'Alpha', prompt_text: 'alpha prompt', contains_text: null, tag_text: null },
	right: { kind: 'specific', category_name: 'Beta', prompt_text: betaPrompt, contains_text: null, tag_text: null },
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('selectPromptsWithCategoryCycle (legacy cases)', () => {
	it('does not increment a category counter when a category-level forbidden association disables the whole category', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const alpha = makeCategory('Alpha', ['alpha prompt'], { priority: 1 });
		const beta = makeCategory('Beta', ['beta first', 'beta second'], { priority: 2 });

		const result = withMockedRandom(0.25, () =>
			selectPromptsWithCategoryCycle([alpha, beta], [alphaPromptVsBeta(null)], {
				alpha: { seed: 5, remaining: 1, prompt_count: 1 },
				beta: { seed: 11, remaining: 2, prompt_count: 2 },
			}),
		);

		expect(result.selections.map((item) => item.category_name)).toEqual(['Alpha']);
		expect(result.promptSeed).toBe(5);
		expect(result.nextCategorySeedState.alpha).toEqual({ seed: 536870912, remaining: 1, prompt_count: 1 });
		expect(result.nextCategorySeedState.beta).toEqual({ seed: 11, remaining: 2, prompt_count: 2 });
		expect(warn).toHaveBeenCalledOnce();
	});

	it('does not touch skipped category counters because skipped categories are not processed', () => {
		const alpha = makeCategory('Alpha', ['alpha prompt'], { priority: 1 });
		const beta = makeCategory('Beta', ['beta first', 'beta second'], { priority: 2, state: 'skip' });

		const result = withMockedRandom(0.75, () =>
			selectPromptsWithCategoryCycle([alpha, beta], [], {
				alpha: { seed: 3, remaining: 1, prompt_count: 1 },
				beta: { seed: 10, remaining: 2, prompt_count: 2 },
			}),
		);

		expect(result.selections.map((item) => item.category_name)).toEqual(['Alpha']);
		expect('beta' in result.nextCategorySeedState).toBe(false);
	});

	it('walks past skipped sub-prompts and selects the next usable prompt', () => {
		const alpha = makeCategory('Alpha', [{ text: 'alpha skipped', state: 'skip' }, 'alpha usable'], { priority: 1 });

		const result = withMockedRandom(0.5, () => selectPromptsWithCategoryCycle([alpha], [], { alpha: { seed: 0, remaining: 2, prompt_count: 2 } }));

		expect(result.selections.map((item) => item.prompt_text)).toEqual(['alpha usable']);
		expect(result.promptSeed).toBe(0);
		expect(result.nextCategorySeedState.alpha).toEqual({ seed: 1073741824, remaining: 2, prompt_count: 2 });
	});

	it('walks past forbidden sub-prompts and selects the next usable prompt', () => {
		const alpha = makeCategory('Alpha', ['alpha prompt'], { priority: 1 });
		const beta = makeCategory('Beta', ['beta forbidden', 'beta usable'], { priority: 2 });

		const result = withMockedRandom(0.5, () =>
			selectPromptsWithCategoryCycle([alpha, beta], [alphaPromptVsBeta('beta forbidden')], {
				alpha: { seed: 4, remaining: 1, prompt_count: 1 },
				beta: { seed: 0, remaining: 2, prompt_count: 2 },
			}),
		);

		expect(result.selections.map((item) => item.prompt_text)).toEqual(['alpha prompt', 'beta usable']);
		expect(result.nextCategorySeedState.beta).toEqual({ seed: 1073741824, remaining: 2, prompt_count: 2 });
	});

	it('does not increment a category counter when using a valid locked prompt', () => {
		const alpha = makeCategory('Alpha', [{ text: 'alpha locked', state: 'lock' }, 'alpha normal'], { priority: 1 });

		const result = selectPromptsWithCategoryCycle([alpha], [], { alpha: { seed: 10, remaining: 2, prompt_count: 2 } });

		expect(result.selections.map((item) => item.prompt_text)).toEqual(['alpha locked']);
		expect(result.selections[0].locked).toBe(true);
		expect(result.promptSeed).toBeNull();
		expect(result.nextCategorySeedState.alpha).toEqual({ seed: 10, remaining: 2, prompt_count: 2 });
	});

	it('skips forbidden locked prompts without incrementing the locked category counter', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const alpha = makeCategory('Alpha', ['alpha prompt'], { priority: 1 });
		const beta = makeCategory('Beta', [{ text: 'beta locked', state: 'lock' }, 'beta normal'], { priority: 2 });

		const result = withMockedRandom(0.25, () =>
			selectPromptsWithCategoryCycle([alpha, beta], [alphaPromptVsBeta('beta locked')], {
				alpha: { seed: 7, remaining: 1, prompt_count: 1 },
				beta: { seed: 12, remaining: 2, prompt_count: 2 },
			}),
		);

		expect(result.selections.map((item) => item.prompt_text)).toEqual(['alpha prompt']);
		expect(result.nextCategorySeedState.beta).toEqual({ seed: 12, remaining: 2, prompt_count: 2 });
	});
});

describe('selectPromptsWithCategoryCycle (keys and edge cases)', () => {
	it('keys counters by category key and cycles through the sub-prompts', () => {
		const day = makeCategory('day_moment', ['morning', 'noon', 'night']);
		const first = selectPromptsWithCategoryCycle([day], [], { 'day-moment': { seed: 4, remaining: 3, prompt_count: 3 } });
		expect(first.selections.map((item) => item.prompt_text)).toEqual(['noon']);
		expect(first.nextCategorySeedState).toEqual({ 'day-moment': { seed: 5, remaining: 2, prompt_count: 3 } });
		const second = selectPromptsWithCategoryCycle([day], [], first.nextCategorySeedState);
		expect(second.selections.map((item) => item.prompt_text)).toEqual(['night']);
	});

	it('throws for a required category without prompts and skips optional ones', () => {
		expect(() => selectPromptsWithCategoryCycle([makeCategory('Empty', [])], [], {})).toThrow(new PromptSelectionError("Category 'Empty' has no prompts."));
		const result = selectPromptsWithCategoryCycle(
			[makeCategory('Main', ['x'], { priority: 1 }), makeCategory('Optional', [], { priority: 2, activation_text: 'x' })],
			[],
			{},
		);
		expect(result.selections.map((item) => item.category_name)).toEqual(['Main']);
	});

	it('warns and skips a category whose every cycled prompt is skipped or forbidden', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const result = selectPromptsWithCategoryCycle(
			[makeCategory('Alpha', ['alpha prompt'], { priority: 1 }), makeCategory('Beta', [{ text: 'b1', state: 'skip' }, 'b2'], { priority: 2 })],
			[makeRule(specificMatcher('Alpha', 'alpha prompt'), specificMatcher('Beta', 'b2'))],
			{ alpha: { seed: 0, remaining: 1, prompt_count: 1 }, beta: { seed: 0, remaining: 2, prompt_count: 2 } },
		);
		expect(result.selections.map((item) => item.prompt_text)).toEqual(['alpha prompt']);
		expect(result.nextCategorySeedState.beta).toEqual({ seed: 2, remaining: 2, prompt_count: 2 });
		expect(warn).toHaveBeenCalledWith("Category 'Beta' skipped because every cycled prompt is skipped or forbidden.");
	});
});

describe('selectPrompts', () => {
	const categories = [
		makeCategory('Main', ['m1', 'm2', 'm3', 'm4'], { priority: 1 }),
		makeCategory('Style', ['s1', 's2', 's3'], { priority: 2 }),
	];

	it('is deterministic for a seed', () => {
		const first = selectPrompts(categories, [], 1234);
		expect(selectPrompts(categories, [], 1234)).toEqual(first);
		expect(first.map((item) => item.category_name)).toEqual(['Main', 'Style']);
	});

	it('copies the induced LoRAs and the lock flag of the chosen sub-prompts', () => {
		const result = selectPrompts([makeCategory('Main', [{ text: 'x', state: 'lock', extraLoraIds: ['lora-a'] }, 'y'])], [], 1);
		expect(result).toEqual([{ category_name: 'Main', prompt_text: 'x', locked: true, induced_lora_ids: ['lora-a'] }]);
	});

	it('orders by priority, honours skips and avoids forbidden pairs', () => {
		const result = selectPrompts(
			[
				makeCategory('Late', ['l1'], { priority: 3 }),
				makeCategory('First', [{ text: 'f1, boy', state: 'lock' }], { priority: 1 }),
				makeCategory('Middle', ['m1 boy friend', { text: 'm2', state: 'skip' }, 'm3'], { priority: 2 }),
				makeCategory('Skipped', ['s1'], { priority: 0, state: 'skip' }),
			],
			[makeRule(containsMatcher(null, 'boy'), containsMatcher('Middle', 'friend'))],
			99,
		);
		expect(result.map((item) => [item.category_name, item.prompt_text])).toEqual([
			['First', 'f1, boy'],
			['Middle', 'm3'],
			['Late', 'l1'],
		]);
	});

	it('only includes activated optional categories', () => {
		const result = selectPrompts(
			[
				makeCategory('Main', [{ text: '1girl, Groza', state: 'lock' }], { priority: 1 }),
				makeCategory('Groza clothes', ['jacket'], { priority: 2, activation_text: 'groza' }),
				makeCategory('an-94 clothes', ['coat'], { priority: 3, activation_text: 'an-94' }),
			],
			[],
			5,
		);
		expect(result.map((item) => item.category_name)).toEqual(['Main', 'Groza clothes']);
	});

	it('skips a category whose candidates are all forbidden', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const result = selectPrompts(
			[makeCategory('Alpha', [{ text: 'alpha prompt', state: 'lock' }], { priority: 1 }), makeCategory('Beta', ['b1', 'b2'], { priority: 2 })],
			[alphaPromptVsBeta(null)],
			3,
		);
		expect(result.map((item) => item.category_name)).toEqual(['Alpha']);
		expect(warn).toHaveBeenCalledOnce();
	});

	it('throws clear selection errors', () => {
		expect(() => selectPrompts([], [], 1)).toThrow('No active categories available. Unskip at least one category.');
		expect(() => selectPrompts([makeCategory('Main', [{ text: 'x', state: 'skip' }])], [], 1)).toThrow("Category 'Main' has no usable prompts.");
		expect(() => selectPrompts([makeCategory('Optional', ['x'], { activation_text: 'never' })], [], 1)).toThrow(
			'No prompt could be selected with the current category configuration.',
		);
		expect(() => selectPrompts([], [], 1)).toThrow(PromptSelectionError);
	});
});

describe('pinned categories (active character)', () => {
	const IDENTITY = '1girl, silver hair, blue eyes';
	const OUTFIT = 'school uniform';
	const IDENTITY_SELECTION = { category_name: 'Character', prompt_text: IDENTITY, locked: true, induced_lora_ids: [] };
	const OUTFIT_SELECTION = { category_name: 'Character outfit', prompt_text: OUTFIT, locked: true, induced_lora_ids: [] };
	const SEEDS = Array.from({ length: 24 }, (_, index) => index + 1);

	const user = [
		makeCategory('Late', ['l1', 'l2'], { priority: 9 }),
		makeCategory('Main', ['m1', 'm2', 'm3'], { priority: 0 }),
		makeCategory('Hair', ['black hair, ponytail', 'short hair', 'twintails'], { priority: 2 }),
	];
	const pinned = characterCategories(character(), user);
	const picked = (selections: readonly { category_name: string; prompt_text: string }[], categoryName: string) =>
		selections.find((item) => item.category_name === categoryName)?.prompt_text;

	it('selects the pinned categories first, whatever the user priorities, without changing the user picks', () => {
		const result = selectPrompts(user, [], 7, pinned);
		expect(result.slice(0, 2)).toEqual([IDENTITY_SELECTION, OUTFIT_SELECTION]);
		expect(result.map((item) => item.category_name)).toEqual(['Character', 'Character outfit', 'Main', 'Hair', 'Late']);
		// Pinned categories draw nothing from the seeded sequence.
		expect(result.slice(2)).toEqual(selectPrompts(user, [], 7));
	});

	it.each([
		['an exact prompt rule (tag order insensitive)', makeRule(specificMatcher('Character', 'blue eyes, 1girl, silver hair'), specificMatcher('Hair', 'short hair'))],
		['a category-wide Character rule', makeRule(categoryMatcher('Character'), specificMatcher('Hair', 'short hair'))],
		['a tag rule', makeRule(tagMatcher(null, 'Silver Hair'), tagMatcher('Hair', 'short_hair'))],
	])('never picks a user sub-prompt forbidden with the identity: %s', (_label, rule) => {
		const hairs = new Set<string | undefined>();
		for (const seed of SEEDS) {
			const result = selectPrompts(user, [rule], seed, pinned);
			expect(result.slice(0, 2)).toEqual([IDENTITY_SELECTION, OUTFIT_SELECTION]);
			hairs.add(picked(result, 'Hair'));
		}
		expect([...hairs].sort()).toEqual(['black hair, ponytail', 'twintails']);
	});

	it('skips a user category entirely forbidden with the identity, also a locked one: the character wins', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const rules = [
			makeRule(categoryMatcher('Character'), categoryMatcher('Hair')),
			makeRule(tagMatcher('Character', '1girl'), specificMatcher('Main', 'm2')),
		];
		const withLock = user.map((category) =>
			category.text === 'Main' ? makeCategory('Main', ['m1', { text: 'm2', state: 'lock' }], { priority: 0 }) : category,
		);
		for (const seed of SEEDS) {
			const result = selectPrompts(withLock, rules, seed, characterCategories(character(), withLock));
			expect(result.map((item) => item.category_name)).toEqual(['Character', 'Character outfit', 'Late']);
		}
		expect(warn).toHaveBeenCalledWith("Category 'Hair' skipped because forbidden associations exclude all usable prompts.");
		expect(warn).toHaveBeenCalledWith("Category 'Main' skipped because forbidden associations exclude all usable prompts.");
	});

	it("triggers a user category's activation text with a character tag", () => {
		const accessories = makeCategory('Accessories', ['hair ribbon'], { priority: 1, activation_text: 'silver hair' });
		expect(selectPrompts([...user, accessories], [], 3, pinned).map((item) => item.category_name)).toContain('Accessories');
		expect(selectPrompts([...user, accessories], [], 3).map((item) => item.category_name)).not.toContain('Accessories');
	});

	it('skips the outfit when a rule forbids it with the identity (both modes)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const rules = [makeRule(tagMatcher('Character', '1girl'), categoryMatcher('Character outfit'))];
		expect(selectPrompts(user, rules, 1, pinned).map((item) => item.category_name)).toEqual(['Character', 'Main', 'Hair', 'Late']);
		expect(selectPromptsWithCategoryCycle(user, rules, {}, pinned).selections.map((item) => item.category_name)).toEqual([
			'Character',
			'Main',
			'Hair',
			'Late',
		]);
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenCalledWith("Category 'Character outfit' skipped because its locked prompt is forbidden.");
	});

	it('cycle mode: pinned categories have no counter and leave the prompt seed alone', () => {
		const state = {
			character: { seed: 1, remaining: 1, prompt_count: 1 },
			main: { seed: 4, remaining: 3, prompt_count: 3 },
			hair: { seed: 0, remaining: 3, prompt_count: 3 },
			late: { seed: 1, remaining: 2, prompt_count: 2 },
		};
		const withCharacter = selectPromptsWithCategoryCycle(user, [], state, pinned);
		const without = selectPromptsWithCategoryCycle(user, [], state);
		expect(withCharacter.selections.slice(0, 2)).toEqual([IDENTITY_SELECTION, OUTFIT_SELECTION]);
		expect(withCharacter.selections.slice(2)).toEqual(without.selections);
		expect(withCharacter.promptSeed).toBe(4);
		expect(withCharacter.nextCategorySeedState).toEqual(without.nextCategorySeedState);
		expect(Object.keys(withCharacter.nextCategorySeedState).sort()).toEqual(['hair', 'late', 'main']);
	});

	it('cycle mode: a user category disabled by a category-wide Character rule keeps its counter', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const hair = { seed: 1, remaining: 3, prompt_count: 3 };
		const result = selectPromptsWithCategoryCycle(user, [makeRule(categoryMatcher('Character'), categoryMatcher('Hair'))], { hair }, pinned);
		expect(result.selections.map((item) => item.category_name)).toEqual(['Character', 'Character outfit', 'Main', 'Late']);
		expect(result.nextCategorySeedState.hair).toEqual(hair);
	});

	it('generates the character alone when every user category is skipped', () => {
		const skipped = user.map((category) => ({ ...category, state: 'skip' as const }));
		expect(selectPrompts(skipped, [], 1, pinned)).toEqual([IDENTITY_SELECTION, OUTFIT_SELECTION]);
		expect(selectPromptsWithCategoryCycle([], [], {}, pinned)).toEqual({
			selections: [IDENTITY_SELECTION, OUTFIT_SELECTION],
			nextCategorySeedState: {},
			promptSeed: null,
		});
		expect(() => selectPrompts(skipped, [], 1)).toThrow('No active categories available. Unskip at least one category.');
		expect(() => selectPromptsWithCategoryCycle(skipped, [], {}, [])).toThrow('No active categories available. Unskip at least one category.');
	});

	it('rejects a pinned category without a locked sub-prompt', () => {
		expect(() => selectPrompts(user, [], 1, [makeCategory('Pinned', ['free'])])).toThrow(
			new PromptSelectionError("Pinned category 'Pinned' has no locked prompt."),
		);
	});
});
