// Prompt categories store: single truth holder of categories and sub-prompts (persisted as 'categorie-store').
// Category algorithms live in src/domain/categories.ts; reachability in src/domain/reachability.ts.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import {
	categoryKeyOf,
	estimateCategorySize,
	joinBulkText,
	makeCategory,
	makeSubPrompt,
	newCategoryName,
	removeLoraFromCategories,
	sanitizeCategories,
	sanitizeSubPrompts,
	sortCategories,
	splitBulkText,
	subPromptKeyOf,
	type Category,
	type CategoryKey,
	type CategoryState,
	type CategoryUiState,
	type SubPrompt,
	type SubPromptKey,
	type SubPromptState,
	type SubPromptUiState,
} from '../domain/categories';
import type { ForbiddenRule } from '../domain/forbiddenRules';
import { categoryWindowKey, type ArrangeItem, type Viewport } from '../domain/layout';
import { buildReachabilitySnapshot, categoryUiStateOf, subPromptUiStateOf, type ReachabilitySnapshot } from '../domain/reachability';
import { uniqueStrings } from '../domain/text';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { useNotificationsStore } from './notificationsStore';
import { useWorkspaceStore } from './workspaceStore';

export type CategoriesState = {
	categories: Category[];
};

export type CategoriesActions = {
	/** Appends 'new category' (made unique) with one empty sub-prompt; returns its key. */
	addCategory: () => CategoryKey;
	/** Removes the category, the forbidden rules naming it and its workspace window. */
	removeCategory: (key: CategoryKey) => void;
	/** Renames; rejects (notification, returns false) when the new key collides with another category.
	 *  Moves the workspace window key and rewrites forbidden rules naming the old category. */
	renameCategory: (key: CategoryKey, text: string) => boolean;
	setActivationText: (key: CategoryKey, text: string) => void;
	setPriority: (key: CategoryKey, priority: number) => void;
	setCategoryState: (key: CategoryKey, state: CategoryState) => void;
	/** Appends an empty sub-prompt (rejected with a notification when the category already has one). */
	addSubPrompt: (key: CategoryKey) => void;
	/** Appends a sub-prompt with this text (the image library adds an image's tags with it). Returns false without
	 *  change for an unknown category or a blank text, and rejects duplicates inside the category (the notification
	 *  of setSubPromptText). */
	addSubPromptWithText: (key: CategoryKey, text: string) => boolean;
	/** Edits a sub-prompt text; rejects duplicates inside the category (notification, returns false).
	 *  Rewrites exact forbidden rules naming the old text. */
	setSubPromptText: (key: CategoryKey, promptKey: SubPromptKey, text: string) => boolean;
	/** 'lock' is exclusive inside a category (the previous lock becomes 'normal'). */
	setSubPromptState: (key: CategoryKey, promptKey: SubPromptKey, state: SubPromptState) => void;
	setSubPromptExtraLoraIds: (key: CategoryKey, promptKey: SubPromptKey, loraIds: string[]) => void;
	/** Removes the sub-prompt and the exact forbidden rules naming it. */
	removeSubPrompt: (key: CategoryKey, promptKey: SubPromptKey) => void;
	/** Replaces the sub-prompts from the bulk editor text (entries separated by '\n|\n'); sub-prompts whose
	 *  text is unchanged keep their state and extraLoraIds; duplicates are dropped. */
	applyBulkText: (key: CategoryKey, text: string) => void;
	/** Sorts by priority then name, renumbers priorities 1..n and arranges the category windows in a grid
	 *  (useWorkspaceStore.arrangeCategoryWindows). */
	reorganize: () => void;
	/** Removes a LoRA id from every sub-prompt's extraLoraIds. */
	unlinkLora: (loraId: string) => void;
	/** Wholesale replacement (legacy import at bootstrap); sanitizes (unique keys, single lock). */
	replaceAll: (categories: Category[]) => void;
};

