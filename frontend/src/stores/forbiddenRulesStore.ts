// Forbidden rules store: single truth holder of forbidden rules (persisted as 'forbidden-associations-store')
// and of the association source picked in the Used sub-prompts pane (ephemeral, not persisted).
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GenerationSelection } from '../api/types';
import { sameCategoryName, type Category, type CategoryKey, type SubPromptKey } from '../domain/categories';
import { characterCategories, type CharacterGenerationInput } from '../domain/characters';
import {
	computeForbiddenHighlights,
	forbiddenHighlightOf,
	hasAssociation,
	removeRulesForCategory,
	removeRulesForSubPrompt,
	renameCategoryInRules,
	renameSubPromptInRules,
	ruleBetween,
	sameAssociationEndpoint,
	sameAssociationRow,
	sanitizeRules,
	toggleRule,
	type AssociationEndpoint,
	type ForbiddenHighlight,
	type ForbiddenHighlights,
	type ForbiddenRule,
} from '../domain/forbiddenRules';
import { splitPromptTags } from '../domain/text';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';
import { useCategoriesStore } from './categoriesStore';
import { selectActiveCharacter, useCharactersStore } from './charactersStore';
import { selectCurrentSelections, useOutputsStore } from './outputsStore';

export type ForbiddenRulesState = {
	rules: ForbiddenRule[];
	/** First click of a two-click association in the Used sub-prompts pane. Not persisted. */
	associationSource: AssociationEndpoint | null;
};

export type ForbiddenRulesActions = {
	replaceAll: (rules: ForbiddenRule[]) => void;
	/** Click on P / C / a tag chip in the Used sub-prompts pane:
	 *  no source -> becomes the source; same endpoint or same row -> clears the source;
	 *  otherwise toggles the rule source<->endpoint and clears the source
	 *  (category endpoints in the source's own category only clear it). */
	pickAssociationEndpoint: (endpoint: AssociationEndpoint) => void;
	clearAssociationSource: () => void;
	toggleAssociation: (source: AssociationEndpoint, target: AssociationEndpoint) => void;
	/** Cross-store maintenance called by the categories store. Category names compare by key equivalence. */
	removeRulesForCategory: (categoryName: string) => void;
	removeRulesForSubPrompt: (categoryName: string, promptText: string) => void;
	renameCategoryInRules: (oldName: string, newName: string) => void;
	renameSubPromptInRules: (categoryName: string, oldText: string, newText: string) => void;
};

export type ForbiddenRulesStore = ForbiddenRulesState & ForbiddenRulesActions;

export const useForbiddenRulesStore = create<ForbiddenRulesStore>()(
	persist(
		(set, get) => {
			/** Applies a pure rules update; no state change (and no persistence write) when it returned the same array. */
			const updateRules = (update: (rules: ForbiddenRule[]) => ForbiddenRule[]) => {
				const rules = get().rules;
				const next = update(rules);
				if (next !== rules) {
					set({ rules: next });
				}
			};
			return {
				rules: [],
				associationSource: null,
				replaceAll: (rules) => set({ rules: sanitizeRules(rules) }),
				pickAssociationEndpoint: (endpoint) => {
					const source = get().associationSource;
					if (!source) {
						set({ associationSource: endpoint });
						return;
					}
					const onlyClears =
						sameAssociationEndpoint(source, endpoint) ||
						sameAssociationRow(source, endpoint) ||
						(endpoint.mode === 'category' && sameCategoryName(source.categoryName, endpoint.categoryName));
					if (!onlyClears) {
						get().toggleAssociation(source, endpoint);
					}
					set({ associationSource: null });
				},
				clearAssociationSource: () => set({ associationSource: null }),
				toggleAssociation: (source, target) => updateRules((rules) => toggleRule(rules, ruleBetween(source, target))),
				removeRulesForCategory: (categoryName) => updateRules((rules) => removeRulesForCategory(rules, categoryName)),
				removeRulesForSubPrompt: (categoryName, promptText) =>
					updateRules((rules) => removeRulesForSubPrompt(rules, categoryName, promptText)),
				renameCategoryInRules: (oldName, newName) => updateRules((rules) => renameCategoryInRules(rules, oldName, newName)),
				renameSubPromptInRules: (categoryName, oldText, newText) =>
					updateRules((rules) => renameSubPromptInRules(rules, categoryName, oldText, newText)),
			};
		},
		persistedStoreOptions<ForbiddenRulesStore, Pick<ForbiddenRulesState, 'rules'>>({
			name: STORE_NAMES.forbiddenRules,
			version: 0,
			partialize: (state) => ({ rules: state.rules }),
			// Older rules have no tag_text key: every matcher field is made explicit, malformed rules dropped.
			merge: (persisted, current) => {
				const rules = (persisted as Partial<ForbiddenRulesState> | undefined)?.rules;
				return rules === undefined ? current : { ...current, rules: sanitizeRules(rules) };
			},
		}),
	),
);

