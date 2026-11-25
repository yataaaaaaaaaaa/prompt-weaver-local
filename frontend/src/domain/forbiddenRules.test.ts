import { describe, expect, it } from 'vitest';
import type { Category, SubPrompt } from './categories';
import {
	categoryForbiddenHighlight,
	categoryMatcher,
	computeForbiddenHighlights,
	containsMatcher,
	endpointToMatcher,
	forbiddenHighlightFor,
	forbiddenHighlightOf,
	hasAssociation,
	isCategoryWideMatcher,
	isForbiddenPair,
	isLockedPrompt,
	makeRule,
	matcherEquals,
	matcherMatchesPrompt,
	NO_FORBIDDEN_HIGHLIGHTS,
	removeRulesForCategory,
	removeRulesForSubPrompt,
	renameCategoryInRules,
	renameSubPromptInRules,
	ruleBetween,
	ruleEquals,
	ruleMatchesPrompt,
	sameAssociationEndpoint,
	sameAssociationRow,
	sanitizeRules,
	sourceDesignatesCategory,
	sourceDesignatesPrompt,
	specificMatcher,
	strongestForbiddenHighlight,
	tagMatcher,
	toggleRule,
	type AssociationEndpoint,
	type ForbiddenRule,
} from './forbiddenRules';

const prompt = (categoryName: string, promptText: string) => ({ categoryName, promptText });

function category(text: string, subPrompts: (string | Partial<SubPrompt>)[]): Category {
	return {
		text,
		activation_text: '',
		priority: 1,
		state: 'normal',
		subPrompts: subPrompts.map((item) => ({ state: 'normal', extraLoraIds: [], text: '', ...(typeof item === 'string' ? { text: item } : item) })),
	};
}

function endpoint(mode: AssociationEndpoint['mode'], categoryName: string, promptText: string, tagText: string | null = null): AssociationEndpoint {
	return { mode, categoryName, promptText, tagText };
}

describe('constructors', () => {
	it('builds the three matcher kinds', () => {
		expect(specificMatcher('Alpha', 'a')).toEqual({ kind: 'specific', category_name: 'Alpha', prompt_text: 'a', contains_text: null, tag_text: null });
		expect(categoryMatcher('Alpha')).toEqual({ kind: 'specific', category_name: 'Alpha', prompt_text: null, contains_text: null, tag_text: null });
		expect(containsMatcher(null, 'boy')).toEqual({ kind: 'contains', category_name: null, prompt_text: null, contains_text: 'boy', tag_text: null });
		expect(tagMatcher('NSFW', 'Side View')).toEqual({ kind: 'tag', category_name: 'NSFW', prompt_text: null, contains_text: null, tag_text: 'side_view' });
		expect(isCategoryWideMatcher(categoryMatcher('Alpha'))).toBe(true);
		expect(isCategoryWideMatcher(specificMatcher('Alpha', ' , '))).toBe(true);
		expect(isCategoryWideMatcher(specificMatcher('Alpha', 'a'))).toBe(false);
	});

	it('maps association endpoints to matchers', () => {
		expect(endpointToMatcher(endpoint('prompt', 'Alpha', 'a, b'))).toEqual(specificMatcher('Alpha', 'a, b'));
		expect(endpointToMatcher(endpoint('category', 'Alpha', 'a, b'))).toEqual(categoryMatcher('Alpha'));
		expect(endpointToMatcher(endpoint('tag', 'Alpha', 'a, Long Hair', 'Long Hair'))).toEqual(tagMatcher('Alpha', 'long_hair'));
	});
});

