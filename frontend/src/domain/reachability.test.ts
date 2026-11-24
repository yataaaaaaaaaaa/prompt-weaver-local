import { describe, expect, it } from 'vitest';
import type { Category, SubPrompt } from './categories';
import { categoryMatcher, containsMatcher, makeRule, specificMatcher } from './forbiddenRules';
import { buildReachabilitySnapshot, categoryUiStateOf, subPromptUiStateOf, type ReachabilitySnapshot } from './reachability';

function category(text: string, priority: number, subPrompts: (string | Partial<SubPrompt>)[], extra: Partial<Category> = {}): Category {
	return {
		text,
		activation_text: '',
		priority,
		state: 'normal',
		subPrompts: subPrompts.map((item) => ({ state: 'normal', extraLoraIds: [], text: '', ...(typeof item === 'string' ? { text: item } : item) })),
		...extra,
	};
}

function states(snapshot: ReachabilitySnapshot): Record<string, string> {
	return Object.fromEntries([...snapshot.categories.entries(), ...snapshot.subPrompts.entries()]);
}

describe('buildReachabilitySnapshot', () => {
	it('marks skipped categories and their sub-prompts as skip', () => {
		const snapshot = buildReachabilitySnapshot([category('Alpha', 1, ['a1', { text: 'a2', state: 'lock' }], { state: 'skip' })]);
		expect(states(snapshot)).toEqual({ alpha: 'skip', 'alpha::a1': 'skip', 'alpha::a2': 'skip' });
	});

	it('keeps normal, skip and reports categories without selectable sub-prompt', () => {
		const snapshot = buildReachabilitySnapshot([
			category('Alpha', 1, ['a1', { text: 'a2', state: 'skip' }]),
			category('Beta', 2, [{ text: 'b1', state: 'skip' }]),
		]);
		expect(states(snapshot)).toEqual({
			alpha: 'normal',
			beta: 'indirectly-disabled',
			'alpha::a1': 'normal',
			'alpha::a2': 'skip',
			'beta::b1': 'skip',
		});
	});

	it('activates categories from sub-prompts selectable earlier (same substring rule as the engine)', () => {
		const snapshot = buildReachabilitySnapshot([
			category('Clothes', 3, ['shirt'], { activation_text: 'clothed' }),
			category('Main', 1, ['1girl, full_clothed', 'nude']),
			category('Groza clothes', 2, ['jacket'], { activation_text: 'Groza' }),
			category('Late', 0, ['x'], { activation_text: 'shirt' }),
		]);
		expect(categoryUiStateOf(snapshot, 'clothes')).toBe('normal');
		expect(categoryUiStateOf(snapshot, 'groza-clothes')).toBe('indirectly-disabled');
		expect(subPromptUiStateOf(snapshot, 'groza-clothes', 'jacket')).toBe('indirectly-disabled');
		// 'Late' (priority 0) is walked before 'Clothes', so 'shirt' cannot activate it.
		expect(categoryUiStateOf(snapshot, 'late')).toBe('indirectly-disabled');
	});

	it('a lock is the only candidate; skipped siblings stay skip', () => {
		const snapshot = buildReachabilitySnapshot([category('Alpha', 1, ['a1', { text: 'a2', state: 'lock' }, { text: 'a3', state: 'skip' }])]);
		expect(states(snapshot)).toEqual({ alpha: 'normal', 'alpha::a1': 'indirectly-disabled', 'alpha::a2': 'lock', 'alpha::a3': 'skip' });
	});

	it('a lock forbids the sub-prompts matched by the other side of its rules', () => {
		const categories = [category('Alpha', 1, [{ text: 'a1', state: 'lock' }]), category('Beta', 2, ['b1', 'b2'])];
		const snapshot = buildReachabilitySnapshot(categories, [makeRule(specificMatcher('Beta', 'b1'), specificMatcher('Alpha', 'a1'))]);
		expect(states(snapshot)).toEqual({ alpha: 'normal', beta: 'normal', 'alpha::a1': 'lock', 'beta::b1': 'indirectly-disabled', 'beta::b2': 'normal' });
	});

	it('a category whose every sub-prompt is forbidden by a lock (category-wide rule) is indirectly disabled', () => {
		const categories = [category('Alpha', 1, [{ text: 'a1', state: 'lock' }]), category('Beta', 2, ['b1', { text: 'b2', state: 'skip' }])];
		const snapshot = buildReachabilitySnapshot(categories, [makeRule(specificMatcher('Alpha', 'a1'), categoryMatcher('Beta'))]);
		expect(states(snapshot)).toEqual({ alpha: 'normal', beta: 'indirectly-disabled', 'alpha::a1': 'lock', 'beta::b1': 'indirectly-disabled', 'beta::b2': 'skip' });
	});

	it('a lock forbidden by an earlier lock disables its whole category', () => {
		const categories = [category('Alpha', 1, [{ text: 'a1, boy', state: 'lock' }]), category('Beta', 2, ['b1', { text: 'b2', state: 'lock' }])];
		const snapshot = buildReachabilitySnapshot(categories, [makeRule(containsMatcher(null, 'boy'), specificMatcher('Beta', 'b2'))]);
		expect(categoryUiStateOf(snapshot, 'beta')).toBe('indirectly-disabled');
		expect(subPromptUiStateOf(snapshot, 'beta', 'b1')).toBe('indirectly-disabled');
		expect(subPromptUiStateOf(snapshot, 'beta', 'b2')).toBe('indirectly-disabled');
	});

	it('returns undefined for unknown keys', () => {
		const snapshot = buildReachabilitySnapshot([]);
		expect(categoryUiStateOf(snapshot, 'x')).toBeUndefined();
		expect(subPromptUiStateOf(snapshot, 'x', 'y')).toBeUndefined();
	});
});