export type CategoriesStore = CategoriesState & CategoriesActions;

function displayName(category: Category): string {
	return category.text || '(unnamed category)';
}

function warnDuplicateSubPrompt(category: Category): void {
	useNotificationsStore
		.getState()
		.notify('warning', `Category '${displayName(category)}' cannot contain multiple sub-prompts with the same id.`);
}

function currentViewport(): Viewport {
	return { width: window.innerWidth, height: window.innerHeight };
}

export const useCategoriesStore = create<CategoriesStore>()(
	persist(
		(set, get) => {
			/** Replaces the category with `key` by `update(category)` (no-op when absent or unchanged). */
			const updateCategory = (key: CategoryKey, update: (category: Category) => Category) => {
				const categories = get().categories;
				const index = categories.findIndex((category) => categoryKeyOf(category.text) === key);
				if (index < 0) {
					return;
				}
				const next = update(categories[index]);
				if (next !== categories[index]) {
					set({ categories: categories.map((category, position) => (position === index ? next : category)) });
				}
			};
			const updateSubPrompt = (key: CategoryKey, promptKey: SubPromptKey, update: (subPrompt: SubPrompt) => SubPrompt) =>
				updateCategory(key, (category) => {
					const index = category.subPrompts.findIndex((subPrompt) => subPromptKeyOf(subPrompt.text) === promptKey);
					return index < 0
						? category
						: { ...category, subPrompts: category.subPrompts.map((subPrompt, position) => (position === index ? update(subPrompt) : subPrompt)) };
				});

			return {
				categories: [],
				addCategory: () => {
					const categories = get().categories;
					const category = makeCategory(newCategoryName(categories));
					set({ categories: [...categories, category] });
					return categoryKeyOf(category.text);
				},
				removeCategory: (key) => {
					const category = findCategory(get().categories, key);
					if (!category) {
						return;
					}
					set({ categories: get().categories.filter((item) => item !== category) });
					useWorkspaceStore.getState().removeWindow(categoryWindowKey(key));
					useForbiddenRulesStore.getState().removeRulesForCategory(category.text);
				},
				renameCategory: (key, text) => {
					const category = findCategory(get().categories, key);
					if (!category) {
						return false;
					}
					if (category.text === text) {
						return true;
					}
					const newKey = categoryKeyOf(text);
					if (newKey !== key && findCategory(get().categories, newKey)) {
						useNotificationsStore.getState().notify('warning', `A category named '${text}' already exists.`, { title: 'Rename rejected' });
						return false;
					}
					updateCategory(key, (item) => ({ ...item, text }));
					if (newKey !== key) {
						useWorkspaceStore.getState().renameWindow(categoryWindowKey(key), categoryWindowKey(newKey));
					}
					useForbiddenRulesStore.getState().renameCategoryInRules(category.text, text);
					return true;
				},
				setActivationText: (key, text) =>
					updateCategory(key, (category) => (category.activation_text === text ? category : { ...category, activation_text: text })),
				setPriority: (key, priority) => {
					if (!Number.isFinite(priority)) {
						return;
					}
					updateCategory(key, (category) => (category.priority === priority ? category : { ...category, priority }));
				},
				setCategoryState: (key, state) => updateCategory(key, (category) => (category.state === state ? category : { ...category, state })),
				addSubPrompt: (key) =>
					updateCategory(key, (category) => {
						const emptyKey = subPromptKeyOf('');
						if (category.subPrompts.some((subPrompt) => subPromptKeyOf(subPrompt.text) === emptyKey)) {
							warnDuplicateSubPrompt(category);
							return category;
						}
						return { ...category, subPrompts: [...category.subPrompts, makeSubPrompt()] };
					}),
				addSubPromptWithText: (key, text) => {
					const category = findCategory(get().categories, key);
					if (!category || !text.trim()) {
						return false;
					}
					if (findSubPromptIn(category, subPromptKeyOf(text))) {
						warnDuplicateSubPrompt(category);
						return false;
					}
					updateCategory(key, (item) => ({ ...item, subPrompts: [...item.subPrompts, makeSubPrompt(text)] }));
					return true;
				},
				setSubPromptText: (key, promptKey, text) => {
					const category = findCategory(get().categories, key);
					const subPrompt = category && findSubPromptIn(category, promptKey);
					if (!category || !subPrompt) {
						return false;
					}
					if (subPrompt.text === text) {
						return true;
					}
					const newKey = subPromptKeyOf(text);
					if (newKey !== promptKey && findSubPromptIn(category, newKey)) {
						warnDuplicateSubPrompt(category);
						return false;
					}
					updateSubPrompt(key, promptKey, (item) => ({ ...item, text }));
					useForbiddenRulesStore.getState().renameSubPromptInRules(category.text, subPrompt.text, text);
					return true;
				},
				setSubPromptState: (key, promptKey, state) =>
					updateCategory(key, (category) => {
						const target = findSubPromptIn(category, promptKey);
						if (!target || target.state === state) {
							return category;
						}
						return {
							...category,
							subPrompts: category.subPrompts.map((subPrompt) => {
								if (subPrompt === target) {
									return { ...subPrompt, state };
								}
								return state === 'lock' && subPrompt.state === 'lock' ? { ...subPrompt, state: 'normal' } : subPrompt;
							}),
						};
					}),
				setSubPromptExtraLoraIds: (key, promptKey, loraIds) =>
					updateSubPrompt(key, promptKey, (subPrompt) => ({ ...subPrompt, extraLoraIds: uniqueStrings(loraIds) })),
				removeSubPrompt: (key, promptKey) => {
					const category = findCategory(get().categories, key);
					const subPrompt = category && findSubPromptIn(category, promptKey);
					if (!category || !subPrompt) {
						return;
					}
					updateCategory(key, (item) => ({ ...item, subPrompts: item.subPrompts.filter((entry) => entry !== subPrompt) }));
					useForbiddenRulesStore.getState().removeRulesForSubPrompt(category.text, subPrompt.text);
				},
				applyBulkText: (key, text) =>
					updateCategory(key, (category) => {
						const previousByText = new Map(category.subPrompts.map((subPrompt) => [subPrompt.text, subPrompt]));
						const entries = splitBulkText(text).map((entry) => previousByText.get(entry) ?? makeSubPrompt(entry));
						const { subPrompts, droppedDuplicates } = sanitizeSubPrompts(entries);
						if (droppedDuplicates > 0) {
							useNotificationsStore
								.getState()
								.notify('warning', `${droppedDuplicates} duplicate sub-prompt(s) of '${displayName(category)}' were dropped.`);
						}
						const unchanged =
							subPrompts.length === category.subPrompts.length && subPrompts.every((subPrompt, index) => subPrompt === category.subPrompts[index]);
						return unchanged ? category : { ...category, subPrompts };
					}),
				reorganize: () => {
					const ordered = sortCategories(get().categories).map((category, index) =>
						category.priority === index + 1 ? category : { ...category, priority: index + 1 },
					);
					set({ categories: ordered });
					const viewport = currentViewport();
					// The workspace store keeps a window's stored size and uses the estimate for the others.
					const items: ArrangeItem[] = ordered.map((category) => ({
						key: categoryWindowKey(categoryKeyOf(category.text)),
						preferred: estimateCategorySize(category, viewport),
					}));
					useWorkspaceStore.getState().arrangeCategoryWindows(items, viewport);
				},
				unlinkLora: (loraId) => {
					const categories = get().categories;
					const next = removeLoraFromCategories(categories, loraId);
					if (next !== categories) {
						set({ categories: next });
					}
				},
				replaceAll: (categories) => set({ categories: sanitizeCategories(categories) }),
			};
		},
		persistedStoreOptions<CategoriesStore, CategoriesState>({
			name: STORE_NAMES.categories,
			version: 0,
			partialize: (state) => ({ categories: state.categories }),
			// Persisted data is sanitized (unknown states, duplicate keys, several locks) before use.
			merge: (persisted, current) => {
				const categories = (persisted as Partial<CategoriesState> | undefined)?.categories;
				return categories === undefined ? current : { ...current, categories: sanitizeCategories(categories) };
			},
		}),
	),
);

