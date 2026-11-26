import { describe, expect, it } from 'vitest';
import {
	categoryKeyOfLegacyWindow,
	isCompleteRect,
	legacyCategoryWindowKey,
	legacyPaneWindowKey,
	legacyWorkspaceFromEnvelopes,
	migrateLegacyPanelLayouts,
	sanitizeLegacyWorkspace,
} from './legacyLayout';

// Shaped like real panel-layouts-store / workspace-z-index-store files (synthetic names and numbers).
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

describe('legacy window keys', () => {
	it('prefixes panes and categories, and reads the category key back', () => {
		expect(legacyPaneWindowKey('image')).toBe('pane:image');
		expect(legacyCategoryWindowKey('hair')).toBe('category:hair');
		expect(categoryKeyOfLegacyWindow('category:pane-ideas')).toBe('pane-ideas');
		expect(categoryKeyOfLegacyWindow('pane:image')).toBeNull();
	});

	it('accepts complete rects only', () => {
		expect(isCompleteRect({ x: 1, y: 2, width: 3, height: 4 })).toBe(true);
		expect(isCompleteRect({ x: 1, y: 2, width: Number.NaN, height: 4 })).toBe(false);
		expect(isCompleteRect(null)).toBe(false);
	});
});

describe('migrateLegacyPanelLayouts', () => {
	it('maps panes and categories into one window map with their z', () => {
		expect(migrateLegacyPanelLayouts(panelLayouts, zIndex)).toEqual({
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
		});
	});

	it('defaults z to 1 without a z-index store and returns null without any legacy store', () => {
		const migrated = migrateLegacyPanelLayouts(panelLayouts, null);
		expect(migrated?.windows['pane:image']?.z).toBe(1);
		expect(migrated?.windows['category:main']?.z).toBe(1);
		expect(migrateLegacyPanelLayouts(null, null)).toBeNull();
		expect(migrateLegacyPanelLayouts(null, zIndex)).toEqual({ windows: {}, hiddenPaneIds: [] });
	});

	it('recognises a category whose key starts with pane- by its z entry', () => {
		const migrated = migrateLegacyPanelLayouts(
			{ state: { panels: { 'pane-ideas': { x: 10, y: 10, width: 300, height: 200 } } } },
			{ state: { paneZ: {}, categoryZ: { 'pane-ideas': 12 } } },
		);
		expect(migrated?.windows).toEqual({ 'category:pane-ideas': { x: 10, y: 10, width: 300, height: 200, z: 12 } });
	});
});

describe('sanitizeLegacyWorkspace', () => {
	it('keeps complete windows and string pane ids, once', () => {
		expect(
			sanitizeLegacyWorkspace({
				windows: {
					'pane:image': { x: 16, y: 16, width: 420, height: 400, z: 1 },
					'category:subject': { x: 4, y: 16, width: 500, height: 256 },
					'category:broken': { x: 'a', y: 16, width: 500, height: 256, z: 2 },
					other: { x: 1, y: 1, width: 1, height: 1, z: 1 },
				},
				hiddenPaneIds: ['models', 'models', 3, 'images'],
			}),
		).toEqual({
			windows: {
				'pane:image': { x: 16, y: 16, width: 420, height: 400, z: 1 },
				'category:subject': { x: 8, y: 16, width: 500, height: 256, z: 1 },
			},
			hiddenPaneIds: ['models', 'images'],
		});
		expect(sanitizeLegacyWorkspace(null)).toEqual({ windows: {}, hiddenPaneIds: [] });
	});
});

describe('legacyWorkspaceFromEnvelopes', () => {
	const workspace = {
		state: { windows: { 'category:mood': { x: 880, y: 592, width: 500, height: 256, z: 10 } }, hiddenPaneIds: ['characters'] },
		version: 0,
	};

	it('prefers the workspace store over the panel layouts', () => {
		expect(
			legacyWorkspaceFromEnvelopes({
				'workspace-store': workspace,
				'panel-layouts-store': panelLayouts,
				'workspace-z-index-store': zIndex,
			}),
		).toEqual({ windows: { 'category:mood': { x: 880, y: 592, width: 500, height: 256, z: 10 } }, hiddenPaneIds: ['characters'] });
	});

	it('falls back to the panel layouts, then to nothing', () => {
		expect(
			legacyWorkspaceFromEnvelopes({ 'workspace-store': null, 'panel-layouts-store': panelLayouts, 'workspace-z-index-store': zIndex })?.windows[
				'category:main'
			],
		).toEqual({ x: 755, y: 24, width: 785, height: 286, z: 2309 });
		expect(legacyWorkspaceFromEnvelopes({ 'workspace-store': null, 'panel-layouts-store': null, 'workspace-z-index-store': null })).toBeNull();
	});
});
