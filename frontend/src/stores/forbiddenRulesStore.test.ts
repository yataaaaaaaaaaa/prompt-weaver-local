import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GenerationSelection, OutputRecord } from '../api/types';
import type { Category, SubPromptState } from '../domain/categories';
import {
	categoryMatcher,
	containsMatcher,
	makeRule,
	specificMatcher,
	tagMatcher,
	type AssociationEndpoint,
} from '../domain/forbiddenRules';
import { flushPersistence, hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import { character } from '../test/characterData';
import { useCategoriesStore } from './categoriesStore';
import { useCharactersStore } from './charactersStore';
import {
	buildUsedSelectionRows,
	categoryWindowVisualState,
	highlightVisualState,
	subPromptVisualState,
	useCategoryForbiddenHighlight,
	useCategoryWindowState,
	useForbiddenHighlight,
	useForbiddenRulesStore,
	useIsCategoryDesignated,
	useIsSubPromptDesignated,
	useSubPromptVisualState,
	useUsedSelectionRows,
} from './forbiddenRulesStore';
import { useOutputsStore } from './outputsStore';

const store = () => useForbiddenRulesStore.getState();
const rules = () => useForbiddenRulesStore.getState().rules;

function endpoint(mode: AssociationEndpoint['mode'], categoryName: string, promptText: string, tagText: string | null = null): AssociationEndpoint {
	return { mode, categoryName, promptText, tagText };
}

function selection(category_name: string, prompt_text: string, locked = false): GenerationSelection {
	return { category_name, prompt_text, locked, induced_lora_ids: [] };
}

function record(selections: GenerationSelection[]): OutputRecord {
	return {
		output_id: '0000000001',
		generated_at: '2026-01-01T00:00:00Z',
		image_path: 'D:/out/0000000001.png',
		metadata_path: 'D:/out/0000000001.json',
		model_id: 'model',
		active_loras: [],
		character: null,
		prompt: selections.map((item) => item.prompt_text).join(', '),
		negative_prompt: '',
		width: 1024,
		height: 1024,
		steps: 30,
		guidance_scale: 7,
		seed: 1,
		image_seed: 1,
		prompt_seed: 1,
		selections,
	};
}

describe('association picking (Used sub-prompts pane clicks)', () => {
	const alphaPrompt = endpoint('prompt', 'Alpha', 'a1, smile');
	const betaPrompt = endpoint('prompt', 'Beta', 'b1');

	it('first click selects the source, a click on another row toggles the rule and clears the source', () => {
		store().pickAssociationEndpoint(alphaPrompt);
		expect(store().associationSource).toEqual(alphaPrompt);

		store().pickAssociationEndpoint(betaPrompt);
		expect(rules()).toEqual([makeRule(specificMatcher('Alpha', 'a1, smile'), specificMatcher('Beta', 'b1'))]);
		expect(store().associationSource).toBeNull();

		store().pickAssociationEndpoint(betaPrompt);
		store().pickAssociationEndpoint(alphaPrompt);
		expect(rules()).toEqual([]);
	});

	it('the same endpoint, the same row or a category endpoint of the source category only clear the source', () => {
		store().pickAssociationEndpoint(alphaPrompt);
		store().pickAssociationEndpoint(alphaPrompt);
		expect(store().associationSource).toBeNull();

		store().pickAssociationEndpoint(alphaPrompt);
		store().pickAssociationEndpoint(endpoint('tag', 'Alpha', 'a1, smile', 'smile'));
		expect(store().associationSource).toBeNull();

		store().pickAssociationEndpoint(endpoint('tag', 'Alpha', 'a1, smile', 'smile'));
		store().pickAssociationEndpoint(endpoint('category', 'alpha', 'other prompt'));
		expect(store().associationSource).toBeNull();
		expect(rules()).toEqual([]);
	});

	it('creates category and tag rules', () => {
		store().pickAssociationEndpoint(endpoint('tag', 'Alpha', 'a1, Smile', 'Smile'));
		store().pickAssociationEndpoint(endpoint('category', 'Beta', 'b1'));
		expect(rules()).toEqual([makeRule(tagMatcher('Alpha', 'smile'), categoryMatcher('Beta'))]);
		store().pickAssociationEndpoint(alphaPrompt);
		store().clearAssociationSource();
		expect(store().associationSource).toBeNull();
	});
});

describe('rules maintenance actions', () => {
	const exact = makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b1'));
	const contains = makeRule(containsMatcher(null, 'boy'), categoryMatcher('Gamma'));

	it('replaceAll sanitizes legacy rules', () => {
		store().replaceAll([{ left: { kind: 'specific', category_name: 'Alpha', prompt_text: 'a1', contains_text: null }, right: exact.right } as never]);
		expect(rules()).toEqual([exact]);
	});

	it('removes and renames through the domain helpers, without writes when nothing changes', () => {
		useForbiddenRulesStore.setState({ rules: [exact, contains] });
		const before = rules();
		store().removeRulesForCategory('Unknown');
		store().renameCategoryInRules('Unknown', 'X');
		store().removeRulesForSubPrompt('Alpha', 'unknown');
		store().renameSubPromptInRules('Alpha', 'unknown', 'x');
		expect(rules()).toBe(before);

		store().renameSubPromptInRules('alpha', 'A1', 'a1 v2');
		expect(rules()[0].left).toEqual(specificMatcher('Alpha', 'a1 v2'));
		store().renameCategoryInRules('Gamma', 'Delta');
		expect(rules()[1].right).toEqual(categoryMatcher('Delta'));
		store().removeRulesForSubPrompt('Beta', 'b1');
		expect(rules()).toEqual([makeRule(containsMatcher(null, 'boy'), categoryMatcher('Delta'))]);
		store().removeRulesForCategory('delta');
		expect(rules()).toEqual([]);
	});
});

describe('useUsedSelectionRows', () => {
	it('builds one row per selection with tags, source and forbidden flags', () => {
		useOutputsStore.setState({ record: record([selection('Alpha', 'a1, Smile, smile', true), selection('Beta', 'b1')]) });
		useForbiddenRulesStore.setState({
			rules: [makeRule(specificMatcher('Alpha', 'a1, Smile, smile'), categoryMatcher('Beta'))],
			associationSource: endpoint('prompt', 'Alpha', 'a1, Smile, smile'),
		});

		const { result, rerender } = renderHook(() => useUsedSelectionRows());

		const [alpha, beta] = result.current;
		expect(alpha).toMatchObject({ index: 0, categoryName: 'Alpha', locked: true, isPromptSource: true, isCategorySource: false });
		expect(alpha.tags.map((tag) => tag.tagText)).toEqual(['a1', 'Smile']);
		expect(alpha.tags[1].endpoint).toEqual(endpoint('tag', 'Alpha', 'a1, Smile, smile', 'Smile'));
		expect(beta).toMatchObject({ index: 1, isPromptForbidden: false, isCategoryForbidden: true, isPromptSource: false });

		const first = result.current;
		rerender();
		expect(result.current).toBe(first);

		act(() => store().clearAssociationSource());
		expect(result.current[1].isCategoryForbidden).toBe(false);
	});

	it('is empty without a current output', () => {
		expect(buildUsedSelectionRows([], [], null)).toEqual([]);
		const { result } = renderHook(() => useUsedSelectionRows());
		expect(result.current).toEqual([]);
	});

	it('flags tag sources and tag rules', () => {
		const rows = buildUsedSelectionRows(
			[selection('Alpha', 'x, smile'), selection('Beta', 'b1')],
			[makeRule(specificMatcher('Beta', 'b1'), tagMatcher('Alpha', 'smile'))],
			endpoint('prompt', 'Beta', 'b1'),
		);
		expect(rows[0].tags.map((tag) => tag.isForbidden)).toEqual([false, true]);
		expect(rows[1].isPromptSource).toBe(true);
	});
});

describe('useForbiddenHighlight', () => {
	const categories: Category[] = [
		{ text: 'Alpha', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: 'a1', state: 'normal', extraLoraIds: [] }] },
		{
			text: 'Beta',
			activation_text: '',
			priority: 2,
			state: 'normal',
			subPrompts: [
				{ text: 'b1', state: 'normal', extraLoraIds: [] },
				{ text: 'b2', state: 'lock', extraLoraIds: [] },
				{ text: 'b3', state: 'normal', extraLoraIds: [] },
			],
		},
	];

	it('highlights sub-prompts forbidden with the source (purple when locked)', () => {
		useCategoriesStore.setState({ categories });
		useForbiddenRulesStore.setState({
			rules: [makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b1')), makeRule(specificMatcher('Alpha', 'a1'), specificMatcher('Beta', 'b2'))],
		});
		const { result } = renderHook(() => ({
			b1: useForbiddenHighlight('beta', 'b1'),
			b2: useForbiddenHighlight('beta', 'b2'),
			b3: useForbiddenHighlight('beta', 'b3'),
		}));
		expect(result.current).toEqual({ b1: 'none', b2: 'none', b3: 'none' });

		act(() => store().pickAssociationEndpoint(endpoint('prompt', 'Alpha', 'a1')));
		expect(result.current).toEqual({ b1: 'forbidden', b2: 'forbidden-locked', b3: 'none' });

		act(() => store().clearAssociationSource());
		expect(result.current.b1).toBe('none');
	});

	it('a source from the active character (Used sub-prompts) is locked: purple highlights', () => {
		const alice = character({ outfit_tags: [] });
		useCategoriesStore.setState({ categories });
		useForbiddenRulesStore.setState({ rules: [makeRule(specificMatcher('Character', '1girl, silver hair, blue eyes'), specificMatcher('Beta', 'b1'))] });
		useCharactersStore.setState({ characters: [alice], activeId: null });
		const { result } = renderHook(() => useForbiddenHighlight('beta', 'b1'));

		act(() => store().pickAssociationEndpoint(endpoint('prompt', 'Character', '1girl, silver hair, blue eyes')));
		expect(result.current).toBe('forbidden');

		act(() => useCharactersStore.setState({ activeId: alice.id }));
		expect(result.current).toBe('forbidden-locked');
	});
});

