// Prompt selection engine: picks one sub-prompt per active category, in
// generation order (priority, then name), honoring skips, locks, activation texts and forbidden rules.
// Operates directly on the categories store data; cycle counters are keyed by category key.
// Pure module (same semantics as the pre-refactor src/promptEngine.ts).
import type { ForbiddenRule, GenerationSelection } from '../api/types';
import {
	categoryKeyOf,
	hasActivationTerms,
	isActivationTriggered,
	sameCategoryName,
	sortCategories,
	type Category,
	type SubPrompt,
} from './categories';
import {
	isCategoryWideMatcher,
	isForbiddenPair,
	matcherMatchesPrompt,
	preparePrompt,
	type ForbiddenMatcher,
	type PreparedPrompt,
} from './forbiddenRules';
import {
	advanceCategorySeedEntry,
	advanceCategorySeedEntryForScan,
	normalizeCategorySeedEntry,
	type CategorySeedEntry,
	type CategorySeedState,
} from './seeds';

export class PromptSelectionError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = 'PromptSelectionError';
	}
}

export type CategoryCycleSelectionResult = {
	selections: GenerationSelection[];
	/** Counters of every processed category (skipped categories and categories without prompts are absent). */
	nextCategorySeedState: CategorySeedState;
	/** Seed of the first category selected through its counter (null when only locks were used). */
	promptSeed: number | null;
};

type Candidate = {
	category: Category;
	subPrompt: SubPrompt;
	locked: boolean;
	prompt: PreparedPrompt;
};

function makeCandidate(category: Category, subPrompt: SubPrompt, locked: boolean): Candidate {
	return { category, subPrompt, locked, prompt: preparePrompt({ categoryName: category.text, promptText: subPrompt.text }) };
}

/** Deterministic PRNG (mulberry32) for a seed; Math.random without one. */
function createSeededRandom(seed: number | null): () => number {
	if (seed == null || !Number.isFinite(seed)) {
		return () => Math.random();
	}
	let state = Math.floor(seed) >>> 0 || 0x6d2b79f5;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000;
	};
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
	for (let index = items.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		[items[index], items[swapIndex]] = [items[swapIndex], items[index]];
	}
}

function conflictsWithChosen(rules: readonly ForbiddenRule[], candidate: Candidate, chosen: readonly Candidate[]): boolean {
	return chosen.some((previous) => isForbiddenPair(rules, candidate.prompt, previous.prompt));
}

function isCategoryWideMatcherFor(matcher: ForbiddenMatcher, category: Category): boolean {
	return isCategoryWideMatcher(matcher) && sameCategoryName(matcher.category_name ?? '', category.text);
}

/** A category-wide rule forbids the whole category together with an already chosen prompt. */
function isCategoryEntirelyForbidden(rules: readonly ForbiddenRule[], category: Category, chosen: readonly Candidate[]): boolean {
	if (!chosen.length) {
		return false;
	}
	return rules.some((rule) => {
		if (isCategoryWideMatcherFor(rule.left, category)) {
			return chosen.some((candidate) => matcherMatchesPrompt(rule.right, candidate.prompt));
		}
		if (isCategoryWideMatcherFor(rule.right, category)) {
			return chosen.some((candidate) => matcherMatchesPrompt(rule.left, candidate.prompt));
		}
		return false;
	});
}

/** The locked sub-prompt alone, else every non-skipped sub-prompt in random order. */
function candidatesForCategory(category: Category, random: () => number): Candidate[] {
	const locked = category.subPrompts.find((subPrompt) => subPrompt.state === 'lock');
	if (locked) {
		return [makeCandidate(category, locked, true)];
	}
	const candidates = category.subPrompts.filter((subPrompt) => subPrompt.state !== 'skip').map((subPrompt) => makeCandidate(category, subPrompt, false));
	shuffleInPlace(candidates, random);
	return candidates;
}

function activationTriggered(category: Category, chosen: readonly Candidate[]): boolean {
	return isActivationTriggered(
		category.activation_text,
		chosen.map((candidate) => candidate.subPrompt.text),
	);
}

function toGenerationSelections(chosen: readonly Candidate[]): GenerationSelection[] {
	return chosen.map((item) => ({
		category_name: item.category.text,
		prompt_text: item.subPrompt.text,
		locked: item.locked,
		induced_lora_ids: [...item.subPrompt.extraLoraIds],
	}));
}

function activeCategories(categories: readonly Category[]): Category[] {
	const ordered = sortCategories(categories.filter((category) => category.state !== 'skip'));
	if (!ordered.length) {
		throw new PromptSelectionError('No active categories available. Unskip at least one category.');
	}
	return ordered;
}

function positiveModulo(value: number, divisor: number): number {
	const remainder = value % divisor;
	return remainder >= 0 ? remainder : remainder + divisor;
}

