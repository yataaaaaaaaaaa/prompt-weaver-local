import { describe, expect, it } from 'vitest';
import {
	arrangeGrid,
	backZ,
	categoryWindowKey,
	DEFAULT_WINDOW_RECT,
	frontZ,
	maxWindowZ,
	migrateLegacyWorkspace,
	moveRect,
	paneWindowKey,
	resizeRect,
	sanitizeRect,
	sanitizeWindowLayouts,
	type WindowLayouts,
} from './layout';

describe('window keys', () => {
	it('prefixes panes and categories', () => {
		expect(paneWindowKey('image')).toBe('pane:image');
		expect(categoryWindowKey('main')).toBe('category:main');
	});
});

describe('moveRect / resizeRect', () => {
	const rect = { x: 40, y: 40, width: 300, height: 200 };

	it('moves by the delta but never above/left of the visible offset', () => {
		expect(moveRect(rect, 16, -8)).toEqual({ x: 56, y: 32, width: 300, height: 200 });
		expect(moveRect(rect, -100, -100)).toEqual({ x: 8, y: 8, width: 300, height: 200 });
	});

	it('resizes from the bottom-right corner, never below the minimum size', () => {
		expect(resizeRect(rect, 40, -8, { width: 280, height: 180 })).toEqual({ x: 40, y: 40, width: 340, height: 192 });
		expect(resizeRect(rect, -500, -500, { width: 280, height: 180 })).toEqual({ x: 40, y: 40, width: 280, height: 180 });
	});
});

describe('sanitizeRect', () => {
	it('keeps windows reachable (x,y >= 8) and sizes positive', () => {
		expect(sanitizeRect({ x: -40, y: 3, width: 0, height: -5 })).toEqual({ x: 8, y: 8, width: 1, height: 1 });
		expect(sanitizeRect({ x: 41, y: 13, width: 643, height: 979 })).toEqual({ x: 41, y: 13, width: 643, height: 979 });
	});

	it('takes non-finite values from the fallback', () => {
		const fallback = { x: 100, y: 200, width: 300, height: 400 };
		expect(sanitizeRect({ x: Number.NaN, y: Number.POSITIVE_INFINITY, width: undefined, height: 50 }, fallback)).toEqual({
			x: 100,
			y: 200,
			width: 300,
			height: 50,
		});
		expect(sanitizeRect({})).toEqual(DEFAULT_WINDOW_RECT);
	});

	it('drops incomplete entries of a layout map', () => {
		const windows = {
			'pane:image': { x: 1, y: 20, width: 10, height: 10, z: Number.NaN },
			'pane:bad': { x: Number.NaN, y: 0, width: 10, height: 10, z: 3 },
		} as WindowLayouts;
		expect(sanitizeWindowLayouts(windows)).toEqual({ 'pane:image': { x: 8, y: 20, width: 10, height: 10, z: 1 } });
	});
});

describe('z-order', () => {
	const rect = { x: 10, y: 10, width: 100, height: 100 };
	const windows: WindowLayouts = {
		'pane:image': { ...rect, z: 5 },
		'pane:controls': { ...rect, z: 9 },
		'category:main': { ...rect, z: 7 },
	};

	it('max counts unstored windows as z 1', () => {
		expect(maxWindowZ({})).toBe(1);
		expect(maxWindowZ(windows)).toBe(9);
	});

	it('front = max + 1, null when already the single top-most window', () => {
		expect(frontZ(windows, 'pane:image')).toBe(10);
		expect(frontZ(windows, 'pane:controls')).toBeNull();
		expect(frontZ(windows, 'category:new')).toBe(10);
		expect(frontZ({}, 'pane:image')).toBe(2);
		// A tie with another window on top is resolved.
		expect(frontZ({ ...windows, 'pane:used': { ...rect, z: 9 } }, 'pane:controls')).toBe(10);
	});

	it('back = min - 1 (windows without layout count as 1), null when already behind everything', () => {
		expect(backZ(windows, 'pane:controls')).toBe(0);
		expect(backZ({ 'pane:image': { ...rect, z: -3 }, 'pane:used': { ...rect, z: 4 } }, 'pane:used')).toBe(-4);
		expect(backZ({ 'pane:image': { ...rect, z: -3 }, 'pane:used': { ...rect, z: 4 } }, 'pane:image')).toBeNull();
		expect(backZ({}, 'pane:image')).toBe(0);
	});
});

