import { describe, expect, it } from 'vitest';
import { CREATE_REGION_IDS } from '../app/sections';
import {
	clampRegionWidth,
	COLLAPSED_REGION_WIDTH,
	DEFAULT_CREATE_LAYOUT,
	fillRegion,
	fitRegions,
	generationPanelInset,
	hasSplitter,
	isLastExpandedRegion,
	isResizableRegion,
	layoutFromLegacyWorkspace,
	nextFocusLayout,
	REGION_MAX_WIDTH,
	REGION_MIN_WIDTH,
	regionWidthRange,
	sanitizeCreateLayout,
	withRegionCollapsed,
	type RegionBoxes,
	type RegionCollapsed,
	type RegionWidths,
} from './layout';
import { legacyWorkspaceFromEnvelopes } from './legacyLayout';

const ALL_EXPANDED: RegionCollapsed = { board: false, viewer: false, generation: false };
const total = (boxes: RegionBoxes) => CREATE_REGION_IDS.reduce((sum, region) => sum + boxes[region], 0);
const layoutWith = (widths: RegionWidths = DEFAULT_CREATE_LAYOUT.widths, collapsed: Partial<RegionCollapsed> = {}) => ({
	widths,
	collapsed: { ...ALL_EXPANDED, ...collapsed },
});
/** The regions row of the smallest supported window (1280 px) next to the navigation rail (80 px). */
const SMALL_WINDOW_ROW = 1280 - 80;

describe('sanitizeCreateLayout', () => {
	it('takes the default for anything unusable and clamps the widths', () => {
		expect(sanitizeCreateLayout(null)).toEqual(DEFAULT_CREATE_LAYOUT);
		expect(
			sanitizeCreateLayout({
				widths: { viewer: 10, generation: 'x' },
				collapsed: { board: true, viewer: 'no' },
				details: { open: false, tab: 'nope' },
			}),
		).toEqual({
			widths: { viewer: REGION_MIN_WIDTH.viewer, generation: DEFAULT_CREATE_LAYOUT.widths.generation },
			collapsed: { board: true, viewer: false, generation: false },
			details: { open: false, tab: 'details' },
		});
	});

	it('never restores a layout with every region collapsed: the board shows', () => {
		expect(sanitizeCreateLayout({ collapsed: { board: true, viewer: true, generation: true } }).collapsed).toEqual({
			board: false,
			viewer: true,
			generation: true,
		});
	});

	it('keeps a valid layout as it is', () => {
		const layout = {
			widths: { viewer: 700, generation: 420 },
			collapsed: { board: false, viewer: true, generation: false },
			details: { open: true, tab: 'used' as const },
		};
		expect(sanitizeCreateLayout(layout)).toEqual(layout);
	});
});

describe('clampRegionWidth', () => {
	it('keeps widths between the minimum and the maximum, rounded', () => {
		expect(clampRegionWidth('generation', 12)).toBe(REGION_MIN_WIDTH.generation);
		expect(clampRegionWidth('generation', 99_999)).toBe(REGION_MAX_WIDTH.generation);
		expect(clampRegionWidth('viewer', 512.6)).toBe(513);
	});
});

describe('nextFocusLayout (Ctrl+H)', () => {
	it('cycles all regions -> board only -> image and generation -> all regions', () => {
		const board = nextFocusLayout(ALL_EXPANDED);
		expect(board).toEqual({ board: false, viewer: true, generation: true });
		const output = nextFocusLayout(board);
		expect(output).toEqual({ board: true, viewer: false, generation: false });
		expect(nextFocusLayout(output)).toEqual(ALL_EXPANDED);
		expect(nextFocusLayout({ board: false, viewer: true, generation: false })).toEqual(ALL_EXPANDED);
	});

	it('never collapses every region', () => {
		let collapsed = ALL_EXPANDED;
		for (let press = 0; press < 6; press += 1) {
			collapsed = nextFocusLayout(collapsed);
			expect(fillRegion(collapsed)).not.toBeNull();
		}
	});
});