// ---------------------------------------------------------------------------
// View models / hooks
// ---------------------------------------------------------------------------

export type UsedSelectionTag = {
	tagText: string;
	endpoint: AssociationEndpoint;
	isSource: boolean;
	/** A rule forbids this tag together with the current source. */
	isForbidden: boolean;
};

/** One row of the Used sub-prompts pane (one selection of the current output). */
export type UsedSelectionRow = {
	index: number;
	categoryName: string;
	promptText: string;
	locked: boolean;
	promptEndpoint: AssociationEndpoint;
	categoryEndpoint: AssociationEndpoint;
	isPromptSource: boolean;
	isCategorySource: boolean;
	isPromptForbidden: boolean;
	isCategoryForbidden: boolean;
	tags: UsedSelectionTag[];
};

function endpoint(selection: GenerationSelection, mode: AssociationEndpoint['mode'], tagText: string | null = null): AssociationEndpoint {
	return { mode, categoryName: selection.category_name, promptText: selection.prompt_text, tagText };
}

/** Pure view model of the Used sub-prompts pane: one row per selection, flags against the association source. */
export function buildUsedSelectionRows(
	selections: readonly GenerationSelection[],
	rules: readonly ForbiddenRule[],
	source: AssociationEndpoint | null,
): UsedSelectionRow[] {
	const isSource = (target: AssociationEndpoint) => source != null && sameAssociationEndpoint(source, target);
	const isForbidden = (target: AssociationEndpoint) => source != null && hasAssociation(rules, source, target);
	return selections.map((selection, index) => {
		const promptEndpoint = endpoint(selection, 'prompt');
		const categoryEndpoint = endpoint(selection, 'category');
		return {
			index,
			categoryName: selection.category_name,
			promptText: selection.prompt_text,
			locked: selection.locked,
			promptEndpoint,
			categoryEndpoint,
			isPromptSource: isSource(promptEndpoint),
			isCategorySource: isSource(categoryEndpoint),
			isPromptForbidden: isForbidden(promptEndpoint),
			isCategoryForbidden: isForbidden(categoryEndpoint),
			tags: splitPromptTags(selection.prompt_text).map((tagText) => {
				const tagEndpoint = endpoint(selection, 'tag', tagText);
				return { tagText, endpoint: tagEndpoint, isSource: isSource(tagEndpoint), isForbidden: isForbidden(tagEndpoint) };
			}),
		};
	});
}

/** Rows for the current output's selections (outputs store) with association flags vs the current source. */
export function useUsedSelectionRows(): UsedSelectionRow[] {
	const selections = useOutputsStore(selectCurrentSelections);
	const rules = useForbiddenRulesStore((state) => state.rules);
	const source = useForbiddenRulesStore((state) => state.associationSource);
	return useMemo(() => buildUsedSelectionRows(selections, rules, source), [selections, rules, source]);
}

// One shared highlight computation for every sub-prompt card (memoized on the input identities).
let highlightsMemo: {
	categories: readonly Category[];
	rules: readonly ForbiddenRule[];
	source: AssociationEndpoint | null;
	character: CharacterGenerationInput | null;
	highlights: ForbiddenHighlights;
} | null = null;

/** Highlights of every sub-prompt against the association source, computed once per (categories, rules, source,
 *  active character): a source from the character's pinned categories (Used sub-prompts pane) is locked. */
export function selectForbiddenHighlights(
	categories: readonly Category[],
	rules: readonly ForbiddenRule[],
	source: AssociationEndpoint | null,
	character: CharacterGenerationInput | null = null,
): ForbiddenHighlights {
	if (
		!highlightsMemo ||
		highlightsMemo.categories !== categories ||
		highlightsMemo.rules !== rules ||
		highlightsMemo.source !== source ||
		highlightsMemo.character !== character
	) {
		const highlights = computeForbiddenHighlights(categories, rules, source, characterCategories(character, categories));
		highlightsMemo = { categories, rules, source, character, highlights };
	}
	return highlightsMemo.highlights;
}

/** Red ('forbidden') / purple ('forbidden-locked': the source or the prompt is locked) highlight of a
 *  sub-prompt card that a rule forbids together with the current association source. */
export function useForbiddenHighlight(key: CategoryKey, promptKey: SubPromptKey): ForbiddenHighlight {
	const rules = useForbiddenRulesStore((state) => state.rules);
	const source = useForbiddenRulesStore((state) => state.associationSource);
	const character = useCharactersStore(selectActiveCharacter);
	return useCategoriesStore((state) =>
		source ? forbiddenHighlightOf(selectForbiddenHighlights(state.categories, rules, source, character), key, promptKey) : 'none',
	);
}
