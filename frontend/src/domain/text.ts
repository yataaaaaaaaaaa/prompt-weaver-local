// Text normalization: single owner of every key/slug/matching normalization of the frontend
// (stable keys, unique names, prompt/tag/category name equivalences, priority ordering).
// Pure module: no React, no stores. Untrusted value guards live in ./guards.ts.

const COMBINING_DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Stable key of a user-visible name (category name, sub-prompt text, library file name, ...):
 * NFKD, diacritics removed, lower-case, runs of non [a-z0-9] collapsed to '-', trimmed; 'id' when empty.
 * Persisted data depends on it (window layout keys, per-category seed state keys, library ids): never change it.
 */
export function toKey(text: string): string {
	const normalized = text.normalize('NFKD').replace(COMBINING_DIACRITICS, '').trim().toLowerCase();
	const slug = normalized
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+/g, '')
		.replace(/-+$/g, '')
		.replace(/-+/g, '-');
	return slug || 'id';
}

/** Two names designate the same thing when their keys are equal (category names, library names). */
export function sameKey(left: string, right: string): boolean {
	return toKey(left) === toKey(right);
}

/**
 * The one unique-name helper: toKey(base), suffixed '-2', '-3', ... until it is not in `existingKeys`.
 * (Replaces the legacy slugify/uniqueSlug: identical results for ASCII names, e.g.
 * 'JANKUV5NSFWTrainedNoobai_v50.safetensors' -> 'jankuv5nsfwtrainednoobai-v50-safetensors'.)
 */
export function uniqueKey(base: string, existingKeys: Iterable<string>): string {
	const taken = existingKeys instanceof Set ? (existingKeys as Set<string>) : new Set(existingKeys);
	const initial = toKey(base);
	if (!taken.has(initial)) {
		return initial;
	}
	let counter = 2;
	while (taken.has(`${initial}-${counter}`)) {
		counter += 1;
	}
	return `${initial}-${counter}`;
}

/** Unique values in first-occurrence order (id lists). */
export function uniqueStrings(values: Iterable<string>): string[] {
	return Array.from(new Set(values));
}

// ---------------------------------------------------------------------------
// Prompt matching normalizations (forbidden rules, activation terms, tags)
// ---------------------------------------------------------------------------

/** One tag/token as an id: runs of non-alphanumerics -> '_', trimmed, lower-case ('Long Hair' -> 'long_hair'). */
export function normalizeIdPart(token: string): string {
	return token
		.replace(/[^a-zA-Z0-9]+/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}

/** Tag identity used by tag matchers (persisted in ForbiddenMatcher.tag_text). */
export function normalizeTagId(value: string): string {
	return normalizeIdPart(value);
}

/** Prompt identity for exact prompt rules: casing, whitespace and comma-tag order insensitive. */
export function normalizePromptName(value: string): string {
	return value
		.split(',')
		.map((token) => normalizeIdPart(token))
		.filter(Boolean)
		.sort()
		.join(', ');
}

export function areNameEquivalent(left: string, right: string): boolean {
	return normalizePromptName(left) === normalizePromptName(right);
}

/** Whitespace-collapsed, trimmed, lower-case text for substring matching. */
export function normalizeTextForMatch(text: string): string {
	return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Case/whitespace-insensitive substring test; an empty needle never matches. */
export function textContains(haystack: string, needle: string): boolean {
	const normalizedNeedle = normalizeTextForMatch(needle);
	if (!normalizedNeedle) {
		return false;
	}
	return normalizeTextForMatch(haystack).includes(normalizedNeedle);
}

/** Comma-separated activation terms, trimmed, empty ones dropped (case preserved). */
export function splitActivationTerms(text: string): string[] {
	return text
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

/** Comma-separated words of a prompt, normalized for matching. */
export function splitPromptWords(text: string): string[] {
	return text
		.split(',')
		.map((item) => normalizeTextForMatch(item))
		.filter(Boolean);
}

/** Comma-separated tags of a prompt (trimmed display text), unique by normalizeTagId, in order. */
export function splitPromptTags(text: string): string[] {
	const seen = new Set<string>();
	const tags: string[] = [];
	for (const rawTag of text.split(',')) {
		const trimmedTag = rawTag.trim();
		const tagId = normalizeTagId(trimmedTag);
		if (!trimmedTag || !tagId || seen.has(tagId)) {
			continue;
		}
		seen.add(tagId);
		tags.push(trimmedTag);
	}
	return tags;
}

/** Tags as pasted into a prompt (the inverse of splitPromptTags): trimmed, empty ones dropped, joined with ', '.
 *  Used for trigger words and for the tags of online images. */
export function joinPromptTags(tags: readonly string[]): string {
	return tags
		.map((tag) => tag.trim())
		.filter(Boolean)
		.join(', ');
}

/** Normalized tag ids of a prompt. */
export function promptTagIds(promptText: string): Set<string> {
	return new Set(splitPromptTags(promptText).map((tag) => normalizeTagId(tag)));
}

export function promptHasTag(promptText: string, tagText: string): boolean {
	const expectedTagId = normalizeTagId(tagText);
	if (!expectedTagId) {
		return false;
	}
	return promptTagIds(promptText).has(expectedTagId);
}

// ---------------------------------------------------------------------------
// Priorities ('1', '2.1', ...): dotted numeric parts; non-numeric parts use their digits or sort last.
// ---------------------------------------------------------------------------

const MISSING_PRIORITY_PART = 10000;

export function priorityToSortKey(priority: string): number[] {
	return (priority || '')
		.split('.')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			if (/^\d+$/.test(part)) {
				return Number(part);
			}
			const digits = part.replace(/\D+/g, '');
			return digits ? Number(digits) : MISSING_PRIORITY_PART;
		});
}

export function comparePriority(left: string, right: string): number {
	const leftParts = priorityToSortKey(left);
	const rightParts = priorityToSortKey(right);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const delta = (leftParts[index] ?? MISSING_PRIORITY_PART) - (rightParts[index] ?? MISSING_PRIORITY_PART);
		if (delta !== 0) {
			return delta;
		}
	}
	return 0;
}

/** One sentence listing named problems ('name: problem' joined with '; ', e.g. resources skipped or downloads that
 *  failed): each problem's trailing periods are dropped, one period ends the sentence. */
export function namedProblemsText(items: readonly { name: string; problem: string }[]): string {
	return `${items.map(({ name, problem }) => `${name}: ${problem.trim().replace(/\.+$/, '')}`).join('; ')}.`;
}

/** Display text of a weight (at most 2 decimals, no trailing zeros): 1 -> '1', 0.6 -> '0.6', -1.25 -> '-1.25'.
 *  The one weight formatter of the views (LoRA weights, IP-Adapter reference strength). */
export function formatWeight(weight: number): string {
	return String(Math.round(weight * 100) / 100);
}
