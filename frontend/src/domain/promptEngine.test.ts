// Ports every case of the pre-refactor tests/promptEngine.test.ts (prompt engine part) plus selectPrompts coverage.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ForbiddenRule } from '../api/types';
import type { Category, SubPrompt } from './categories';
import { containsMatcher, makeRule, specificMatcher } from './forbiddenRules';
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
