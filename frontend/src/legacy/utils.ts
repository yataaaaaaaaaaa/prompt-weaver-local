import type {
	CategoryStoredState,
	CategoryUiState,
	ForbiddenMatcher,
	ForbiddenRule,
	GenerationSelection,
	OutputSummary,
	PromptCategory,
	PromptEntry,
	PromptStoredState,
	PromptUiState,
} from './types';

export type RuntimePromptEndpoint = {
	categoryId: string;
	categoryName: string;
	promptId: string;
	promptText: string;
	locked: boolean;
};

export type ReachabilitySnapshot = {
	categoryUiStateById: Map<string, CategoryUiState>;
	promptUiStateById: Map<string, PromptUiState>;
};

type ResolvedMatcherEndpoints = {
	endpoints: RuntimePromptEndpoint[];
	endpointKeys: Set<string>;
};

type RuntimeMatcherResolver = {
	allEndpoints: RuntimePromptEndpoint[];
	resolve: (matcher: ForbiddenMatcher) => ResolvedMatcherEndpoints;
};

export type TransitionValidationIssue = {
	severity: 'blocked' | 'confirm';
	scope: 'category' | 'prompt';
	categoryId: string;
	categoryName: string;
	promptId: string | null;
	promptText: string | null;
	fromState: CategoryUiState | PromptUiState;
	toState: CategoryUiState | PromptUiState;
	message: string;
};

export type StateTransitionResult =
	| { ok: true; categories: PromptCategory[] }
	| { ok: false; error: string }
	| { ok: 'confirm'; categories: PromptCategory[]; issues: TransitionValidationIssue[] };

export type GraphTransitionResult =
	| { ok: true; categories: PromptCategory[]; rules: ForbiddenRule[] }
	| { ok: false; error: string }
	| { ok: 'confirm'; categories: PromptCategory[]; rules: ForbiddenRule[]; issues: TransitionValidationIssue[] };

export function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'item';
}