// ---------------------------------------------------------------------------
// Selectors (pure) and hooks (fine-grained subscriptions for views)
// ---------------------------------------------------------------------------

export function findCategory(categories: readonly Category[], key: CategoryKey): Category | undefined {
	return categories.find((category) => categoryKeyOf(category.text) === key);
}

function findSubPromptIn(category: Category, promptKey: SubPromptKey): SubPrompt | undefined {
	return category.subPrompts.find((subPrompt) => subPromptKeyOf(subPrompt.text) === promptKey);
}

export function findSubPrompt(categories: readonly Category[], key: CategoryKey, promptKey: SubPromptKey): SubPrompt | undefined {
	const category = findCategory(categories, key);
	return category && findSubPromptIn(category, promptKey);
}

export const selectCategoryKeys = (state: CategoriesState): CategoryKey[] => state.categories.map((category) => categoryKeyOf(category.text));

export function useCategoryKeys(): CategoryKey[] {
	return useCategoriesStore(useShallow(selectCategoryKeys));
}

export function useCategory(key: CategoryKey): Category | undefined {
	return useCategoriesStore((state) => findCategory(state.categories, key));
}

export function useSubPromptKeys(key: CategoryKey): SubPromptKey[] {
	return useCategoriesStore(useShallow((state) => findCategory(state.categories, key)?.subPrompts.map((item) => subPromptKeyOf(item.text)) ?? []));
}

