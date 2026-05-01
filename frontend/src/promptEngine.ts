import { makeRandomSeed } from './app/appHelpers';
import type { AppState, ForbiddenMatcher, ForbiddenRule, GenerationSelection, PromptCategory, PromptEntry, PromptCategorySeedStateEntry } from './types';
import { categoryIdFromName, comparePriority, getStoredCategoryState, getStoredPromptState, matcherMatchesPrompt, splitActivationTerms, textContains } from './utils';

type CandidatePrompt = {
	category: PromptCategory;
	prompt: PromptEntry;
	locked: boolean;
};

export type PromptCategorySeedState = Record<string, PromptCategorySeedStateEntry>;

export type CategoryCycleSelectionResult = {
	selections: GenerationSelection[];
	nextCategorySeedState: PromptCategorySeedState;
	promptSeed: number | null;
};

export class PromptSelectionError extends Error { }

function createSeededRandom(seed: number | null): () => number {
	if (seed == null || !Number.isFinite(seed)) {
		return () => Math.random();
	}

	let state = (Math.floor(seed) >>> 0) || 0x6d2b79f5;
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

function matcherMatches(matcher: ForbiddenMatcher, candidate: CandidatePrompt, categories: PromptCategory[]): boolean {
	return matcherMatchesPrompt(matcher, {
		categoryId: candidate.category.id,
		categoryName: candidate.category.name,
		promptId: candidate.prompt.id,
		promptText: candidate.prompt.text,
		locked: candidate.locked,
	}, categories);
}

function isForbidden(rules: ForbiddenRule[], first: CandidatePrompt, second: CandidatePrompt, categories: PromptCategory[]): boolean {
	return rules.some((rule) => (
		(matcherMatches(rule.left, first, categories) && matcherMatches(rule.right, second, categories))
		|| (matcherMatches(rule.left, second, categories) && matcherMatches(rule.right, first, categories))
	));
}

function isCategoryWideMatcherForCategory(matcher: ForbiddenMatcher, category: PromptCategory): boolean {
	return matcher.kind === 'specific'
		&& categoryIdFromName(matcher.category_name ?? '') === category.id
		&& (matcher.prompt_text == null || matcher.prompt_text.trim() === '');
}

function isCategoryEntirelyForbidden(
	rules: ForbiddenRule[],
	category: PromptCategory,
	chosen: CandidatePrompt[],
	allCategories: PromptCategory[],
): boolean {
	if (!chosen.length) {
		return false;
	}

	return rules.some((rule) => {
		if (isCategoryWideMatcherForCategory(rule.left, category)) {
			return chosen.some((candidate) => matcherMatches(rule.right, candidate, allCategories));
		}
		if (isCategoryWideMatcherForCategory(rule.right, category)) {
			return chosen.some((candidate) => matcherMatches(rule.left, candidate, allCategories));
		}
		return false;
	});
}

function categoryCompare(left: PromptCategory, right: PromptCategory): number {
	const priorityDelta = comparePriority(left.priority, right.priority);
	if (priorityDelta !== 0) {
		return priorityDelta;
	}
	return left.name.localeCompare(right.name);
}

function candidatesForCategory(category: PromptCategory, random: () => number): CandidatePrompt[] {
	const locked = category.prompts.find((prompt) => getStoredPromptState(category, prompt) === 'lock') ?? null;
	if (locked) {
		if (getStoredPromptState(category, locked) === 'skip') {
			throw new PromptSelectionError(`Category '${category.name}' has a locked prompt marked as skipped.`);
		}
		return [{ category, prompt: locked, locked: true }];
	}
	const candidates = category.prompts
		.filter((prompt) => getStoredPromptState(category, prompt) !== 'skip')
		.map((prompt) => ({ category, prompt, locked: false }));
	shuffleInPlace(candidates, random);
	return candidates;
}

function activationTriggered(category: PromptCategory, chosen: CandidatePrompt[]): boolean {
	const terms = splitActivationTerms(category.activation_text);
	if (!terms.length) {
		return true;
	}
	return terms.some((term) => chosen.some((candidate) => textContains(candidate.prompt.text, term)));
}

function toGenerationSelections(chosen: CandidatePrompt[]): GenerationSelection[] {
	return chosen.map((item) => ({
		category_name: item.category.name,
		prompt_text: item.prompt.text,
		locked: item.locked,
		induced_lora_ids: [...item.prompt.extra_lora_ids],
	}));
}

function normalizeCategorySeedEntry(
	entry: PromptCategorySeedStateEntry | undefined,
	promptCount: number,
): PromptCategorySeedStateEntry {
	if (promptCount <= 0) {
		return {
			seed: makeRandomSeed(),
			remaining: 0,
			prompt_count: 0,
		};
	}

	if (!entry
		|| !Number.isFinite(entry.seed)
		|| !Number.isFinite(entry.remaining)
		|| !Number.isFinite(entry.prompt_count)
		|| entry.prompt_count !== promptCount
		|| entry.remaining < 1
		|| entry.remaining > promptCount) {
		return {
			seed: makeRandomSeed(),
			remaining: promptCount,
			prompt_count: promptCount,
		};
	}

	return {
		seed: Math.trunc(entry.seed),
		remaining: Math.trunc(entry.remaining),
		prompt_count: promptCount,
	};
}

function advanceCategorySeedEntry(entry: PromptCategorySeedStateEntry): PromptCategorySeedStateEntry {
	if (entry.prompt_count <= 0) {
		return entry;
	}

	if (entry.remaining <= 1) {
		return {
			seed: makeRandomSeed(),
			remaining: entry.prompt_count,
			prompt_count: entry.prompt_count,
		};
	}

	return {
		seed: entry.seed + 1,
		remaining: entry.remaining - 1,
		prompt_count: entry.prompt_count,
	};
}

function positiveModulo(value: number, divisor: number): number {
	const remainder = value % divisor;
	return remainder >= 0 ? remainder : remainder + divisor;
}

export function selectPrompts(state: AppState, seed: number | null): GenerationSelection[] {
	const random = createSeededRandom(seed);
	const rules = [...state.forbidden_rules];
	const orderedCategories = state.categories
		.filter((category) => getStoredCategoryState(category) !== 'skip')
		.sort(categoryCompare);

	if (!orderedCategories.length) {
		throw new PromptSelectionError('No active categories available. Unskip at least one category.');
	}

	const chosen: CandidatePrompt[] = [];

	for (const category of orderedCategories) {
		const activationTerms = splitActivationTerms(category.activation_text);
		if (activationTerms.length > 0 && !activationTriggered(category, chosen)) {
			continue;
		}

		const candidates = candidatesForCategory(category, random);
		if (!candidates.length) {
			if (activationTerms.length === 0) {
				throw new PromptSelectionError(`Category '${category.name}' has no usable prompts.`);
			}
			continue;
		}

		const selectedCandidate = candidates.find((candidate) => !chosen.some((previous) => isForbidden(rules, candidate, previous, state.categories))) ?? null;
		if (!selectedCandidate) {
			console.warn(`Category '${category.name}' skipped because forbidden associations exclude all usable prompts.`);
			continue;
		}

		chosen.push(selectedCandidate);
	}

	if (!chosen.length) {
		throw new PromptSelectionError('No prompt could be selected with the current category configuration.');
	}

	return toGenerationSelections(chosen);
}

export function selectPromptsWithCategoryCycle(state: AppState, categorySeedState: PromptCategorySeedState): CategoryCycleSelectionResult {
	const rules = [...state.forbidden_rules];
	const orderedCategories = state.categories
		.filter((category) => getStoredCategoryState(category) !== 'skip')
		.sort(categoryCompare);

	if (!orderedCategories.length) {
		throw new PromptSelectionError('No active categories available. Unskip at least one category.');
	}

	const chosen: CandidatePrompt[] = [];
	const nextCategorySeedState: PromptCategorySeedState = {};
	let firstUsedSeed: number | null = null;

	for (const category of orderedCategories) {
		const promptCount = category.prompts.length;
		const normalizedEntry = normalizeCategorySeedEntry(categorySeedState[category.id], promptCount);
		if (promptCount > 0) {
			nextCategorySeedState[category.id] = normalizedEntry;
		}

		const activationTerms = splitActivationTerms(category.activation_text);
		if (activationTerms.length > 0 && !activationTriggered(category, chosen)) {
			continue;
		}

		if (promptCount === 0) {
			if (activationTerms.length === 0) {
				throw new PromptSelectionError(`Category '${category.name}' has no prompts.`);
			}
			continue;
		}

		if (isCategoryEntirelyForbidden(rules, category, chosen, state.categories)) {
			console.warn(`Category '${category.name}' skipped because a category-level forbidden association disables the whole category.`);
			continue;
		}

		if (firstUsedSeed == null) {
			firstUsedSeed = normalizedEntry.seed;
		}

		const lockedPrompt = category.prompts.find((prompt) => getStoredPromptState(category, prompt) === 'lock') ?? null;
		let selectedCandidate: CandidatePrompt | null = null;

		if (lockedPrompt) {
			const lockedCandidate = { category, prompt: lockedPrompt, locked: true };
			if (!chosen.some((previous) => isForbidden(rules, lockedCandidate, previous, state.categories))) {
				selectedCandidate = lockedCandidate;
			} else {
				console.warn(`Category '${category.name}' skipped because its locked prompt is forbidden.`);
			}
		} else {
			const selectedPrompt = category.prompts[positiveModulo(normalizedEntry.seed, promptCount)] ?? null;
			if (!selectedPrompt) {
				throw new PromptSelectionError(`Category '${category.name}' has no prompts.`);
			}

			if (getStoredPromptState(category, selectedPrompt) === 'skip') {
				console.warn(`Category '${category.name}' skipped because the seeded prompt is marked as skipped.`);
			} else {
				const seededCandidate = { category, prompt: selectedPrompt, locked: false };
				if (!chosen.some((previous) => isForbidden(rules, seededCandidate, previous, state.categories))) {
					selectedCandidate = seededCandidate;
				} else {
					console.warn(`Category '${category.name}' skipped because the seeded prompt is forbidden.`);
				}
			}
		}

		nextCategorySeedState[category.id] = advanceCategorySeedEntry(normalizedEntry);
		if (selectedCandidate) {
			chosen.push(selectedCandidate);
		}
	}

	if (!chosen.length) {
		throw new PromptSelectionError('No prompt could be selected with the current category configuration.');
	}

	return {
		selections: toGenerationSelections(chosen),
		nextCategorySeedState,
		promptSeed: firstUsedSeed,
	};
}
