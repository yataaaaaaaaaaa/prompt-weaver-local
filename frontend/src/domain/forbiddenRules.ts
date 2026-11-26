// Forbidden rules domain: the single implementation of matcher/rule
// construction, equality, matching, maintenance (rename/remove) and highlight computation.
// Pure module; the types are used by the forbidden-rules store and the Used sub-prompts view.
//
// Name equivalences (one function each, from ./text and ./categories):
// - category names: key equivalence (sameCategoryName);
// - exact prompts: areNameEquivalent (casing, whitespace and comma-tag order insensitive);
// - contains text: normalizeTextForMatch; tags: normalizeTagId.
import type { ForbiddenMatcher, ForbiddenRule, MatcherKind } from '../api/types';
import {
	categoryKeyOf,
	sameCategoryName,
	subPromptKeyOf,
	subPromptPath,
	type Category,
	type CategoryKey,
	type SubPromptKey,
} from './categories';
import { isRecord, stringOr } from './guards';
import { areNameEquivalent, normalizePromptName, normalizeTagId, normalizeTextForMatch, promptTagIds } from './text';

export type { ForbiddenMatcher, ForbiddenRule, MatcherKind };

/** What a click in the Used sub-prompts list designates: a sub-prompt, its whole category, or one of its tags. */
export type AssociationMode = 'prompt' | 'category' | 'tag';

export type AssociationEndpoint = {
	mode: AssociationMode;
	categoryName: string;
	promptText: string;
	/** Only for mode 'tag'. */
	tagText: string | null;
};

/** Highlight of a sub-prompt that is forbidden together with the current association source. */
export type ForbiddenHighlight = 'none' | 'forbidden' | 'forbidden-locked';

/** A prompt as seen by matchers: the name of its category and its text. */
export type PromptRef = {
	categoryName: string;
	promptText: string;
};

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export function specificMatcher(categoryName: string, promptText: string): ForbiddenMatcher {
	return { kind: 'specific', category_name: categoryName, prompt_text: promptText, contains_text: null, tag_text: null };
}

/** Category-wide matcher: a specific matcher without prompt text matches every prompt of the category. */
export function categoryMatcher(categoryName: string): ForbiddenMatcher {
	return { kind: 'specific', category_name: categoryName, prompt_text: null, contains_text: null, tag_text: null };
}

/** Prompts containing `text`, in one category or (null) in every category. */
export function containsMatcher(categoryName: string | null, text: string): ForbiddenMatcher {
	return { kind: 'contains', category_name: categoryName, prompt_text: null, contains_text: text, tag_text: null };
}

/** Prompts having the tag, in one category or (null) in every category. tag_text is stored normalized. */
export function tagMatcher(categoryName: string | null, tagText: string): ForbiddenMatcher {
	return { kind: 'tag', category_name: categoryName, prompt_text: null, contains_text: null, tag_text: normalizeTagId(tagText) };
}

export function makeRule(left: ForbiddenMatcher, right: ForbiddenMatcher): ForbiddenRule {
	return { left, right };
}

/** prompt -> exact prompt, category -> category-wide, tag -> tag in the endpoint's category. */
export function endpointToMatcher(endpoint: AssociationEndpoint): ForbiddenMatcher {
	if (endpoint.mode === 'prompt') {
		return specificMatcher(endpoint.categoryName, endpoint.promptText);
	}
	if (endpoint.mode === 'category') {
		return categoryMatcher(endpoint.categoryName);
	}
	return tagMatcher(endpoint.categoryName, endpoint.tagText ?? '');
}

export function ruleBetween(source: AssociationEndpoint, target: AssociationEndpoint): ForbiddenRule {
	return makeRule(endpointToMatcher(source), endpointToMatcher(target));
}

export function isCategoryWideMatcher(matcher: ForbiddenMatcher): boolean {
	return matcher.kind === 'specific' && !!matcher.category_name && !normalizePromptName(matcher.prompt_text ?? '');
}

