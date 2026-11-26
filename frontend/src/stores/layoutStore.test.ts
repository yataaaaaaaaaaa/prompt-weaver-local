import { describe, expect, it } from 'vitest';
import { DEFAULT_CREATE_LAYOUT, REGION_MAX_WIDTH } from '../domain/layout';
import { hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import { useLayoutStore } from './layoutStore';

const layout = () => useLayoutStore.getState();

describe('layoutStore', () => {
	it('stores clamped region widths', () => {
		layout().setRegionWidth('generation', 99_999);
		expect(layout().widths.generation).toBe(REGION_MAX_WIDTH.generation);
	});

	it('collapses and expands regions, and cycles the Create layout (Ctrl+H)', () => {
		layout().toggleRegionCollapsed('board');
		expect(layout().collapsed.board).toBe(true);
		layout().setRegionCollapsed('board', false);

		layout().cycleFocusLayout();
		expect(layout().collapsed).toEqual({ board: false, viewer: true, generation: true });
	});

	it('never collapses the last expanded region', () => {
		layout().setRegionCollapsed('viewer', true);
		layout().setRegionCollapsed('generation', true);
		const before = layout().collapsed;

		layout().toggleRegionCollapsed('board');

		expect(layout().collapsed).toBe(before);
		expect(layout().collapsed).toEqual({ board: false, viewer: true, generation: true });
	});

	it('imports a legacy workspace wholesale (app_state.json pane layouts)', () => {
		layout().importLegacyWorkspace({
			windows: { 'pane:image': { x: 10, y: 10, width: 700, height: 500, z: 1 }, 'pane:controls': { x: 720, y: 10, width: 400, height: 900, z: 2 } },
			hiddenPaneIds: [],
		});

		expect(layout().widths).toEqual({ viewer: 700, generation: 400 });
	});

	it('shows a details tab: opens the panel and expands the viewer', () => {
		useLayoutStore.setState({ collapsed: { board: false, viewer: true, generation: false }, details: { open: false, tab: 'details' } });

		layout().showDetailsTab('used');

		expect(layout().details).toEqual({ open: true, tab: 'used' });
		expect(layout().collapsed.viewer).toBe(false);
	});
});

describe('layoutStore persistence', () => {
	it('starts from the defaults without any layout data', async () => {
		setStoreBackend(createMemoryStoreBackend());

		expect(await hydratePersistedStores([useLayoutStore])).toEqual([]);

		expect(layout()).toMatchObject(DEFAULT_CREATE_LAYOUT);
	});

	it('derives the layout from a legacy workspace store (version 0) and leaves that file untouched', async () => {
		const legacy = {
			state: {
				windows: {
					'pane:image': { x: 41, y: 13, width: 643, height: 979, z: 2305 },
					'pane:controls': { x: 1469, y: 76, width: 445, height: 811, z: 2308 },
					'category:main': { x: 755, y: 24, width: 785, height: 286, z: 2309 },
				},
				hiddenPaneIds: ['used', 'browser', 'models'],
			},
			version: 0,
		};
		const memory = createMemoryStoreBackend({ 'workspace-store': legacy });
		setStoreBackend(memory);

		await hydratePersistedStores([useLayoutStore]);

		expect(layout()).toMatchObject({
			widths: { viewer: 643, generation: 445 },
			collapsed: { board: false, viewer: false, generation: false },
			details: { open: false, tab: 'details' },
		});
		expect(await memory.read('workspace-store')).toEqual(legacy);
	});

	it('derives the layout from the older panel-layouts + z-index stores and leaves both files untouched', async () => {
		const panelLayouts = {
			state: {
				panels: {
					'pane-image': { x: 41, y: 13, width: 610, height: 979 },
					'pane-controls': { x: 1469, y: 76, width: 455, height: 811 },
					'pane-details': { x: 700, y: 600, width: 500, height: 380 },
					'pane-used': { x: 700, y: 40, width: 480, height: 520 },
					'pane-browser': { x: 41, y: 1000, width: 643, height: 300 },
					subject: { x: 755, y: 24, width: 785, height: 286 },
					main: { x: 755, y: 320, width: 785, height: 286 },
				},
			},
			version: 0,
		};
		const zIndex = {
			state: { maxZ: 2310, paneZ: { image: 2305, controls: 2308, details: 1111, used: 2300, browser: 2301 }, categoryZ: { subject: 60, main: 61 } },
			version: 0,
		};
		const memory = createMemoryStoreBackend({ 'panel-layouts-store': panelLayouts, 'workspace-z-index-store': zIndex });
		setStoreBackend(memory);

		await hydratePersistedStores([useLayoutStore]);

		expect(layout()).toMatchObject({
			widths: { viewer: 610, generation: 455 },
			collapsed: { board: false, viewer: false, generation: false },
			details: { open: true, tab: 'details' },
		});
		expect(await memory.read('panel-layouts-store')).toEqual(panelLayouts);
		expect(await memory.read('workspace-z-index-store')).toEqual(zIndex);
		expect(await memory.read('workspace-store')).toBeNull();
	});

	it('prefers its own data over any legacy store', async () => {
		const own = { state: { widths: { viewer: 900, generation: 500 }, collapsed: { board: false, viewer: false, generation: true }, details: { open: false, tab: 'used' } }, version: 0 };
		setStoreBackend(
			createMemoryStoreBackend({
				'layout-store': own,
				'workspace-store': { state: { windows: { 'pane:image': { x: 1, y: 1, width: 400, height: 400, z: 1 } }, hiddenPaneIds: [] }, version: 0 },
			}),
		);

		await hydratePersistedStores([useLayoutStore]);

		expect(layout()).toMatchObject(own.state);
	});

	it('saves its layout as layout-store version 0, never a legacy store', async () => {
		const memory = createMemoryStoreBackend({
			'workspace-store': { state: { windows: {}, hiddenPaneIds: [] }, version: 0 },
		});
		setStoreBackend(memory);
		await hydratePersistedStores([useLayoutStore]);

		layout().setRegionWidth('viewer', 720);

		await expect.poll(async () => (await memory.read('layout-store'))?.state).toMatchObject({ widths: { viewer: 720 } });
		expect((await memory.read('layout-store'))?.version).toBe(0);
		expect(await memory.read('workspace-store')).toEqual({ state: { windows: {}, hiddenPaneIds: [] }, version: 0 });
	});

	it('sanitizes its own persisted data', async () => {
		setStoreBackend(createMemoryStoreBackend({ 'layout-store': { state: { widths: { viewer: 'wide' }, collapsed: { generation: true } }, version: 0 } }));

		await hydratePersistedStores([useLayoutStore]);

		expect(layout()).toMatchObject({
			widths: DEFAULT_CREATE_LAYOUT.widths,
			collapsed: { board: false, viewer: false, generation: true },
			details: DEFAULT_CREATE_LAYOUT.details,
		});
	});
});