/**
 * Random selection seeded by `seed` (Math.random when null): per active category, the lock or a shuffled
 * candidate that no forbidden rule excludes together with the previous choices. Categories with activation
 * terms are optional (skipped when not triggered, empty or entirely forbidden).
 */
export function selectPrompts(categories: readonly Category[], rules: readonly ForbiddenRule[], seed: number | null): GenerationSelection[] {
	const random = createSeededRandom(seed);
	const ordered = activeCategories(categories);
	const chosen: Candidate[] = [];

	for (const category of ordered) {
		const optional = hasActivationTerms(category.activation_text);
		if (optional && !activationTriggered(category, chosen)) {
			continue;
		}
		const candidates = candidatesForCategory(category, random);
		if (!candidates.length) {
			if (!optional) {
				throw new PromptSelectionError(`Category '${category.text}' has no usable prompts.`);
			}
			continue;
		}
		const selected = candidates.find((candidate) => !conflictsWithChosen(rules, candidate, chosen));
		if (!selected) {
			console.warn(`Category '${category.text}' skipped because forbidden associations exclude all usable prompts.`);
			continue;
		}
		chosen.push(selected);
	}

	if (!chosen.length) {
		throw new PromptSelectionError('No prompt could be selected with the current category configuration.');
	}
	return toGenerationSelections(chosen);
}

/**
 * 'per_category_cycle' selection: each category walks its sub-prompts through its own counter
 * (seed -> index seed mod count), skipping skipped/forbidden ones, and restarts randomly after a full cycle.
 * Locks are used without touching the counter; a category disabled by a category-wide rule keeps its counter.
 */
export function selectPromptsWithCategoryCycle(
	categories: readonly Category[],
	rules: readonly ForbiddenRule[],
	categorySeedState: CategorySeedState,
): CategoryCycleSelectionResult {
	const ordered = activeCategories(categories);
	const chosen: Candidate[] = [];
	const nextCategorySeedState: CategorySeedState = {};
	let firstUsedSeed: number | null = null;

	for (const category of ordered) {
		const key = categoryKeyOf(category.text);
		const promptCount = category.subPrompts.length;
		const normalizedEntry = normalizeCategorySeedEntry(categorySeedState[key], promptCount);
		if (promptCount > 0) {
			nextCategorySeedState[key] = normalizedEntry;
		}

		const optional = hasActivationTerms(category.activation_text);
		if (optional && !activationTriggered(category, chosen)) {
			continue;
		}
		if (promptCount === 0) {
			if (!optional) {
				throw new PromptSelectionError(`Category '${category.text}' has no prompts.`);
			}
			continue;
		}
		if (isCategoryEntirelyForbidden(rules, category, chosen)) {
			console.warn(`Category '${category.text}' skipped because a category-level forbidden association disables the whole category.`);
			continue;
		}

		const lockedSubPrompt = category.subPrompts.find((subPrompt) => subPrompt.state === 'lock');
		let selected: Candidate | null = null;
		let nextEntry: CategorySeedEntry = normalizedEntry;

		if (lockedSubPrompt) {
			const lockedCandidate = makeCandidate(category, lockedSubPrompt, true);
			if (!conflictsWithChosen(rules, lockedCandidate, chosen)) {
				selected = lockedCandidate;
			} else {
				console.warn(`Category '${category.text}' skipped because its locked prompt is forbidden.`);
			}
		} else {
			if (firstUsedSeed == null) {
				firstUsedSeed = normalizedEntry.seed;
			}
			let scanEntry = normalizedEntry;
			let skippedSeeded = 0;
			let forbiddenSeeded = 0;
			for (let attempt = 0; attempt < promptCount; attempt += 1) {
				const subPrompt = category.subPrompts[positiveModulo(scanEntry.seed, promptCount)];
				if (subPrompt.state === 'skip') {
					skippedSeeded += 1;
					scanEntry = advanceCategorySeedEntryForScan(scanEntry);
					continue;
				}
				const candidate = makeCandidate(category, subPrompt, false);
				if (conflictsWithChosen(rules, candidate, chosen)) {
					forbiddenSeeded += 1;
					scanEntry = advanceCategorySeedEntryForScan(scanEntry);
					continue;
				}
				selected = candidate;
				nextEntry = advanceCategorySeedEntry(scanEntry);
				break;
			}
			if (!selected) {
				nextEntry = scanEntry;
				const reason =
					skippedSeeded > 0 && forbiddenSeeded > 0 ? 'skipped or forbidden' : skippedSeeded > 0 ? 'marked as skipped' : 'forbidden';
				console.warn(`Category '${category.text}' skipped because every cycled prompt is ${reason}.`);
			}
		}

		nextCategorySeedState[key] = nextEntry;
		if (selected) {
			chosen.push(selected);
		}
	}

	if (!chosen.length) {
		throw new PromptSelectionError('No prompt could be selected with the current category configuration.');
	}
	return { selections: toGenerationSelections(chosen), nextCategorySeedState, promptSeed: firstUsedSeed };
}
