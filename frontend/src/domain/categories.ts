// Prompt categories domain model.
// The types below are the persisted format of the 'categorie-store' (version 0) and are a CONTRACT:
// do not change them without a persisted-state migration.
import type { Rect, Size, Viewport } from './layout';
import { isFiniteNumber, isRecord, parseNumberText, stringOr } from './guards';
import { comparePriority, sameKey, splitActivationTerms, textContains, toKey, uniqueKey, uniqueStrings } from './text';

export type CategoryState = 'normal' | 'skip';
export type SubPromptState = 'normal' | 'skip' | 'lock';
/** Derived, never persisted: 'indirectly-disabled' = unreachable (activation text, locks, forbidden rules). */
export type CategoryUiState = CategoryState | 'indirectly-disabled';
export type SubPromptUiState = SubPromptState | 'indirectly-disabled';

/** One sub-prompt. Identity inside its category = subPromptKeyOf(text) (unique per category). */
export type SubPrompt = {
	text: string;
	state: SubPromptState;
	/** LoRA ids (library ids) induced when this sub-prompt is selected. */
	extraLoraIds: string[];
};

/** One category. Identity = categoryKeyOf(text) (unique). */
export type Category = {
	text: string;
	/** Comma-separated activation terms; non-empty = only active when a selected prompt contains one. */
	activation_text: string;
	priority: number;
	state: CategoryState;
	subPrompts: SubPrompt[];
};

export type CategoryKey = string;
export type SubPromptKey = string;

export function categoryKeyOf(categoryText: string): CategoryKey {
	return toKey(categoryText);
}

export function subPromptKeyOf(subPromptText: string): SubPromptKey {
	return toKey(subPromptText);
}

/** THE category-name comparison (rules, selections, cycle counters): key equivalence. */
export function sameCategoryName(left: string, right: string): boolean {
	return sameKey(left, right);
}

/** Identity of a sub-prompt across categories (keys only contain [a-z0-9-]). */
export function subPromptPath(categoryKey: CategoryKey, promptKey: SubPromptKey): string {
	return `${categoryKey}::${promptKey}`;
}

/** The category has activation terms (comma-separated activation_text). */
export function hasActivationTerms(activationText: string): boolean {
	return splitActivationTerms(activationText).length > 0;
}

/** Without activation terms a category is always active; with terms, only when one of the prompts selected
 *  before it contains one of them (case/whitespace-insensitive substring). Shared by the prompt engine and
 *  the reachability snapshot. */
export function isActivationTriggered(activationText: string, selectedPromptTexts: readonly string[]): boolean {
	const terms = splitActivationTerms(activationText);
	return terms.length === 0 || terms.some((term) => selectedPromptTexts.some((text) => textContains(text, term)));
}

export const NEW_CATEGORY_NAME = 'new category';

export function makeSubPrompt(text = ''): SubPrompt {
	return { text, state: 'normal', extraLoraIds: [] };
}

export function makeCategory(text: string): Category {
	return { text, activation_text: '', priority: DEFAULT_PRIORITY, state: 'normal', subPrompts: [makeSubPrompt()] };
}

/** Name of a new category: 'new category' made unique among the existing keys (legacy: 'new-category', 'new-category-2'). */
export function newCategoryName(categories: readonly Category[]): string {
	return uniqueKey(NEW_CATEGORY_NAME, categories.map((category) => categoryKeyOf(category.text)));
}

// ---------------------------------------------------------------------------
// Ordering (generation order, reachability, "Reorganize categories")
// ---------------------------------------------------------------------------

/** Priority (dotted numeric comparison of String(priority)), then name. */
export function compareCategories(left: Category, right: Category): number {
	return comparePriority(String(left.priority), String(right.priority)) || left.text.localeCompare(right.text);
}

export function sortCategories(categories: readonly Category[]): Category[] {
	return [...categories].sort(compareCategories);
}

// ---------------------------------------------------------------------------
// Bulk editor text: sub-prompt texts separated by a line containing only '|'
// ---------------------------------------------------------------------------

export const BULK_SEPARATOR = '\n|\n';

export function joinBulkText(subPrompts: readonly Pick<SubPrompt, 'text'>[]): string {
	return subPrompts.map((subPrompt) => subPrompt.text).join(BULK_SEPARATOR);
}

/** Entries trimmed; always at least one entry ('' -> ['']). CRLF line breaks are accepted. */
export function splitBulkText(text: string): string[] {
	return text.split(/\r?\n\|\r?\n/g).map((item) => item.trim());
}

// ---------------------------------------------------------------------------
// Sanitizing (persisted data, legacy import, bulk replacement)
// ---------------------------------------------------------------------------

/** Priority of a new category and of stored/imported data without a usable priority. */
export const DEFAULT_PRIORITY = 1;

/** Priority given as a number or as text (typed in the priority field, legacy app_state.json strings);
 *  null when it is not a finite number (decimals allowed: '2.5'). */
export function parsePriority(value: unknown): number | null {
	if (typeof value === 'string') {
		return parseNumberText(value);
	}
	return isFiniteNumber(value) ? value : null;
}