describe('persistence', () => {
	it('round-trips the real forbidden-associations-store format (rules with and without tag_text)', async () => {
		const withoutTag = {
			left: { kind: 'specific', category_name: 'NSFW', prompt_text: 'missionary, sex', contains_text: null },
			right: { kind: 'specific', category_name: 'bottom_clothed', prompt_text: 'pants', contains_text: null },
		};
		const withTag = {
			left: { kind: 'tag', category_name: 'NSFW', prompt_text: null, contains_text: null, tag_text: 'sideboob' },
			right: { kind: 'specific', category_name: 'Openess', prompt_text: null, contains_text: null, tag_text: null },
		};
		const backend = createMemoryStoreBackend({ 'forbidden-associations-store': { state: { rules: [withoutTag, withTag] }, version: 0 } });
		setStoreBackend(backend);

		expect(await hydratePersistedStores([useForbiddenRulesStore])).toEqual([]);
		const hydratedWithoutTag = { left: { ...withoutTag.left, tag_text: null }, right: { ...withoutTag.right, tag_text: null } };
		expect(rules()).toEqual([hydratedWithoutTag, withTag]);

		store().toggleAssociation(endpoint('prompt', 'Alpha', 'a1'), endpoint('category', 'Beta', 'b1'));
		store().pickAssociationEndpoint(endpoint('prompt', 'Alpha', 'a1'));
		await flushPersistence();

		const written = backend.snapshot()['forbidden-associations-store'];
		expect(written).toEqual({
			state: { rules: [hydratedWithoutTag, withTag, makeRule(specificMatcher('Alpha', 'a1'), categoryMatcher('Beta'))] },
			version: 0,
		});
	});
});

