import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	advanceCategorySeedEntry,
	advanceCategorySeedEntryForScan,
	IMAGE_SEED_BEHAVIORS,
	isSeedBehavior,
	makeRandomSeed,
	normalizeCategorySeedEntry,
	parseOptionalSeed,
	planSeed,
	PROMPT_SEED_BEHAVIORS,
	sanitizeCategorySeedState,
	SEED_BEHAVIOR_LABELS,
} from './seeds';

function mockRandom(value: number): void {
	vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('seed basics', () => {
	it('makes random seeds in [1, 2147483646]', () => {
		mockRandom(0);
		expect(makeRandomSeed()).toBe(1);
		mockRandom(0.25);
		expect(makeRandomSeed()).toBe(536870912);
		mockRandom(0.9999999999);
		expect(makeRandomSeed()).toBe(2147483646);
	});

	it('parses optional seed fields', () => {
		expect(parseOptionalSeed('')).toBeNull();
		expect(parseOptionalSeed('   ')).toBeNull();
		expect(parseOptionalSeed(' 42 ')).toBe(42);
		expect(parseOptionalSeed('abc')).toBeNull();
	});

	it('labels every behavior and offers no cycle for image seeds', () => {
		expect(PROMPT_SEED_BEHAVIORS.every((behavior) => SEED_BEHAVIOR_LABELS[behavior])).toBe(true);
		expect(IMAGE_SEED_BEHAVIORS).not.toContain('per_category_cycle');
		expect(isSeedBehavior('increment')).toBe(true);
		expect(isSeedBehavior('keep')).toBe(false);
	});
});

describe('planSeed', () => {
	it('fixed: uses the field (or a random seed) and keeps it', () => {
		expect(planSeed('fixed', '42')).toEqual({ requestSeed: 42, nextInput: '42' });
		mockRandom(0.5);
		expect(planSeed('fixed', '')).toEqual({ requestSeed: 1073741824, nextInput: '1073741824' });
		expect(planSeed('fixed', '', 7)).toEqual({ requestSeed: 7, nextInput: '7' });
	});

	it('increment: uses the field and advances it by one', () => {
		expect(planSeed('increment', '41')).toEqual({ requestSeed: 41, nextInput: '42' });
		expect(planSeed('increment', '', 99)).toEqual({ requestSeed: 99, nextInput: '100' });
	});

	it('randomize: ignores the field, the next field value is random', () => {
		mockRandom(0.25);
		expect(planSeed('randomize', '42')).toEqual({ requestSeed: 536870912, nextInput: '536870912' });
		expect(planSeed('randomize', '42', 5)).toEqual({ requestSeed: 5, nextInput: '536870912' });
	});
});

describe('per-category cycle entries', () => {
	it('keeps a consistent entry and truncates it', () => {
		expect(normalizeCategorySeedEntry({ seed: 5.7, remaining: 2, prompt_count: 3 }, 3)).toEqual({ seed: 5, remaining: 2, prompt_count: 3 });
	});

	it('restarts randomly when the entry is missing or inconsistent', () => {
		mockRandom(0.25);
		const fresh = { seed: 536870912, remaining: 3, prompt_count: 3 };
		expect(normalizeCategorySeedEntry(undefined, 3)).toEqual(fresh);
		expect(normalizeCategorySeedEntry({ seed: 1, remaining: 2, prompt_count: 2 }, 3)).toEqual(fresh);
		expect(normalizeCategorySeedEntry({ seed: 1, remaining: 0, prompt_count: 3 }, 3)).toEqual(fresh);
		expect(normalizeCategorySeedEntry({ seed: Number.NaN, remaining: 1, prompt_count: 3 }, 3)).toEqual(fresh);
		expect(normalizeCategorySeedEntry(undefined, 0)).toEqual({ seed: 536870912, remaining: 0, prompt_count: 0 });
	});

	it('advances, restarting randomly after a full cycle', () => {
		mockRandom(0.25);
		expect(advanceCategorySeedEntry({ seed: 4, remaining: 3, prompt_count: 3 })).toEqual({ seed: 5, remaining: 2, prompt_count: 3 });
		expect(advanceCategorySeedEntry({ seed: 4, remaining: 1, prompt_count: 3 })).toEqual({ seed: 536870912, remaining: 3, prompt_count: 3 });
		expect(advanceCategorySeedEntryForScan({ seed: 4, remaining: 1, prompt_count: 3 })).toEqual({ seed: 5, remaining: 3, prompt_count: 3 });
		const empty = { seed: 1, remaining: 0, prompt_count: 0 };
		expect(advanceCategorySeedEntry(empty)).toBe(empty);
		expect(advanceCategorySeedEntryForScan(empty)).toBe(empty);
	});

	it('sanitizes a persisted per-category seed state', () => {
		expect(
			sanitizeCategorySeedState({
				main: { seed: 484998770, remaining: 2, prompt_count: 2 },
				broken: { seed: 'x', remaining: 1, prompt_count: 1 },
				other: null,
			}),
		).toEqual({ main: { seed: 484998770, remaining: 2, prompt_count: 2 } });
		expect(sanitizeCategorySeedState([])).toEqual({});
		expect(sanitizeCategorySeedState(undefined)).toEqual({});
	});
});
