// Seed domain: types and option lists used by the generation settings store and the seed views. Also owns the seed algorithms: random seeds, seed field parsing, the per-generation
// seed plan and the per-category cycle counters. Pure module.
import type { SeedBehavior } from '../api/types';
import type { CategoryKey } from './categories';
import { isFiniteNumber, isRecord, parseNumberText } from './guards';

export type { SeedBehavior };

/** Persisted per-category cycle counter (settings-store `promptCategorySeedState`). */
export type CategorySeedEntry = {
	seed: number;
	remaining: number;
	prompt_count: number;
};

export type CategorySeedState = Record<CategoryKey, CategorySeedEntry>;

/** Everything a generation changes in the seed settings (restored by undo). */
export type SeedSnapshot = {
	promptSeedInput: string;
	seedInput: string;
	promptSeedBehavior: SeedBehavior;
	imageSeedBehavior: SeedBehavior;
	promptCategorySeedState: CategorySeedState;
};

/** One label per backend SeedBehavior value (exhaustive: the type-check fails when the schema changes). */
export const SEED_BEHAVIOR_LABELS: Record<SeedBehavior, string> = {
	fixed: 'Fixed',
	increment: 'Auto increment',
	randomize: 'Randomize',
	per_category_cycle: 'Per-category cycle (random restart)',
};

/** Every behavior, in display order (the prompt seed supports all of them). */
export const PROMPT_SEED_BEHAVIORS = Object.keys(SEED_BEHAVIOR_LABELS) as readonly SeedBehavior[];
/** The per-category cycle only applies to prompt selection. */
export const IMAGE_SEED_BEHAVIORS: readonly SeedBehavior[] = PROMPT_SEED_BEHAVIORS.filter((behavior) => behavior !== 'per_category_cycle');

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

/** Random seed in [1, 2147483646]. */
export function makeRandomSeed(): number {
	return Math.floor(Math.random() * 2147483646) + 1;
}

/** Seed field text -> number; null when empty or not a finite number. */
export function parseOptionalSeed(value: string): number | null {
	return parseNumberText(value);
}

/** A seed field's text -> the non-negative integer seed the backend accepts (characters, story scenes); null when
 *  empty or not such a number. */
export function nonNegativeSeedOf(value: string): number | null {
	const seed = parseOptionalSeed(value);
	return seed !== null && Number.isSafeInteger(seed) && seed >= 0 ? seed : null;
}

export type SeedPlan = {
	/** Seed sent with the request. */
	requestSeed: number;
	/** Text of the seed field after the generation. */
	nextInput: string;
};

/**
 * Seed of one generation and the field text afterwards.
 * - 'randomize': a new random seed each time (`actualSeed` when known); the field shows the next random seed;
 * - 'increment': the field seed (or `actualSeed`, or random), the field advances by one;
 * - 'fixed' (and anything else): the field seed (or `actualSeed`, or random), the field keeps it.
 * Called without `actualSeed` before the request, and with the seed the backend reports afterwards.
 */
export function planSeed(mode: SeedBehavior, rawValue: string, actualSeed: number | null = null): SeedPlan {
	const parsed = parseOptionalSeed(rawValue);
	const usedSeed = mode === 'randomize' ? (actualSeed ?? makeRandomSeed()) : (parsed ?? actualSeed ?? makeRandomSeed());
	if (mode === 'increment') {
		return { requestSeed: usedSeed, nextInput: String(usedSeed + 1) };
	}
	if (mode === 'randomize') {
		return { requestSeed: usedSeed, nextInput: String(makeRandomSeed()) };
	}
	return { requestSeed: usedSeed, nextInput: String(usedSeed) };
}

export function isSeedBehavior(value: unknown): value is SeedBehavior {
	return typeof value === 'string' && Object.hasOwn(SEED_BEHAVIOR_LABELS, value);
}

// ---------------------------------------------------------------------------
// Per-category cycle counters ('per_category_cycle' prompt seed behavior)
// ---------------------------------------------------------------------------

/** The stored entry when it is consistent with the category's prompt count, else a fresh random cycle. */
export function normalizeCategorySeedEntry(entry: CategorySeedEntry | undefined, promptCount: number): CategorySeedEntry {
	if (promptCount <= 0) {
		return { seed: makeRandomSeed(), remaining: 0, prompt_count: 0 };
	}
	if (
		!entry ||
		!Number.isFinite(entry.seed) ||
		!Number.isFinite(entry.remaining) ||
		!Number.isFinite(entry.prompt_count) ||
		entry.prompt_count !== promptCount ||
		entry.remaining < 1 ||
		entry.remaining > promptCount
	) {
		return { seed: makeRandomSeed(), remaining: promptCount, prompt_count: promptCount };
	}
	return { seed: Math.trunc(entry.seed), remaining: Math.trunc(entry.remaining), prompt_count: promptCount };
}

/** After a prompt was used: next seed, or a random restart once the whole cycle was used. */
export function advanceCategorySeedEntry(entry: CategorySeedEntry): CategorySeedEntry {
	if (entry.prompt_count <= 0) {
		return entry;
	}
	if (entry.remaining <= 1) {
		return { seed: makeRandomSeed(), remaining: entry.prompt_count, prompt_count: entry.prompt_count };
	}
	return { seed: entry.seed + 1, remaining: entry.remaining - 1, prompt_count: entry.prompt_count };
}

/** While scanning past skipped/forbidden prompts: next seed without a random restart. */
export function advanceCategorySeedEntryForScan(entry: CategorySeedEntry): CategorySeedEntry {
	if (entry.prompt_count <= 0) {
		return entry;
	}
	if (entry.remaining <= 1) {
		return { seed: entry.seed + 1, remaining: entry.prompt_count, prompt_count: entry.prompt_count };
	}
	return { seed: entry.seed + 1, remaining: entry.remaining - 1, prompt_count: entry.prompt_count };
}

/** Drops malformed entries of a persisted per-category seed state. */
export function sanitizeCategorySeedState(value: unknown): CategorySeedState {
	if (!isRecord(value)) {
		return {};
	}
	const result: CategorySeedState = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!isRecord(entry)) {
			continue;
		}
		const { seed, remaining, prompt_count } = entry;
		if (isFiniteNumber(seed) && isFiniteNumber(remaining) && isFiniteNumber(prompt_count)) {
			result[key] = { seed, remaining, prompt_count };
		}
	}
	return result;
}