describe('visual states (pure mappings)', () => {
	it('highlightVisualState: red, purple, none', () => {
		expect(highlightVisualState('forbidden')).toBe('forbidden');
		expect(highlightVisualState('forbidden-locked')).toBe('forbiddenLocked');
		expect(highlightVisualState('none')).toBeNull();
	});

	const plainRow = { uiState: 'normal', highlight: 'none', designated: false, current: false } as const;

	it('subPromptVisualState maps each input alone', () => {
		expect(subPromptVisualState(plainRow)).toBeNull();
		expect(subPromptVisualState({ ...plainRow, highlight: 'forbidden' })).toBe('forbidden');
		expect(subPromptVisualState({ ...plainRow, highlight: 'forbidden-locked' })).toBe('forbiddenLocked');
		expect(subPromptVisualState({ ...plainRow, designated: true })).toBe('associated');
		expect(subPromptVisualState({ ...plainRow, current: true })).toBe('current');
		expect(subPromptVisualState({ ...plainRow, uiState: 'lock' })).toBe('locked');
		expect(subPromptVisualState({ ...plainRow, uiState: 'indirectly-disabled' })).toBe('indirectlyDisabled');
		expect(subPromptVisualState({ ...plainRow, uiState: 'skip' })).toBe('skipped');
	});

	it('subPromptVisualState: forbiddenLocked > forbidden > associated > current > locked > indirectlyDisabled > skipped', () => {
		const everything = { uiState: 'lock', highlight: 'forbidden-locked', designated: true, current: true } as const;
		expect(subPromptVisualState(everything)).toBe('forbiddenLocked');
		expect(subPromptVisualState({ ...everything, highlight: 'forbidden' })).toBe('forbidden');
		expect(subPromptVisualState({ ...everything, highlight: 'none' })).toBe('associated');
		expect(subPromptVisualState({ ...everything, highlight: 'none', designated: false })).toBe('current');
		expect(subPromptVisualState({ ...plainRow, uiState: 'indirectly-disabled', current: true })).toBe('current');
		expect(subPromptVisualState({ ...plainRow, uiState: 'skip', highlight: 'forbidden' })).toBe('forbidden');
		expect(subPromptVisualState({ ...plainRow, uiState: 'indirectly-disabled', designated: true })).toBe('associated');
	});

	const plainWindow = { uiState: 'normal', highlight: 'none', designated: false } as const;

	it('categoryWindowVisualState: forbiddenLocked > forbidden > associated > indirectlyDisabled > skipped', () => {
		expect(categoryWindowVisualState(plainWindow)).toBeNull();
		expect(categoryWindowVisualState({ ...plainWindow, uiState: 'skip' })).toBe('skipped');
		expect(categoryWindowVisualState({ ...plainWindow, uiState: 'indirectly-disabled' })).toBe('indirectlyDisabled');
		expect(categoryWindowVisualState({ ...plainWindow, uiState: 'indirectly-disabled', designated: true })).toBe('associated');
		expect(categoryWindowVisualState({ ...plainWindow, uiState: 'skip', designated: true, highlight: 'forbidden' })).toBe('forbidden');
		expect(categoryWindowVisualState({ uiState: 'skip', designated: true, highlight: 'forbidden-locked' })).toBe('forbiddenLocked');
	});
});

