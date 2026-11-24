import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { flushPersistence, hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import { selectShowCategories, selectShowPanes, useIsPaneVisible, useWindowLayout, useWorkspaceStore } from './workspaceStore';

const rect = { x: 50, y: 60, width: 300, height: 200 };
const workspace = () => useWorkspaceStore.getState();

describe('workspaceStore actions', () => {
	it('commits sanitized rects and keeps z', () => {
		workspace().commitWindowRect('pane:image', { x: -20, y: 30, width: 0, height: 400 });
		expect(workspace().windows['pane:image']).toEqual({ x: 8, y: 30, width: 1, height: 400, z: 1 });

		workspace().focusWindow('pane:image');
		workspace().commitWindowRect('pane:image', rect);
		expect(workspace().windows['pane:image']).toEqual({ ...rect, z: 2 });
	});

	it('focuses on top and sends to the back across panes and categories', () => {
		workspace().replaceWindows({
			'pane:image': { ...rect, z: 5 },
			'category:main': { ...rect, z: 7 },
		});
		workspace().focusWindow('pane:image');
		expect(workspace().windows['pane:image']?.z).toBe(8);

		const before = workspace().windows;
		workspace().focusWindow('pane:image');
		expect(workspace().windows).toBe(before);

		workspace().sendWindowToBack('pane:image');
		expect(workspace().windows['pane:image']?.z).toBe(0);
		expect(workspace().windows['category:main']?.z).toBe(7);
	});

	it('focusing a window without stored layout keeps the rect it is drawn at', () => {
		renderHook(() => useWindowLayout('pane:used', { x: 690, y: 320, width: 790, height: 420 }));
		workspace().focusWindow('pane:used');
		expect(workspace().windows['pane:used']).toEqual({ x: 690, y: 320, width: 790, height: 420, z: 2 });
	});

	it('renames and removes windows', () => {
		workspace().commitWindowRect('category:old', rect);
		workspace().renameWindow('category:old', 'category:new');
		expect(workspace().windows).toEqual({ 'category:new': { ...rect, z: 1 } });

		workspace().renameWindow('category:missing', 'category:other');
		workspace().removeWindow('category:new');
		expect(workspace().windows).toEqual({});
	});

	it('arranges category windows in a grid above every window, preferring stored sizes', () => {
		workspace().replaceWindows({
			'pane:image': { ...rect, z: 40 },
			'category:a': { x: 900, y: 900, width: 500, height: 250, z: 3 },
		});
		workspace().arrangeCategoryWindows(
			[
				{ key: 'category:a', preferred: { width: 320, height: 200 } },
				{ key: 'category:b', preferred: { width: 320, height: 200 } },
			],
			{ width: 1920, height: 1080 },
		);
		expect(workspace().windows['category:a']).toEqual({ x: 24, y: 24, width: 500, height: 250, z: 41 });
		expect(workspace().windows['category:b']).toEqual({ x: 540, y: 24, width: 320, height: 250, z: 42 });
		expect(workspace().windows['pane:image']).toEqual({ ...rect, z: 40 });
	});

	it('maintains hidden panes', () => {
		workspace().setPaneVisible('used', false);
		workspace().setPaneVisible('used', false);
		expect(workspace().hiddenPaneIds).toEqual(['used']);
		workspace().setPaneVisible('used', true);
		expect(workspace().hiddenPaneIds).toEqual([]);
	});

	it('reveals a pane: visible, in front, and panes shown', () => {
		workspace().commitWindowRect('pane:image', rect);
		workspace().commitWindowRect('pane:characters', rect);
		workspace().focusWindow('pane:image');
		workspace().setPaneVisible('characters', false);
		workspace().cycleVisibilityMode(); // categories-only

		workspace().revealPane('characters');

		expect(workspace().hiddenPaneIds).toEqual([]);
		expect(workspace().windows['pane:characters']!.z).toBeGreaterThan(workspace().windows['pane:image']!.z);
		expect(workspace().visibilityMode).toBe('all');

		workspace().cycleVisibilityMode();
		workspace().cycleVisibilityMode(); // panes-only
		workspace().revealPane('characters');
		expect(workspace().visibilityMode).toBe('panes-only');
	});

	it('cycles visibility all -> categories-only -> panes-only -> all', () => {
		const seen = [workspace().visibilityMode];
		for (let index = 0; index < 3; index += 1) {
			workspace().cycleVisibilityMode();
			seen.push(workspace().visibilityMode);
		}
		expect(seen).toEqual(['all', 'categories-only', 'panes-only', 'all']);
		expect(selectShowCategories({ ...workspace(), visibilityMode: 'panes-only' })).toBe(false);
		expect(selectShowPanes({ ...workspace(), visibilityMode: 'categories-only' })).toBe(false);
	});

	it('replaceWindows drops incomplete rects', () => {
		workspace().replaceWindows({
			'pane:image': { ...rect, z: 3 },
			'pane:bad': { x: Number.NaN, y: 0, width: 1, height: 1, z: 1 },
		});
		expect(Object.keys(workspace().windows)).toEqual(['pane:image']);
	});
});

describe('workspaceStore hooks', () => {
	it('useWindowLayout returns the sanitized stored layout or the fallback with z 1, referentially stable', () => {
		const fallback = { x: 24, y: 24, width: 640, height: 720 };
		const { result, rerender } = renderHook(({ fb }) => useWindowLayout('pane:image', fb), { initialProps: { fb: fallback } });
		const first = result.current;
		expect(first).toEqual({ ...fallback, z: 1 });

		rerender({ fb: { ...fallback } });
		expect(result.current).toBe(first);

		useWorkspaceStore.setState({ windows: { 'pane:image': { x: -5, y: 40, width: 500, height: 600, z: 9 } } });
		rerender({ fb: { ...fallback } });
		expect(result.current).toEqual({ x: 8, y: 40, width: 500, height: 600, z: 9 });
	});

	it('useIsPaneVisible follows hiddenPaneIds', () => {
		const { result, rerender } = renderHook(() => useIsPaneVisible('controls'));
		expect(result.current).toBe(true);
		workspace().setPaneVisible('controls', false);
		rerender();
		expect(result.current).toBe(false);
	});
});

describe('workspaceStore persistence', () => {
	it('migrates the legacy layout stores, then writes workspace-store without the visibility mode', async () => {
		const backend = createMemoryStoreBackend({
			'panel-layouts-store': {
				state: { panels: { 'pane-image': { x: 41, y: 13, width: 643, height: 979 }, main: { x: 755, y: 24, width: 785, height: 286 } } },
				version: 0,
			},
			'workspace-z-index-store': {
				state: { maxZ: 2310, paneZ: { image: 2305, controls: 2308, details: 1111, used: 2301, browser: 2088 }, categoryZ: { main: 2309 } },
				version: 0,
			},
		});
		setStoreBackend(backend);

		expect(await hydratePersistedStores([useWorkspaceStore])).toEqual([]);
		expect(workspace().windows).toEqual({
			'pane:image': { x: 41, y: 13, width: 643, height: 979, z: 2305 },
			'category:main': { x: 755, y: 24, width: 785, height: 286, z: 2309 },
		});

		workspace().focusWindow('pane:image');
		workspace().cycleVisibilityMode();
		await flushPersistence();

		const saved = backend.snapshot();
		expect(saved['workspace-store']).toEqual({
			state: {
				windows: {
					'pane:image': { x: 41, y: 13, width: 643, height: 979, z: 2310 },
					'category:main': { x: 755, y: 24, width: 785, height: 286, z: 2309 },
				},
				hiddenPaneIds: [],
			},
			version: 0,
		});
		// Legacy stores are only read.
		expect(saved['panel-layouts-store']).toBeDefined();
	});

	it('prefers workspace-store over the legacy stores', async () => {
		setStoreBackend(
			createMemoryStoreBackend({
				'workspace-store': { state: { windows: { 'pane:used': { ...rect, z: 4 } }, hiddenPaneIds: ['browser'] }, version: 0 },
				'panel-layouts-store': { state: { panels: { 'pane-image': rect } }, version: 0 },
			}),
		);
		await hydratePersistedStores([useWorkspaceStore]);
		expect(workspace().windows).toEqual({ 'pane:used': { ...rect, z: 4 } });
		expect(workspace().hiddenPaneIds).toEqual(['browser']);
	});
});