export function useSubPrompt(key: CategoryKey, promptKey: SubPromptKey): SubPrompt | undefined {
	return useCategoriesStore((state) => findSubPrompt(state.categories, key, promptKey));
}

/** Text shown in the bulk editor: sub-prompt texts joined with '\n|\n'. */
export function useBulkText(key: CategoryKey): string {
	return useCategoriesStore((state) => {
		const category = findCategory(state.categories, key);
		return category ? joinBulkText(category.subPrompts) : '';
	});
}

// One reachability computation shared by every card (memoized on the categories and rules identities).
let reachabilityMemo: { categories: readonly Category[]; rules: readonly ForbiddenRule[]; snapshot: ReachabilitySnapshot } | null = null;

/** Reachability snapshot of (categories, rules), computed once per change of either. */
export function selectReachability(categories: readonly Category[], rules: readonly ForbiddenRule[]): ReachabilitySnapshot {
	if (!reachabilityMemo || reachabilityMemo.categories !== categories || reachabilityMemo.rules !== rules) {
		reachabilityMemo = { categories, rules, snapshot: buildReachabilitySnapshot(categories, rules) };
	}
	return reachabilityMemo.snapshot;
}

/** Reachability-derived state (categories + forbidden rules), computed once per change and shared. */
export function useCategoryUiState(key: CategoryKey): CategoryUiState {
	const rules = useForbiddenRulesStore((state) => state.rules);
	return useCategoriesStore(
		(state) => categoryUiStateOf(selectReachability(state.categories, rules), key) ?? findCategory(state.categories, key)?.state ?? 'normal',
	);
}

export function useSubPromptUiState(key: CategoryKey, promptKey: SubPromptKey): SubPromptUiState {
	const rules = useForbiddenRulesStore((state) => state.rules);
	return useCategoriesStore(
		(state) =>
			subPromptUiStateOf(selectReachability(state.categories, rules), key, promptKey) ??
			findSubPrompt(state.categories, key, promptKey)?.state ??
			'normal',
	);
}
