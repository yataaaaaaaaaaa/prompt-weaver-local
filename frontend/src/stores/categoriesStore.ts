import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useGenerationStore } from './generationStore';
import type { PromptUiState } from '../types';
import { CategoryId } from '../utils/CategoryId';
import { SubPromptId } from '../utils/SubPromptId';
import { createFileBackedStorage } from '../utils/createFileBackedStorage';
import { usePanelLayoutsStore } from './panelLayoutState';
import { useWorkspaceZIndexStore } from './workspaceZIndex';

export type StoredSubPrompt = {
    text: string;
    state: PromptUiState;
    extraLoraIds: string[];
};

export type StoredCategory = {
    text: string;
    activation_text: string;
    priority: number;
    state: PromptUiState;
    subPrompts: StoredSubPrompt[];
};

type CategoriesState = {
    categories: StoredCategory[];
    setCategories: (categories: StoredCategory[]) => void;
    reorganizeCategories: () => void;
    upsertCategory: (category: StoredCategory) => void;
    removeCategory: (categoryId: CategoryId) => void;
    patchCategory: (categoryId: CategoryId, patch: Partial<Omit<StoredCategory, 'subPrompts'>>) => void;
    replaceSubPrompts: (categoryId: CategoryId, subPrompts: StoredSubPrompt[]) => void;
    addSubPrompt: (categoryId: CategoryId, subPrompt: StoredSubPrompt) => void;
    removeSubPrompt: (categoryId: CategoryId, subPromptId: SubPromptId) => void;
    patchSubPrompt: (categoryId: CategoryId, subPromptId: SubPromptId, patch: Partial<StoredSubPrompt>) => void;
    setCategoryText: (categoryId: CategoryId, text: string) => void;
    setCategoryActivationText: (categoryId: CategoryId, activationText: string) => void;
    setCategoryPriority: (categoryId: CategoryId, priority: number) => void;
    setCategoryState: (categoryId: CategoryId, stateValue: PromptUiState) => void;
    setSubPromptText: (categoryId: CategoryId, subPromptId: SubPromptId, text: string) => void;
    setSubPrompts: (categoryId: CategoryId, texts: string[]) => void;
    setSubPromptState: (categoryId: CategoryId, subPromptId: SubPromptId, stateValue: PromptUiState) => void;
    setSubPromptExtraLoraIds: (categoryId: CategoryId, subPromptId: SubPromptId, extraLoraIds: string[]) => void;
    reset: () => void;
};

const DefaultPromptUiState: PromptUiState = 'normal';
const DefaultPromptPriority = 1;
const EmptySubPrompts: StoredSubPrompt[] = [];

function setValidationError(message: string): void {
    useGenerationStore.getState().setError(message);
}

function categoryMatches(category: StoredCategory, categoryId: CategoryId): boolean {
    return CategoryId.from(category.text).equals(categoryId);
}

function subPromptMatches(subPrompt: StoredSubPrompt, subPromptId: SubPromptId): boolean {
    return SubPromptId.from(subPrompt.text).equals(subPromptId);
}

function findDuplicateSubPromptId(subPrompts: StoredSubPrompt[]): string | null {
    const seen = new Set<string>();
    for (const subPrompt of subPrompts) {
        const subPromptId = SubPromptId.from(subPrompt.text).toString();
        if (seen.has(subPromptId)) {
            return subPromptId;
        }
        seen.add(subPromptId);
    }
    return null;
}

function ensureUniqueSubPromptIds(category: StoredCategory, nextSubPrompts: StoredSubPrompt[], mode: 'reject' | 'dedupe'): StoredSubPrompt[] | null {
    const duplicateId = findDuplicateSubPromptId(nextSubPrompts);
    if (!duplicateId) {
        return nextSubPrompts;
    }

    if (mode === 'dedupe') {
        const seen = new Set<string>();
        return nextSubPrompts.filter((subPrompt) => {
            const subPromptId = SubPromptId.from(subPrompt.text).toString();
            if (seen.has(subPromptId)) {
                return false;
            }
            seen.add(subPromptId);
            return true;
        });
    }

    setValidationError(`Category '${category.text || '(unnamed category)'}' cannot contain multiple sub-prompts with the same id.`);
    return null;
}

