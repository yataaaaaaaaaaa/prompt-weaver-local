import { describe, expect, it } from 'vitest';
import {
	categoryKeyOf,
	collectLinkedLoraIds,
	compareCategories,
	estimateCategorySize,
	hasActivationTerms,
	isActivationTriggered,
	joinBulkText,
	makeCategory,
	newCategoryName,
	removeLoraFromCategories,
	sameCategoryName,
	sanitizeCategories,
	sanitizeSubPrompts,
	sortCategories,
	splitBulkText,
	subPromptKeyOf,
	subPromptPath,
	type Category,
	type SubPrompt,
} from './categories';

function category(text: string, priority: number, subPrompts: Partial<SubPrompt>[] = [{}], extra: Partial<Category> = {}): Category {
	return {
		text,
		activation_text: '',
		priority,
		state: 'normal',
		subPrompts: subPrompts.map((item) => ({ text: '', state: 'normal', extraLoraIds: [], ...item })),
		...extra,
	};
}

describe('keys', () => {
	it('derives category and sub-prompt keys from their text', () => {
		expect(categoryKeyOf('day_moment')).toBe('day-moment');
		expect(subPromptKeyOf('<lora:an94-10:1>, an-94')).toBe('lora-an94-10-1-an-94');
		expect(subPromptPath('main', 'id')).toBe('main::id');
	});

	it('compares category names by key equivalence', () => {
		expect(sameCategoryName('Groza clothes', 'groza_clothes')).toBe(true);
		expect(sameCategoryName('Clothed', 'Sub_clothed')).toBe(false);
	});

	it('names new categories uniquely like the legacy app', () => {
		expect(newCategoryName([])).toBe('new-category');
		expect(newCategoryName([makeCategory('new-category')])).toBe('new-category-2');
		expect(makeCategory('x')).toEqual({
			text: 'x',
			activation_text: '',
			priority: 1,
			state: 'normal',
			subPrompts: [{ text: '', state: 'normal', extraLoraIds: [] }],
		});
	});
});

describe('bulk text', () => {
	it('joins and splits on a line containing only |', () => {
		const text = joinBulkText([{ text: 'a, b' }, { text: 'multi\nline' }, { text: '' }]);
		expect(text).toBe('a, b\n|\nmulti\nline\n|\n');
		expect(splitBulkText(text)).toEqual(['a, b', 'multi\nline', '']);
	});

	it('trims entries, accepts CRLF and always returns one entry', () => {
		expect(splitBulkText('  a \r\n|\r\n b  ')).toEqual(['a', 'b']);
		expect(splitBulkText('')).toEqual(['']);
		expect(splitBulkText('a | b')).toEqual(['a | b']);
	});
});

describe('sanitizeCategories', () => {
	it('keeps the real persisted format unchanged', () => {
		const persisted = [
			category('girl frontline', 1, [{ text: '<lora:Groza-10:1>, Groza' }, { text: '<lora:an94-10:1>, an-94', state: 'skip' }], { state: 'skip' }),
			category('Main', 2, [{ text: 'embedding:lazypos, 1girl', state: 'lock' }, { text: '' }]),
		];
		expect(sanitizeCategories(persisted)).toEqual(persisted);
	});

	it('repairs unknown states, missing fields, duplicates and extra locks', () => {
		const result = sanitizeCategories([
			{
				text: 'Main',
				priority: '3',
				state: 'indirectly-disabled',
				subPrompts: [
					{ text: 'a', state: 'lock', extraLoraIds: ['x', 'x', 3] },
					{ text: 'A', state: 'normal', extraLoraIds: [] },
					{ text: 'b', state: 'lock' },
					{ text: 'c', state: 'indirectly-disabled' },
				],
			},
			'garbage',
			{ text: 'main', activation_text: 7, priority: Number.NaN },
		]);
		expect(result).toEqual([
			{
				text: 'Main',
				activation_text: '',
				priority: 3,
				state: 'normal',
				subPrompts: [
					{ text: 'a', state: 'lock', extraLoraIds: ['x'] },
					{ text: 'b', state: 'normal', extraLoraIds: [] },
					{ text: 'c', state: 'normal', extraLoraIds: [] },
				],
			},
			{ text: 'main-2', activation_text: '', priority: 1, state: 'normal', subPrompts: [] },
		]);
		expect(sanitizeCategories(undefined)).toEqual([]);
	});

	it('reports how many duplicate sub-prompts were dropped', () => {
		const { subPrompts, droppedDuplicates } = sanitizeSubPrompts([
			{ text: 'x', state: 'normal', extraLoraIds: [] },
			{ text: ' X ', state: 'skip', extraLoraIds: [] },
		]);
		expect(subPrompts.map((item) => item.text)).toEqual(['x']);
		expect(droppedDuplicates).toBe(1);
	});
});

describe('ordering', () => {
	it('sorts by priority (dotted numeric comparison) then name', () => {
		const sorted = sortCategories([category('b', 2), category('a', 2), category('z', 10), category('y', 1)]);
		expect(sorted.map((item) => item.text)).toEqual(['y', 'a', 'b', 'z']);
		expect(compareCategories(category('a', 1.2), category('b', 1.1))).toBeGreaterThan(0);
	});
});

describe('activation', () => {
	it('is always triggered without terms, else when a selected prompt contains a term', () => {
		expect(hasActivationTerms(' , ')).toBe(false);
		expect(isActivationTriggered('', [])).toBe(true);
		expect(isActivationTriggered('clothed, Groza', ['1girl, full_clothed'])).toBe(true);
		expect(isActivationTriggered('groza', ['<lora:Groza-10:1>, Groza, orange eyes'])).toBe(true);
		expect(isActivationTriggered('an-94', ['Groza'])).toBe(false);
	});
});

describe('LoRA links', () => {
	const categories = [
		category('A', 1, [{ text: 'a', extraLoraIds: ['x', 'y'] }, { text: 'b', extraLoraIds: ['y'] }]),
		category('B', 2, [{ text: 'c' }]),
	];

	it('collects linked ids once', () => {
		expect(collectLinkedLoraIds(categories)).toEqual(['x', 'y']);
	});

	it('removes a LoRA from every sub-prompt and keeps untouched objects', () => {
		const next = removeLoraFromCategories(categories, 'y');
		expect(next[0].subPrompts.map((item) => item.extraLoraIds)).toEqual([['x'], []]);
		expect(next[1]).toBe(categories[1]);
		expect(removeLoraFromCategories(categories, 'unknown')).toBe(categories);
	});
});

describe('estimateCategorySize', () => {
	const viewport = { width: 1920, height: 1080 };

	it('grows with the content within bounds', () => {
		expect(estimateCategorySize(category('A', 1), viewport)).toEqual({ width: 300, height: 168 });
		const big = category('A', 1, Array.from({ length: 30 }, (_, index) => ({ text: `${'x'.repeat(200)} ${index}` })), { activation_text: 'x' });
		expect(estimateCategorySize(big, viewport)).toEqual({ width: 768, height: 324 });
	});
});