describe('Used sub-prompts states (buildUsedSelectionRows)', () => {
	const locks: Category[] = [
		{ text: 'Subject', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: '1girl', state: 'lock', extraLoraIds: [] }] },
	];
	const selections = [selection('Subject', '1girl', true), selection('Outfit', 'red dress'), selection('Mood', 'smiling, happy')];

	it('the source is associated, its row too; nothing else without rules', () => {
		const rows = buildUsedSelectionRows(selections, [], endpoint('prompt', 'Outfit', 'red dress'), locks);
		expect(rows.map((row) => [row.promptState, row.categoryState, row.state])).toEqual([
			[null, null, null],
			['associated', null, 'associated'],
			[null, null, null],
		]);
	});

	it('an endpoint forbidden with the source is red; purple when the source or the row prompt is locked', () => {
		const rules = [
			makeRule(specificMatcher('Outfit', 'red dress'), specificMatcher('Mood', 'smiling, happy')),
			makeRule(specificMatcher('Outfit', 'red dress'), specificMatcher('Subject', '1girl')),
			makeRule(specificMatcher('Subject', '1girl'), categoryMatcher('Mood')),
		];
		const fromDress = buildUsedSelectionRows(selections, rules, endpoint('prompt', 'Outfit', 'red dress'), locks);
		expect(fromDress[2]).toMatchObject({ isPromptForbidden: true, promptState: 'forbidden', categoryState: null, state: 'forbidden' });
		expect(fromDress[0]).toMatchObject({ isPromptForbidden: true, promptState: 'forbiddenLocked', state: 'forbiddenLocked' });

		const fromSubject = buildUsedSelectionRows(selections, rules, endpoint('prompt', 'Subject', '1girl'), locks);
		expect(fromSubject[2]).toMatchObject({ promptState: null, categoryState: 'forbiddenLocked', state: 'forbiddenLocked' });
		expect(fromSubject[0]).toMatchObject({ promptState: 'associated', state: 'associated' });

		// Without lock sources (e.g. the lock was removed since): plain red.
		expect(buildUsedSelectionRows(selections, rules, endpoint('prompt', 'Subject', '1girl'))[2].categoryState).toBe('forbidden');
	});

	it('tag chips: the source tag is associated, a forbidden tag red, and the row takes the strongest state', () => {
		const rules = [makeRule(specificMatcher('Outfit', 'red dress'), tagMatcher('Mood', 'happy'))];
		const rows = buildUsedSelectionRows(selections, rules, endpoint('prompt', 'Outfit', 'red dress'), locks);
		expect(rows[2].tags.map((tag) => [tag.tagText, tag.state])).toEqual([
			['smiling', null],
			['happy', 'forbidden'],
		]);
		expect(rows[2].state).toBe('forbidden');

		const fromTag = buildUsedSelectionRows(selections, rules, endpoint('tag', 'Mood', 'smiling, happy', 'happy'), locks);
		expect(fromTag[2].tags.map((tag) => tag.state)).toEqual([null, 'associated']);
		expect(fromTag[2].state).toBe('associated');
		expect(fromTag[1].promptState).toBe('forbidden');
	});

	it('useUsedSelectionRows reads the locks of the categories and of the active character', () => {
		const alice = character({ outfit_tags: [] });
		useOutputsStore.setState({ record: record([selection('Character', '1girl, silver hair, blue eyes', true), selection('Outfit', 'red dress')]) });
		useForbiddenRulesStore.setState({
			rules: [makeRule(specificMatcher('Character', '1girl, silver hair, blue eyes'), specificMatcher('Outfit', 'red dress'))],
			associationSource: endpoint('prompt', 'Outfit', 'red dress'),
		});
		useCharactersStore.setState({ characters: [alice], activeId: null });
		const { result } = renderHook(() => useUsedSelectionRows());
		expect(result.current[0].promptState).toBe('forbidden');

		act(() => useCharactersStore.setState({ activeId: alice.id }));
		expect(result.current[0].promptState).toBe('forbiddenLocked');
	});
});