/** parsePriority, DEFAULT_PRIORITY when unusable. */
export function priorityOr(value: unknown): number {
	return parsePriority(value) ?? DEFAULT_PRIORITY;
}

function sanitizeSubPrompt(value: unknown): SubPrompt {
	const raw = isRecord(value) ? value : {};
	const state = raw.state === 'skip' || raw.state === 'lock' ? raw.state : 'normal';
	const extraLoraIds = Array.isArray(raw.extraLoraIds) ? raw.extraLoraIds.filter((id): id is string => typeof id === 'string') : [];
	return { text: stringOr(raw.text, ''), state, extraLoraIds: uniqueStrings(extraLoraIds) };
}

/** Keeps the first sub-prompt of each key and the first lock (later locks become 'normal'). */
export function sanitizeSubPrompts(subPrompts: readonly SubPrompt[]): { subPrompts: SubPrompt[]; droppedDuplicates: number } {
	const seen = new Set<SubPromptKey>();
	let sawLock = false;
	const result: SubPrompt[] = [];
	for (const subPrompt of subPrompts) {
		const key = subPromptKeyOf(subPrompt.text);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		if (subPrompt.state === 'lock') {
			if (sawLock) {
				result.push({ ...subPrompt, state: 'normal' });
				continue;
			}
			sawLock = true;
		}
		result.push(subPrompt);
	}
	return { subPrompts: result, droppedDuplicates: subPrompts.length - result.length };
}

/**
 * Normalizes untrusted categories (persisted store, legacy import): unknown states -> 'normal', missing fields
 * defaulted, duplicate sub-prompt keys dropped, a single lock per category, and unique category keys
 * (a duplicate category is renamed with uniqueKey so no user data is lost).
 */
export function sanitizeCategories(value: unknown): Category[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const usedKeys = new Set<CategoryKey>();
	return value.filter(isRecord).map((raw) => {
		let text = stringOr(raw.text, '');
		if (usedKeys.has(categoryKeyOf(text))) {
			text = uniqueKey(text, usedKeys);
		}
		usedKeys.add(categoryKeyOf(text));
		const subPrompts = Array.isArray(raw.subPrompts) ? raw.subPrompts.map(sanitizeSubPrompt) : [];
		return {
			text,
			activation_text: stringOr(raw.activation_text, ''),
			priority: priorityOr(raw.priority),
			state: raw.state === 'skip' ? 'skip' : 'normal',
			subPrompts: sanitizeSubPrompts(subPrompts).subPrompts,
		};
	});
}

/** Removes a LoRA id from every sub-prompt (same array returned when nothing referenced it). */
export function removeLoraFromCategories(categories: Category[], loraId: string): Category[] {
	if (!categories.some((category) => category.subPrompts.some((subPrompt) => subPrompt.extraLoraIds.includes(loraId)))) {
		return categories;
	}
	return categories.map((category) =>
		category.subPrompts.some((subPrompt) => subPrompt.extraLoraIds.includes(loraId))
			? {
					...category,
					subPrompts: category.subPrompts.map((subPrompt) =>
						subPrompt.extraLoraIds.includes(loraId)
							? { ...subPrompt, extraLoraIds: subPrompt.extraLoraIds.filter((id) => id !== loraId) }
							: subPrompt,
					),
				}
			: category,
	);
}

/** Every LoRA id induced by some sub-prompt, unique, in category/sub-prompt order. */
export function collectLinkedLoraIds(categories: readonly Category[]): string[] {
	return uniqueStrings(categories.flatMap((category) => category.subPrompts.flatMap((subPrompt) => subPrompt.extraLoraIds)));
}

// ---------------------------------------------------------------------------
// Category windows
// ---------------------------------------------------------------------------

/** Where the window of the category at `index` (categories order) is drawn without a stored layout: cascaded. */
export function categoryDefaultLayout(index: number): Rect {
	return { x: 40 + 24 * index, y: 40 + 24 * index, width: 500, height: 300 };
}

// ---------------------------------------------------------------------------
// Window size estimate (used by "Reorganize categories" when a card has no stored size)
// ---------------------------------------------------------------------------

/** Card size from its content: width from the longest text (capped at 40% of the viewport width),
 *  height from the sub-prompt count (capped at 30% of the viewport height). */
export function estimateCategorySize(category: Category, viewport: Viewport): Size {
	const maxWidth = Math.max(320, Math.floor(viewport.width * 0.4));
	const maxHeight = Math.max(180, Math.floor(viewport.height * 0.3));
	const longestText = Math.max(
		18,
		category.text.length,
		category.activation_text.length,
		...category.subPrompts.map((subPrompt) => Math.max(18, subPrompt.text.length)),
	);
	const width = Math.max(300, Math.min(maxWidth, 170 + longestText * 6));
	const visibleSubPromptCount = Math.max(1, category.subPrompts.length);
	const headerHeight = category.activation_text.trim() ? 108 : 82;
	const estimatedHeight = headerHeight + visibleSubPromptCount * 38 + 20;
	const height = Math.max(168, Math.min(maxHeight, estimatedHeight));
	return { width, height };
}