describe('equality (one implementation for the store and the domain)', () => {
	it('compares categories by key, prompts by name equivalence, contains and tags normalized', () => {
		expect(matcherEquals(specificMatcher('Groza clothes', 'long hair, Blonde hair'), specificMatcher('groza_clothes', 'blonde_hair, long hair'))).toBe(true);
		expect(matcherEquals(specificMatcher('A', 'x'), specificMatcher('B', 'x'))).toBe(false);
		expect(matcherEquals(containsMatcher(null, ' Boy '), containsMatcher(null, 'boy'))).toBe(true);
		expect(matcherEquals(containsMatcher(null, 'boy'), containsMatcher('A', 'boy'))).toBe(false);
		expect(matcherEquals(tagMatcher('A', 'side view'), { ...tagMatcher('A', 'x'), tag_text: 'Side-View' })).toBe(true);
		expect(matcherEquals(categoryMatcher('A'), tagMatcher('A', 'x'))).toBe(false);
	});

	it('treats a missing tag_text (older persisted rules) like null', () => {
		const legacy = { kind: 'specific', category_name: 'NSFW', prompt_text: 'x', contains_text: null } as unknown as ReturnType<typeof specificMatcher>;
		expect(matcherEquals(legacy, specificMatcher('NSFW', 'x'))).toBe(true);
	});

	it('rules are symmetric and toggle on/off', () => {
		const rule = makeRule(specificMatcher('A', 'a'), categoryMatcher('B'));
		const swapped = makeRule(categoryMatcher('b'), specificMatcher('A', 'A'));
		expect(ruleEquals(rule, swapped)).toBe(true);
		const added = toggleRule([], rule);
		expect(added).toEqual([rule]);
		expect(toggleRule(added, swapped)).toEqual([]);
	});

	it('compares association endpoints and rows', () => {
		const tag = endpoint('tag', 'A', 'x, y', 'x');
		expect(sameAssociationEndpoint(tag, endpoint('tag', 'a', 'x, y', 'X'))).toBe(true);
		expect(sameAssociationEndpoint(tag, endpoint('tag', 'A', 'x, y', 'y'))).toBe(false);
		expect(sameAssociationRow(tag, endpoint('prompt', 'A', 'x, y'))).toBe(true);
		expect(sameAssociationRow(tag, endpoint('prompt', 'B', 'x, y'))).toBe(false);
		const rules = [ruleBetween(endpoint('prompt', 'A', 'x'), endpoint('category', 'B', 'z'))];
		expect(hasAssociation(rules, endpoint('category', 'B', 'other'), endpoint('prompt', 'A', 'x'))).toBe(true);
		expect(hasAssociation(rules, endpoint('prompt', 'A', 'x'), endpoint('prompt', 'B', 'z'))).toBe(false);
	});
});

describe('matching', () => {
	it('category-level specific matchers apply to every prompt in the target category (legacy test)', () => {
		const rule: ForbiddenRule = {
			left: { kind: 'specific', category_name: 'Alpha', prompt_text: 'alpha prompt', contains_text: null, tag_text: null },
			right: { kind: 'specific', category_name: 'Beta', prompt_text: null, contains_text: null, tag_text: null },
		};
		expect(ruleMatchesPrompt(rule, prompt('Alpha', 'alpha prompt'), prompt('Beta', 'beta first'))).toBe(true);
		expect(ruleMatchesPrompt(rule, prompt('Alpha', 'alpha prompt'), prompt('Beta', 'beta second'))).toBe(true);
		expect(ruleMatchesPrompt(rule, prompt('Beta', 'beta second'), prompt('Alpha', 'alpha prompt'))).toBe(true);
		expect(ruleMatchesPrompt(rule, prompt('Alpha', 'other'), prompt('Beta', 'beta first'))).toBe(false);
	});

	it('specific matchers need the same category and an equivalent prompt', () => {
		expect(matcherMatchesPrompt(specificMatcher('bottom_clothed', 'pants,'), prompt('Bottom clothed', 'Pants'))).toBe(true);
		expect(matcherMatchesPrompt(specificMatcher('bottom_clothed', 'pants'), prompt('top_clothed', 'pants'))).toBe(false);
		expect(matcherMatchesPrompt({ ...specificMatcher('x', 'pants'), category_name: null }, prompt('x', 'pants'))).toBe(false);
	});

	it('contains and tag matchers are optionally scoped to a category', () => {
		expect(matcherMatchesPrompt(containsMatcher(null, 'BOY'), prompt('Any', '1boy, smile'))).toBe(true);
		expect(matcherMatchesPrompt(containsMatcher('NSFW', 'boy'), prompt('Any', '1boy'))).toBe(false);
		expect(matcherMatchesPrompt(containsMatcher(null, ' '), prompt('Any', '1boy'))).toBe(false);
		expect(matcherMatchesPrompt(tagMatcher('NSFW', 'sideboob'), prompt('nsfw', 'sideboob, smile'))).toBe(true);
		expect(matcherMatchesPrompt(tagMatcher('NSFW', 'side'), prompt('NSFW', 'sideboob'))).toBe(false);
		expect(matcherMatchesPrompt(tagMatcher(null, 'smile'), prompt('Other', 'Smile'))).toBe(true);
	});

	it('isForbiddenPair checks every rule in both orders', () => {
		const rules = [makeRule(tagMatcher('NSFW', 'side view'), specificMatcher('Openess', 'open_clothes, no_bra'))];
		expect(isForbiddenPair(rules, prompt('Openess', 'no_bra, open_clothes'), prompt('NSFW', 'side_view, x'))).toBe(true);
		expect(isForbiddenPair(rules, prompt('Openess', 'open_clothes'), prompt('NSFW', 'side_view'))).toBe(false);
	});
});

