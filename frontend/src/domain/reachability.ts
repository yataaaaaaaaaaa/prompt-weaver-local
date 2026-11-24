// Reachability of categories and sub-prompts: which ones the prompt engine can
// still select given skips, locks, activation texts and forbidden rules. Drives the derived
// 'indirectly-disabled' UI state. Pure module (ported from legacy buildReachabilitySnapshot).
import type { ForbiddenRule } from '../api/types';
import {
	categoryKeyOf,
	isActivationTriggered,
	sortCategories,
	subPromptKeyOf,
	subPromptPath,
	type Category,
	type CategoryKey,
	type CategoryUiState,
	type SubPrompt,
	type SubPromptKey,
	type SubPromptUiState,
} from './categories';
import { matcherMatchesPrompt, preparePrompt, type ForbiddenMatcher, type PreparedPrompt } from './forbiddenRules';

export type ReachabilitySnapshot = {
	categories: ReadonlyMap<CategoryKey, CategoryUiState>;
	/** By subPromptPath(categoryKey, promptKey). */
	subPrompts: ReadonlyMap<string, SubPromptUiState>;
};

export const EMPTY_REACHABILITY: ReachabilitySnapshot = { categories: new Map(), subPrompts: new Map() };

export function categoryUiStateOf(snapshot: ReachabilitySnapshot, key: CategoryKey): CategoryUiState | undefined {
	return snapshot.categories.get(key);
}

export function subPromptUiStateOf(snapshot: ReachabilitySnapshot, key: CategoryKey, promptKey: SubPromptKey): SubPromptUiState | undefined {
	return snapshot.subPrompts.get(subPromptPath(key, promptKey));
}

type Endpoint = {
	path: string;
	prompt: PreparedPrompt;
};

/** Resolves a matcher to the set of sub-prompt paths it matches (cached per matcher for one snapshot). */
function createResolver(endpoints: readonly Endpoint[]): (matcher: ForbiddenMatcher) => ReadonlySet<string> {
	const cache = new Map<ForbiddenMatcher, Set<string>>();
	return (matcher) => {
		let paths = cache.get(matcher);
		if (!paths) {
			paths = new Set(endpoints.filter((endpoint) => matcherMatchesPrompt(matcher, endpoint.prompt)).map((endpoint) => endpoint.path));
			cache.set(matcher, paths);
		}
		return paths;
	};
}

/**
 * Walks the categories in generation order (priority, then name) like the prompt engine:
 * - a skipped category: 'skip' with all its sub-prompts 'skip';
 * - activation terms not contained in any sub-prompt that an earlier category can select -> 'indirectly-disabled';
 * - a locked sub-prompt is the only candidate: 'lock', the others 'indirectly-disabled'; when a rule forbids it
 *   together with an earlier lock, the whole category is 'indirectly-disabled'. A lock forbids the sub-prompts
 *   matched by the other side of its rules (in every category);
 * - otherwise sub-prompts are 'normal' unless skipped or forbidden by a lock; no selectable sub-prompt left ->
 *   'indirectly-disabled'.
 * Skipped sub-prompts always stay 'skip'.
 */
export function buildReachabilitySnapshot(categories: readonly Category[], rules: readonly ForbiddenRule[] = []): ReachabilitySnapshot {
	const categoryStates = new Map<CategoryKey, CategoryUiState>();
	const subPromptStates = new Map<string, SubPromptUiState>();
	const ordered = sortCategories(categories);
	const pathOf = (category: Category, subPrompt: SubPrompt) => subPromptPath(categoryKeyOf(category.text), subPromptKeyOf(subPrompt.text));
	const endpoints: Endpoint[] = ordered.flatMap((category) =>
		category.subPrompts.map((subPrompt) => ({
			path: pathOf(category, subPrompt),
			prompt: preparePrompt({ categoryName: category.text, promptText: subPrompt.text }),
		})),
	);
	const resolve = createResolver(endpoints);
	/** Texts of every sub-prompt an already walked category can select (activation of later categories). */
	const selectableTexts: string[] = [];
	const forbiddenPaths = new Set<string>();

	const disable = (category: Category, key: CategoryKey) => {
		categoryStates.set(key, 'indirectly-disabled');
		for (const subPrompt of category.subPrompts) {
			subPromptStates.set(pathOf(category, subPrompt), subPrompt.state === 'skip' ? 'skip' : 'indirectly-disabled');
		}
	};

	for (const category of ordered) {
		const key = categoryKeyOf(category.text);
		if (category.state === 'skip') {
			categoryStates.set(key, 'skip');
			for (const subPrompt of category.subPrompts) {
				subPromptStates.set(pathOf(category, subPrompt), 'skip');
			}
			continue;
		}
		if (!isActivationTriggered(category.activation_text, selectableTexts)) {
			disable(category, key);
			continue;
		}

		const locked = category.subPrompts.find((subPrompt) => subPrompt.state === 'lock');
		if (locked) {
			const lockedPath = pathOf(category, locked);
			if (forbiddenPaths.has(lockedPath)) {
				disable(category, key);
				continue;
			}
			categoryStates.set(key, 'normal');
			for (const subPrompt of category.subPrompts) {
				const path = pathOf(category, subPrompt);
				subPromptStates.set(path, subPrompt.state === 'skip' ? 'skip' : path === lockedPath ? 'lock' : 'indirectly-disabled');
			}
			selectableTexts.push(locked.text);
			for (const rule of rules) {
				const leftMatchesLocked = resolve(rule.left).has(lockedPath);
				const rightMatchesLocked = resolve(rule.right).has(lockedPath);
				const opposite = [...(leftMatchesLocked ? resolve(rule.right) : []), ...(rightMatchesLocked ? resolve(rule.left) : [])];
				for (const path of opposite) {
					if (path !== lockedPath) {
						forbiddenPaths.add(path);
					}
				}
			}
			continue;
		}

		let hasSelectable = false;
		for (const subPrompt of category.subPrompts) {
			const path = pathOf(category, subPrompt);
			if (subPrompt.state === 'skip') {
				subPromptStates.set(path, 'skip');
			} else if (forbiddenPaths.has(path)) {
				subPromptStates.set(path, 'indirectly-disabled');
			} else {
				subPromptStates.set(path, 'normal');
				hasSelectable = true;
				selectableTexts.push(subPrompt.text);
			}
		}
		categoryStates.set(key, hasSelectable ? 'normal' : 'indirectly-disabled');
	}

	return { categories: categoryStates, subPrompts: subPromptStates };
}
