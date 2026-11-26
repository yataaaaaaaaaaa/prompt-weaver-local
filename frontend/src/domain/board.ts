// Prompt board domain: the arrangement of the category cards in the Create section's board (their order, which cards
// are collapsed), the search / state filter, reordering (drag and drop, keyboard) and the derivation of the initial
// arrangement from the legacy floating workspace (window positions, top-to-bottom then left-to-right). The board store
// (src/stores/boardStore.ts) is the only state holder; this module is pure.
//
// The board arranges categories; it never owns them: the categories store owns which categories exist. The stored
// order may miss categories (new ones) or name categories that no longer exist; resolveBoardOrder reconciles both.
// The board order is a display order only: generation order is the categories' priority (src/domain/categories.ts
// compareCategories); "Sort by priority" (Ctrl+O, categoriesStore.reorganize) aligns the two.
import type { Category, CategoryKey, CategoryUiState } from './categories';
import { recordOr } from './guards';
import { categoryKeyOfLegacyWindow, type LegacyWindowLayout, type LegacyWindowLayouts, type LegacyWorkspaceState } from './legacyLayout';
import { textContains, uniqueStrings } from './text';

/** The persisted state of the board store ('board-store', version 0). */
export type BoardPersistedState = {
	/** Category keys in board order (may be incomplete or stale: resolveBoardOrder). */
	order: CategoryKey[];
	/** Category keys whose card is collapsed to its header. */
	collapsed: CategoryKey[];
};

export const EMPTY_BOARD: BoardPersistedState = { order: [], collapsed: [] };

function stringList(value: unknown): string[] {
	return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === 'string')) : [];
}

/** Persisted (or migrated) data -> a valid board state. */
export function sanitizeBoard(value: unknown): BoardPersistedState {
	const raw = recordOr(value);
	return { order: stringList(raw.order), collapsed: stringList(raw.collapsed) };
}

/** The board order of the existing categories: the stored keys that still exist, in stored order, then the other
 *  existing keys in `keys` order (categories store order: a new category comes last). */
export function resolveBoardOrder(order: readonly CategoryKey[], keys: readonly CategoryKey[]): CategoryKey[] {
	const existing = new Set(keys);
	const placed = order.filter((key) => existing.has(key));
	const placedSet = new Set(placed);
	return [...placed, ...keys.filter((key) => !placedSet.has(key))];
}

export type Placement = 'before' | 'after';

/** `keys` with `key` moved right before / after `target` (both must be in `keys`; else `keys` unchanged). */
export function moveKeyNextTo(keys: readonly CategoryKey[], key: CategoryKey, target: CategoryKey, placement: Placement): CategoryKey[] {
	if (key === target || !keys.includes(key) || !keys.includes(target)) {
		return [...keys];
	}
	const without = keys.filter((item) => item !== key);
	const index = without.indexOf(target) + (placement === 'after' ? 1 : 0);
	return [...without.slice(0, index), key, ...without.slice(index)];
}

/** `list` with `from` renamed to `to` (same position; a duplicate `to` is dropped). */
export function renameKeyIn(list: readonly CategoryKey[], from: CategoryKey, to: CategoryKey): CategoryKey[] {
	return uniqueStrings(list.map((key) => (key === from ? to : key)));
}

export function removeKeyFrom(list: readonly CategoryKey[], key: CategoryKey): CategoryKey[] {
	return list.filter((item) => item !== key);
}

// ---------------------------------------------------------------------------
// Reordering: keyboard moves and drop placement, always relative to the cards the board shows (a filter may hide
// some: the moved card lands next to its shown neighbor, the hidden ones keep their place in the full order)
// ---------------------------------------------------------------------------

/** A keyboard move of a card among the shown cards. */
export type BoardMove = 'previous' | 'next' | 'first' | 'last';

/** The keys of a reorder handle: ArrowLeft / ArrowUp = previous, ArrowRight / ArrowDown = next, Home = first,
 *  End = last. */
const MOVE_KEYS: ReadonlyMap<string, BoardMove> = new Map([
	['ArrowLeft', 'previous'],
	['ArrowUp', 'previous'],
	['ArrowRight', 'next'],
	['ArrowDown', 'next'],
	['Home', 'first'],
	['End', 'last'],
]);

/** The move of a key press on a reorder handle (KeyboardEvent.key), null for any other key. */
export function boardMoveForKey(key: string): BoardMove | null {
	return MOVE_KEYS.get(key) ?? null;
}

/** Where `move` puts `key` among the shown cards `visible`: right before the previous / first card, right after the
 *  next / last card. Null when the card is not shown or already at that end. */