describe('fitRegions', () => {
	it('gives the viewer and the generation panel their stored widths and the board the rest', () => {
		const boxes = fitRegions(1840, layoutWith({ viewer: 600, generation: 400 }));

		expect(boxes).toEqual({ board: 840, viewer: 600, generation: 400 });
		expect(total(boxes)).toBe(1840);
	});

	it('rounds the measured width down: the regions never stick out by a fraction of a pixel', () => {
		expect(total(fitRegions(1500.75, layoutWith()))).toBe(1500);
	});

	it('shrinks the viewer first, then the generation panel, before the board leaves its minimum', () => {
		const layout = layoutWith({ viewer: 700, generation: 500 });

		// 1400: the viewer gives 120 px, the board keeps its minimum.
		expect(fitRegions(1400, layout)).toEqual({ board: REGION_MIN_WIDTH.board, viewer: 580, generation: 500 });
		// 1000: the viewer is at its minimum, the generation panel gives the rest.
		expect(fitRegions(1000, layout)).toEqual({ board: REGION_MIN_WIDTH.board, viewer: REGION_MIN_WIDTH.viewer, generation: 360 });
	});

	it('fits the default layout into the smallest supported window, every region at least at its minimum', () => {
		const boxes = fitRegions(SMALL_WINDOW_ROW, DEFAULT_CREATE_LAYOUT);

		expect(total(boxes)).toBe(SMALL_WINDOW_ROW);
		for (const region of CREATE_REGION_IDS) {
			expect(boxes[region], region).toBeGreaterThanOrEqual(REGION_MIN_WIDTH[region]);
		}
		// The generation panel keeps its stored width: only the viewer gave room.
		expect(boxes.generation).toBe(DEFAULT_CREATE_LAYOUT.widths.generation);
	});

	it('fits the widest stored widths into the smallest window too', () => {
		const boxes = fitRegions(SMALL_WINDOW_ROW, layoutWith(REGION_MAX_WIDTH));

		expect(total(boxes)).toBe(SMALL_WINDOW_ROW);
		expect(boxes.board).toBe(REGION_MIN_WIDTH.board);
	});

	it('draws collapsed regions as strips and gives their room to the board', () => {
		const boxes = fitRegions(1600, layoutWith(undefined, { viewer: true }));

		expect(boxes.viewer).toBe(COLLAPSED_REGION_WIDTH);
		expect(boxes.generation).toBe(DEFAULT_CREATE_LAYOUT.widths.generation);
		expect(boxes.board).toBe(1600 - COLLAPSED_REGION_WIDTH - DEFAULT_CREATE_LAYOUT.widths.generation);
	});

	it('lets the viewer take the rest while the board is collapsed, then the generation panel', () => {
		expect(fitRegions(1600, layoutWith(undefined, { board: true }))).toEqual({
			board: COLLAPSED_REGION_WIDTH,
			viewer: 1600 - COLLAPSED_REGION_WIDTH - DEFAULT_CREATE_LAYOUT.widths.generation,
			generation: DEFAULT_CREATE_LAYOUT.widths.generation,
		});
		expect(fitRegions(1600, layoutWith(undefined, { board: true, viewer: true }))).toEqual({
			board: COLLAPSED_REGION_WIDTH,
			viewer: COLLAPSED_REGION_WIDTH,
			generation: 1600 - 2 * COLLAPSED_REGION_WIDTH,
		});
	});

	it('keeps every expanded region at its minimum in a window narrower than the minimums (the row scrolls)', () => {
		expect(fitRegions(300, layoutWith())).toEqual(REGION_MIN_WIDTH);
		expect(fitRegions(0, layoutWith(undefined, { viewer: true }))).toEqual({
			board: REGION_MIN_WIDTH.board,
			viewer: COLLAPSED_REGION_WIDTH,
			generation: REGION_MIN_WIDTH.generation,
		});
	});

	it('clamps stored widths out of range', () => {
		expect(fitRegions(3000, layoutWith({ viewer: 10, generation: 99_999 }))).toMatchObject({
			viewer: REGION_MIN_WIDTH.viewer,
			generation: REGION_MAX_WIDTH.generation,
		});
	});
});

describe('isResizableRegion', () => {
	it('names the regions with a stored width: the viewer and the generation panel', () => {
		expect(CREATE_REGION_IDS.filter(isResizableRegion)).toEqual(['viewer', 'generation']);
	});
});

describe('fillRegion and splitters', () => {
	it('fills with the first expanded region: board, else viewer, else generation panel', () => {
		expect(fillRegion(ALL_EXPANDED)).toBe('board');
		expect(fillRegion({ board: true, viewer: false, generation: false })).toBe('viewer');
		expect(fillRegion({ board: true, viewer: true, generation: false })).toBe('generation');
		expect(fillRegion({ board: true, viewer: true, generation: true })).toBeNull();
	});

	it('gives a splitter to every expanded region that is not the fill region', () => {
		expect(hasSplitter('viewer', ALL_EXPANDED)).toBe(true);
		expect(hasSplitter('generation', ALL_EXPANDED)).toBe(true);
		expect(hasSplitter('viewer', { board: false, viewer: true, generation: false })).toBe(false);
		expect(hasSplitter('generation', { board: false, viewer: true, generation: false })).toBe(true);
		// The viewer fills while the board is collapsed: only the generation panel can be resized.
		expect(hasSplitter('viewer', { board: true, viewer: false, generation: false })).toBe(false);
		expect(hasSplitter('generation', { board: true, viewer: false, generation: false })).toBe(true);
		expect(hasSplitter('generation', { board: true, viewer: true, generation: false })).toBe(false);
	});
});