function normalizeSingleLockedSubPrompt(subPrompts: StoredSubPrompt[]): StoredSubPrompt[] {
    let sawLockedSubPrompt = false;
    return subPrompts.map((subPrompt) => {
        if (subPrompt.state !== 'lock') {
            return subPrompt;
        }
        if (!sawLockedSubPrompt) {
            sawLockedSubPrompt = true;
            return subPrompt;
        }
        return {
            ...subPrompt,
            state: 'normal',
        };
    });
}

function sanitizeCategory(category: StoredCategory): StoredCategory {
    return {
        ...category,
        subPrompts: normalizeSingleLockedSubPrompt(ensureUniqueSubPromptIds(category, category.subPrompts, 'dedupe') ?? []),
    };
}

function sanitizeCategories(categories: StoredCategory[]): StoredCategory[] {
    return categories.map(sanitizeCategory);
}

function updateCategory(categories: StoredCategory[], categoryId: CategoryId, updater: (category: StoredCategory) => StoredCategory): StoredCategory[] {
    return categories.map((category) => categoryMatches(category, categoryId) ? sanitizeCategory(updater(category)) : category);
}

function updateSubPrompt(
    categories: StoredCategory[],
    categoryId: CategoryId,
    subPromptId: SubPromptId,
    updater: (subPrompt: StoredSubPrompt) => StoredSubPrompt,
): StoredCategory[] {
    return categories.map((category) => {
        if (!categoryMatches(category, categoryId)) {
            return category;
        }
        const nextSubPrompts = category.subPrompts.map((subPrompt) => subPromptMatches(subPrompt, subPromptId) ? updater(subPrompt) : subPrompt);
        const validatedSubPrompts = ensureUniqueSubPromptIds(category, nextSubPrompts, 'reject');
        if (!validatedSubPrompts) {
            return category;
        }
        return {
            ...category,
            subPrompts: validatedSubPrompts,
        };
    });
}

function findCategory(categories: StoredCategory[], categoryId: CategoryId): StoredCategory | undefined {
    return categories.find((category) => categoryMatches(category, categoryId));
}

function findSubPrompt(categories: StoredCategory[], categoryId: CategoryId, subPromptId: SubPromptId): StoredSubPrompt | undefined {
    return findCategory(categories, categoryId)?.subPrompts.find((subPrompt) => subPromptMatches(subPrompt, subPromptId));
}

function reorganizeCategories(categories: StoredCategory[]): StoredCategory[] {
    return [...categories]
        .sort((left, right) => {
            const priorityDiff = left.priority - right.priority;
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
            return left.text.localeCompare(right.text);
        })
        .map((category, index) => ({
            ...category,
            priority: index + 1,
        }));
}

