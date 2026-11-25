// Forbidden rules store: single truth holder of forbidden rules (persisted as 'forbidden-associations-store')
// and of the association source picked in the Used sub-prompts pane (ephemeral, not persisted).
// It also derives the semantic visual state (src/ui/stateColors.ts VisualState) of every view showing prompts against
// the association source: sub-prompt rows and category windows (useSubPromptVisualState, useCategoryWindowState) and
// the Used sub-prompts pane (useUsedSelectionRows).
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GenerationSelection } from '../api/types';
import {
	sameCategoryName,
	type Category,
	type CategoryKey,
	type CategoryUiState,
	type SubPromptKey,
	type SubPromptUiState,
} from '../domain/categories';
import { characterCategories, type CharacterGenerationInput } from '../domain/characters';
import {
	categoryForbiddenHighlight,
	computeForbiddenHighlights,
	forbiddenHighlightFor,
	forbiddenHighlightOf,
	hasAssociation,
	isLockedPrompt,
	removeRulesForCategory,
	removeRulesForSubPrompt,
	renameCategoryInRules,
	renameSubPromptInRules,
	ruleBetween,
	sameAssociationEndpoint,
	sameAssociationRow,
	sanitizeRules,
	sourceDesignatesCategory,
	sourceDesignatesPrompt,
	toggleRule,
	type AssociationEndpoint,
	type ForbiddenHighlight,
	type ForbiddenHighlights,
	type ForbiddenRule,
} from '../domain/forbiddenRules';
import { splitPromptTags } from '../domain/text';
import { persistedStoreOptions } from '../persistence/persist';
import { STORE_NAMES } from '../persistence/storeNames';
import { strongestVisualState, type VisualState } from '../ui/stateColors';
import { findCategory, findSubPrompt, useCategoriesStore, useCategoryUiState, useSubPromptUiState } from './categoriesStore';
import { selectActiveCharacter, useCharactersStore } from './charactersStore';
import { selectCurrentSelections, useIsSubPromptInCurrentOutput, useOutputsStore } from './outputsStore';

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
// Visual states (src/ui/stateColors.ts): pure mappings used by the hooks below
// ---------------------------------------------------------------------------

/** forbidden -> red, forbidden-locked -> purple, none -> no state. */
export function highlightVisualState(highlight: ForbiddenHighlight): VisualState | null {
	return highlight === 'forbidden-locked' ? 'forbiddenLocked' : highlight === 'forbidden' ? 'forbidden' : null;
}

/** Everything that decides how a sub-prompt row looks. */
export type SubPromptVisualInput = {
	/** Reachability state (categoriesStore useSubPromptUiState). */
	uiState: SubPromptUiState;
	/** Forbidden together with the association source (useForbiddenHighlight). */
	highlight: ForbiddenHighlight;
	/** Designated by the association source (useIsSubPromptDesignated). */
	designated: boolean;
	/** Used by the output being viewed (outputsStore useIsSubPromptInCurrentOutput). */
	current: boolean;
};

/** The row's state, strongest first (VISUAL_STATES order): forbiddenLocked, forbidden, associated, current, locked,
 *  indirectlyDisabled, skipped; null for a plain row. */
export function subPromptVisualState({ uiState, highlight, designated, current }: SubPromptVisualInput): VisualState | null {
	return strongestVisualState([
		highlightVisualState(highlight),
		designated && 'associated',
		current && 'current',
		uiState === 'lock' && 'locked',
		uiState === 'indirectly-disabled' && 'indirectlyDisabled',
		uiState === 'skip' && 'skipped',
	]);
}

/** Everything that decides how a category window looks. */
export type CategoryWindowVisualInput = {
	/** Reachability state (categoriesStore useCategoryUiState). */
	uiState: CategoryUiState;
	/** Strongest highlight of its sub-prompts (useCategoryForbiddenHighlight). */
	highlight: ForbiddenHighlight;
	/** The association source belongs to this category (useIsCategoryDesignated). */
	designated: boolean;
};

/** The window's state: forbiddenLocked > forbidden > associated > indirectlyDisabled > skipped (current and locked
 *  are row-level only); null for a plain window. */
export function categoryWindowVisualState({ uiState, highlight, designated }: CategoryWindowVisualInput): VisualState | null {
	return strongestVisualState([
		highlightVisualState(highlight),
		designated && 'associated',
		uiState === 'indirectly-disabled' && 'indirectlyDisabled',
		uiState === 'skip' && 'skipped',
	]);
}

// ---------------------------------------------------------------------------
// View models / hooks
// ---------------------------------------------------------------------------

/** Association flags and visual state of one endpoint of the Used sub-prompts pane (P, C or a tag chip). */
export type UsedSelectionEndpointState = {
	/** It is the association source ('associated'). */
	isSource: boolean;
	/** A rule forbids it together with the current source ('forbidden', or 'forbiddenLocked' when a lock is involved). */
	isForbidden: boolean;
	state: VisualState | null;
};

export type UsedSelectionTag = UsedSelectionEndpointState & {
	tagText: string;
	endpoint: AssociationEndpoint;
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
	/** State of the P button. */
	promptState: VisualState | null;
	/** State of the C button. */
	categoryState: VisualState | null;
	/** State of the whole row: the strongest of its P, C and tag states. */
	state: VisualState | null;
	tags: UsedSelectionTag[];
};

function endpoint(selection: GenerationSelection, mode: AssociationEndpoint['mode'], tagText: string | null = null): AssociationEndpoint {
	return { mode, categoryName: selection.category_name, promptText: selection.prompt_text, tagText };
}