// ---------------------------------------------------------------------------
// Sanitizing (persisted data: older rules have no tag_text key)
// ---------------------------------------------------------------------------

function sanitizeMatcher(value: unknown): ForbiddenMatcher | null {
	if (!isRecord(value)) {
		return null;
	}
	const kind = value.kind ?? 'specific';
	if (kind !== 'specific' && kind !== 'contains' && kind !== 'tag') {
		return null;
	}
	return {
		kind,
		category_name: stringOr(value.category_name, null),
		prompt_text: stringOr(value.prompt_text, null),
		contains_text: stringOr(value.contains_text, null),
		tag_text: stringOr(value.tag_text, null),
	};
}

/** Every matcher field present (missing -> null); malformed rules dropped. */
export function sanitizeRules(value: unknown): ForbiddenRule[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const rules: ForbiddenRule[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			continue;
		}
		const left = sanitizeMatcher(item.left);
		const right = sanitizeMatcher(item.right);
		if (left && right) {
			rules.push({ left, right });
		}
	}
	return rules;
}

// ---------------------------------------------------------------------------
// Equality
// ---------------------------------------------------------------------------

function sameMatcherCategory(left: string | null, right: string | null): boolean {
	if (left == null || right == null) {
		return left == right;
	}
	return sameCategoryName(left, right);
}

export function matcherEquals(left: ForbiddenMatcher, right: ForbiddenMatcher): boolean {
	return (
		left.kind === right.kind &&
		sameMatcherCategory(left.category_name ?? null, right.category_name ?? null) &&
		areNameEquivalent(left.prompt_text ?? '', right.prompt_text ?? '') &&
		normalizeTextForMatch(left.contains_text ?? '') === normalizeTextForMatch(right.contains_text ?? '') &&
		normalizeTagId(left.tag_text ?? '') === normalizeTagId(right.tag_text ?? '')
	);
}

/** Rules are symmetric: {A, B} equals {B, A}. */
export function ruleEquals(left: ForbiddenRule, right: ForbiddenRule): boolean {
	return (
		(matcherEquals(left.left, right.left) && matcherEquals(left.right, right.right)) ||
		(matcherEquals(left.left, right.right) && matcherEquals(left.right, right.left))
	);
}

export function hasRule(rules: readonly ForbiddenRule[], rule: ForbiddenRule): boolean {
	return rules.some((item) => ruleEquals(item, rule));
}

/** Removes every rule equal to `rule`, or appends it when there is none. */
export function toggleRule(rules: readonly ForbiddenRule[], rule: ForbiddenRule): ForbiddenRule[] {
	return hasRule(rules, rule) ? rules.filter((item) => !ruleEquals(item, rule)) : [...rules, rule];
}

/** The exact rule source<->target exists. */
export function hasAssociation(rules: readonly ForbiddenRule[], source: AssociationEndpoint, target: AssociationEndpoint): boolean {
	return hasRule(rules, ruleBetween(source, target));
}

/** Both endpoints designate the same selection row (same category and prompt). */
export function sameAssociationRow(left: AssociationEndpoint, right: AssociationEndpoint): boolean {
	return sameCategoryName(left.categoryName, right.categoryName) && left.promptText === right.promptText;
}