function normalizeIdPart(token: string): string {
	return token.replace(/[^a-zA-Z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

export function normalizeTagId(value: string): string {
	return normalizeIdPart(value);
}

function normalizePromptName(value: string): string {
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

export function promptToKey(_categoryName: string, text: string): string {
	return normalizePromptName(text);
}

export function categoryIdFromName(categoryName: string): string {
	return normalizeIdPart(categoryName) || 'category';
}

function dedupeId(base: string, used: Set<string>): string {
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	let index = 2;
	while (used.has(`${base}__${index}`)) {
		index += 1;
	}
	const value = `${base}__${index}`;
	used.add(value);
	return value;
}

function isRuntimePromptId(value: string | null | undefined): boolean {
	return typeof value === 'string' && /^prompt-[a-z0-9]{8}$/i.test(value);
}

export function normalizeTextForMatch(text: string): string {
	return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function textContains(haystack: string, needle: string): boolean {
	const normalizedNeedle = normalizeTextForMatch(needle);
	if (!normalizedNeedle) {
		return false;
	}
	return normalizeTextForMatch(haystack).includes(normalizedNeedle);
}

export function makeId(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneDeep<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function splitActivationTerms(text: string): string[] {
	return text.split(',').map((item) => item.trim()).filter(Boolean);
}

export function splitPromptWords(text: string): string[] {
	return text
		.split(',')
		.map((item) => normalizeTextForMatch(item))
		.filter(Boolean);
}

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

export function promptHasTag(promptText: string, tagText: string): boolean {
	const expectedTagId = normalizeTagId(tagText);
	if (!expectedTagId) {
		return false;
	}
	return splitPromptTags(promptText).some((tag) => normalizeTagId(tag) === expectedTagId);
}

export function getStoredCategoryState(category: PromptCategory): CategoryStoredState {
	return category.state === 'skip' || category.muted ? 'skip' : 'normal';
}

export function getStoredPromptState(category: PromptCategory, prompt: PromptEntry): PromptStoredState {
	if (prompt.state === 'skip' || prompt.state === 'lock' || prompt.state === 'normal') {
		return prompt.state;
	}
	if (category.locked_prompt_id === prompt.id) {
		return 'lock';
	}
	if (category.locked_prompt_text && areNameEquivalent(prompt.text, category.locked_prompt_text)) {
		return 'lock';
	}
	if (prompt.skipped) {
		return 'skip';
	}
	return 'normal';
}

function getLockedPrompt(category: PromptCategory): PromptEntry | null {
	return category.prompts.find((prompt) => getStoredPromptState(category, prompt) === 'lock') ?? null;
}

function syncCategoryRuntimeFields(category: PromptCategory): void {
	category.state = getStoredCategoryState(category);
	category.muted = category.state === 'skip';

	let lockedPromptId: string | null = null;
	let lockedPromptText: string | null = null;
	let sawLock = false;

	for (const prompt of category.prompts) {
		const storedState = getStoredPromptState(category, prompt);
		if (storedState === 'lock' && !sawLock) {
			prompt.state = 'lock';
			prompt.skipped = false;
			lockedPromptId = prompt.id;
			lockedPromptText = prompt.text;
			sawLock = true;
			continue;
		}
		prompt.state = storedState === 'lock' ? 'normal' : storedState;
		prompt.skipped = prompt.state === 'skip';
	}

	category.locked_prompt_id = lockedPromptId;
	category.locked_prompt_text = lockedPromptText;
}

function migrateCategoryState(category: PromptCategory): void {
	category.state = getStoredCategoryState(category);
	for (const prompt of category.prompts) {
		prompt.state = getStoredPromptState(category, prompt);
	}
	syncCategoryRuntimeFields(category);
}

function assignRuntimePromptIds(category: PromptCategory, usedPromptIds: Set<string>): void {
	for (const prompt of category.prompts) {
		if (!isRuntimePromptId(prompt.id) || usedPromptIds.has(prompt.id)) {
			prompt.id = makeId('prompt');
		}
		while (usedPromptIds.has(prompt.id)) {
			prompt.id = makeId('prompt');
		}
		usedPromptIds.add(prompt.id);
	}
}

export function normalizeStateIds<
	T extends {
		categories: PromptCategory[];
		forbidden_rules: ForbiddenRule[];
		editor: {
			selected_category_id: string | null;
			selected_prompt_id: string | null;
			editing_target: { kind: string; category_id: string | null; prompt_id: string | null; };
		};
	},
>(state: T): T {
	const originalSelectedCategoryId = state.editor.selected_category_id;
	const originalSelectedPromptId = state.editor.selected_prompt_id;
	const originalEditingCategoryId = state.editor.editing_target.category_id;
	const originalEditingPromptId = state.editor.editing_target.prompt_id;
	const categoryIdMap = new Map<string, string>();
	const usedCategoryIds = new Set<string>();
	const usedPromptIds = new Set<string>();

	for (const category of state.categories) {
		const originalCategoryId = category.id;
		const nextCategoryId = dedupeId(categoryIdFromName(category.name), usedCategoryIds);
		categoryIdMap.set(originalCategoryId, nextCategoryId);
		category.id = nextCategoryId;
		assignRuntimePromptIds(category, usedPromptIds);
		migrateCategoryState(category);
	}

	state.editor.selected_category_id = originalSelectedCategoryId ? (categoryIdMap.get(originalSelectedCategoryId) ?? originalSelectedCategoryId) : null;
	state.editor.editing_target.category_id = originalEditingCategoryId ? (categoryIdMap.get(originalEditingCategoryId) ?? originalEditingCategoryId) : null;

	const selectedCategory = state.editor.selected_category_id
		? state.categories.find((category) => category.id === state.editor.selected_category_id) ?? null
		: null;
	state.editor.selected_prompt_id = selectedCategory?.prompts.some((prompt) => prompt.id === originalSelectedPromptId)
		? originalSelectedPromptId
		: null;

	const editingCategory = state.editor.editing_target.category_id
		? state.categories.find((category) => category.id === state.editor.editing_target.category_id) ?? null
		: null;
	state.editor.editing_target.prompt_id = editingCategory?.prompts.some((prompt) => prompt.id === originalEditingPromptId)
		? originalEditingPromptId
		: null;

	return state;
}

export function serializeStateForStorage<T extends { categories: PromptCategory[]; editor: { selected_prompt_id: string | null; editing_target: { prompt_id: string | null } } }>(state: T): T {
	const cloned = cloneDeep(state);
	for (const category of cloned.categories) {
		migrateCategoryState(category);
		delete (category as Partial<PromptCategory>).id;
		delete category.muted;
		delete category.locked_prompt_id;
		delete category.locked_prompt_text;
		for (const prompt of category.prompts) {
			delete (prompt as Partial<PromptEntry>).id;
			delete prompt.skipped;
		}
	}
	cloned.editor.selected_prompt_id = null;
	cloned.editor.editing_target.prompt_id = null;
	return cloned;
}

export function makeRuntimePromptEndpoint(category: PromptCategory, prompt: PromptEntry, locked?: boolean): RuntimePromptEndpoint {
	return {
		categoryId: category.id,
		categoryName: category.name,
		promptId: prompt.id,
		promptText: prompt.text,
		locked: locked ?? (getStoredPromptState(category, prompt) === 'lock'),
	};
}

function runtimePromptKey(categoryId: string, promptId: string): string {
	return `${categoryId}::${promptId}`;
}

function matcherCacheKey(matcher: ForbiddenMatcher): string {
	return [
		matcher.kind,
		categoryIdFromName(matcher.category_name ?? ''),
		normalizePromptName(matcher.prompt_text ?? ''),
		normalizeTextForMatch(matcher.contains_text ?? ''),
		normalizeTagId(matcher.tag_text ?? ''),
	].join('::');
}

function isCategoryWideSpecificMatcher(matcher: ForbiddenMatcher): boolean {
	return matcher.kind === 'specific' && !!matcher.category_name && !normalizePromptName(matcher.prompt_text ?? '');
}

function buildRuntimeMatcherResolver(categories: PromptCategory[]): RuntimeMatcherResolver {
	const allEndpoints = categories.flatMap((category) => category.prompts.map((prompt) => makeRuntimePromptEndpoint(category, prompt, getStoredPromptState(category, prompt) === 'lock')));
	const specificEndpointsByKey = new Map<string, RuntimePromptEndpoint[]>();
	for (const endpoint of allEndpoints) {
		const key = `${categoryIdFromName(endpoint.categoryName)}::${normalizePromptName(endpoint.promptText)}`;
		const existing = specificEndpointsByKey.get(key);
		if (existing) {
			existing.push(endpoint);
		} else {
			specificEndpointsByKey.set(key, [endpoint]);
		}
	}

	const cache = new Map<string, ResolvedMatcherEndpoints>();
	return {
		allEndpoints,
		resolve(matcher: ForbiddenMatcher): ResolvedMatcherEndpoints {
			const key = matcherCacheKey(matcher);
			const cached = cache.get(key);
			if (cached) {
				return cached;
			}

			let endpoints: RuntimePromptEndpoint[];
			if (matcher.kind === 'specific') {
				if (isCategoryWideSpecificMatcher(matcher)) {
					const scopedCategoryId = categoryIdFromName(matcher.category_name ?? '');
					endpoints = allEndpoints.filter((endpoint) => categoryIdFromName(endpoint.categoryName) === scopedCategoryId);
				} else {
					const specificKey = `${categoryIdFromName(matcher.category_name ?? '')}::${normalizePromptName(matcher.prompt_text ?? '')}`;
					endpoints = [...(specificEndpointsByKey.get(specificKey) ?? [])];
				}
			} else if (matcher.kind === 'tag') {
				const scopedCategoryId = matcher.category_name ? categoryIdFromName(matcher.category_name) : null;
				endpoints = allEndpoints.filter((endpoint) => {
					if (scopedCategoryId && categoryIdFromName(endpoint.categoryName) !== scopedCategoryId) {
						return false;
					}
					return promptHasTag(endpoint.promptText, matcher.tag_text ?? '');
				});
			} else {
				const scopedCategoryId = matcher.category_name ? categoryIdFromName(matcher.category_name) : null;
				endpoints = allEndpoints.filter((endpoint) => {
					if (scopedCategoryId && categoryIdFromName(endpoint.categoryName) !== scopedCategoryId) {
						return false;
					}
					return textContains(endpoint.promptText, matcher.contains_text ?? '');
				});
			}

			const resolved = {
				endpoints,
				endpointKeys: new Set(endpoints.map((endpoint) => runtimePromptKey(endpoint.categoryId, endpoint.promptId))),
			};
			cache.set(key, resolved);
			return resolved;
		},
	};
}

function collectForbiddenEffectsFromLockedPrompt(
	resolver: RuntimeMatcherResolver,
	rules: ForbiddenRule[],
	lockedEndpoint: RuntimePromptEndpoint,
): { forbiddenPromptIds: Set<string>; forbiddenCategoryIds: Set<string> } {
	const forbiddenPromptIds = new Set<string>();
	const forbiddenCategoryIds = new Set<string>();
	if (!rules.length) {
		return { forbiddenPromptIds, forbiddenCategoryIds };
	}

	const lockedKey = runtimePromptKey(lockedEndpoint.categoryId, lockedEndpoint.promptId);

	for (const rule of rules) {
		const leftMatches = resolver.resolve(rule.left);
		const rightMatches = resolver.resolve(rule.right);
		const leftMatchesLocked = leftMatches.endpointKeys.has(lockedKey);
		const rightMatchesLocked = rightMatches.endpointKeys.has(lockedKey);
		if (!leftMatchesLocked && !rightMatchesLocked) {
			continue;
		}

		const oppositeEndpoints = leftMatchesLocked ? rightMatches.endpoints : rightMatchesLocked ? leftMatches.endpoints : [];
		for (const endpoint of oppositeEndpoints) {
			if (endpoint.categoryId === lockedEndpoint.categoryId && endpoint.promptId === lockedEndpoint.promptId) {
				continue;
			}
			forbiddenPromptIds.add(endpoint.promptId);
			forbiddenCategoryIds.add(endpoint.categoryId);
		}
	}

	return { forbiddenPromptIds, forbiddenCategoryIds };
}

export function buildReachabilitySnapshot(categories: PromptCategory[], rules: ForbiddenRule[] = []): ReachabilitySnapshot {
	const categoryUiStateById = new Map<string, CategoryUiState>();
	const promptUiStateById = new Map<string, PromptUiState>();
	const orderedCategories = [...categories].sort((left, right) => comparePriority(left.priority, right.priority) || left.name.localeCompare(right.name));
	const resolver = buildRuntimeMatcherResolver(orderedCategories);
	const allPromptedWords = new Set<string>();
	const forbiddenPromptIds = new Set<string>();
	const forbiddenCategoryIds = new Set<string>();

	const promptWordsById = new Map<string, string[]>();
	const conditionWordsByCategoryId = new Map<string, string[]>();
	for (const category of orderedCategories) {
		conditionWordsByCategoryId.set(category.id, splitPromptWords(category.activation_text));
		for (const prompt of category.prompts) {
			promptWordsById.set(prompt.id, splitPromptWords(prompt.text));
		}
	}

	for (const category of orderedCategories) {
		const storedCategoryState = getStoredCategoryState(category);
		if (storedCategoryState === 'skip') {
			categoryUiStateById.set(category.id, 'skip');
			for (const prompt of category.prompts) {
				promptUiStateById.set(prompt.id, 'skip');
			}
			continue;
		}

		const activationTerms = conditionWordsByCategoryId.get(category.id) ?? [];
		const activationSatisfied = !activationTerms.length
			|| activationTerms.some((term) => allPromptedWords.has(term));

		if (!activationSatisfied || forbiddenCategoryIds.has(category.id)) {
			categoryUiStateById.set(category.id, 'indirectly-disabled');
			for (const prompt of category.prompts) {
				promptUiStateById.set(prompt.id, getStoredPromptState(category, prompt) === 'skip' ? 'skip' : 'indirectly-disabled');
			}
			continue;
		}

		const lockedPrompt = getLockedPrompt(category);
		if (lockedPrompt) {
			if (forbiddenPromptIds.has(lockedPrompt.id)) {
				categoryUiStateById.set(category.id, 'indirectly-disabled');
				for (const prompt of category.prompts) {
					promptUiStateById.set(prompt.id, getStoredPromptState(category, prompt) === 'skip' ? 'skip' : 'indirectly-disabled');
				}
				continue;
			}

			categoryUiStateById.set(category.id, 'normal');
			for (const prompt of category.prompts) {
				const storedPromptState = getStoredPromptState(category, prompt);
				if (storedPromptState === 'skip') {
					promptUiStateById.set(prompt.id, 'skip');
				} else if (prompt.id === lockedPrompt.id) {
					promptUiStateById.set(prompt.id, 'lock');
				} else {
					promptUiStateById.set(prompt.id, 'indirectly-disabled');
				}
			}

			for (const word of promptWordsById.get(lockedPrompt.id) ?? []) {
				allPromptedWords.add(word);
			}
			const lockedEndpoint = makeRuntimePromptEndpoint(category, lockedPrompt, true);
			const effects = collectForbiddenEffectsFromLockedPrompt(resolver, rules, lockedEndpoint);
			for (const promptId of effects.forbiddenPromptIds) {
				forbiddenPromptIds.add(promptId);
			}
			for (const forbiddenCategoryId of effects.forbiddenCategoryIds) {
				forbiddenCategoryIds.add(forbiddenCategoryId);
			}
			continue;
		}

		let hasReachablePrompt = false;
		for (const prompt of category.prompts) {
			const storedPromptState = getStoredPromptState(category, prompt);
			if (storedPromptState === 'skip') {
				promptUiStateById.set(prompt.id, 'skip');
				continue;
			}
			if (forbiddenPromptIds.has(prompt.id)) {
				promptUiStateById.set(prompt.id, 'indirectly-disabled');
				continue;
			}
			promptUiStateById.set(prompt.id, 'normal');
			hasReachablePrompt = true;
			for (const word of promptWordsById.get(prompt.id) ?? []) {
				allPromptedWords.add(word);
			}
		}

		if (!hasReachablePrompt) {
			categoryUiStateById.set(category.id, 'indirectly-disabled');
			for (const prompt of category.prompts) {
				if (getStoredPromptState(category, prompt) !== 'skip') {
					promptUiStateById.set(prompt.id, 'indirectly-disabled');
				}
			}
			continue;
		}

		categoryUiStateById.set(category.id, 'normal');
	}

	return { categoryUiStateById, promptUiStateById };
}

export function getCategoryUiState(
	categories: PromptCategory[],
	categoryId: string,
	snapshot: ReachabilitySnapshot | null = null,
	_rules: ForbiddenRule[] = [],
): CategoryUiState {
	if (snapshot) {
		return snapshot.categoryUiStateById.get(categoryId) ?? 'indirectly-disabled';
	}
	const category = categories.find((item) => item.id === categoryId) ?? null;
	return category ? getStoredCategoryState(category) : 'indirectly-disabled';
}

export function getPromptUiState(
	categories: PromptCategory[],
	categoryId: string,
	promptId: string,
	snapshot: ReachabilitySnapshot | null = null,
	_rules: ForbiddenRule[] = [],
): PromptUiState {
	const category = categories.find((item) => item.id === categoryId) ?? null;
	const prompt = category?.prompts.find((item) => item.id === promptId) ?? null;
	if (!category || !prompt) {
		return 'indirectly-disabled';
	}
	if (snapshot) {
		return snapshot.promptUiStateById.get(promptId) ?? 'indirectly-disabled';
	}
	return getStoredPromptState(category, prompt);
}

export function isCategoryReachable(categories: PromptCategory[], categoryId: string, snapshot: ReachabilitySnapshot | null = null, rules: ForbiddenRule[] = []): boolean {
	return getCategoryUiState(categories, categoryId, snapshot, rules) === 'normal';
}

export function isSubPromptReachable(categories: PromptCategory[], categoryId: string, promptId: string, snapshot: ReachabilitySnapshot | null = null, rules: ForbiddenRule[] = []): boolean {
	const state = getPromptUiState(categories, categoryId, promptId, snapshot, rules);
	return state === 'normal' || state === 'lock';
}

function formatUiStateLabel(state: CategoryUiState | PromptUiState): string {
	if (state === 'indirectly-disabled') {
		return 'indirectly disabled';
	}
	return state;
}

function isAllowedCategoryUiTransition(from: CategoryUiState, to: CategoryUiState): boolean {
	if (from === to) {
		return true;
	}
	return (
		(from === 'normal' && (to === 'skip' || to === 'indirectly-disabled'))
		|| (to === 'normal' && (from === 'skip' || from === 'indirectly-disabled'))
		|| (from === 'indirectly-disabled' && to === 'skip')
	);
}

function isAllowedPromptUiTransition(from: PromptUiState, to: PromptUiState): boolean {
	if (from === to) {
		return true;
	}
	return (
		(from === 'lock' && (to === 'normal' || to === 'skip'))
		|| (from === 'normal' && (to === 'lock' || to === 'skip' || to === 'indirectly-disabled'))
		|| (from === 'skip' && (to === 'normal' || to === 'lock'))
		|| (from === 'indirectly-disabled' && (to === 'normal' || to === 'skip'))
	);
}

function collectTransitionIssues(before: PromptCategory[], beforeRules: ForbiddenRule[], after: PromptCategory[], afterRules: ForbiddenRule[]): TransitionValidationIssue[] {
	const beforeSnapshot = buildReachabilitySnapshot(before, beforeRules);
	const afterSnapshot = buildReachabilitySnapshot(after, afterRules);
	const issues: TransitionValidationIssue[] = [];

	for (const beforeCategory of before) {
		const afterCategory = after.find((item) => item.id === beforeCategory.id);
		if (!afterCategory) {
			continue;
		}

		const beforeCategoryState = getCategoryUiState(before, beforeCategory.id, beforeSnapshot, beforeRules);
		const afterCategoryState = getCategoryUiState(after, afterCategory.id, afterSnapshot, afterRules);
		if (!isAllowedCategoryUiTransition(beforeCategoryState, afterCategoryState)) {
			issues.push({
				severity: 'blocked',
				scope: 'category',
				categoryId: beforeCategory.id,
				categoryName: beforeCategory.name,
				promptId: null,
				promptText: null,
				fromState: beforeCategoryState,
				toState: afterCategoryState,
				message: `Category '${beforeCategory.name}' would change from ${formatUiStateLabel(beforeCategoryState)} to ${formatUiStateLabel(afterCategoryState)}.`,
			});
		}

		for (const beforePrompt of beforeCategory.prompts) {
			const afterPrompt = afterCategory.prompts.find((item) => item.id === beforePrompt.id);
			if (!afterPrompt) {
				continue;
			}
			const beforePromptState = getPromptUiState(before, beforeCategory.id, beforePrompt.id, beforeSnapshot, beforeRules);
			const afterPromptState = getPromptUiState(after, afterCategory.id, afterPrompt.id, afterSnapshot, afterRules);
			if (beforePromptState === afterPromptState) {
				continue;
			}
			const label = beforePrompt.text || '(empty sub-prompt)';
			if (beforePromptState === 'indirectly-disabled' && afterPromptState === 'lock') {
				issues.push({
					severity: 'blocked',
					scope: 'prompt',
					categoryId: beforeCategory.id,
					categoryName: beforeCategory.name,
					promptId: beforePrompt.id,
					promptText: beforePrompt.text,
					fromState: beforePromptState,
					toState: afterPromptState,
					message: `Sub-prompt '${label}' in category '${beforeCategory.name}' cannot change from indirectly disabled to lock.`,
				});
				continue;
			}
			if (beforePromptState === 'lock' && afterPromptState === 'indirectly-disabled') {
				issues.push({
					severity: 'confirm',
					scope: 'prompt',
					categoryId: beforeCategory.id,
					categoryName: beforeCategory.name,
					promptId: beforePrompt.id,
					promptText: beforePrompt.text,
					fromState: beforePromptState,
					toState: afterPromptState,
					message: `Disable lock for sub-prompt '${label}' in category '${beforeCategory.name}'.`,
				});
				continue;
			}
			if (!isAllowedPromptUiTransition(beforePromptState, afterPromptState)) {
				issues.push({
					severity: 'blocked',
					scope: 'prompt',
					categoryId: beforeCategory.id,
					categoryName: beforeCategory.name,
					promptId: beforePrompt.id,
					promptText: beforePrompt.text,
					fromState: beforePromptState,
					toState: afterPromptState,
					message: `Sub-prompt '${label}' in category '${beforeCategory.name}' would change from ${formatUiStateLabel(beforePromptState)} to ${formatUiStateLabel(afterPromptState)}.`,
				});
			}
		}
	}

	return issues;
}

function resolveConfirmIssues(after: PromptCategory[], issues: TransitionValidationIssue[]): PromptCategory[] {
	const cloned = cloneDeep(after);
	for (const issue of issues) {
		if (issue.scope !== 'prompt' || issue.promptId == null) {
			continue;
		}
		const category = cloned.find((item) => item.id === issue.categoryId);
		const prompt = category?.prompts.find((item) => item.id === issue.promptId);
		if (!category || !prompt) {
			continue;
		}
		migrateCategoryState(category);
		prompt.state = 'normal';
		syncCategoryRuntimeFields(category);
	}
	return cloned;
}

export function validateGraphChange(
	_beforeCategories: PromptCategory[],
	_beforeRules: ForbiddenRule[],
	afterCategories: PromptCategory[],
	afterRules: ForbiddenRule[],
): GraphTransitionResult {
	const preparedAfter = cloneDeep(afterCategories);
	for (const category of preparedAfter) {
		migrateCategoryState(category);
	}
	return { ok: true, categories: preparedAfter, rules: cloneDeep(afterRules) };
}

export function validateCategoriesChange(before: PromptCategory[], after: PromptCategory[], rules: ForbiddenRule[]): StateTransitionResult {
	const result = validateGraphChange(before, rules, after, rules);
	if (result.ok === false) {
		return result;
	}
	if (result.ok === 'confirm') {
		return { ok: 'confirm', categories: result.categories, issues: result.issues };
	}
	return { ok: true, categories: result.categories };
}

export function validateForbiddenRulesChange(
	categories: PromptCategory[],
	beforeRules: ForbiddenRule[],
	afterRules: ForbiddenRule[],
): GraphTransitionResult {
	return validateGraphChange(categories, beforeRules, categories, afterRules);
}

function setPromptStoredStateInternal(categories: PromptCategory[], categoryId: string, promptId: string, nextState: PromptStoredState): PromptCategory[] {
	const cloned = cloneDeep(categories);
	const category = cloned.find((item) => item.id === categoryId);
	const prompt = category?.prompts.find((item) => item.id === promptId);
	if (!category || !prompt) {
		return cloned;
	}

	migrateCategoryState(category);
	prompt.state = nextState;
	if (nextState === 'lock') {
		for (const otherPrompt of category.prompts) {
			if (otherPrompt.id !== promptId && otherPrompt.state === 'lock') {
				otherPrompt.state = 'normal';
			}
		}
	}
	syncCategoryRuntimeFields(category);
	return cloned;
}

function setCategoryStoredStateInternal(categories: PromptCategory[], categoryId: string, nextState: CategoryStoredState): PromptCategory[] {
	const cloned = cloneDeep(categories);
	const category = cloned.find((item) => item.id === categoryId);
	if (!category) {
		return cloned;
	}
	migrateCategoryState(category);
	category.state = nextState;
	syncCategoryRuntimeFields(category);
	return cloned;
}

export function setPromptStoredStateChecked(
	categories: PromptCategory[],
	_rules: ForbiddenRule[],
	categoryId: string,
	promptId: string,
	nextState: PromptStoredState,
): StateTransitionResult {
	const after = setPromptStoredStateInternal(categories, categoryId, promptId, nextState);
	return { ok: true, categories: after };
}

export function setCategoryStoredStateChecked(
	categories: PromptCategory[],
	_rules: ForbiddenRule[],
	categoryId: string,
	nextState: CategoryStoredState,
): StateTransitionResult {
	const after = setCategoryStoredStateInternal(categories, categoryId, nextState);
	return { ok: true, categories: after };
}

function matcherCategoryEquals(left: string | null, right: string | null): boolean {
	if ((left ?? null) === (right ?? null)) {
		return true;
	}
	if (!left || !right) {
		return false;
	}
	return categoryIdFromName(left) === categoryIdFromName(right);
}

export function matcherEquals(left: ForbiddenMatcher, right: ForbiddenMatcher): boolean {
	return (
		left.kind === right.kind
		&& matcherCategoryEquals(left.category_name ?? null, right.category_name ?? null)
		&& areNameEquivalent(left.prompt_text ?? '', right.prompt_text ?? '')
		&& normalizeTextForMatch(left.contains_text ?? '') === normalizeTextForMatch(right.contains_text ?? '')
		&& normalizeTagId(left.tag_text ?? '') === normalizeTagId(right.tag_text ?? '')
	);
}

export function specificMatcher(categoryName: string, promptText: string): ForbiddenMatcher {
	return {
		kind: 'specific',
		category_name: categoryName,
		prompt_text: promptText,
		contains_text: null,
		tag_text: null,
	};
}

export function containsMatcher(categoryName: string | null, text: string): ForbiddenMatcher {
	return {
		kind: 'contains',
		category_name: categoryName,
		prompt_text: null,
		contains_text: text,
		tag_text: null,
	};
}

export function tagMatcher(categoryName: string, tagText: string): ForbiddenMatcher {
	return {
		kind: 'tag',
		category_name: categoryName,
		prompt_text: null,
		contains_text: null,
		tag_text: normalizeTagId(tagText),
	};
}

function resolveSpecificMatcher(categories: PromptCategory[], matcher: ForbiddenMatcher): RuntimePromptEndpoint[] {
	if (matcher.kind !== 'specific' || !matcher.category_name) {
		return [];
	}
	return categories
		.filter((category) => categoryIdFromName(category.name) === categoryIdFromName(matcher.category_name ?? ''))
		.flatMap((category) => category.prompts
			.filter((prompt) => isCategoryWideSpecificMatcher(matcher) || areNameEquivalent(prompt.text, matcher.prompt_text ?? ''))
			.map((prompt) => makeRuntimePromptEndpoint(category, prompt, getStoredPromptState(category, prompt) === 'lock')));
}

export function matcherMatchesPrompt(
	matcher: ForbiddenMatcher,
	prompt: RuntimePromptEndpoint,
	categories: PromptCategory[],
): boolean {
	if (matcher.kind === 'specific') {
		return resolveSpecificMatcher(categories, matcher).some((candidate) => candidate.categoryId === prompt.categoryId && candidate.promptId === prompt.promptId);
	}
	if (matcher.category_name && categoryIdFromName(matcher.category_name) !== categoryIdFromName(prompt.categoryName)) {
		return false;
	}
	if (matcher.kind === 'tag') {
		return promptHasTag(prompt.promptText, matcher.tag_text ?? '');
	}
	return textContains(prompt.promptText, matcher.contains_text ?? '');
}

export function ruleMatchesPrompt(
	rule: ForbiddenRule,
	left: RuntimePromptEndpoint,
	right: RuntimePromptEndpoint,
	categories: PromptCategory[],
): boolean {
	return (
		matcherMatchesPrompt(rule.left, left, categories) && matcherMatchesPrompt(rule.right, right, categories)
	) || (
			matcherMatchesPrompt(rule.left, right, categories) && matcherMatchesPrompt(rule.right, left, categories)
		);
}

export function hasSpecificForbiddenRule(
	rules: ForbiddenRule[],
	categories: PromptCategory[],
	first: RuntimePromptEndpoint,
	second: RuntimePromptEndpoint,
): boolean {
	return rules.some((rule) =>
		ruleMatchesPrompt(rule, first, second, categories)
		&& rule.left.kind === 'specific'
		&& rule.right.kind === 'specific',
	);
}

export function setSpecificForbiddenRule(
	rules: ForbiddenRule[],
	first: RuntimePromptEndpoint,
	second: RuntimePromptEndpoint,
	forbidden: boolean,
): ForbiddenRule[] {
	const left = specificMatcher(first.categoryName, first.promptText);
	const right = specificMatcher(second.categoryName, second.promptText);
	const existingIndex = rules.findIndex((rule) =>
		(matcherEquals(rule.left, left) && matcherEquals(rule.right, right))
		|| (matcherEquals(rule.left, right) && matcherEquals(rule.right, left)),
	);

	if (forbidden) {
		if (existingIndex >= 0) {
			return rules;
		}
		const order = [left, right].sort((a, b) => `${categoryIdFromName(a.category_name ?? '')}::${promptToKey('', a.prompt_text ?? '')}`.localeCompare(`${categoryIdFromName(b.category_name ?? '')}::${promptToKey('', b.prompt_text ?? '')}`));
		return [...rules, { left: order[0], right: order[1] }];
	}

	return existingIndex >= 0 ? rules.filter((_, index) => index !== existingIndex) : rules;
}

export function toggleSpecificForbiddenRule(
	rules: ForbiddenRule[],
	categories: PromptCategory[],
	first: RuntimePromptEndpoint,
	second: RuntimePromptEndpoint,
): ForbiddenRule[] {
	return setSpecificForbiddenRule(rules, first, second, !hasSpecificForbiddenRule(rules, categories, first, second));
}

export function removeRule(rules: ForbiddenRule[], ruleToRemove: ForbiddenRule): ForbiddenRule[] {
	return rules.filter(
		(rule) =>
			!((matcherEquals(rule.left, ruleToRemove.left) && matcherEquals(rule.right, ruleToRemove.right))
				|| (matcherEquals(rule.left, ruleToRemove.right) && matcherEquals(rule.right, ruleToRemove.left))),
	);
}

export function uniqueSlug(base: string, existingIds: string[]): string {
	const initial = slugify(base);
	if (!existingIds.includes(initial)) {
		return initial;
	}
	let counter = 2;
	while (existingIds.includes(`${initial}-${counter}`)) {
		counter += 1;
	}
	return `${initial}-${counter}`;
}

export function findPromptById(categories: PromptCategory[], categoryId: string, promptId: string): PromptEntry | null {
	return categories.find((category) => category.id === categoryId)?.prompts.find((prompt) => prompt.id === promptId) ?? null;
}

export function findPromptBySelection(categories: PromptCategory[], selection: Pick<GenerationSelection, 'category_name' | 'prompt_text'>): { category: PromptCategory; prompt: PromptEntry } | null {
	const category = categories.find((item) => categoryIdFromName(item.name) === categoryIdFromName(selection.category_name));
	if (!category) {
		return null;
	}
	const prompt = category.prompts.find((item) => areNameEquivalent(item.text, selection.prompt_text));
	return prompt ? { category, prompt } : null;
}

export function resolveSelectionToRuntimeEndpoint(
	categories: PromptCategory[],
	selection: Pick<GenerationSelection, 'category_name' | 'prompt_text'>,
	snapshot: ReachabilitySnapshot | null = null,
	rules: ForbiddenRule[] = [],
): RuntimePromptEndpoint | null {
	const match = findPromptBySelection(categories, selection);
	if (!match) {
		return null;
	}
	const resolvedSnapshot = snapshot ?? buildReachabilitySnapshot(categories, rules);
	return makeRuntimePromptEndpoint(
		match.category,
		match.prompt,
		getPromptUiState(categories, match.category.id, match.prompt.id, resolvedSnapshot, rules) === 'lock',
	);
}

export function latestOutputId(outputs: OutputSummary[]): string | null {
	return outputs.length ? outputs[outputs.length - 1].output_id : null;
}

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
			return digits ? Number(digits) : 10000;
		});
}

export function comparePriority(left: string, right: string): number {
	const leftParts = priorityToSortKey(left);
	const rightParts = priorityToSortKey(right);
	const length = Math.max(leftParts.length, rightParts.length);
	for (let index = 0; index < length; index += 1) {
		const delta = (leftParts[index] ?? 10000) - (rightParts[index] ?? 10000);
		if (delta !== 0) {
			return delta;
		}
	}
	return 0;
}