describe('maintenance', () => {
	const exact = makeRule(specificMatcher('Alpha', 'a'), specificMatcher('Beta', 'b'));
	const wide = makeRule(categoryMatcher('Alpha'), specificMatcher('Gamma', 'g'));
	const tag = makeRule(tagMatcher('Alpha', 'x'), containsMatcher(null, 'boy'));
	const rules = [exact, wide, tag];

	it('removes rules naming a category (any kind, key equivalence)', () => {
		expect(removeRulesForCategory(rules, 'alpha')).toEqual([]);
		expect(removeRulesForCategory(rules, 'Beta')).toEqual([wide, tag]);
		expect(removeRulesForCategory(rules, 'Unknown')).toBe(rules);
	});

	it('removes only exact rules of a sub-prompt (never category-wide ones, even for an empty prompt)', () => {
		expect(removeRulesForSubPrompt(rules, 'Alpha', 'A')).toEqual([wide, tag]);
		expect(removeRulesForSubPrompt(rules, 'Alpha', '')).toBe(rules);
		expect(removeRulesForSubPrompt(rules, 'Beta', 'a')).toBe(rules);
	});

	it('renames categories in every matcher kind', () => {
		const renamed = renameCategoryInRules(rules, 'alpha', 'Alpha 2');
		expect(renamed.map((rule) => rule.left.category_name)).toEqual(['Alpha 2', 'Alpha 2', 'Alpha 2']);
		expect(renamed[0].right).toBe(exact.right);
		expect(renameCategoryInRules(rules, 'Unknown', 'X')).toBe(rules);
	});

	it('renames exact prompts only', () => {
		const renamed = renameSubPromptInRules(rules, 'Alpha', 'a', 'a2');
		expect(renamed[0].left).toEqual(specificMatcher('Alpha', 'a2'));
		expect(renamed[1]).toBe(wide);
		expect(renamed[2]).toBe(tag);
		expect(renameSubPromptInRules(rules, 'Alpha', 'a', 'a')).toBe(rules);
	});

	it('sanitizes persisted rules (missing tag_text, malformed entries)', () => {
		const persisted = [
			{ left: { kind: 'specific', category_name: 'NSFW', prompt_text: 'x', contains_text: null }, right: { kind: 'specific', category_name: 'B', prompt_text: 'pants', contains_text: null } },
			{ left: { kind: 'unknown' }, right: { kind: 'specific' } },
			{ left: null },
			'nope',
		];
		expect(sanitizeRules(persisted)).toEqual([makeRule(specificMatcher('NSFW', 'x'), specificMatcher('B', 'pants'))]);
		expect(sanitizeRules(undefined)).toEqual([]);
	});
});