describe('row and window visual-state hooks', () => {
	function fixtureCategory(text: string, subPrompts: [string, SubPromptState?][], extra: Partial<Category> = {}): Category {
		return {
			text,
			activation_text: '',
			priority: 1,
			state: 'normal',
			subPrompts: subPrompts.map(([promptText, state = 'normal']) => ({ text: promptText, state, extraLoraIds: [] })),
			...extra,
		};
	}

	// A small version of the e2e fixture (backend/tests/e2e/fixtures).
	const fixture: Category[] = [
		fixtureCategory('Subject', [['1girl, silver hair', 'lock'], ['1boy']], { priority: 1 }),
		fixtureCategory('Outfit', [['red dress'], ['armor', 'skip'], ['swimsuit']], { priority: 2 }),
		fixtureCategory('Background', [['neon street, rain'], ['beach']], { priority: 3 }),
		fixtureCategory('Lighting', [['studio']], { priority: 4, state: 'skip' }),
		fixtureCategory('Sea', [['jellyfish']], { priority: 5, activation_text: 'underwater' }),
	];
	const fixtureRules = [
		makeRule(specificMatcher('Subject', '1girl, silver hair'), specificMatcher('Outfit', 'swimsuit')),
		makeRule(specificMatcher('Outfit', 'red dress'), specificMatcher('Background', 'beach')),
		makeRule(categoryMatcher('Background'), categoryMatcher('Sea')),
	];

	function renderStates() {
		useCategoriesStore.setState({ categories: fixture });
		useForbiddenRulesStore.setState({ rules: fixtureRules });
		useOutputsStore.setState({ record: record([selection('Subject', '1girl, silver hair', true), selection('Outfit', 'red dress')]) });
		return renderHook(() => ({
			rows: {
				girl: useSubPromptVisualState('subject', '1girl-silver-hair'),
				boy: useSubPromptVisualState('subject', '1boy'),
				dress: useSubPromptVisualState('outfit', 'red-dress'),
				armor: useSubPromptVisualState('outfit', 'armor'),
				swimsuit: useSubPromptVisualState('outfit', 'swimsuit'),
				neon: useSubPromptVisualState('background', 'neon-street-rain'),
				beach: useSubPromptVisualState('background', 'beach'),
				studio: useSubPromptVisualState('lighting', 'studio'),
				jellyfish: useSubPromptVisualState('sea', 'jellyfish'),
			},
			windows: {
				subject: useCategoryWindowState('subject'),
				outfit: useCategoryWindowState('outfit'),
				background: useCategoryWindowState('background'),
				lighting: useCategoryWindowState('lighting'),
				sea: useCategoryWindowState('sea'),
			},
		}));
	}

	it('without a source: current, locked, unreachable and skipped', () => {
		const { result } = renderStates();
		expect(result.current.rows).toEqual({
			girl: 'current',
			boy: 'indirectlyDisabled',
			dress: 'current',
			armor: 'skipped',
			swimsuit: 'indirectlyDisabled',
			neon: null,
			beach: null,
			studio: 'skipped',
			jellyfish: 'indirectlyDisabled',
		});
		expect(result.current.windows).toEqual({ subject: null, outfit: null, background: null, lighting: 'skipped', sea: 'indirectlyDisabled' });

		act(() => useOutputsStore.setState({ record: null }));
		expect(result.current.rows.girl).toBe('locked');
	});

	it('a P source: its row and window associated, what it forbids red', () => {
		const { result } = renderStates();
		act(() => useForbiddenRulesStore.getState().pickAssociationEndpoint(endpoint('prompt', 'Outfit', 'red dress')));
		expect(result.current.rows).toMatchObject({ dress: 'associated', armor: 'skipped', beach: 'forbidden', neon: null });
		expect(result.current.windows).toMatchObject({ outfit: 'associated', background: 'forbidden', subject: null });
	});

	it('a locked P source: what it forbids is purple, in the row and its window', () => {
		const { result } = renderStates();
		act(() => useForbiddenRulesStore.getState().pickAssociationEndpoint(endpoint('prompt', 'Subject', '1girl, silver hair')));
		expect(result.current.rows).toMatchObject({ girl: 'associated', swimsuit: 'forbiddenLocked', dress: 'current' });
		expect(result.current.windows).toMatchObject({ subject: 'associated', outfit: 'forbiddenLocked' });
	});

	it('a C source: every row of its category associated; a category-wide rule makes the other window red', () => {
		const { result } = renderStates();
		act(() => useForbiddenRulesStore.getState().pickAssociationEndpoint(endpoint('category', 'Background', 'neon street, rain')));
		expect(result.current.rows).toMatchObject({ neon: 'associated', beach: 'associated', jellyfish: 'forbidden' });
		expect(result.current.windows).toMatchObject({ background: 'associated', sea: 'forbidden', outfit: null });

		act(() => useForbiddenRulesStore.getState().clearAssociationSource());
		expect(result.current.windows).toMatchObject({ background: null, sea: 'indirectlyDisabled' });
	});

	it('a tag source: the rows of its category carrying the tag', () => {
		const { result } = renderStates();
		act(() => useForbiddenRulesStore.getState().pickAssociationEndpoint(endpoint('tag', 'Background', 'neon street, rain', 'rain')));
		expect(result.current.rows).toMatchObject({ neon: 'associated', beach: null });
		expect(result.current.windows.background).toBe('associated');
	});

	it('the designation and window highlight hooks', () => {
		useCategoriesStore.setState({ categories: fixture });
		useForbiddenRulesStore.setState({ rules: fixtureRules, associationSource: endpoint('prompt', 'Outfit', 'red dress') });
		const { result } = renderHook(() => ({
			dress: useIsSubPromptDesignated('outfit', 'red-dress'),
			armor: useIsSubPromptDesignated('outfit', 'armor'),
			unknown: useIsSubPromptDesignated('outfit', 'unknown'),
			outfit: useIsCategoryDesignated('outfit'),
			subject: useIsCategoryDesignated('subject'),
			background: useCategoryForbiddenHighlight('background'),
			missing: useCategoryForbiddenHighlight('missing'),
		}));
		expect(result.current).toEqual({ dress: true, armor: false, unknown: false, outfit: true, subject: false, background: 'forbidden', missing: 'none' });

		act(() => useForbiddenRulesStore.getState().clearAssociationSource());
		expect(result.current).toEqual({ dress: false, armor: false, unknown: false, outfit: false, subject: false, background: 'none', missing: 'none' });
	});
});