describe('arrangeGrid', () => {
	const viewport = { width: 1920, height: 1080 };

	it('fills rows left to right with margin 24 and gap 16, stacked above baseZ in item order', () => {
		const result = arrangeGrid(
			[
				{ key: 'category:a', preferred: { width: 760, height: 190 } },
				{ key: 'category:b', preferred: { width: 760, height: 250 } },
				{ key: 'category:c', preferred: { width: 400, height: 200 } },
			],
			viewport,
			100,
		);
		// Row 1: a (24) + 16 + b (800) = 1560 <= 1872; c would reach 1976 > 1872 -> row 2.
		// Row height = min(30% of 1080 = 324, max(190, 250)) = 250.
		expect(result['category:a']).toEqual({ x: 24, y: 24, width: 760, height: 250, z: 101 });
		expect(result['category:b']).toEqual({ x: 800, y: 24, width: 760, height: 250, z: 102 });
		expect(result['category:c']).toEqual({ x: 24, y: 290, width: 400, height: 200, z: 103 });
	});

	it('clamps widths to [300, viewport - 2 * margin] and heights to [168, 30% of the viewport]', () => {
		const result = arrangeGrid(
			[
				{ key: 'category:narrow', preferred: { width: 120, height: 50 } },
				{ key: 'category:wide', preferred: { width: 5000, height: 2000 } },
			],
			viewport,
			1,
		);
		expect(result['category:narrow']).toMatchObject({ width: 300, height: 168 });
		expect(result['category:wide']).toMatchObject({ x: 24, y: 24 + 168 + 16, width: 1872, height: 324 });
	});

	it('keeps a usable width on tiny viewports and ignores non-finite sizes', () => {
		const result = arrangeGrid([{ key: 'category:a', preferred: { width: Number.NaN, height: Number.NaN } }], { width: 200, height: 100 }, 1);
		expect(result['category:a']).toEqual({ x: 24, y: 24, width: 300, height: 168, z: 2 });
	});
});

describe('migrateLegacyWorkspace', () => {
	// Trimmed from real panel-layouts-store / workspace-z-index-store files.
	const panelLayouts = {
		state: {
			panels: {
				'pane-image': { x: 41, y: 13, width: 643, height: 979 },
				'pane-controls': { x: 1469, y: 76, width: 445, height: 811 },
				'pane-details': { x: 995, y: 41, width: 548, height: 758 },
				'pane-browser': { x: 35, y: 36, width: 691, height: 248 },
				main: { x: 755, y: 24, width: 785, height: 286 },
				boy: { x: 1124, y: 3620, width: 554, height: 286 },
				style: { x: 427, y: 3, width: 324, height: 358 },
				broken: { x: null, y: 4, width: 10, height: 10 },
			},
		},
		version: 0,
	};
	const zIndex = {
		state: {
			maxZ: 2310,
			paneZ: { image: 2305, controls: 2308, details: 1111, used: 2301, browser: 2088 },
			categoryZ: { main: 2309, boy: 2096, style: 'x' },
		},
		version: 0,
	};

	it('maps panes and categories into one window map with their z', () => {
		expect(migrateLegacyWorkspace(panelLayouts, zIndex)).toEqual({
			state: {
				windows: {
					'pane:image': { x: 41, y: 13, width: 643, height: 979, z: 2305 },
					'pane:controls': { x: 1469, y: 76, width: 445, height: 811, z: 2308 },
					'pane:details': { x: 995, y: 41, width: 548, height: 758, z: 1111 },
					'pane:browser': { x: 35, y: 36, width: 691, height: 248, z: 2088 },
					'category:main': { x: 755, y: 24, width: 785, height: 286, z: 2309 },
					'category:boy': { x: 1124, y: 3620, width: 554, height: 286, z: 2096 },
					'category:style': { x: 427, y: 8, width: 324, height: 358, z: 1 },
				},
				hiddenPaneIds: [],
			},
			version: 0,
		});
	});

	it('defaults z to 1 without a z-index store and returns null without any legacy store', () => {
		const migrated = migrateLegacyWorkspace(panelLayouts, null);
		expect(migrated?.state.windows['pane:image']?.z).toBe(1);
		expect(migrated?.state.windows['category:main']?.z).toBe(1);
		expect(migrateLegacyWorkspace(null, null)).toBeNull();
		expect(migrateLegacyWorkspace(null, zIndex)).toEqual({ state: { windows: {}, hiddenPaneIds: [] }, version: 0 });
	});

	it('recognises a category whose key starts with pane- by its z entry', () => {
		const migrated = migrateLegacyWorkspace(
			{ state: { panels: { 'pane-ideas': { x: 10, y: 10, width: 300, height: 200 } } } },
			{ state: { paneZ: {}, categoryZ: { 'pane-ideas': 12 } } },
		);
		expect(migrated?.state.windows).toEqual({ 'category:pane-ideas': { x: 10, y: 10, width: 300, height: 200, z: 12 } });
	});
});
