// Board store: single truth holder of the prompt board's arrangement (src/domain/board.ts): the order of the category
// cards and which cards are collapsed (persisted as 'board-store', version 0), plus the search / state filter and the
// request to reveal a card (not persisted). It arranges categories, never owns them (categoriesStore does): the
// categories store calls renameCategoryKey / forgetCategory / revealCategory / setOrder from its own actions.
//
// The cards the board shows (useVisibleCategoryKeys, visibleCategoryKeysNow) are derived: board order, filtered by the
// search and the state filter against the categories (categoriesStore), every card's state in one pass
// (forbiddenRulesStore selectCategoryCardStates) and the current output's selections (outputsStore). Reordering is
// relative to the shown cards (a filter may hide some).
//
// When absent, the persisted part is derived once from the legacy floating workspace ('workspace-store', else
// 'panel-layouts-store' + 'workspace-z-index-store', read only) through persistedStoreOptions({ legacy }); the session
// store seeds it from app_state.json's category positions when no layout store at all exists (importLegacyWorkspace).
// Rule: never read another store at module top level or in the initial state (stores import each other).
import { useMemo, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import {
	boardFromLegacyWorkspace,
	boardMoveTarget,
	boardPositionOf,
	EMPTY_BOARD,
	filterBoardKeys,
	filterRevealing,
	isBoardFilterActive,
	moveKeyNextTo,
	NO_BOARD_FILTER,
	removeKeyFrom,
	renameKeyIn,
	resolveBoardOrder,
	sanitizeBoard,
	type BoardFilter,
	type BoardMove,
	type BoardMoveResult,
	type BoardPersistedState,
	type BoardStateFilter,
	type CategoryFilterFacts,
	type Placement,
} from '../domain/board';
import { categoryKeyOf, type Category, type CategoryKey } from '../domain/categories';
import { legacyWorkspaceFromEnvelopes, LEGACY_WORKSPACE_STORE_NAMES, type LegacyWorkspaceState } from '../domain/legacyLayout';
import type { SelectionIndex } from '../domain/outputs';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';
import { findCategory, selectCategoryKeys, useCategoriesStore } from './categoriesStore';
import { selectActiveCharacter, useCharactersStore } from './charactersStore';
import { selectCategoryCardStates, useCategoryCardStates, useForbiddenRulesStore, type CategoryCardStates } from './forbiddenRulesStore';
import { useLayoutStore } from './layoutStore';
import { selectCurrentSelectionIndex, useOutputsStore } from './outputsStore';

/** A request to bring a card into view: the board scrolls it into view and focuses its name (`editName`: opens the
 *  name editor, a new category is named right away). Serial: a new request for the same card is a new value. */
export type RevealRequest = { key: CategoryKey; serial: number; editName: boolean };

export type BoardState = BoardPersistedState & {
	filter: BoardFilter;
	/** The pending reveal request (completeReveal clears it once the board has shown the card). Not persisted. */
	revealRequest: RevealRequest | null;
	/** The serial of the latest reveal request (requests are numbered from 1). */
	lastRevealSerial: number;
};

export type BoardActions = {
	setQuery: (query: string) => void;
	setStateFilter: (state: BoardStateFilter) => void;
	clearFilter: () => void;
	/** Drag and drop / keyboard reorder: moves the card of `key` right before / after the card of `target` (keys of
	 *  existing categories; the full board order is stored). Returns the card's position among the shown cards and
	 *  whether the order changed (null when the card is not shown). */
	moveCategoryNextTo: (key: CategoryKey, target: CategoryKey, placement: Placement) => BoardMoveResult | null;
	/** Keyboard reorder among the shown cards (domain/board.ts boardMoveTarget); nothing moves past an end. Same
	 *  result as moveCategoryNextTo. */
	moveCategory: (key: CategoryKey, move: BoardMove) => BoardMoveResult | null;
	/** Replaces the order (categoriesStore.reorganize: sorted by priority). */
	setOrder: (keys: readonly CategoryKey[]) => void;
	setCollapsed: (key: CategoryKey, collapsed: boolean) => void;
	toggleCollapsed: (key: CategoryKey) => void;
	/** Collapses or expands every category's card. */
	setAllCollapsed: (collapsed: boolean) => void;
	/** The category was renamed: its position, collapsed state and pending reveal follow the new key. */
	renameCategoryKey: (from: CategoryKey, to: CategoryKey) => void;
	/** The category was deleted. */
	forgetCategory: (key: CategoryKey) => void;
	/** Shows the card of `key`: clears the filter only when it hides the card, expands the card and the prompt board
	 *  region (layout store), and asks the board to scroll it into view and focus its name (revealRequest). */
	revealCategory: (key: CategoryKey, options?: { editName?: boolean }) => void;
	/** The board has shown the card of the request `serial` (no-op for an older request). */
	completeReveal: (serial: number) => void;
	/** Wholesale replacement from a legacy workspace (session store: app_state.json category positions). */
	importLegacyWorkspace: (legacy: LegacyWorkspaceState) => void;
};

export type BoardStore = BoardState & BoardActions;

/** The keys of the existing categories, in categories store order (read at call time). */
function categoryKeysNow(): CategoryKey[] {
	return selectCategoryKeys(useCategoriesStore.getState());
}

/** The filter facts of one category (domain/board.ts CategoryFilterFacts) from the card states and the current
 *  output's selections. */
function filterFactsOf(category: Category, cards: CategoryCardStates, selections: SelectionIndex): CategoryFilterFacts {
	const key = categoryKeyOf(category.text);
	const card = cards.get(key);
	return {
		category,
		uiState: card?.uiState ?? category.state,
		forbidden: card !== undefined && card.highlight !== 'none',
		associationSource: card?.designated ?? false,
		usedByCurrentOutput: (selections.get(key)?.length ?? 0) > 0,
	};
}

/** The shown keys: `order` resolved against the categories, filtered (THE derivation of useVisibleCategoryKeys and
 *  visibleCategoryKeysNow). */
function visibleKeysOf(
	order: readonly CategoryKey[],
	filter: BoardFilter,
	categories: readonly Category[],
	cards: CategoryCardStates,
	selections: SelectionIndex,
): CategoryKey[] {
	const ordered = resolveBoardOrder(order, categories.map((category) => categoryKeyOf(category.text)));
	if (!isBoardFilterActive(filter)) {
		return ordered;
	}
	const byKey = new Map(categories.map((category) => [categoryKeyOf(category.text), category]));
	return filterBoardKeys(ordered, filter, (key) => {
		const category = byKey.get(key);
		return category && filterFactsOf(category, cards, selections);
	});
}

/** The card states of the current stores (read at call time). */
function cardStatesNow(): CategoryCardStates {
	const { rules, associationSource } = useForbiddenRulesStore.getState();
	return selectCategoryCardStates(useCategoriesStore.getState().categories, rules, associationSource, selectActiveCharacter(useCharactersStore.getState()));
}

/** The filter facts of a category now (undefined for an unknown category). */
function filterFactsNow(key: CategoryKey): CategoryFilterFacts | undefined {
	const category = findCategory(useCategoriesStore.getState().categories, key);
	return category && filterFactsOf(category, cardStatesNow(), selectCurrentSelectionIndex(useOutputsStore.getState()));
}

export const useBoardStore = create<BoardStore>()(
	persist(
		(set, get) => ({
			...EMPTY_BOARD,
			filter: NO_BOARD_FILTER,
			revealRequest: null,
			lastRevealSerial: 0,
			setQuery: (query) => {
				if (get().filter.query !== query) {
					set((state) => ({ filter: { ...state.filter, query } }));
				}
			},
			setStateFilter: (stateFilter) => {
				if (get().filter.state !== stateFilter) {
					set((state) => ({ filter: { ...state.filter, state: stateFilter } }));
				}
			},
			clearFilter: () => {
				if (isBoardFilterActive(get().filter)) {
					set({ filter: NO_BOARD_FILTER });
				}
			},
			moveCategoryNextTo: (key, target, placement) => {
				const order = resolveBoardOrder(get().order, categoryKeysNow());
				const next = moveKeyNextTo(order, key, target, placement);
				const moved = !sameKeys(next, order);
				if (!sameKeys(next, get().order)) {
					set({ order: next });
				}
				const position = boardPositionOf(visibleCategoryKeysNow(), key);
				return position && { ...position, moved };
			},
			moveCategory: (key, move) => {
				const visible = visibleCategoryKeysNow();
				const target = boardMoveTarget(visible, key, move);
				if (target) {
					return get().moveCategoryNextTo(key, target.target, target.placement);
				}
				const position = boardPositionOf(visible, key);
				return position && { ...position, moved: false };
			},
			setOrder: (keys) => set({ order: [...keys] }),
			setCollapsed: (key, collapsed) => {
				const isCollapsed = get().collapsed.includes(key);
				if (isCollapsed !== collapsed) {
					set((state) => ({ collapsed: collapsed ? [...state.collapsed, key] : removeKeyFrom(state.collapsed, key) }));
				}
			},
			toggleCollapsed: (key) => get().setCollapsed(key, !get().collapsed.includes(key)),
			setAllCollapsed: (collapsed) => set({ collapsed: collapsed ? resolveBoardOrder(get().order, categoryKeysNow()) : [] }),
			renameCategoryKey: (from, to) =>
				set((state) => ({
					order: renameKeyIn(state.order, from, to),
					collapsed: renameKeyIn(state.collapsed, from, to),
					revealRequest: state.revealRequest?.key === from ? { ...state.revealRequest, key: to } : state.revealRequest,
				})),
			forgetCategory: (key) =>
				set((state) => ({
					order: removeKeyFrom(state.order, key),
					collapsed: removeKeyFrom(state.collapsed, key),
					revealRequest: state.revealRequest?.key === key ? null : state.revealRequest,
				})),
			revealCategory: (key, options = {}) => {
				const serial = get().lastRevealSerial + 1;
				set((state) => ({
					filter: filterRevealing(state.filter, filterFactsNow(key)),
					collapsed: removeKeyFrom(state.collapsed, key),
					revealRequest: { key, serial, editName: options.editName ?? false },
					lastRevealSerial: serial,
				}));
				useLayoutStore.getState().setRegionCollapsed('board', false);
			},
			completeReveal: (serial) => {
				if (get().revealRequest?.serial === serial) {
					set({ revealRequest: null });
				}
			},
			importLegacyWorkspace: (legacy) => set(boardFromLegacyWorkspace(legacy)),
		}),
		persistedStoreOptions<BoardStore, BoardPersistedState>({
			name: STORE_NAMES.board,
			version: 0,
			partialize: (state) => ({ order: state.order, collapsed: state.collapsed }),
			merge: (persisted, current) => (persisted === undefined ? current : { ...current, ...sanitizeBoard(persisted) }),
			legacy: {
				names: LEGACY_WORKSPACE_STORE_NAMES,
				combine: (envelopes) => {
					const legacy = legacyWorkspaceFromEnvelopes(envelopes);
					return legacy ? { state: boardFromLegacyWorkspace(legacy), version: 0 } : null;
				},
			},
		}),
	),
);

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

/** The keys of the cards the board shows now (read at call time; actions and tests). */
export function visibleCategoryKeysNow(): CategoryKey[] {
	const { order, filter } = useBoardStore.getState();
	return visibleKeysOf(order, filter, useCategoriesStore.getState().categories, cardStatesNow(), selectCurrentSelectionIndex(useOutputsStore.getState()));
}

/** Every category key in board order. */
export function useBoardOrder(): CategoryKey[] {
	const order = useBoardStore((state) => state.order);
	const keys = useCategoriesStore(useShallow(selectCategoryKeys));
	return useMemo(() => resolveBoardOrder(order, keys), [order, keys]);
}

/** The keys of the cards the board shows: board order, filtered by the search and the state filter (card states of
 *  every category computed once: forbiddenRulesStore selectCategoryCardStates; "used by the current output": the
 *  outputs store's selection index). */
export function useVisibleCategoryKeys(): CategoryKey[] {
	const order = useBoardStore((state) => state.order);
	const filter = useBoardStore((state) => state.filter);
	const categories = useCategoriesStore((state) => state.categories);
	const cards = useCategoryCardStates();
	const selections = useOutputsStore(selectCurrentSelectionIndex);
	const keys = useMemo(() => visibleKeysOf(order, filter, categories, cards, selections), [order, filter, categories, cards, selections]);
	// The same array while the shown keys are the same (card states change with every association pick).
	const previous = useRef(keys);
	if (previous.current !== keys && !sameKeys(previous.current, keys)) {
		previous.current = keys;
	}
	return previous.current;
}

function sameKeys(left: readonly CategoryKey[], right: readonly CategoryKey[]): boolean {
	return left.length === right.length && left.every((key, index) => key === right[index]);
}

export function useIsBoardFilterActive(): boolean {
	return useBoardStore((state) => isBoardFilterActive(state.filter));
}

export function useIsCardCollapsed(key: CategoryKey): boolean {
	return useBoardStore((state) => state.collapsed.includes(key));
}

/** Whether any card is collapsed / any card is expanded (the Collapse all and Expand all commands). */
export function useCollapseSummary(): { anyCollapsed: boolean; anyExpanded: boolean } {
	const collapsed = useBoardStore((state) => state.collapsed);
	const keys = useCategoriesStore(useShallow(selectCategoryKeys));
	return useMemo(() => {
		const set = new Set(collapsed);
		const collapsedCount = keys.filter((key) => set.has(key)).length;
		return { anyCollapsed: collapsedCount > 0, anyExpanded: collapsedCount < keys.length };
	}, [collapsed, keys]);
}

/** The pending reveal request of `key` (null when there is none or it is another card's). */
export function useCardRevealRequest(key: CategoryKey): RevealRequest | null {
	return useBoardStore((state) => (state.revealRequest?.key === key ? state.revealRequest : null));
}