export function boardMoveTarget(
	visible: readonly CategoryKey[],
	key: CategoryKey,
	move: BoardMove,
): { target: CategoryKey; placement: Placement } | null {
	const index = visible.indexOf(key);
	const last = visible.length - 1;
	if (index < 0) {
		return null;
	}
	switch (move) {
		case 'previous':
			return index > 0 ? { target: visible[index - 1], placement: 'before' } : null;
		case 'next':
			return index < last ? { target: visible[index + 1], placement: 'after' } : null;
		case 'first':
			return index > 0 ? { target: visible[0], placement: 'before' } : null;
		case 'last':
			return index < last ? { target: visible[last], placement: 'after' } : null;
	}
}

/** 1-based position of a card among the shown cards. */
export type BoardPosition = { position: number; total: number };

export function boardPositionOf(visible: readonly CategoryKey[], key: CategoryKey): BoardPosition | null {
	const index = visible.indexOf(key);
	return index < 0 ? null : { position: index + 1, total: visible.length };
}

/** The outcome of a reorder: the card's position among the shown cards, and whether the order changed (a move past an
 *  end, or a drop next to its own place, changes nothing). */
export type BoardMoveResult = BoardPosition & { moved: boolean };

/** The announcement of a reorder for screen readers: 'Subject moved to position 3 of 7', or 'Subject is at position 1
 *  of 7' when nothing moved. */
export function boardMoveAnnouncement(name: string, result: BoardMoveResult): string {
	return `${name} ${result.moved ? 'moved to' : 'is at'} position ${result.position} of ${result.total}`;
}

/** Drop placement of a dragged card on the card under the pointer. The grid flows left to right, then top to bottom:
 *  with several columns the pointer's half of the card (left / right) decides, in a single column its top / bottom
 *  half. */
export function dropPlacementAt(
	point: { x: number; y: number },
	card: { left: number; top: number; width: number; height: number },
	singleColumn: boolean,
): Placement {
	if (singleColumn) {
		return point.y < card.top + card.height / 2 ? 'before' : 'after';
	}
	return point.x < card.left + card.width / 2 ? 'before' : 'after';
}

// ---------------------------------------------------------------------------
// Search and state filter
// ---------------------------------------------------------------------------

/** The state filter of the board ('any' = no state filter). */
export const BOARD_STATE_FILTERS = ['any', 'current', 'locked', 'forbidden', 'associated', 'indirectlyDisabled', 'skipped'] as const;
export type BoardStateFilter = (typeof BOARD_STATE_FILTERS)[number];

export const BOARD_STATE_FILTER_LABELS: Readonly<Record<BoardStateFilter, string>> = {
	any: 'Any state',
	current: 'Used by the current output',
	locked: 'With a locked sub-prompt',
	forbidden: 'Forbidden with the association source',
	associated: 'Association source',
	indirectlyDisabled: 'Indirectly disabled',
	skipped: 'Skipped',
};

export function isBoardStateFilter(value: unknown): value is BoardStateFilter {
	return typeof value === 'string' && (BOARD_STATE_FILTERS as readonly string[]).includes(value);
}

export type BoardFilter = { query: string; state: BoardStateFilter };

export const NO_BOARD_FILTER: BoardFilter = { query: '', state: 'any' };

export function isBoardFilterActive(filter: BoardFilter): boolean {
	return filter.query.trim() !== '' || filter.state !== 'any';
}

/** What the filter looks at for one category (gathered by the board store from the owning stores: the card facts of
 *  forbiddenRulesStore selectCategoryCardStates and the current output's selections of the outputs store). */
export type CategoryFilterFacts = {
	category: Category;
	/** Reachability state of the category ('indirectly-disabled': activation text, locks, forbidden rules). */
	uiState: CategoryUiState;
	/** One of its sub-prompts is forbidden together with the association source (red, or purple with a lock). */
	forbidden: boolean;
	/** The association source belongs to it. */
	associationSource: boolean;
	/** A sub-prompt of it was used by the output being viewed. */
	usedByCurrentOutput: boolean;
};

/** The category matches the search (case- and whitespace-insensitive, in its name, activation text or any sub-prompt
 *  text) and the state filter:
 *  - current: a sub-prompt of it was used by the output being viewed;
 *  - locked: it has a locked sub-prompt;
 *  - forbidden: a sub-prompt of it is forbidden with the association source (red or purple card);
 *  - associated: the association source belongs to it (green card), even when a stronger state shows;
 *  - indirectlyDisabled: it can never be selected (amber card);
 *  - skipped: the category itself is skipped. */
