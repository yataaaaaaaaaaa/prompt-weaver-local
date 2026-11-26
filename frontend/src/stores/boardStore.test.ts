import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GenerationSelection, OutputRecord } from '../api/types';
import type { Category, SubPromptState } from '../domain/categories';
import { categoryMatcher, makeRule, specificMatcher } from '../domain/forbiddenRules';
import { legacyWorkspaceWindows } from '../domain/legacyImport';
import { hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import {
	useBoardOrder,
	useBoardStore,
	useCardRevealRequest,
	useCollapseSummary,
	useIsBoardFilterActive,
	useVisibleCategoryKeys,
	visibleCategoryKeysNow,
} from './boardStore';
import { useCategoriesStore } from './categoriesStore';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { useLayoutStore } from './layoutStore';
import { useOutputsStore } from './outputsStore';

const category = (text: string, extra: Partial<Category> = {}): Category => ({
	text,
	activation_text: '',
	priority: 1,
	state: 'normal',
	subPrompts: [{ text: `${text.toLowerCase()} prompt`, state: 'normal', extraLoraIds: [] }],
	...extra,
});

const board = () => useBoardStore.getState();

function seedCategories(...names: string[]): void {
	useCategoriesStore.setState({ categories: names.map((name) => category(name)) });
}

function withPrompts(text: string, prompts: [string, SubPromptState?][], extra: Partial<Category> = {}): Category {
	return category(text, { subPrompts: prompts.map(([prompt, state = 'normal']) => ({ text: prompt, state, extraLoraIds: [] })), ...extra });
}

function outputUsing(...selections: [string, string][]): OutputRecord {
	const items: GenerationSelection[] = selections.map(([category_name, prompt_text]) => ({ category_name, prompt_text, locked: false, induced_lora_ids: [] }));
	return {
		output_id: '0000000001',
		generated_at: '2026-01-01T00:00:00Z',
		image_path: 'D:/out/0000000001.png',
		metadata_path: 'D:/out/0000000001.json',
		model_id: 'model',
		active_loras: [],
		character: null,
		prompt: '',
		negative_prompt: '',
		width: 1024,
		height: 1024,
		steps: 30,
		guidance_scale: 7,
		seed: 1,
		image_seed: 1,
		prompt_seed: 1,
		selections: items,
	};
}

// A small version of the e2e fixture: every state the filter knows.
function seedStates(): void {
	useCategoriesStore.setState({
		categories: [
			withPrompts('Subject', [['1girl', 'lock'], ['1boy']], { priority: 1 }),
			withPrompts('Outfit', [['red dress'], ['swimsuit']], { priority: 2 }),
			withPrompts('Background', [['beach'], ['street']], { priority: 3 }),
			withPrompts('Lighting', [['studio']], { priority: 4, state: 'skip' }),
			withPrompts('Sea', [['jellyfish']], { priority: 5, activation_text: 'underwater' }),
		],
	});
	useForbiddenRulesStore.setState({
		rules: [makeRule(specificMatcher('Outfit', 'red dress'), specificMatcher('Background', 'beach')), makeRule(categoryMatcher('Mood'), categoryMatcher('Sea'))],
	});
	useOutputsStore.setState({ record: outputUsing(['Subject', '1girl'], ['Outfit', 'red dress']) });
}

describe('boardStore order and cards', () => {
	it('orders the cards by the stored order, new categories last', () => {
		seedCategories('Alpha', 'Beta', 'Gamma');
		useBoardStore.setState({ order: ['gamma', 'alpha'] });

		const { result } = renderHook(() => useBoardOrder());

		expect(result.current).toEqual(['gamma', 'alpha', 'beta']);
	});

	it('moves a card next to another one, stores the whole order and returns its new position', () => {
		seedCategories('Alpha', 'Beta', 'Gamma');

		expect(board().moveCategoryNextTo('gamma', 'alpha', 'before')).toEqual({ position: 1, total: 3, moved: true });
		expect(board().order).toEqual(['gamma', 'alpha', 'beta']);
		expect(board().moveCategoryNextTo('gamma', 'beta', 'after')).toEqual({ position: 3, total: 3, moved: true });
		expect(board().order).toEqual(['alpha', 'beta', 'gamma']);
		// A drop next to its own place changes nothing.
		expect(board().moveCategoryNextTo('gamma', 'beta', 'after')).toEqual({ position: 3, total: 3, moved: false });
	});

	it('moves with the keyboard among the shown cards; nothing past an end', () => {
		seedCategories('Alpha', 'Beta', 'Gamma', 'Delta');

		expect(board().moveCategory('alpha', 'next')).toEqual({ position: 2, total: 4, moved: true });
		expect(board().order).toEqual(['beta', 'alpha', 'gamma', 'delta']);
		expect(board().moveCategory('delta', 'first')).toEqual({ position: 1, total: 4, moved: true });
		expect(board().moveCategory('delta', 'previous')).toEqual({ position: 1, total: 4, moved: false });
		expect(board().moveCategory('beta', 'last')).toEqual({ position: 4, total: 4, moved: true });
		expect(board().order).toEqual(['delta', 'alpha', 'gamma', 'beta']);
		expect(board().moveCategory('unknown', 'next')).toBeNull();
	});

	it('moves relative to the shown neighbors while a filter hides cards', () => {
		useCategoriesStore.setState({ categories: ['Alpha', 'Beet', 'Gamma', 'Delta', 'Epsilon'].map((name) => withPrompts(name, [['x']])) });
		// The search 'a' hides Beet and Epsilon.
		board().setQuery('a');
		expect(visibleCategoryKeysNow()).toEqual(['alpha', 'gamma', 'delta']);

		expect(board().moveCategory('delta', 'previous')).toEqual({ position: 2, total: 3, moved: true });
		expect(board().order).toEqual(['alpha', 'beet', 'delta', 'gamma', 'epsilon']);
		expect(board().moveCategory('alpha', 'last')).toEqual({ position: 3, total: 3, moved: true });
		expect(board().order).toEqual(['beet', 'delta', 'gamma', 'alpha', 'epsilon']);
	});

	it('follows renames and deletions, and collapses / expands cards', () => {
		seedCategories('Alpha', 'Beta');
		useBoardStore.setState({ order: ['beta', 'alpha'], collapsed: ['alpha'] });

		board().renameCategoryKey('alpha', 'alpha-2');
		expect(board()).toMatchObject({ order: ['beta', 'alpha-2'], collapsed: ['alpha-2'] });

		board().forgetCategory('beta');
		board().toggleCollapsed('alpha-2');
		expect(board()).toMatchObject({ order: ['alpha-2'], collapsed: [] });

		useBoardStore.setState({ order: ['beta', 'alpha'] });
		board().setAllCollapsed(true);
		expect(board().collapsed).toEqual(['beta', 'alpha']);
		board().setCollapsed('beta', false);
		board().setCollapsed('beta', false);
		expect(board().collapsed).toEqual(['alpha']);
		board().setAllCollapsed(false);
		expect(board().collapsed).toEqual([]);
	});

	it('summarizes the collapsed cards for Collapse all / Expand all', () => {
		seedCategories('Alpha', 'Beta');
		const { result } = renderHook(() => useCollapseSummary());
		expect(result.current).toEqual({ anyCollapsed: false, anyExpanded: true });

		act(() => board().setCollapsed('alpha', true));
		expect(result.current).toEqual({ anyCollapsed: true, anyExpanded: true });

		act(() => board().setAllCollapsed(true));
		expect(result.current).toEqual({ anyCollapsed: true, anyExpanded: false });

		// A stale key of a deleted category does not count.
		act(() => useBoardStore.setState({ collapsed: ['gone'] }));
		expect(result.current).toEqual({ anyCollapsed: false, anyExpanded: true });
	});
});

describe('boardStore filter', () => {
	it('filters the shown cards by the search (name, activation text, sub-prompts)', () => {
		seedCategories('Alpha', 'Beta');
		const { result } = renderHook(() => ({ keys: useVisibleCategoryKeys(), active: useIsBoardFilterActive() }));
		expect(result.current).toEqual({ keys: ['alpha', 'beta'], active: false });

		act(() => board().setQuery('beta prompt'));
		expect(result.current).toEqual({ keys: ['beta'], active: true });

		act(() => board().clearFilter());
		expect(result.current).toEqual({ keys: ['alpha', 'beta'], active: false });
	});

	it('filters by the real card states: current, locked, skipped, indirectly disabled', () => {
		seedStates();
		const { result } = renderHook(() => useVisibleCategoryKeys());

		act(() => board().setStateFilter('current'));
		expect(result.current).toEqual(['subject', 'outfit']);
		act(() => board().setStateFilter('locked'));
		expect(result.current).toEqual(['subject']);
		act(() => board().setStateFilter('skipped'));
		expect(result.current).toEqual(['lighting']);
		act(() => board().setStateFilter('indirectlyDisabled'));
		expect(result.current).toEqual(['sea']);

		// Another output: 'current' follows it.
		act(() => board().setStateFilter('current'));
		act(() => useOutputsStore.setState({ record: outputUsing(['Background', 'street']) }));
		expect(result.current).toEqual(['background']);
		act(() => useOutputsStore.setState({ record: null }));
		expect(result.current).toEqual([]);
	});

	it('filters by the association source: its card, and the cards forbidden with it', () => {
		seedStates();
		const { result } = renderHook(() => useVisibleCategoryKeys());
		act(() => board().setStateFilter('associated'));
		expect(result.current).toEqual([]);

		act(() => useForbiddenRulesStore.getState().pickAssociationEndpoint({ mode: 'prompt', categoryName: 'Outfit', promptText: 'red dress', tagText: null }));
		expect(result.current).toEqual(['outfit']);
		act(() => board().setStateFilter('forbidden'));
		expect(result.current).toEqual(['background']);
		act(() => board().setQuery('street'));
		expect(result.current).toEqual(['background']);
		act(() => board().setQuery('studio'));
		expect(result.current).toEqual([]);
	});

	it('keeps the same array while the shown keys are the same', () => {
		seedStates();
		const { result } = renderHook(() => useVisibleCategoryKeys());
		const before = result.current;

		act(() => useForbiddenRulesStore.getState().pickAssociationEndpoint({ mode: 'prompt', categoryName: 'Outfit', promptText: 'red dress', tagText: null }));

		expect(result.current).toBe(before);
	});

	it('no-ops when the filter does not change', () => {
		const before = board().filter;
		board().setQuery('');
		board().setStateFilter('any');
		board().clearFilter();
		expect(board().filter).toBe(before);
	});
});

describe('boardStore reveal', () => {
	it('clears only a filter that hides the card, expands it and the board region, and numbers the requests', () => {
		seedStates();
		useBoardStore.setState({ collapsed: ['lighting', 'outfit'], filter: { query: '', state: 'skipped' } });
		useLayoutStore.setState({ collapsed: { board: true, viewer: false, generation: false } });

		// Lighting is skipped: the filter shows it and stays.
		board().revealCategory('lighting');
		expect(board()).toMatchObject({
			filter: { query: '', state: 'skipped' },
			collapsed: ['outfit'],
			revealRequest: { key: 'lighting', serial: 1, editName: false },
		});
		expect(useLayoutStore.getState().collapsed.board).toBe(false);

		// Outfit is not skipped: the filter would hide it and is cleared.
		board().revealCategory('outfit', { editName: true });
		expect(board()).toMatchObject({ filter: { query: '', state: 'any' }, collapsed: [], revealRequest: { key: 'outfit', serial: 2, editName: true } });
	});

	it('a search that matches the card is kept; one that hides it is cleared', () => {
		seedCategories('Alpha', 'Beta');
		board().setQuery('alp');
		board().revealCategory('alpha');
		expect(board().filter.query).toBe('alp');
		board().revealCategory('beta');
		expect(board().filter.query).toBe('');
	});

	it('the board completes a request; an older completion and other cards leave it alone', () => {
		seedCategories('Alpha', 'Beta');
		const { result } = renderHook(() => ({ alpha: useCardRevealRequest('alpha'), beta: useCardRevealRequest('beta') }));

		act(() => board().revealCategory('alpha'));
		act(() => board().revealCategory('alpha'));
		expect(result.current).toEqual({ alpha: { key: 'alpha', serial: 2, editName: false }, beta: null });

		act(() => board().completeReveal(1));
		expect(result.current.alpha?.serial).toBe(2);
		act(() => board().completeReveal(2));
		expect(result.current).toEqual({ alpha: null, beta: null });

		// The next request gets a new serial although none is pending.
		act(() => board().revealCategory('beta'));
		expect(result.current.beta?.serial).toBe(3);
	});

	it('a pending request follows a rename and is dropped with its category', () => {
		seedCategories('Alpha', 'Beta');
		board().revealCategory('alpha', { editName: true });

		board().renameCategoryKey('alpha', 'gamma');
		expect(board().revealRequest).toEqual({ key: 'gamma', serial: 1, editName: true });
		board().forgetCategory('beta');
		expect(board().revealRequest?.key).toBe('gamma');
		board().forgetCategory('gamma');
		expect(board().revealRequest).toBeNull();
	});
});

describe('boardStore persistence', () => {
	// Shaped like a real legacy 'workspace-store' (version 0) file; synthetic names and numbers.
	const legacyWorkspace = {
		state: {
			windows: {
				'pane:image': { x: 16, y: 16, width: 420, height: 400, z: 1 },
				'category:subject': { x: 880, y: 16, width: 500, height: 256, z: 8 },
				'category:outfit': { x: 880, y: 284, width: 500, height: 296, z: 9 },
				'category:background': { x: 1392, y: 16, width: 512, height: 256, z: 11 },
			},
			hiddenPaneIds: ['models', 'images', 'characters'],
		},
		version: 0,
	};

	it('derives the order from the legacy workspace when it has no data of its own, and leaves it untouched', async () => {
		const memory = createMemoryStoreBackend({ 'workspace-store': legacyWorkspace });
		setStoreBackend(memory);

		expect(await hydratePersistedStores([useBoardStore])).toEqual([]);

		expect(board()).toMatchObject({ order: ['subject', 'background', 'outfit'], collapsed: [] });
		expect(await memory.read('workspace-store')).toEqual(legacyWorkspace);
		expect(await memory.read('board-store')).toBeNull();
	});

	it('derives the order from the older panel layouts too (a real-shaped 36-category layout)', async () => {
		// Shaped like a long-used 'panel-layouts-store' + 'workspace-z-index-store' pair (the stores older versions wrote):
		// pane rects ('pane-<id>'), category rects by key, rows lined up by hand, two overlapping rows; synthetic values.
		const names = Array.from({ length: 36 }, (_, index) => `category-${String(index + 1).padStart(2, '0')}`);
		const panels: Record<string, { x: number; y: number; width: number; height: number }> = {
			'pane-image': { x: 41, y: 13, width: 643, height: 979 },
			'pane-controls': { x: 700, y: 13, width: 520, height: 900 },
			'pane-details': { x: 1230, y: 13, width: 600, height: 400 },
		};
		const categoryZ: Record<string, number> = {};
		names.forEach((name, index) => {
			const row = Math.floor(index / 3);
			const column = index % 3;
			// Columns listed right to left; tops a few pixels apart inside a row; row 4 slid under row 3.
			panels[name] = { x: 24 + (2 - column) * 520, y: 24 + row * 300 - (row === 4 ? 80 : 0) + column * 9, width: 500, height: 286 };
			categoryZ[name] = 100 + index;
		});
		setStoreBackend(
			createMemoryStoreBackend({
				'panel-layouts-store': { state: { panels }, version: 0 },
				'workspace-z-index-store': { state: { maxZ: 200, paneZ: { image: 1, controls: 2, details: 3 }, categoryZ }, version: 0 },
			}),
		);
		useCategoriesStore.setState({ categories: [...names].reverse().map((name) => category(name)) });

		await hydratePersistedStores([useBoardStore]);

		// Read row by row, left to right: within each row of three, the last listed column comes first.
		const expected = Array.from({ length: 12 }, (_, row) => [2, 1, 0].map((column) => names[row * 3 + column])).flat();
		expect(board().order).toEqual(expected);
		const { result } = renderHook(() => useBoardOrder());
		expect(result.current).toEqual(expected);
		expect(board().collapsed).toEqual([]);
	});

	it('derives the order from the panel layouts of the oldest versions', async () => {
		setStoreBackend(
			createMemoryStoreBackend({
				'panel-layouts-store': {
					state: { panels: { 'pane-image': { x: 41, y: 13, width: 643, height: 979 }, boy: { x: 900, y: 300, width: 500, height: 280 }, main: { x: 24, y: 24, width: 700, height: 280 } } },
					version: 0,
				},
				'workspace-z-index-store': { state: { maxZ: 3, paneZ: { image: 1 }, categoryZ: { boy: 2, main: 3 } }, version: 0 },
			}),
		);

		await hydratePersistedStores([useBoardStore]);

		expect(board().order).toEqual(['main', 'boy']);
	});

	it('prefers its own data over the legacy workspace', async () => {
		setStoreBackend(
			createMemoryStoreBackend({
				'board-store': { state: { order: ['outfit'], collapsed: ['outfit', 7] }, version: 0 },
				'workspace-store': legacyWorkspace,
			}),
		);

		await hydratePersistedStores([useBoardStore]);

		expect(board()).toMatchObject({ order: ['outfit'], collapsed: ['outfit'] });
	});

	it('imports the order of app_state.json category positions (session store path)', () => {
		const placed = (name: string, x: number, y: number) => ({ name, position: { x, y }, size: { width: 300, height: 240 }, z_index: 1, prompts: [] });
		const windows = legacyWorkspaceWindows({
			categories: [placed('Main', 24, 24), placed('Clothed', 796, 30), placed('Hair', 24, 268), placed('Pose', 410, 268)],
		} as unknown as Parameters<typeof legacyWorkspaceWindows>[0]);
		useBoardStore.setState({ order: ['stale'], collapsed: ['stale'] });

		board().importLegacyWorkspace({ windows, hiddenPaneIds: [] });

		expect(board()).toMatchObject({ order: ['main', 'clothed', 'hair', 'pose'], collapsed: [] });
	});
});