describe('regionWidthRange', () => {
	it('lets a region grow until the board is at its minimum, never past the region maximum', () => {
		const layout = layoutWith({ viewer: 600, generation: 400 });

		expect(regionWidthRange('viewer', 1840, layout)).toEqual({ min: REGION_MIN_WIDTH.viewer, max: 600 + (840 - REGION_MIN_WIDTH.board) });
		expect(regionWidthRange('generation', 1840, layout)).toEqual({ min: REGION_MIN_WIDTH.generation, max: REGION_MAX_WIDTH.generation });
	});

	it('offers no growth when the board already is at its minimum', () => {
		const boxes = fitRegions(SMALL_WINDOW_ROW, DEFAULT_CREATE_LAYOUT);

		expect(regionWidthRange('viewer', SMALL_WINDOW_ROW, DEFAULT_CREATE_LAYOUT).max).toBe(boxes.viewer);
		expect(regionWidthRange('generation', SMALL_WINDOW_ROW, DEFAULT_CREATE_LAYOUT).max).toBe(boxes.generation);
	});

	it('takes the room from the viewer when the viewer fills (board collapsed)', () => {
		const layout = layoutWith({ viewer: 600, generation: 400 }, { board: true });

		expect(regionWidthRange('generation', 900, layout)).toEqual({
			min: REGION_MIN_WIDTH.generation,
			max: 900 - COLLAPSED_REGION_WIDTH - REGION_MIN_WIDTH.viewer,
		});
		expect(regionWidthRange('generation', 1200, layout).max).toBe(REGION_MAX_WIDTH.generation);
	});

	it('never has a maximum below the minimum', () => {
		expect(regionWidthRange('viewer', 200, layoutWith())).toEqual({ min: REGION_MIN_WIDTH.viewer, max: REGION_MIN_WIDTH.viewer });
	});
});

describe('generationPanelInset', () => {
	it('keeps the toasts clear of the generation panel: its width, its strip, or nothing when it fills the row', () => {
		expect(generationPanelInset(layoutWith({ viewer: 600, generation: 420 }))).toBe(420);
		expect(generationPanelInset(layoutWith({ viewer: 600, generation: 9999 }))).toBe(REGION_MAX_WIDTH.generation);
		expect(generationPanelInset(layoutWith(undefined, { generation: true }))).toBe(COLLAPSED_REGION_WIDTH);
		expect(generationPanelInset(layoutWith(undefined, { board: true, viewer: true }))).toBe(0);
	});
});

describe('withRegionCollapsed', () => {
	it('collapses and expands a region, and returns the same state when nothing changes', () => {
		const collapsed = withRegionCollapsed(ALL_EXPANDED, 'viewer', true);

		expect(collapsed).toEqual({ board: false, viewer: true, generation: false });
		expect(withRegionCollapsed(collapsed, 'viewer', true)).toBe(collapsed);
		expect(withRegionCollapsed(collapsed, 'viewer', false)).toEqual(ALL_EXPANDED);
	});

	it('refuses to collapse the last expanded region', () => {
		const onlyBoard = { board: false, viewer: true, generation: true };

		expect(isLastExpandedRegion(onlyBoard, 'board')).toBe(true);
		expect(isLastExpandedRegion(ALL_EXPANDED, 'board')).toBe(false);
		expect(isLastExpandedRegion(onlyBoard, 'viewer')).toBe(false);
		expect(withRegionCollapsed(onlyBoard, 'board', true)).toBe(onlyBoard);
	});
});