export function matchesBoardFilter(facts: CategoryFilterFacts, filter: BoardFilter): boolean {
	const query = filter.query.trim();
	const { category } = facts;
	const matchesQuery =
		query === '' ||
		textContains(category.text, query) ||
		textContains(category.activation_text, query) ||
		category.subPrompts.some((subPrompt) => textContains(subPrompt.text, query));
	if (!matchesQuery) {
		return false;
	}
	switch (filter.state) {
		case 'any':
			return true;
		case 'current':
			return facts.usedByCurrentOutput;
		case 'locked':
			return category.subPrompts.some((subPrompt) => subPrompt.state === 'lock');
		case 'forbidden':
			return facts.forbidden;
		case 'associated':
			return facts.associationSource;
		case 'indirectlyDisabled':
			return facts.uiState === 'indirectly-disabled';
		case 'skipped':
			return category.state === 'skip';
	}
}

/** The shown keys of `ordered` (board order kept): all of them without an active filter, else those whose facts match
 *  (`factsOf` undefined = an unknown category, never shown under a filter). */
export function filterBoardKeys(
	ordered: readonly CategoryKey[],
	filter: BoardFilter,
	factsOf: (key: CategoryKey) => CategoryFilterFacts | undefined,
): CategoryKey[] {
	if (!isBoardFilterActive(filter)) {
		return [...ordered];
	}
	return ordered.filter((key) => {
		const facts = factsOf(key);
		return facts !== undefined && matchesBoardFilter(facts, filter);
	});
}

/** The filter to keep when a card is revealed: the same filter when the category matches it (or nothing is filtered),
 *  else no filter (a revealed card is never left hidden by the filter). */
export function filterRevealing(filter: BoardFilter, facts: CategoryFilterFacts | undefined): BoardFilter {
	if (!isBoardFilterActive(filter) || (facts !== undefined && matchesBoardFilter(facts, filter))) {
		return filter;
	}
	return NO_BOARD_FILTER;
}

// ---------------------------------------------------------------------------
// Legacy floating workspace -> board
// ---------------------------------------------------------------------------

/** Windows whose tops are at most this far apart belong to the same row of the legacy layout (users lined their
 *  windows up by hand: tops a few pixels apart; a window placed a third of a window lower started a new row). */
export const LEGACY_ROW_TOLERANCE_PX = 64;

type PlacedWindow = { key: CategoryKey; layout: LegacyWindowLayout };

/** Reading order inside a row: left to right; at the same left, the higher one; at the same position, the one in
 *  front (higher z: the one the user saw), then by key (deterministic). */
function compareInRow(left: PlacedWindow, right: PlacedWindow): number {
	return (
		left.layout.x - right.layout.x ||
		left.layout.y - right.layout.y ||
		right.layout.z - left.layout.z ||
		(left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
	);
}

/** The category keys of the legacy category windows, top-to-bottom then left-to-right: windows are sorted by top,
 *  grouped into rows (a window starts a new row when its top is more than LEGACY_ROW_TOLERANCE_PX below the top of the
 *  row's first window), each row read left to right (compareInRow). Overlapping windows follow the same rule as the
 *  others. Pane windows are ignored; the keys may name deleted categories (resolveBoardOrder drops them) and miss
 *  categories without a window (resolveBoardOrder appends them). */
export function orderFromLegacyWindows(windows: LegacyWindowLayouts): CategoryKey[] {
	const placed = Object.entries(windows)
		.map(([key, layout]) => ({ key: categoryKeyOfLegacyWindow(key), layout }))
		.filter((entry): entry is PlacedWindow => entry.key !== null && entry.layout !== undefined)
		.sort((left, right) => left.layout.y - right.layout.y || compareInRow(left, right));
	const rows: PlacedWindow[][] = [];
	for (const entry of placed) {
		const row = rows[rows.length - 1];
		if (row && entry.layout.y - row[0].layout.y <= LEGACY_ROW_TOLERANCE_PX) {
			row.push(entry);
		} else {
			rows.push([entry]);
		}
	}
	return rows.flatMap((row) => [...row].sort(compareInRow).map((entry) => entry.key));
}

/** The board derived once from the legacy floating workspace: the order of the category windows
 *  (orderFromLegacyWindows); every card expanded (the floating windows had no collapsed state); free positions and
 *  sizes are dropped. */
export function boardFromLegacyWorkspace(legacy: LegacyWorkspaceState): BoardPersistedState {
	return { order: orderFromLegacyWindows(legacy.windows), collapsed: [] };
}
