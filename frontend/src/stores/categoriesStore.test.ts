import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Category, SubPrompt } from '../domain/categories';
import { categoryMatcher, makeRule, specificMatcher, tagMatcher } from '../domain/forbiddenRules';
import { flushPersistence, hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import { ALICE_ID, BOB, BOB_ID, character } from '../test/characterData';
import {
	findCategory,
	selectReachability,
	useBulkText,
	useCategoriesStore,
	useCategoryKeys,
	useCategoryUiState,
	useSubPromptKeys,
	useSubPromptUiState,
} from './categoriesStore';
import { useCharactersStore } from './charactersStore';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { useNotificationsStore } from './notificationsStore';
import { useWorkspaceStore } from './workspaceStore';

function category(text: string, subPrompts: (string | Partial<SubPrompt>)[], extra: Partial<Category> = {}): Category {
	return {
		text,
		activation_text: '',
		priority: 1,
		state: 'normal',
		subPrompts: subPrompts.map((item) => ({ state: 'normal', extraLoraIds: [], text: '', ...(typeof item === 'string' ? { text: item } : item) })),
		...extra,
	};
}

function seed(...categories: Category[]): void {
	useCategoriesStore.setState({ categories });
}

const store = () => useCategoriesStore.getState();
const categories = () => useCategoriesStore.getState().categories;

function mockWorkspace() {
	const actions = { renameWindow: vi.fn(), removeWindow: vi.fn(), arrangeCategoryWindows: vi.fn() };
	useWorkspaceStore.setState(actions);
	return actions;
}

function mockRules() {
	const actions = {
		removeRulesForCategory: vi.fn(),
		removeRulesForSubPrompt: vi.fn(),
		renameCategoryInRules: vi.fn(),
		renameSubPromptInRules: vi.fn(),
	};
	useForbiddenRulesStore.setState(actions);
	return actions;
}

function notifications() {
	return useNotificationsStore.getState().notifications.map(({ intent, message }) => ({ intent, message }));
}

describe('categories', () => {
	it('adds uniquely named categories with one empty sub-prompt', () => {
		expect(store().addCategory()).toBe('new-category');
		expect(store().addCategory()).toBe('new-category-2');
		expect(categories()[1]).toEqual(category('new-category-2', ['']));
	});

	it('removes a category with its window and its forbidden rules', () => {
		const workspace = mockWorkspace();
		const rules = mockRules();
		seed(category('Alpha', ['a']), category('Beta', ['b']));

		store().removeCategory('alpha');

		expect(categories().map((item) => item.text)).toEqual(['Beta']);
		expect(workspace.removeWindow).toHaveBeenCalledWith('category:alpha');
		expect(rules.removeRulesForCategory).toHaveBeenCalledWith('Alpha');
		store().removeCategory('unknown');
		expect(workspace.removeWindow).toHaveBeenCalledOnce();
	});

	it('really drops the rules naming a removed category (forbidden rules store)', () => {
		mockWorkspace();
		const kept = makeRule(specificMatcher('Beta', 'b'), specificMatcher('Gamma', 'g'));
		useForbiddenRulesStore.setState({ rules: [makeRule(categoryMatcher('alpha'), specificMatcher('Beta', 'b')), kept] });
		seed(category('Alpha', ['a']), category('Beta', ['b']));

		store().removeCategory('alpha');

		expect(useForbiddenRulesStore.getState().rules).toEqual([kept]);
	});

	it('renames a category, its window key and its rules', () => {
		const workspace = mockWorkspace();
		const rules = mockRules();
		seed(category('Alpha', ['a']), category('Beta', ['b']));

		expect(store().renameCategory('alpha', 'Alpha 2')).toBe(true);

		expect(categories()[0].text).toBe('Alpha 2');
		expect(workspace.renameWindow).toHaveBeenCalledWith('category:alpha', 'category:alpha-2');
		expect(rules.renameCategoryInRules).toHaveBeenCalledWith('Alpha', 'Alpha 2');
	});

	it('keeps the window key when the key does not change and ignores no-op renames', () => {
		const workspace = mockWorkspace();
		const rules = mockRules();
		seed(category('Alpha', ['a']));

		expect(store().renameCategory('alpha', 'ALPHA')).toBe(true);
		expect(store().renameCategory('alpha', 'ALPHA')).toBe(true);

		expect(categories()[0].text).toBe('ALPHA');
		expect(workspace.renameWindow).not.toHaveBeenCalled();
		expect(rules.renameCategoryInRules).toHaveBeenCalledOnce();
	});

	it('rejects a rename onto another category key with a warning', () => {
		const workspace = mockWorkspace();
		seed(category('Alpha', ['a']), category('Beta', ['b']));

		expect(store().renameCategory('alpha', 'beta')).toBe(false);
		expect(store().renameCategory('unknown', 'x')).toBe(false);

		expect(categories().map((item) => item.text)).toEqual(['Alpha', 'Beta']);
		expect(workspace.renameWindow).not.toHaveBeenCalled();
		expect(notifications()).toEqual([{ intent: 'warning', message: "A category named 'beta' already exists." }]);
	});

	it('edits activation text, priority and state', () => {
		seed(category('Alpha', ['a']));
		const before = categories();
		store().setPriority('alpha', Number.NaN);
		store().setCategoryState('alpha', 'normal');
		expect(categories()).toBe(before);

		store().setActivationText('alpha', 'clothed');
		store().setPriority('alpha', 2.5);
		store().setCategoryState('alpha', 'skip');

		expect(categories()[0]).toMatchObject({ activation_text: 'clothed', priority: 2.5, state: 'skip' });
	});

	it('reorganizes: sorts, renumbers priorities and arranges the windows with estimated sizes', () => {
		// The workspace store replaces an estimate by the window's stored size (workspaceStore.test.ts).
		const workspace = mockWorkspace();
		seed(category('Gamma', ['g'], { priority: 7 }), category('Beta', ['b'], { priority: 2 }), category('Alpha', ['a'], { priority: 2 }));

		store().reorganize();

		expect(categories().map((item) => [item.text, item.priority])).toEqual([
			['Alpha', 1],
			['Beta', 2],
			['Gamma', 3],
		]);
		expect(workspace.arrangeCategoryWindows).toHaveBeenCalledWith(
			[
				{ key: 'category:alpha', preferred: { width: 300, height: 168 } },
				{ key: 'category:beta', preferred: { width: 300, height: 168 } },
				{ key: 'category:gamma', preferred: { width: 300, height: 168 } },
			],
			{ width: window.innerWidth, height: window.innerHeight },
		);
	});

	it('replaceAll sanitizes the categories', () => {
		store().replaceAll([
			category('Main', [{ text: 'a', state: 'lock' }, { text: 'b', state: 'lock' }, 'A']),
			category('main', ['x']),
		]);
		expect(categories()).toEqual([
			category('Main', [{ text: 'a', state: 'lock' }, { text: 'b', state: 'normal' }]),
			category('main-2', ['x']),
		]);
	});
});

describe('sub-prompts', () => {
	it('adds an empty sub-prompt once (legacy duplicate warning)', () => {
		seed(category('Alpha', ['a']));
		store().addSubPrompt('alpha');
		store().addSubPrompt('alpha');
		expect(categories()[0].subPrompts.map((item) => item.text)).toEqual(['a', '']);
		expect(notifications()).toEqual([{ intent: 'warning', message: "Category 'Alpha' cannot contain multiple sub-prompts with the same id." }]);
	});

	it('appends a sub-prompt with a text', () => {
		const rules = mockRules();
		seed(category('Alpha', ['a1', '']), category('Beta', ['b']));
		const beta = categories()[1];

		expect(store().addSubPromptWithText('alpha', 'castle, sky, snowing')).toBe(true);

		expect(categories()[0].subPrompts).toEqual([
			{ text: 'a1', state: 'normal', extraLoraIds: [] },
			{ text: '', state: 'normal', extraLoraIds: [] },
			{ text: 'castle, sky, snowing', state: 'normal', extraLoraIds: [] },
		]);
		expect(categories()[1]).toBe(beta);
		expect(rules.renameSubPromptInRules).not.toHaveBeenCalled();
		expect(notifications()).toEqual([]);
	});

	it('rejects blank texts, unknown categories and duplicates (the duplicate warning of setSubPromptText)', () => {
		seed(category('Alpha', ['castle, sky']));
		const before = categories();

		expect(store().addSubPromptWithText('alpha', '')).toBe(false);
		expect(store().addSubPromptWithText('alpha', '  ')).toBe(false);
		expect(store().addSubPromptWithText('unknown', 'x')).toBe(false);
		expect(notifications()).toEqual([]);

		expect(store().addSubPromptWithText('alpha', 'Castle,  Sky')).toBe(false);
		expect(categories()).toBe(before);
		expect(notifications()).toEqual([{ intent: 'warning', message: "Category 'Alpha' cannot contain multiple sub-prompts with the same id." }]);
	});

	it('edits a sub-prompt text and rewrites its exact rules', () => {
		const rules = mockRules();
		seed(category('Alpha', ['a1', 'a2']));

		expect(store().setSubPromptText('alpha', 'a1', 'a1, new')).toBe(true);
		expect(store().setSubPromptText('alpha', 'a1-new', 'a1, new')).toBe(true);

		expect(categories()[0].subPrompts.map((item) => item.text)).toEqual(['a1, new', 'a2']);
		expect(rules.renameSubPromptInRules).toHaveBeenCalledOnce();
		expect(rules.renameSubPromptInRules).toHaveBeenCalledWith('Alpha', 'a1', 'a1, new');
	});

	it('rejects duplicate sub-prompt texts with the legacy warning', () => {
		const rules = mockRules();
		seed(category('', ['a1', 'a2']));

		expect(store().setSubPromptText('id', 'a1', 'A2')).toBe(false);
		expect(store().setSubPromptText('id', 'unknown', 'x')).toBe(false);

		expect(categories()[0].subPrompts.map((item) => item.text)).toEqual(['a1', 'a2']);
		expect(rules.renameSubPromptInRules).not.toHaveBeenCalled();
		expect(notifications()).toEqual([
			{ intent: 'warning', message: "Category '(unnamed category)' cannot contain multiple sub-prompts with the same id." },
		]);
	});

	it('keeps a single lock per category', () => {
		seed(category('Alpha', [{ text: 'a1', state: 'lock' }, 'a2', { text: 'a3', state: 'skip' }]));
		store().setSubPromptState('alpha', 'a2', 'lock');
		expect(categories()[0].subPrompts.map((item) => item.state)).toEqual(['normal', 'lock', 'skip']);
		store().setSubPromptState('alpha', 'a3', 'normal');
		expect(categories()[0].subPrompts.map((item) => item.state)).toEqual(['normal', 'lock', 'normal']);
	});

	it('sets unique extra LoRA ids and unlinks LoRAs everywhere', () => {
		seed(category('Alpha', ['a1', 'a2']), category('Beta', ['b']));
		store().setSubPromptExtraLoraIds('alpha', 'a1', ['x', 'y', 'x']);
		store().setSubPromptExtraLoraIds('alpha', 'a2', ['y']);
		expect(categories()[0].subPrompts.map((item) => item.extraLoraIds)).toEqual([['x', 'y'], ['y']]);

		const beta = categories()[1];
		store().unlinkLora('y');
		expect(categories()[0].subPrompts.map((item) => item.extraLoraIds)).toEqual([['x'], []]);
		expect(categories()[1]).toBe(beta);
		const before = categories();
		store().unlinkLora('unknown');
		expect(categories()).toBe(before);
	});

	it('removes a sub-prompt and its exact rules', () => {
		const rules = mockRules();
		seed(category('Alpha', ['a1', 'a2']));
		store().removeSubPrompt('alpha', 'a1');
		store().removeSubPrompt('alpha', 'unknown');
		expect(categories()[0].subPrompts.map((item) => item.text)).toEqual(['a2']);
		expect(rules.removeRulesForSubPrompt).toHaveBeenCalledOnce();
		expect(rules.removeRulesForSubPrompt).toHaveBeenCalledWith('Alpha', 'a1');
	});

	it('applies the bulk text keeping unchanged sub-prompts and dropping duplicates', () => {
		seed(category('Alpha', [{ text: 'a1', state: 'lock', extraLoraIds: ['x'] }, { text: 'a2', state: 'skip' }]));

		store().applyBulkText('alpha', 'a1\n|\nnew\n|\nNEW\n|\na2 changed');

		expect(categories()[0].subPrompts).toEqual([
			{ text: 'a1', state: 'lock', extraLoraIds: ['x'] },
			{ text: 'new', state: 'normal', extraLoraIds: [] },
			{ text: 'a2 changed', state: 'normal', extraLoraIds: [] },
		]);
		expect(notifications()).toEqual([{ intent: 'warning', message: "1 duplicate sub-prompt(s) of 'Alpha' were dropped." }]);

		const before = categories();
		store().applyBulkText('alpha', 'a1\n|\nnew\n|\na2 changed');
		expect(categories()).toBe(before);
	});
});

describe('selectors and hooks', () => {
	it('finds categories and exposes stable key lists', () => {
		seed(category('Alpha', ['a1', 'a2']));
		expect(findCategory(categories(), 'alpha')?.text).toBe('Alpha');
		const { result } = renderHook(() => ({ keys: useCategoryKeys(), promptKeys: useSubPromptKeys('alpha') }));
		const first = result.current;
		act(() => store().setActivationText('alpha', 'x'));
		expect(result.current.keys).toBe(first.keys);
		expect(result.current.promptKeys).toEqual(['a1', 'a2']);
		expect(result.current.promptKeys).toBe(first.promptKeys);
	});

	it('useBulkText joins the sub-prompts with the bulk separator', () => {
		seed(category('Alpha', ['a1', 'a2']));
		const { result } = renderHook(() => useBulkText('alpha'));
		expect(result.current).toBe('a1\n|\na2');
		act(() => store().addSubPrompt('alpha'));
		expect(result.current).toBe('a1\n|\na2\n|\n');
	});

	it('derives ui states from categories and forbidden rules (one shared snapshot)', () => {
		seed(category('Alpha', [{ text: 'a1', state: 'lock' }]), category('Beta', ['b1', 'b2'], { priority: 2 }));
		const { result } = renderHook(() => ({
			beta: useCategoryUiState('beta'),
			b1: useSubPromptUiState('beta', 'b1'),
			a1: useSubPromptUiState('alpha', 'a1'),
		}));
		expect(result.current).toEqual({ beta: 'normal', b1: 'normal', a1: 'lock' });

		act(() => useForbiddenRulesStore.setState({ rules: [makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b1'))] }));
		expect(result.current).toEqual({ beta: 'normal', b1: 'indirectly-disabled', a1: 'lock' });

		act(() => useForbiddenRulesStore.setState({ rules: [makeRule(specificMatcher('Alpha', 'a1'), categoryMatcher('Beta'))] }));
		expect(result.current.beta).toBe('indirectly-disabled');

		const rules = useForbiddenRulesStore.getState().rules;
		expect(selectReachability(categories(), rules)).toBe(selectReachability(categories(), rules));
	});

	it('ui states include the active character: what it forbids is indirectly-disabled, what it activates is reachable', () => {
		seed(category('Hair', ['black hair', 'short hair']), category('Accessories', ['hair ribbon'], { priority: 2, activation_text: 'silver hair' }));
		useForbiddenRulesStore.setState({ rules: [makeRule(tagMatcher('Character', 'silver hair'), specificMatcher('Hair', 'short hair'))] });
		useCharactersStore.setState({ characters: [character(), BOB], activeId: null });
		const { result } = renderHook(() => ({
			hair: useCategoryUiState('hair'),
			shortHair: useSubPromptUiState('hair', 'short-hair'),
			blackHair: useSubPromptUiState('hair', 'black-hair'),
			accessories: useCategoryUiState('accessories'),
			ribbon: useSubPromptUiState('accessories', 'hair-ribbon'),
		}));
		expect(result.current).toEqual({ hair: 'normal', shortHair: 'normal', blackHair: 'normal', accessories: 'indirectly-disabled', ribbon: 'indirectly-disabled' });

		act(() => useCharactersStore.setState({ activeId: ALICE_ID }));
		expect(result.current).toEqual({ hair: 'normal', shortHair: 'indirectly-disabled', blackHair: 'normal', accessories: 'normal', ribbon: 'normal' });

		act(() => useCharactersStore.setState({ activeId: BOB_ID }));
		expect(result.current).toEqual({ hair: 'normal', shortHair: 'normal', blackHair: 'normal', accessories: 'indirectly-disabled', ribbon: 'indirectly-disabled' });
	});

	it('selectReachability is memoized on (categories, rules, character)', () => {
		seed(category('Alpha', ['a1']));
		const rules = useForbiddenRulesStore.getState().rules;
		const alice = character();
		const withAlice = selectReachability(categories(), rules, alice);
		expect(selectReachability(categories(), rules, alice)).toBe(withAlice);
		expect(selectReachability(categories(), rules, BOB)).not.toBe(withAlice);
		expect(selectReachability(categories(), rules)).toEqual(selectReachability(categories(), rules, BOB));
	});
});

describe('persistence', () => {
	it('round-trips the real categorie-store format', async () => {
		const envelope = {
			state: {
				categories: [
					{
						text: 'girl frontline',
						activation_text: '',
						priority: 1,
						state: 'skip',
						subPrompts: [{ text: '<lora:Groza-10:1>, Groza', state: 'normal', extraLoraIds: [] }],
					},
					{
						text: 'Groza clothes',
						activation_text: 'Groza',
						priority: 2,
						state: 'normal',
						subPrompts: [
							{ text: 'jacket', state: 'lock', extraLoraIds: ['shion'] },
							{ text: '', state: 'normal', extraLoraIds: [] },
						],
					},
				],
			},
			version: 0,
		};
		const backend = createMemoryStoreBackend({ 'categorie-store': envelope });
		setStoreBackend(backend);

		expect(await hydratePersistedStores([useCategoriesStore])).toEqual([]);
		expect(categories()).toEqual(envelope.state.categories);

		store().setCategoryState('girl-frontline', 'normal');
		await flushPersistence();

		const written = backend.snapshot()['categorie-store'];
		expect(written.version).toBe(0);
		expect(written.state).toEqual({
			categories: [{ ...envelope.state.categories[0], state: 'normal' }, envelope.state.categories[1]],
		});
	});

	it('sanitizes invalid persisted categories on hydration', async () => {
		setStoreBackend(
			createMemoryStoreBackend({
				'categorie-store': {
					state: { categories: [{ text: 'A', priority: 1, state: 'indirectly-disabled', subPrompts: [{ text: 'x', state: 'lock' }, { text: 'x' }] }] },
					version: 0,
				},
			}),
		);
		await hydratePersistedStores([useCategoriesStore]);
		expect(categories()).toEqual([category('A', [{ text: 'x', state: 'lock' }])]);
	});

	it('keeps the defaults when nothing is persisted', async () => {
		await hydratePersistedStores([useCategoriesStore]);
		expect(categories()).toEqual([]);
	});
});