describe('layoutFromLegacyWorkspace', () => {
	it('keeps the Image and Generation pane widths and drops the positions', () => {
		const layout = layoutFromLegacyWorkspace({
			windows: {
				'pane:image': { x: 41, y: 13, width: 643, height: 979, z: 1 },
				'pane:controls': { x: 1469, y: 76, width: 445, height: 811, z: 2 },
				'category:main': { x: 755, y: 24, width: 785, height: 286, z: 3 },
			},
			hiddenPaneIds: ['models', 'images', 'characters'],
		});
		expect(layout).toEqual({
			widths: { viewer: 643, generation: 445 },
			collapsed: ALL_EXPANDED,
			details: { open: true, tab: 'details' },
		});
	});

	it('collapses the regions whose every pane was closed', () => {
		expect(layoutFromLegacyWorkspace({ windows: {}, hiddenPaneIds: ['image', 'browser', 'used', 'controls'] })).toEqual({
			widths: DEFAULT_CREATE_LAYOUT.widths,
			collapsed: { board: false, viewer: true, generation: true },
			details: { open: false, tab: 'details' },
		});
		expect(layoutFromLegacyWorkspace({ windows: {}, hiddenPaneIds: ['browser'] }).details).toEqual({ open: true, tab: 'used' });
	});
});

describe('layoutFromLegacyWorkspace on real-shaped legacy stores', () => {
	// The shape of a real data directory of the floating-window versions: five panes (image, controls, the very old
	// details pane, used, browser) and 36 category windows plus three stale ones, in 'panel-layouts-store', with their
	// stacking order in 'workspace-z-index-store'. Synthetic values.
	const categoryKeys = Array.from({ length: 39 }, (_, index) => `category-${index + 1}`);
	const panelLayouts = {
		state: {
			panels: {
				'pane-image': { x: 41, y: 13, width: 643, height: 979 },
				'pane-controls': { x: 1469, y: 76, width: 445, height: 811 },
				'pane-details': { x: 700, y: 600, width: 500, height: 380 },
				'pane-used': { x: 700, y: 40, width: 480, height: 520 },
				'pane-browser': { x: 41, y: 1000, width: 643, height: 300 },
				...Object.fromEntries(
					categoryKeys.map((key, index) => [key, { x: 700 + (index % 3) * 260, y: 20 + index * 40, width: 250, height: 200 }]),
				),
			},
		},
		version: 0,
	};
	const zIndex = {
		state: {
			maxZ: 2310,
			paneZ: { image: 2305, controls: 2308, details: 1111, used: 2300, browser: 2301 },
			categoryZ: Object.fromEntries(categoryKeys.map((key, index) => [key, 60 + index])),
		},
		version: 0,
	};

	it('keeps the Image and Generation pane widths of panel-layouts + z-index, with every region shown', () => {
		const legacy = legacyWorkspaceFromEnvelopes({ 'panel-layouts-store': panelLayouts, 'workspace-z-index-store': zIndex });

		expect(legacy).not.toBeNull();
		expect(Object.keys(legacy!.windows)).toHaveLength(5 + categoryKeys.length);
		expect(layoutFromLegacyWorkspace(legacy!)).toEqual({
			widths: { viewer: 643, generation: 445 },
			collapsed: ALL_EXPANDED,
			details: { open: true, tab: 'details' },
		});
	});

	it('reads the newer workspace-store (version 0) first, clamping its widths and keeping its closed panes', () => {
		const workspace = {
			state: {
				windows: {
					'pane:image': { x: 16, y: 16, width: 2000, height: 400, z: 1 },
					'pane:browser': { x: 16, y: 428, width: 420, height: 592, z: 2 },
					'pane:controls': { x: 448, y: 16, width: 120, height: 560, z: 3 },
					'pane:used': { x: 448, y: 588, width: 420, height: 432, z: 4 },
					'category:subject': { x: 880, y: 16, width: 500, height: 256, z: 8 },
				},
				hiddenPaneIds: ['controls', 'models', 'images', 'characters'],
			},
			version: 0,
		};
		const legacy = legacyWorkspaceFromEnvelopes({
			'workspace-store': workspace,
			'panel-layouts-store': panelLayouts,
			'workspace-z-index-store': zIndex,
		});

		expect(layoutFromLegacyWorkspace(legacy!)).toEqual({
			widths: { viewer: REGION_MAX_WIDTH.viewer, generation: REGION_MIN_WIDTH.generation },
			collapsed: { board: false, viewer: false, generation: true },
			details: { open: true, tab: 'details' },
		});
	});

	it('takes the defaults for panes without a usable rect', () => {
		const legacy = legacyWorkspaceFromEnvelopes({
			'panel-layouts-store': { state: { panels: { 'pane-image': { x: 1, y: 2, width: 'wide', height: 3 } } }, version: 0 },
		});

		expect(layoutFromLegacyWorkspace(legacy!).widths).toEqual(DEFAULT_CREATE_LAYOUT.widths);
	});
});