function estimateCategoryLayout(category: StoredCategory): { width: number; height: number } {
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const maxWidth = Math.max(320, Math.floor(screenWidth * 0.4));
    const maxHeight = Math.max(180, Math.floor(screenHeight * 0.3));

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

type ReorganizedCategoryPanel = {
    identifier: string;
    width: number;
    preferredHeight: number;
};

function applyReorganizedCategoryLayouts(categories: StoredCategory[]): void {
    const margin = 24;
    const gap = 16;
    const screenWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const screenHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
    const availableWidth = Math.max(360, screenWidth - margin * 2);
    const maxRowHeight = Math.max(168, Math.floor(screenHeight * 0.3));
    const panelLayoutsStore = usePanelLayoutsStore.getState();
    const setPanelLayout = panelLayoutsStore.setPanelLayout;
    const paneZ = useWorkspaceZIndexStore.getState().paneZ;
    const categoryZ = useWorkspaceZIndexStore.getState().categoryZ;
    const setCategoryZIndex = useWorkspaceZIndexStore.getState().setCategoryZIndex;

    const paneMaxZ = Object.values(paneZ).reduce((max, value) => Math.max(max, value ?? 0), 1);
    const categoryMaxZ = Object.values(categoryZ).reduce((max, value) => Math.max(max, value ?? 0), 1);
    const baseZ = Math.max(paneMaxZ, categoryMaxZ, 1);

    const panels: ReorganizedCategoryPanel[] = categories.map((category) => {
        const identifier = CategoryId.from(category.text).toString();
        const storedLayout = panelLayoutsStore.panels[identifier];
        const estimatedSize = estimateCategoryLayout(category);
        return {
            identifier,
            width: Math.max(300, Math.min(availableWidth, storedLayout?.width ?? estimatedSize.width)),
            preferredHeight: Math.max(168, Math.min(maxRowHeight, storedLayout?.height ?? estimatedSize.height)),
        };
    });

    const rows: ReorganizedCategoryPanel[][] = [];
    let currentRow: ReorganizedCategoryPanel[] = [];
    let currentRowWidth = 0;

    for (const panel of panels) {
        const nextRowWidth = currentRow.length === 0 ? panel.width : currentRowWidth + gap + panel.width;
        if (currentRow.length > 0 && nextRowWidth > availableWidth) {
            rows.push(currentRow);
            currentRow = [panel];
            currentRowWidth = panel.width;
            continue;
        }

        currentRow.push(panel);
        currentRowWidth = nextRowWidth;
    }

    if (currentRow.length > 0) {
        rows.push(currentRow);
    }

    let cursorY = margin;
    let categoryIndex = 0;

    rows.forEach((row) => {
        const rowHeight = Math.min(maxRowHeight, Math.max(...row.map((panel) => panel.preferredHeight)));
        let cursorX = margin;

        row.forEach((panel) => {
            setPanelLayout(panel.identifier, {
                x: cursorX,
                y: cursorY,
                width: panel.width,
                height: rowHeight,
            });
            setCategoryZIndex(panel.identifier, baseZ + categoryIndex + 1);
            cursorX += panel.width + gap;
            categoryIndex += 1;
        });

        cursorY += rowHeight + gap;
    });
}

export const useCategoriesStore = create<CategoriesState>()(
    persist(
        (set) => ({
            categories: [],
            setCategories: (categories) => set({ categories: sanitizeCategories(categories) }),
            reorganizeCategories: () => set((state) => {
                const categories = reorganizeCategories(state.categories);
                applyReorganizedCategoryLayouts(categories);
                return { categories };
            }),
            upsertCategory: (category) => set((state) => {
                const existingIndex = state.categories.findIndex((item) => categoryMatches(item, CategoryId.from(category.text)));
                const sanitizedCategory = sanitizeCategory(category);
                if (existingIndex < 0) {
                    return { categories: [...state.categories, sanitizedCategory] };
                }
                const nextCategories = state.categories.slice();
                nextCategories[existingIndex] = sanitizedCategory;
                return { categories: nextCategories };
            }),
            removeCategory: (categoryId) => set((state) => ({ categories: state.categories.filter((category) => !categoryMatches(category, categoryId)) })),
            patchCategory: (categoryId, patch) => set((state) => ({ categories: updateCategory(state.categories, categoryId, (category) => ({ ...category, ...patch })) })),
            replaceSubPrompts: (categoryId, subPrompts) => set((state) => ({ categories: state.categories.map((category) => {
                if (!categoryMatches(category, categoryId)) {
                    return category;
                }
                const validatedSubPrompts = ensureUniqueSubPromptIds(category, subPrompts, 'reject');
                if (!validatedSubPrompts) {
                    return category;
                }
                return { ...category, subPrompts: validatedSubPrompts };
            }) })),
            addSubPrompt: (categoryId, subPrompt) => set((state) => ({ categories: state.categories.map((category) => {
                if (!categoryMatches(category, categoryId)) {
                    return category;
                }
                const validatedSubPrompts = ensureUniqueSubPromptIds(category, [...category.subPrompts, subPrompt], 'reject');
                if (!validatedSubPrompts) {
                    return category;
                }
                return { ...category, subPrompts: validatedSubPrompts };
            }) })),
            removeSubPrompt: (categoryId, subPromptId) => set((state) => ({ categories: updateCategory(state.categories, categoryId, (category) => ({ ...category, subPrompts: category.subPrompts.filter((subPrompt) => !subPromptMatches(subPrompt, subPromptId)) })) })),
            patchSubPrompt: (categoryId, subPromptId, patch) => set((state) => ({ categories: updateSubPrompt(state.categories, categoryId, subPromptId, (subPrompt) => ({ ...subPrompt, ...patch })) })),
            setCategoryText: (categoryId, text) => set((state) => ({ categories: updateCategory(state.categories, categoryId, (category) => ({ ...category, text })) })),
            setCategoryActivationText: (categoryId, activation_text) => set((state) => ({ categories: updateCategory(state.categories, categoryId, (category) => ({ ...category, activation_text })) })),
            setCategoryPriority: (categoryId, priority) => set((state) => ({ categories: updateCategory(state.categories, categoryId, (category) => ({ ...category, priority })) })),
            setCategoryState: (categoryId, stateValue) => set((state) => ({ categories: updateCategory(state.categories, categoryId, (category) => ({ ...category, state: stateValue })) })),
            setSubPromptText: (categoryId, subPromptId, text) => set((state) => ({ categories: updateSubPrompt(state.categories, categoryId, subPromptId, (subPrompt) => ({ ...subPrompt, text })) })),
            setSubPrompts: (categoryId, texts) => set((state) => ({ categories: state.categories.map((category) => {
                if (!categoryMatches(category, categoryId)) {
                    return category;
                }
                const nextSubPrompts = texts.map((text) => ({ text, state: 'normal' as PromptUiState, extraLoraIds: [] }));
                const validatedSubPrompts = ensureUniqueSubPromptIds(category, nextSubPrompts, 'reject');
                if (!validatedSubPrompts) {
                    return category;
                }
                return { ...category, subPrompts: validatedSubPrompts };
            }) })),
            setSubPromptState: (categoryId, subPromptId, stateValue) => set((state) => ({ categories: state.categories.map((category) => {
                if (!categoryMatches(category, categoryId)) {
                    return category;
                }
                return {
                    ...category,
                    subPrompts: category.subPrompts.map((subPrompt) => {
                        if (!subPromptMatches(subPrompt, subPromptId)) {
                            if (stateValue === 'lock' && subPrompt.state === 'lock') {
                                return {
                                    ...subPrompt,
                                    state: 'normal',
                                };
                            }
                            return subPrompt;
                        }
                        return {
                            ...subPrompt,
                            state: stateValue,
                        };
                    }),
                };
            }) })),
            setSubPromptExtraLoraIds: (categoryId, subPromptId, extraLoraIds) => set((state) => ({ categories: updateSubPrompt(state.categories, categoryId, subPromptId, (subPrompt) => ({ ...subPrompt, extraLoraIds })) })),
            reset: () => ({ categories: [] }),
        }),
        {
            name: 'categorie-store',
            storage: createJSONStorage(() => createFileBackedStorage('categorie-store')),
            partialize: (state) => ({ categories: sanitizeCategories(state.categories) }),
        },
    ),
);

export function useCategorySlice<TResult>(categoryId: CategoryId, selector: (category: StoredCategory | undefined) => TResult): TResult {
    return useCategoriesStore((state) => selector(findCategory(state.categories, categoryId)));
}

export function useSubPromptSlice<TResult>(categoryId: CategoryId, subPromptId: SubPromptId, selector: (subPrompt: StoredSubPrompt | undefined) => TResult): TResult {
    return useCategoriesStore((state) => selector(findSubPrompt(state.categories, categoryId, subPromptId)));
}

export function useCategoryActions(categoryId: CategoryId) {
    const setCategoryText = useCategoriesStore((state) => state.setCategoryText);
    const setCategoryActivationText = useCategoriesStore((state) => state.setCategoryActivationText);
    const setCategoryPriority = useCategoriesStore((state) => state.setCategoryPriority);
    const setCategoryState = useCategoriesStore((state) => state.setCategoryState);
    const removeCategory = useCategoriesStore((state) => state.removeCategory);
    const replaceSubPrompts = useCategoriesStore((state) => state.replaceSubPrompts);
    const addSubPrompt = useCategoriesStore((state) => state.addSubPrompt);
    const patchCategory = useCategoriesStore((state) => state.patchCategory);
    const setSubPrompts = useCategoriesStore((state) => state.setSubPrompts);

    return useMemo(() => ({
        onTextChange: (nextText: string) => setCategoryText(categoryId, nextText),
        onActivationTextChange: (nextText: string) => setCategoryActivationText(categoryId, nextText),
        onPriorityChange: (priority: number) => setCategoryPriority(categoryId, priority),
        onStateChange: (nextState: PromptUiState) => setCategoryState(categoryId, nextState),
        onRemove: () => removeCategory(categoryId),
        onReplaceSubPrompts: (subPrompts: StoredSubPrompt[]) => replaceSubPrompts(categoryId, subPrompts),
        onAddSubPrompt: (subPrompt: StoredSubPrompt) => addSubPrompt(categoryId, subPrompt),
        onPatch: (patch: Partial<Omit<StoredCategory, 'subPrompts'>>) => patchCategory(categoryId, patch),
        onSetSubPrompts: (texts: string[]) => setSubPrompts(categoryId, texts),
    }), [addSubPrompt, categoryId, patchCategory, removeCategory, replaceSubPrompts, setCategoryActivationText, setCategoryPriority, setCategoryState, setCategoryText, setSubPrompts]);
}

export function useSubPromptActions(categoryId: CategoryId, subPromptId: SubPromptId) {
    const setSubPromptText = useCategoriesStore((state) => state.setSubPromptText);
    const setSubPromptState = useCategoriesStore((state) => state.setSubPromptState);
    const setSubPromptExtraLoraIds = useCategoriesStore((state) => state.setSubPromptExtraLoraIds);
    const removeSubPrompt = useCategoriesStore((state) => state.removeSubPrompt);
    const patchSubPrompt = useCategoriesStore((state) => state.patchSubPrompt);

    return useMemo(() => ({
        onTextChange: (nextText: string) => setSubPromptText(categoryId, subPromptId, nextText),
        onStateChange: (nextState: PromptUiState) => setSubPromptState(categoryId, subPromptId, nextState),
        onExtraLoraIdsChange: (extraLoraIds: string[]) => setSubPromptExtraLoraIds(categoryId, subPromptId, extraLoraIds),
        onRemove: () => removeSubPrompt(categoryId, subPromptId),
        onPatch: (patch: Partial<StoredSubPrompt>) => patchSubPrompt(categoryId, subPromptId, patch),
    }), [categoryId, patchSubPrompt, removeSubPrompt, setSubPromptExtraLoraIds, setSubPromptState, setSubPromptText, subPromptId]);
}

export function useCategoryItem(categoryId: CategoryId) {
    const text = useCategorySlice(categoryId, (category) => category?.text ?? '');
    const activation_text = useCategorySlice(categoryId, (category) => category?.activation_text ?? '');
    const priority = useCategorySlice(categoryId, (category) => category?.priority ?? DefaultPromptPriority);
    const state = useCategorySlice(categoryId, (category) => category?.state ?? DefaultPromptUiState);
    const subPrompts = useCategorySlice(categoryId, (category) => category?.subPrompts ?? EmptySubPrompts);
    const actions = useCategoryActions(categoryId);

    return useMemo(() => ({ text, activation_text, priority, state, subPrompts, ...actions }), [actions, activation_text, priority, state, subPrompts, text]);
}

export function useSubPromptItem(categoryId: CategoryId, subPromptId: SubPromptId) {
    const text = useSubPromptSlice(categoryId, subPromptId, (subPrompt) => subPrompt?.text ?? '');
    const state = useSubPromptSlice(categoryId, subPromptId, (subPrompt) => subPrompt?.state ?? DefaultPromptUiState);
    const extraLoraIds = useSubPromptSlice(categoryId, subPromptId, (subPrompt) => subPrompt?.extraLoraIds ?? []);
    const actions = useSubPromptActions(categoryId, subPromptId);

    return useMemo(() => ({ text, state, extraLoraIds, ...actions }), [actions, extraLoraIds, state, text]);
}
