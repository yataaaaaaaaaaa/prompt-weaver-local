import { describe, expect, it } from 'vitest';
import type { Category } from './categories';
import {
	BOARD_STATE_FILTERS,
	boardFromLegacyWorkspace,
	boardMoveAnnouncement,
	boardMoveForKey,
	boardMoveTarget,
	boardPositionOf,
	dropPlacementAt,
	filterBoardKeys,
	filterRevealing,
	isBoardFilterActive,
	isBoardStateFilter,
	matchesBoardFilter,
	moveKeyNextTo,
	NO_BOARD_FILTER,
	orderFromLegacyWindows,
	removeKeyFrom,
	renameKeyIn,
	resolveBoardOrder,
	sanitizeBoard,
	type BoardStateFilter,
	type CategoryFilterFacts,
} from './board';
import { legacyWorkspaceWindows } from './legacyImport';
import type { LegacyWindowLayouts } from './legacyLayout';

const category = (text: string, extra: Partial<Category> = {}): Category => ({
	text,
	activation_text: '',
	priority: 1,
	state: 'normal',
	subPrompts: [{ text: 'red hair', state: 'normal', extraLoraIds: [] }],
	...extra,
});

describe('resolveBoardOrder', () => {
	it('keeps the stored order of existing keys and appends the others in categories order', () => {
		expect(resolveBoardOrder(['c', 'gone', 'a'], ['a', 'b', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd']);
		expect(resolveBoardOrder([], ['a', 'b'])).toEqual(['a', 'b']);
		expect(resolveBoardOrder(['gone'], [])).toEqual([]);
	});
});

describe('moveKeyNextTo / renameKeyIn / removeKeyFrom', () => {
	it('moves a key before or after another one', () => {
		expect(moveKeyNextTo(['a', 'b', 'c', 'd'], 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
		expect(moveKeyNextTo(['a', 'b', 'c', 'd'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
		expect(moveKeyNextTo(['a', 'b', 'c', 'd'], 'a', 'd', 'after')).toEqual(['b', 'c', 'd', 'a']);
		expect(moveKeyNextTo(['a', 'b', 'c', 'd'], 'd', 'a', 'before')).toEqual(['d', 'a', 'b', 'c']);
		expect(moveKeyNextTo(['a', 'b'], 'a', 'a', 'after')).toEqual(['a', 'b']);
		expect(moveKeyNextTo(['a', 'b'], 'x', 'a', 'after')).toEqual(['a', 'b']);
		expect(moveKeyNextTo(['a', 'b'], 'a', 'x', 'after')).toEqual(['a', 'b']);
	});

	it('renames in place and removes', () => {
		expect(renameKeyIn(['a', 'b', 'c'], 'b', 'z')).toEqual(['a', 'z', 'c']);
		expect(renameKeyIn(['a', 'b'], 'b', 'a')).toEqual(['a']);
		expect(removeKeyFrom(['a', 'b'], 'a')).toEqual(['b']);
	});
});

describe('sanitizeBoard', () => {
	it('keeps unique string keys only', () => {
		expect(sanitizeBoard({ order: ['a', 'a', 3, 'b'], collapsed: 'x' })).toEqual({ order: ['a', 'b'], collapsed: [] });
		expect(sanitizeBoard(undefined)).toEqual({ order: [], collapsed: [] });
		expect(sanitizeBoard([1, 2])).toEqual({ order: [], collapsed: [] });
	});
});

describe('keyboard reorder', () => {
	it('maps the reorder keys: arrows to the neighbors, Home / End to the ends', () => {
		expect(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'].map(boardMoveForKey)).toEqual([
			'previous',
			'previous',
			'next',
			'next',
			'first',
			'last',
		]);
		expect(boardMoveForKey('Enter')).toBeNull();
		expect(boardMoveForKey('constructor')).toBeNull();
	});

	it('moves before the previous / first shown card, after the next / last one; nothing at an end', () => {
		const shown = ['a', 'c', 'e'];
		expect(boardMoveTarget(shown, 'c', 'previous')).toEqual({ target: 'a', placement: 'before' });
		expect(boardMoveTarget(shown, 'c', 'next')).toEqual({ target: 'e', placement: 'after' });
		expect(boardMoveTarget(shown, 'e', 'first')).toEqual({ target: 'a', placement: 'before' });
		expect(boardMoveTarget(shown, 'a', 'last')).toEqual({ target: 'e', placement: 'after' });
		expect(boardMoveTarget(shown, 'a', 'previous')).toBeNull();
		expect(boardMoveTarget(shown, 'a', 'first')).toBeNull();
		expect(boardMoveTarget(shown, 'e', 'next')).toBeNull();
		expect(boardMoveTarget(shown, 'e', 'last')).toBeNull();
		expect(boardMoveTarget(shown, 'b', 'next')).toBeNull();
	});

	it('a move relative to the shown neighbors keeps the hidden cards in place', () => {
		// 'b' and 'd' are hidden by a filter: 'e' moved before its shown neighbor 'c' lands right before it.
		const target = boardMoveTarget(['a', 'c', 'e'], 'e', 'previous');
		expect(target).not.toBeNull();
		expect(moveKeyNextTo(['a', 'b', 'c', 'd', 'e'], 'e', target!.target, target!.placement)).toEqual(['a', 'b', 'e', 'c', 'd']);
	});

	it('positions and announcements', () => {
		expect(boardPositionOf(['a', 'b', 'c'], 'c')).toEqual({ position: 3, total: 3 });
		expect(boardPositionOf(['a'], 'x')).toBeNull();
		expect(boardMoveAnnouncement('Subject', { position: 3, total: 7, moved: true })).toBe('Subject moved to position 3 of 7');
		expect(boardMoveAnnouncement('Subject', { position: 1, total: 7, moved: false })).toBe('Subject is at position 1 of 7');
	});
});

describe('dropPlacementAt', () => {
	const card = { left: 100, top: 200, width: 300, height: 120 };

	it('uses the horizontal half in a grid of several columns, the vertical half in a single column', () => {
		expect(dropPlacementAt({ x: 120, y: 310 }, card, false)).toBe('before');
		expect(dropPlacementAt({ x: 380, y: 210 }, card, false)).toBe('after');
		expect(dropPlacementAt({ x: 380, y: 210 }, card, true)).toBe('before');
		expect(dropPlacementAt({ x: 120, y: 310 }, card, true)).toBe('after');
	});
});

describe('matchesBoardFilter', () => {
	const facts = (extra: Partial<Category> = {}, more: Partial<CategoryFilterFacts> = {}): CategoryFilterFacts => ({
		category: category('Hair', extra),
		uiState: extra.state ?? 'normal',
		forbidden: false,
		associationSource: false,
		usedByCurrentOutput: false,
		...more,
	});
	const state = (value: BoardStateFilter) => ({ query: '', state: value });

	it('matches the name, the activation text and the sub-prompt texts, ignoring case and spaces', () => {
		expect(isBoardFilterActive(NO_BOARD_FILTER)).toBe(false);
		expect(isBoardFilterActive({ query: '  ', state: 'any' })).toBe(false);
		expect(isBoardFilterActive({ query: 'a', state: 'any' })).toBe(true);
		expect(isBoardFilterActive(state('skipped'))).toBe(true);
		expect(matchesBoardFilter(facts(), { query: 'HAIR', state: 'any' })).toBe(true);
		expect(matchesBoardFilter(facts(), { query: ' red  hair ', state: 'any' })).toBe(true);
		expect(matchesBoardFilter(facts({ activation_text: 'girl' }), { query: 'girl', state: 'any' })).toBe(true);
		expect(matchesBoardFilter(facts(), { query: 'pose', state: 'any' })).toBe(false);
		expect(matchesBoardFilter(facts(), NO_BOARD_FILTER)).toBe(true);
	});

	it('every state filter has its own rule', () => {
		const plain = facts();
		const expectations: Record<BoardStateFilter, [CategoryFilterFacts, boolean][]> = {
			any: [[plain, true]],
			current: [
				[facts({}, { usedByCurrentOutput: true }), true],
				[plain, false],
			],
			locked: [
				[facts({ subPrompts: [{ text: 'a', state: 'lock', extraLoraIds: [] }] }), true],
				[facts({ subPrompts: [{ text: 'a', state: 'skip', extraLoraIds: [] }] }), false],
			],
			// Red and purple cards: forbidden with the association source.
			forbidden: [
				[facts({}, { forbidden: true }), true],
				[facts({}, { forbidden: true, associationSource: true }), true],
				[plain, false],
			],
			// The source's own card, even when one of its other sub-prompts is forbidden with the source (red wins on it).
			associated: [
				[facts({}, { associationSource: true }), true],
				[facts({}, { associationSource: true, forbidden: true }), true],
				[facts({}, { forbidden: true }), false],
			],
			indirectlyDisabled: [
				[facts({}, { uiState: 'indirectly-disabled' }), true],
				[facts({ state: 'skip' }), false],
				[plain, false],
			],
			skipped: [
				[facts({ state: 'skip' }), true],
				[facts({ subPrompts: [{ text: 'a', state: 'skip', extraLoraIds: [] }] }), false],
				[facts({}, { uiState: 'indirectly-disabled' }), false],
			],
		};
		expect(Object.keys(expectations)).toEqual([...BOARD_STATE_FILTERS]);
		for (const filter of BOARD_STATE_FILTERS) {
			for (const [input, expected] of expectations[filter]) {
				expect(matchesBoardFilter(input, state(filter)), `${filter}: ${JSON.stringify(input)}`).toBe(expected);
			}
		}
	});

	it('combines the search and the state filter', () => {
		const skipped = facts({ state: 'skip' });
		expect(matchesBoardFilter(skipped, { query: 'red', state: 'skipped' })).toBe(true);
		expect(matchesBoardFilter(skipped, { query: 'blue', state: 'skipped' })).toBe(false);
		expect(matchesBoardFilter(facts(), { query: 'red', state: 'skipped' })).toBe(false);
	});

	it('recognises the state filter ids', () => {
		expect(BOARD_STATE_FILTERS.every(isBoardStateFilter)).toBe(true);
		expect(isBoardStateFilter('window')).toBe(false);
		expect(isBoardStateFilter(3)).toBe(false);
	});
});

describe('filterBoardKeys / filterRevealing', () => {
	const byKey: Record<string, CategoryFilterFacts> = {
		hair: { category: category('Hair'), uiState: 'normal', forbidden: false, associationSource: false, usedByCurrentOutput: true },
		pose: { category: category('Pose', { state: 'skip' }), uiState: 'skip', forbidden: false, associationSource: false, usedByCurrentOutput: false },
		eyes: { category: category('Eyes'), uiState: 'normal', forbidden: false, associationSource: false, usedByCurrentOutput: false },
	};
	const factsOf = (key: string) => byKey[key];

	it('keeps the board order; shows everything without a filter; unknown categories never match a filter', () => {
		expect(filterBoardKeys(['pose', 'hair', 'gone'], NO_BOARD_FILTER, factsOf)).toEqual(['pose', 'hair', 'gone']);
		expect(filterBoardKeys(['pose', 'eyes', 'hair', 'gone'], { query: '', state: 'skipped' }, factsOf)).toEqual(['pose']);
		expect(filterBoardKeys(['pose', 'eyes', 'hair', 'gone'], { query: 'e', state: 'any' }, factsOf)).toEqual(['pose', 'eyes', 'hair']);
		expect(filterBoardKeys(['pose', 'hair'], { query: '', state: 'current' }, factsOf)).toEqual(['hair']);
	});

	it('a revealed card clears only a filter that hides it', () => {
		const skippedFilter = { query: '', state: 'skipped' as const };
		expect(filterRevealing(skippedFilter, byKey.pose)).toBe(skippedFilter);
		expect(filterRevealing(skippedFilter, byKey.hair)).toEqual(NO_BOARD_FILTER);
		expect(filterRevealing({ query: 'hair', state: 'any' }, byKey.hair)).toEqual({ query: 'hair', state: 'any' });
		expect(filterRevealing({ query: 'hair', state: 'any' }, undefined)).toEqual(NO_BOARD_FILTER);
		expect(filterRevealing(NO_BOARD_FILTER, undefined)).toBe(NO_BOARD_FILTER);
	});
});

describe('legacy floating workspace -> board', () => {
	// The e2e fixture's legacy workspace-store (backend/tests/e2e/fixtures/data/stores/workspace-store).
	const fixtureWindows: LegacyWindowLayouts = {
		'pane:image': { x: 16, y: 16, width: 420, height: 400, z: 1 },
		'category:subject': { x: 880, y: 16, width: 500, height: 256, z: 8 },
		'category:outfit': { x: 880, y: 284, width: 500, height: 296, z: 9 },
		'category:mood': { x: 880, y: 592, width: 500, height: 256, z: 10 },
		'category:background': { x: 1392, y: 16, width: 512, height: 256, z: 11 },
		'category:weather-effects': { x: 1392, y: 284, width: 512, height: 216, z: 12 },
		'category:lighting': { x: 1392, y: 512, width: 512, height: 216, z: 13 },
		'category:sea-creatures': { x: 1392, y: 740, width: 512, height: 216, z: 14 },
	};

	it('orders the category windows top-to-bottom, then left-to-right within a row', () => {
		expect(orderFromLegacyWindows(fixtureWindows)).toEqual(['subject', 'background', 'outfit', 'weather-effects', 'lighting', 'mood', 'sea-creatures']);
	});

	// Synthetic, shaped like a long-used real workspace: 40 category windows (3 of deleted categories) on a canvas
	// three screens tall, lined up by hand into rows (tops a few pixels apart), some rows sharing exact tops, windows
	// overlapping their neighbors (a tall row slid under the next one), two windows stacked at the same position, two
	// windows at the same left a little apart vertically, and the pane windows of the old workspace.
	const realShaped: LegacyWindowLayouts = {
		'pane:image': { x: 41, y: 13, width: 643, height: 979, z: 2 },
		'pane:controls': { x: 690, y: 8, width: 520, height: 900, z: 3 },
		'pane:used': { x: 1220, y: 8, width: 600, height: 500, z: 4 },
		// row 1: tops 12 px apart, read left to right
		'category:quality': { x: 760, y: 24, width: 780, height: 286, z: 40 },
		'category:subject': { x: 200, y: 36, width: 660, height: 286, z: 12 },
		// row 2: a window 226 px lower than row 1 and 80 px above row 3: a row of its own
		'category:camera': { x: 560, y: 250, width: 500, height: 286, z: 13 },
		// row 3: equal tops
		'category:pose': { x: 1370, y: 330, width: 300, height: 286, z: 14 },
		'category:hair': { x: 24, y: 330, width: 500, height: 286, z: 15 },
		'category:eyes': { x: 1060, y: 330, width: 300, height: 286, z: 16 },
		// row 4: overlapping row 3 (slid 106 px under it)
		'category:outfit': { x: 1030, y: 436, width: 770, height: 286, z: 17 },
		'category:shoes': { x: 706, y: 450, width: 300, height: 268, z: 18 },
		// row 5
		'category:background': { x: 810, y: 620, width: 715, height: 286, z: 19 },
		'category:time': { x: 24, y: 628, width: 770, height: 286, z: 20 },
		// row 6: two tall windows; row 7 starts 72 px lower and covers them
		'category:weather': { x: 430, y: 858, width: 324, height: 360, z: 21 },
		'category:season': { x: 58, y: 860, width: 320, height: 360, z: 22 },
		'category:lighting': { x: 24, y: 930, width: 770, height: 294, z: 23 },
		'category:mood': { x: 808, y: 930, width: 500, height: 294, z: 24 },
		// rows 8-14: a regular grid
		'category:style': { x: 24, y: 1240, width: 770, height: 268, z: 25 },
		'category:artist': { x: 808, y: 1240, width: 770, height: 268, z: 26 },
		'category:medium': { x: 1592, y: 1240, width: 300, height: 268, z: 27 },
		'category:colors': { x: 24, y: 1524, width: 300, height: 268, z: 28 },
		'category:palette': { x: 340, y: 1524, width: 440, height: 268, z: 29 },
		'category:effects': { x: 1112, y: 1524, width: 308, height: 268, z: 30 },
		'category:frame': { x: 1436, y: 1524, width: 300, height: 268, z: 31 },
		'category:expression': { x: 24, y: 1808, width: 656, height: 286, z: 32 },
		'category:gesture': { x: 696, y: 1808, width: 665, height: 286, z: 33 },
		'category:accessory': { x: 24, y: 2110, width: 665, height: 286, z: 34 },
		// two windows stacked at the same position: the one in front first
		'category:hat': { x: 705, y: 2110, width: 665, height: 286, z: 35 },
		'category:hood': { x: 705, y: 2110, width: 665, height: 286, z: 36 },
		'category:props': { x: 24, y: 2412, width: 665, height: 286, z: 37 },
		'category:vehicle': { x: 705, y: 2412, width: 665, height: 286, z: 38 },
		'category:animal': { x: 24, y: 2714, width: 665, height: 286, z: 39 },
		'category:creature': { x: 705, y: 2714, width: 665, height: 286, z: 41 },
		'category:location': { x: 24, y: 3016, width: 665, height: 286, z: 42 },
		'category:architecture': { x: 705, y: 3016, width: 326, height: 286, z: 43 },
		'category:nature': { x: 1047, y: 3016, width: 608, height: 286, z: 44 },
		// row 15: two windows at the same left, 50 px apart: the higher one first
		'category:angle': { x: 24, y: 3318, width: 500, height: 286, z: 45 },
		'category:composition': { x: 24, y: 3268, width: 665, height: 280, z: 46 },
		'category:focus': { x: 540, y: 3318, width: 398, height: 286, z: 47 },
		'category:depth': { x: 954, y: 3318, width: 300, height: 286, z: 48 },
		'category:lens': { x: 1270, y: 3318, width: 500, height: 286, z: 49 },
		// row 16: windows of deleted categories mixed in
		'category:deleted-one': { x: 24, y: 3620, width: 300, height: 286, z: 50 },
		'category:extras': { x: 1124, y: 3620, width: 554, height: 286, z: 51 },
		'category:deleted-two': { x: 808, y: 3620, width: 300, height: 286, z: 52 },
		'category:deleted-three': { x: 1700, y: 3640, width: 300, height: 286, z: 53 },
	};
	const realShapedOrder = [
		'subject', 'quality',
		'camera',
		'hair', 'eyes', 'pose',
		'shoes', 'outfit',
		'time', 'background',
		'season', 'weather',
		'lighting', 'mood',
		'style', 'artist', 'medium',
		'colors', 'palette', 'effects', 'frame',
		'expression', 'gesture',
		'accessory', 'hood', 'hat',
		'props', 'vehicle',
		'animal', 'creature',
		'location', 'architecture', 'nature',
		'composition', 'angle', 'focus', 'depth', 'lens',
		'deleted-one', 'deleted-two', 'extras', 'deleted-three',
	];

	it('reads a real-shaped layout row by row: overlapping windows, equal tops, stacked windows, panes ignored', () => {
		expect(orderFromLegacyWindows(realShaped)).toEqual(realShapedOrder);
	});

	it('does not depend on the order of the entries', () => {
		const reversed = Object.fromEntries(Object.entries(realShaped).reverse()) as LegacyWindowLayouts;
		expect(orderFromLegacyWindows(reversed)).toEqual(realShapedOrder);
	});

	it('the resolved board order drops deleted categories and appends categories without a window', () => {
		const existing = [...realShapedOrder.filter((key) => !key.startsWith('deleted-')), 'never-placed'].reverse();
		expect(resolveBoardOrder(orderFromLegacyWindows(realShaped), existing)).toEqual([
			...realShapedOrder.filter((key) => !key.startsWith('deleted-')),
			'never-placed',
		]);
	});

	it('derives the board from app_state.json category positions too (equal tops, a window 25 px lower)', () => {
		const placed = (name: string, x: number, y: number, zIndex: number) => ({
			id: name,
			name,
			muted: false,
			priority: '1',
			activation_text: '',
			locked_prompt_id: null,
			position: { x, y },
			size: { width: 300, height: 240 },
			z_index: zIndex,
			prompts: [],
		});
		const windows = legacyWorkspaceWindows({
			categories: [
				placed('Main', 24, 24, 210),
				placed('Clothed', 796, 24, 211),
				placed('Pose', 410, 24, 212),
				placed('Hair Color', 24, 268, 213),
				placed('Eyes', 796, 293, 214),
				placed('Mood', 410, 268, 215),
				placed('Time Of Day', 24, 525, 216),
			],
			workspace: { image: { x: 420, y: 8, width: 542, height: 928, z_index: 228 } },
		} as unknown as Parameters<typeof legacyWorkspaceWindows>[0]);

		expect(boardFromLegacyWorkspace({ windows, hiddenPaneIds: [] })).toEqual({
			order: ['main', 'pose', 'clothed', 'hair-color', 'mood', 'eyes', 'time-of-day'],
			collapsed: [],
		});
	});

	it('starts with every card expanded', () => {
		expect(boardFromLegacyWorkspace({ windows: fixtureWindows, hiddenPaneIds: ['models'] }).collapsed).toEqual([]);
		expect(boardFromLegacyWorkspace({ windows: {}, hiddenPaneIds: [] })).toEqual({ order: [], collapsed: [] });
	});
});