describe('computeForbiddenHighlights', () => {
	const categories = [
		category('Alpha', ['a1', { text: 'a2', state: 'lock' }]),
		category('Beta', ['b1, smile', 'b2', { text: 'b3', state: 'lock' }]),
		category('Gamma', ['g1, 1boy', 'g2']),
	];

	it('is empty without source or rules', () => {
		expect(computeForbiddenHighlights(categories, [makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b1'))], null)).toBe(NO_FORBIDDEN_HIGHLIGHTS);
		expect(computeForbiddenHighlights(categories, [], endpoint('prompt', 'Alpha', 'a1'))).toBe(NO_FORBIDDEN_HIGHLIGHTS);
	});

	it('prompt source: every rule matching (source, sub-prompt); purple when the sub-prompt is locked', () => {
		const rules = [
			makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b1, smile')),
			makeRule(containsMatcher(null, 'boy'), specificMatcher('Alpha', 'a1')),
			makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b3')),
		];
		const highlights = computeForbiddenHighlights(categories, rules, endpoint('prompt', 'Alpha', 'a1'));
		expect(forbiddenHighlightOf(highlights, 'beta', 'b1-smile')).toBe('forbidden');
		expect(forbiddenHighlightOf(highlights, 'gamma', 'g1-1boy')).toBe('forbidden');
		expect(forbiddenHighlightOf(highlights, 'beta', 'b3')).toBe('forbidden-locked');
		expect(forbiddenHighlightOf(highlights, 'beta', 'b2')).toBe('none');
		expect(forbiddenHighlightOf(highlights, 'alpha', 'a1')).toBe('none');
	});

	it('prompt source: a locked source makes every highlight purple, category-wide rules cover the category', () => {
		const rules = [makeRule(specificMatcher('Alpha', 'a2'), categoryMatcher('Gamma'))];
		const highlights = computeForbiddenHighlights(categories, rules, endpoint('prompt', 'Alpha', 'a2'));
		expect([...highlights.entries()]).toEqual([
			['gamma::g1-1boy', 'forbidden-locked'],
			['gamma::g2', 'forbidden-locked'],
		]);
	});

	it('category / tag sources use the rules whose one side equals the source matcher', () => {
		const rules = [
			makeRule(categoryMatcher('Beta'), specificMatcher('Gamma', 'g2')),
			makeRule(specificMatcher('Gamma', 'g1, 1boy'), tagMatcher('Beta', 'smile')),
			makeRule(specificMatcher('Beta', 'b2'), specificMatcher('Gamma', 'g1, 1boy')),
		];
		const byCategory = computeForbiddenHighlights(categories, rules, endpoint('category', 'Beta', 'b2'));
		expect([...byCategory.keys()]).toEqual(['gamma::g2']);
		const byTag = computeForbiddenHighlights(categories, rules, endpoint('tag', 'Beta', 'b1, smile', 'Smile'));
		expect([...byTag.entries()]).toEqual([['gamma::g1-1boy', 'forbidden']]);
	});

	it('a source from a pinned (character) category is locked; pinned categories are never highlighted', () => {
		const pinned = [category('Character', [{ text: '1girl, silver hair', state: 'lock' }])];
		const rules = [makeRule(specificMatcher('Character', '1girl, silver hair'), specificMatcher('Gamma', 'g2'))];
		const source = endpoint('prompt', 'Character', '1girl, silver hair');
		expect([...computeForbiddenHighlights(categories, rules, source).entries()]).toEqual([['gamma::g2', 'forbidden']]);
		expect([...computeForbiddenHighlights(categories, rules, source, pinned).entries()]).toEqual([['gamma::g2', 'forbidden-locked']]);
	});
});

describe('forbidden highlight helpers', () => {
	it('forbiddenHighlightFor: purple as soon as the source or the prompt is locked', () => {
		expect(forbiddenHighlightFor(false, false)).toBe('forbidden');
		expect(forbiddenHighlightFor(true, false)).toBe('forbidden-locked');
		expect(forbiddenHighlightFor(false, true)).toBe('forbidden-locked');
		expect(forbiddenHighlightFor(true, true)).toBe('forbidden-locked');
	});

	it('strongestForbiddenHighlight: forbidden-locked > forbidden > none', () => {
		expect(strongestForbiddenHighlight([])).toBe('none');
		expect(strongestForbiddenHighlight(['none', 'none'])).toBe('none');
		expect(strongestForbiddenHighlight(['none', 'forbidden', 'none'])).toBe('forbidden');
		expect(strongestForbiddenHighlight(['forbidden-locked', 'forbidden'])).toBe('forbidden-locked');
		expect(strongestForbiddenHighlight(['forbidden', 'forbidden-locked', 'none'])).toBe('forbidden-locked');
	});

	it('isLockedPrompt: a locked sub-prompt of the categories (equivalent category name and prompt text)', () => {
		const categories = [category('Alpha', ['a1', { text: 'a2, smile', state: 'lock' }])];
		expect(isLockedPrompt(categories, prompt('alpha', 'Smile,  a2'))).toBe(true);
		expect(isLockedPrompt(categories, prompt('Alpha', 'a1'))).toBe(false);
		expect(isLockedPrompt(categories, prompt('Beta', 'a2, smile'))).toBe(false);
		expect(isLockedPrompt([], prompt('Alpha', 'a2, smile'))).toBe(false);
	});
});

describe('categoryForbiddenHighlight', () => {
	const categories = [
		category('Alpha', ['a1', { text: 'a2', state: 'lock' }]),
		category('Beta', ['b1', { text: 'b2', state: 'lock' }, 'b3']),
		category('Gamma', ['g1']),
	];

	it('is the strongest highlight of the category sub-prompts', () => {
		const rules = [makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b1')), makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b2'))];
		const highlights = computeForbiddenHighlights(categories, rules, endpoint('prompt', 'Alpha', 'a1'));
		expect(categoryForbiddenHighlight(highlights, categories[1])).toBe('forbidden-locked');
		expect(categoryForbiddenHighlight(highlights, categories[0])).toBe('none');
		expect(categoryForbiddenHighlight(highlights, categories[2])).toBe('none');

		const onlyB1 = computeForbiddenHighlights(categories, [rules[0]], endpoint('prompt', 'Alpha', 'a1'));
		expect(categoryForbiddenHighlight(onlyB1, categories[1])).toBe('forbidden');
	});

	it('is none without highlights', () => {
		expect(categoryForbiddenHighlight(NO_FORBIDDEN_HIGHLIGHTS, categories[1])).toBe('none');
	});

	it('a category-wide rule against a category source highlights the whole other category', () => {
		const rules = [makeRule(categoryMatcher('Gamma'), categoryMatcher('Beta'))];
		const highlights = computeForbiddenHighlights(categories, rules, endpoint('category', 'Gamma', 'g1'));
		// b2 is locked: purple wins for the window.
		expect(categoryForbiddenHighlight(highlights, categories[1])).toBe('forbidden-locked');
		expect(categoryForbiddenHighlight(highlights, categories[2])).toBe('none');
	});
});

describe('association source designation', () => {
	it('a prompt source designates its own sub-prompt only (equivalent names)', () => {
		const source = endpoint('prompt', 'Outfit', 'red dress, long');
		expect(sourceDesignatesPrompt(source, prompt('outfit', 'Long, red dress'))).toBe(true);
		expect(sourceDesignatesPrompt(source, prompt('Outfit', 'red dress'))).toBe(false);
		expect(sourceDesignatesPrompt(source, prompt('Background', 'red dress, long'))).toBe(false);
	});

	it('a category source designates every sub-prompt of its category', () => {
		const source = endpoint('category', 'Weather effects', 'puddles reflections');
		expect(sourceDesignatesPrompt(source, prompt('Weather effects', 'lightning bolts'))).toBe(true);
		expect(sourceDesignatesPrompt(source, prompt('weather-effects', 'puddles reflections'))).toBe(true);
		expect(sourceDesignatesPrompt(source, prompt('Mood', 'lightning bolts'))).toBe(false);
	});

	it('a tag source designates the sub-prompts of its category carrying the tag', () => {
		const source = endpoint('tag', 'Background', 'neon city street, rain', 'Rain');
		expect(sourceDesignatesPrompt(source, prompt('Background', 'neon city street, rain'))).toBe(true);
		expect(sourceDesignatesPrompt(source, prompt('Background', 'rain, forest'))).toBe(true);
		expect(sourceDesignatesPrompt(source, prompt('Background', 'rainbow'))).toBe(false);
		expect(sourceDesignatesPrompt(source, prompt('Weather effects', 'rain'))).toBe(false);
	});

	it('the source category window is designated whatever the mode', () => {
		for (const mode of ['prompt', 'category', 'tag'] as const) {
			const source = endpoint(mode, 'Weather effects', 'puddles reflections', mode === 'tag' ? 'puddles reflections' : null);
			expect(sourceDesignatesCategory(source, 'weather effects')).toBe(true);
			expect(sourceDesignatesCategory(source, 'Mood')).toBe(false);
		}
	});
});
