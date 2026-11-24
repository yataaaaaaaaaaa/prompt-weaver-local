import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GenerationSelection, OutputRecord } from '../api/types';
import type { Category } from '../domain/categories';
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
import { useCategoriesStore } from './categoriesStore';
import { buildUsedSelectionRows, useForbiddenHighlight, useForbiddenRulesStore, useUsedSelectionRows } from './forbiddenRulesStore';
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