export function sameAssociationEndpoint(left: AssociationEndpoint, right: AssociationEndpoint): boolean {
	return (
		left.mode === right.mode &&
		sameAssociationRow(left, right) &&
		normalizeTagId(left.tagText ?? '') === normalizeTagId(right.tagText ?? '')
	);
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** A prompt with its normalized forms computed once (for repeated matching). */
export type PreparedPrompt = PromptRef & {
	readonly categoryKey: CategoryKey;
	readonly nameKey: string;
	readonly tagIds: ReadonlySet<string>;
	readonly matchText: string;
};

type PreparedMatcher = {
	kind: MatcherKind;
	categoryKey: CategoryKey | null;
	categoryWide: boolean;
	nameKey: string;
	containsText: string;
	tagId: string;
};

export function preparePrompt(prompt: PromptRef): PreparedPrompt {
	if (isPrepared(prompt)) {
		return prompt;
	}
	return {
		categoryName: prompt.categoryName,
		promptText: prompt.promptText,
		categoryKey: categoryKeyOf(prompt.categoryName),
		nameKey: normalizePromptName(prompt.promptText),
		tagIds: promptTagIds(prompt.promptText),
		matchText: normalizeTextForMatch(prompt.promptText),
	};
}

function isPrepared(prompt: PromptRef): prompt is PreparedPrompt {
	return 'nameKey' in prompt;
}

// Rules are immutable values in the stores, so a matcher object always prepares to the same result.
const preparedMatchers = new WeakMap<ForbiddenMatcher, PreparedMatcher>();

function prepareMatcher(matcher: ForbiddenMatcher): PreparedMatcher {
	let prepared = preparedMatchers.get(matcher);
	if (!prepared) {
		prepared = {
			kind: matcher.kind,
			categoryKey: matcher.category_name ? categoryKeyOf(matcher.category_name) : null,
			categoryWide: isCategoryWideMatcher(matcher),
			nameKey: normalizePromptName(matcher.prompt_text ?? ''),
			containsText: normalizeTextForMatch(matcher.contains_text ?? ''),
			tagId: normalizeTagId(matcher.tag_text ?? ''),
		};
		preparedMatchers.set(matcher, prepared);
	}
	return prepared;
}

/**
 * - specific: same category (a specific matcher without category never matches) and, unless category-wide,
 *   an equivalent prompt;
 * - contains / tag: in the matcher's category when it has one, prompt contains the text / has the tag
 *   (empty text or tag never matches).
 */
export function matcherMatchesPrompt(matcher: ForbiddenMatcher, prompt: PromptRef): boolean {
	const prepared = prepareMatcher(matcher);
	const target = preparePrompt(prompt);
	if (prepared.kind === 'specific') {
		if (prepared.categoryKey == null || prepared.categoryKey !== target.categoryKey) {
			return false;
		}
		return prepared.categoryWide || prepared.nameKey === target.nameKey;
	}
	if (prepared.categoryKey != null && prepared.categoryKey !== target.categoryKey) {
		return false;
	}
	if (prepared.kind === 'tag') {
		return !!prepared.tagId && target.tagIds.has(prepared.tagId);
	}
	return !!prepared.containsText && target.matchText.includes(prepared.containsText);
}

/** The rule forbids these two prompts together (in either order). */
export function ruleMatchesPrompt(rule: ForbiddenRule, first: PromptRef, second: PromptRef): boolean {
	const left = preparePrompt(first);
	const right = preparePrompt(second);
	return (
		(matcherMatchesPrompt(rule.left, left) && matcherMatchesPrompt(rule.right, right)) ||
		(matcherMatchesPrompt(rule.left, right) && matcherMatchesPrompt(rule.right, left))
	);
}

export function isForbiddenPair(rules: readonly ForbiddenRule[], first: PromptRef, second: PromptRef): boolean {
	const left = preparePrompt(first);
	const right = preparePrompt(second);
	return rules.some((rule) => ruleMatchesPrompt(rule, left, right));
}

// ---------------------------------------------------------------------------
// Maintenance after category / sub-prompt edits (same array returned when nothing changed)
// ---------------------------------------------------------------------------

function namesCategory(matcher: ForbiddenMatcher, categoryName: string): boolean {
	return matcher.category_name != null && sameCategoryName(matcher.category_name, categoryName);
}

/** An exact (not category-wide) specific matcher of this prompt. */
function namesSubPrompt(matcher: ForbiddenMatcher, categoryName: string, promptText: string): boolean {
	return (
		matcher.kind === 'specific' &&
		!isCategoryWideMatcher(matcher) &&
		namesCategory(matcher, categoryName) &&
		areNameEquivalent(matcher.prompt_text ?? '', promptText)
	);
}

function filterUnchanged(rules: ForbiddenRule[], keep: (rule: ForbiddenRule) => boolean): ForbiddenRule[] {
	const next = rules.filter(keep);
	return next.length === rules.length ? rules : next;
}

function mapMatchers(rules: ForbiddenRule[], update: (matcher: ForbiddenMatcher) => ForbiddenMatcher): ForbiddenRule[] {
	let changed = false;
	const next = rules.map((rule) => {
		const left = update(rule.left);
		const right = update(rule.right);
		if (left === rule.left && right === rule.right) {
			return rule;
		}
		changed = true;
		return { left, right };
	});
	return changed ? next : rules;
}

/** Drops every rule with a side scoped to the category (any matcher kind). */
export function removeRulesForCategory(rules: ForbiddenRule[], categoryName: string): ForbiddenRule[] {
	return filterUnchanged(rules, (rule) => !namesCategory(rule.left, categoryName) && !namesCategory(rule.right, categoryName));
}

/** Drops the rules with an exact matcher of this sub-prompt (category-wide, contains and tag rules stay). */
export function removeRulesForSubPrompt(rules: ForbiddenRule[], categoryName: string, promptText: string): ForbiddenRule[] {
	return filterUnchanged(
		rules,
		(rule) => !namesSubPrompt(rule.left, categoryName, promptText) && !namesSubPrompt(rule.right, categoryName, promptText),
	);
}

export function renameCategoryInRules(rules: ForbiddenRule[], oldName: string, newName: string): ForbiddenRule[] {
	if (oldName === newName) {
		return rules;
	}
	return mapMatchers(rules, (matcher) => (namesCategory(matcher, oldName) ? { ...matcher, category_name: newName } : matcher));
}

export function renameSubPromptInRules(rules: ForbiddenRule[], categoryName: string, oldText: string, newText: string): ForbiddenRule[] {
	if (oldText === newText) {
		return rules;
	}
	return mapMatchers(rules, (matcher) =>
		namesSubPrompt(matcher, categoryName, oldText) ? { ...matcher, prompt_text: newText } : matcher,
	);
}

// ---------------------------------------------------------------------------
// Highlights of the sub-prompt cards against the association source of the Used sub-prompts list
// ---------------------------------------------------------------------------

/** Non-'none' highlights by subPromptPath. */
export type ForbiddenHighlights = ReadonlyMap<string, Exclude<ForbiddenHighlight, 'none'>>;

export const NO_FORBIDDEN_HIGHLIGHTS: ForbiddenHighlights = new Map();

export function forbiddenHighlightOf(highlights: ForbiddenHighlights, categoryKey: CategoryKey, promptKey: SubPromptKey): ForbiddenHighlight {
	return highlights.get(subPromptPath(categoryKey, promptKey)) ?? 'none';
}

/** The prompt is a locked sub-prompt of `categories` (user categories and / or the active character's pinned ones). */
export function isLockedPrompt(categories: readonly Category[], prompt: PromptRef): boolean {
	return categories.some(
		(category) =>
			sameCategoryName(category.text, prompt.categoryName) &&
			category.subPrompts.some((subPrompt) => subPrompt.state === 'lock' && areNameEquivalent(subPrompt.text, prompt.promptText)),
	);
}

/** THE lock rule of every forbidden highlight (category cards and the Used sub-prompts list): 'forbidden-locked' when
 *  the association source or the forbidden prompt is locked, else 'forbidden'. */
export function forbiddenHighlightFor(sourceLocked: boolean, promptLocked: boolean): Exclude<ForbiddenHighlight, 'none'> {
	return sourceLocked || promptLocked ? 'forbidden-locked' : 'forbidden';
}

const HIGHLIGHT_STRENGTH: Readonly<Record<ForbiddenHighlight, number>> = { none: 0, forbidden: 1, 'forbidden-locked': 2 };

/** The strongest of `highlights`: 'forbidden-locked' > 'forbidden' > 'none'. */
export function strongestForbiddenHighlight(highlights: Iterable<ForbiddenHighlight>): ForbiddenHighlight {
	let best: ForbiddenHighlight = 'none';
	for (const highlight of highlights) {
		if (HIGHLIGHT_STRENGTH[highlight] > HIGHLIGHT_STRENGTH[best]) {
			best = highlight;
		}
	}
	return best;
}

/** Highlight of a category card: the strongest highlight of its sub-prompts (computeForbiddenHighlights output). */
export function categoryForbiddenHighlight(highlights: ForbiddenHighlights, category: Category): ForbiddenHighlight {
	if (highlights.size === 0) {
		return 'none';
	}
	const categoryKey = categoryKeyOf(category.text);
	return strongestForbiddenHighlight(
		category.subPrompts.map((subPrompt) => forbiddenHighlightOf(highlights, categoryKey, subPromptKeyOf(subPrompt.text))),
	);
}

/**
 * What the association source designates on the category cards ('associated'): a 'prompt' source its own
 * sub-prompt, a 'category' source every sub-prompt of its category, a 'tag' source the sub-prompts of its category
 * carrying the tag. The source's own matcher (endpointToMatcher) decides, so designation and the rules it creates
 * always agree.
 */
export function sourceDesignatesPrompt(source: AssociationEndpoint, prompt: PromptRef): boolean {
	return matcherMatchesPrompt(endpointToMatcher(source), prompt);
}

/** The association source belongs to this category: its card is 'associated' (whatever the source mode). */
export function sourceDesignatesCategory(source: AssociationEndpoint, categoryName: string): boolean {
	return sameCategoryName(source.categoryName, categoryName);
}

/**
 * Which sub-prompts a rule forbids together with the association source:
 * - 'prompt' source: every rule matching (source prompt, sub-prompt);
 * - 'category' / 'tag' source: rules with one side equal to the source matcher and the other side matching the sub-prompt.
 * 'forbidden-locked' when the source prompt or the sub-prompt is locked. The source prompt itself is never highlighted.
 * `pinned`: the active character's pinned categories (src/domain/characters.ts characterCategories); they have no
 * card (never highlighted) but their locked sub-prompts count as locked sources.
 */
export function computeForbiddenHighlights(
	categories: readonly Category[],
	rules: readonly ForbiddenRule[],
	source: AssociationEndpoint | null,
	pinned: readonly Category[] = [],
): ForbiddenHighlights {
	if (!source || rules.length === 0) {
		return NO_FORBIDDEN_HIGHLIGHTS;
	}
	const sourcePrompt = preparePrompt({ categoryName: source.categoryName, promptText: source.promptText });
	const sourceLocked = isLockedPrompt(pinned, sourcePrompt) || isLockedPrompt(categories, sourcePrompt);
	let isForbidden: (target: PreparedPrompt) => boolean;
	if (source.mode === 'prompt') {
		isForbidden = (target) => rules.some((rule) => ruleMatchesPrompt(rule, sourcePrompt, target));
	} else {
		const sourceMatcher = endpointToMatcher(source);
		const opposite = rules.flatMap((rule) => [
			...(matcherEquals(rule.left, sourceMatcher) ? [rule.right] : []),
			...(matcherEquals(rule.right, sourceMatcher) ? [rule.left] : []),
		]);
		if (opposite.length === 0) {
			return NO_FORBIDDEN_HIGHLIGHTS;
		}
		isForbidden = (target) => opposite.some((matcher) => matcherMatchesPrompt(matcher, target));
	}

	const highlights = new Map<string, Exclude<ForbiddenHighlight, 'none'>>();
	for (const category of categories) {
		const categoryKey = categoryKeyOf(category.text);
		for (const subPrompt of category.subPrompts) {
			const target = preparePrompt({ categoryName: category.text, promptText: subPrompt.text });
			if (target.categoryKey === sourcePrompt.categoryKey && target.nameKey === sourcePrompt.nameKey) {
				continue;
			}
			if (isForbidden(target)) {
				highlights.set(subPromptPath(categoryKey, subPromptKeyOf(subPrompt.text)), forbiddenHighlightFor(sourceLocked, subPrompt.state === 'lock'));
			}
		}
	}
	return highlights;
}