/**
 * Pure view model of the Used sub-prompts pane: one row per selection, flags and visual states against the
 * association source (the source is 'associated'; an endpoint a rule forbids with it is 'forbidden', or
 * 'forbiddenLocked' when the source or the row's prompt is locked: forbiddenHighlightFor, the rule of the category
 * windows). `lockSources`: the categories whose locked sub-prompts count as locked (the user categories and the
 * active character's pinned ones).
 */
export function buildUsedSelectionRows(
	selections: readonly GenerationSelection[],
	rules: readonly ForbiddenRule[],
	source: AssociationEndpoint | null,
	lockSources: readonly Category[] = [],
): UsedSelectionRow[] {
	const sourceLocked = source != null && isLockedPrompt(lockSources, source);
	return selections.map((selection, index) => {
		const promptLocked = isLockedPrompt(lockSources, { categoryName: selection.category_name, promptText: selection.prompt_text });
		const describe = (target: AssociationEndpoint): UsedSelectionEndpointState => {
			const isSource = source != null && sameAssociationEndpoint(source, target);
			const isForbidden = source != null && hasAssociation(rules, source, target);
			const highlight: ForbiddenHighlight = isForbidden ? forbiddenHighlightFor(sourceLocked, promptLocked) : 'none';
			return { isSource, isForbidden, state: strongestVisualState([highlightVisualState(highlight), isSource && 'associated']) };
		};
		const promptEndpoint = endpoint(selection, 'prompt');
		const categoryEndpoint = endpoint(selection, 'category');
		const prompt = describe(promptEndpoint);
		const category = describe(categoryEndpoint);
		const tags = splitPromptTags(selection.prompt_text).map((tagText): UsedSelectionTag => {
			const tagEndpoint = endpoint(selection, 'tag', tagText);
			return { tagText, endpoint: tagEndpoint, ...describe(tagEndpoint) };
		});
		return {
			index,
			categoryName: selection.category_name,
			promptText: selection.prompt_text,
			locked: selection.locked,
			promptEndpoint,
			categoryEndpoint,
			isPromptSource: prompt.isSource,
			isCategorySource: category.isSource,
			isPromptForbidden: prompt.isForbidden,
			isCategoryForbidden: category.isForbidden,
			promptState: prompt.state,
			categoryState: category.state,
			state: strongestVisualState([prompt.state, category.state, ...tags.map((tag) => tag.state)]),
			tags,
		};
	});
}

/** Rows for the current output's selections (outputs store) with association flags and states vs the current
 *  source; locks come from the categories and the active character's pinned categories. */
export function useUsedSelectionRows(): UsedSelectionRow[] {
	const selections = useOutputsStore(selectCurrentSelections);
	const rules = useForbiddenRulesStore((state) => state.rules);
	const source = useForbiddenRulesStore((state) => state.associationSource);
	const categories = useCategoriesStore((state) => state.categories);
	const character = useCharactersStore(selectActiveCharacter);
	return useMemo(
		() => buildUsedSelectionRows(selections, rules, source, [...characterCategories(character, categories), ...categories]),
		[selections, rules, source, categories, character],
	);
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

/** The strongest highlight of the category's sub-prompts (its window is red / purple). */
export function useCategoryForbiddenHighlight(key: CategoryKey): ForbiddenHighlight {
	const rules = useForbiddenRulesStore((state) => state.rules);
	const source = useForbiddenRulesStore((state) => state.associationSource);
	const character = useCharactersStore(selectActiveCharacter);
	return useCategoriesStore((state) => {
		const category = source ? findCategory(state.categories, key) : undefined;
		return category ? categoryForbiddenHighlight(selectForbiddenHighlights(state.categories, rules, source, character), category) : 'none';
	});
}

/** The association source designates this sub-prompt (sourceDesignatesPrompt: a P pick its own row, a C pick every
 *  row of its category, a tag pick the rows of its category carrying the tag). */
export function useIsSubPromptDesignated(key: CategoryKey, promptKey: SubPromptKey): boolean {
	const source = useForbiddenRulesStore((state) => state.associationSource);
	return useCategoriesStore((state) => {
		const category = source ? findCategory(state.categories, key) : undefined;
		const subPrompt = category ? findSubPrompt(state.categories, key, promptKey) : undefined;
		return !!source && !!category && !!subPrompt && sourceDesignatesPrompt(source, { categoryName: category.text, promptText: subPrompt.text });
	});
}

/** The association source belongs to this category (its window is 'associated'). */
export function useIsCategoryDesignated(key: CategoryKey): boolean {
	const source = useForbiddenRulesStore((state) => state.associationSource);
	return useCategoriesStore((state) => {
		const category = source ? findCategory(state.categories, key) : undefined;
		return !!source && !!category && sourceDesignatesCategory(source, category.text);
	});
}

/** Visual state of a sub-prompt row: subPromptVisualState of its reachability, forbidden highlight, designation by the
 *  association source and use by the current output. */
export function useSubPromptVisualState(key: CategoryKey, promptKey: SubPromptKey): VisualState | null {
	const uiState = useSubPromptUiState(key, promptKey);
	const highlight = useForbiddenHighlight(key, promptKey);
	const designated = useIsSubPromptDesignated(key, promptKey);
	const current = useIsSubPromptInCurrentOutput(key, promptKey);
	return subPromptVisualState({ uiState, highlight, designated, current });
}

/** Visual state of a category window: categoryWindowVisualState of its reachability, strongest forbidden highlight and
 *  designation by the association source. */
export function useCategoryWindowState(key: CategoryKey): VisualState | null {
	const uiState = useCategoryUiState(key);
	const highlight = useCategoryForbiddenHighlight(key);
	const designated = useIsCategoryDesignated(key);
	return categoryWindowVisualState({ uiState, highlight, designated });
}
