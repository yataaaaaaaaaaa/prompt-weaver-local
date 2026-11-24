// LoRA selection: which LoRAs a generation uses (the active character's LoRAs + the user's selection with its
// per-LoRA weights + the LoRAs induced by the selected sub-prompts), which requested ids are missing from the
// library, and the pure edits of the selection (LoraWeight items, the one representation: see src/api/types.ts).
// Pure module; the selection itself lives in src/stores/libraryStore.ts.
import { LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { GenerationLoRA, GenerationSelection, LoraWeight, LoRASpec } from '../api/types';
import { clamp } from './guards';
import { formatWeight, uniqueStrings } from './text';

type LoraLibrary = { readonly loras: readonly LoRASpec[] };

/** A usable LoRA weight: clamped to LORA_WEIGHT_DEFAULTS.min..max (the backend's accepted range); a non-finite
 *  value -> LORA_WEIGHT_DEFAULTS.weight. The one weight normalization of the frontend (selection edits, weights
 *  published by online images, persisted selections). */
export function clampLoraWeight(weight: number): number {
	if (!Number.isFinite(weight)) {
		return LORA_WEIGHT_DEFAULTS.weight;
	}
	return clamp(weight, LORA_WEIGHT_DEFAULTS.min, LORA_WEIGHT_DEFAULTS.max);
}

/** Display text of named LoRAs with their weights: 'name (formatWeight)' joined with ', ' (output browser,
 *  "Use these LoRAs" notification). */
export function weightedLorasText(items: readonly { name: string; weight: number }[]): string {
	return items.map(({ name, weight }) => `${name} (${formatWeight(weight)})`).join(', ');
}

/** The LoRA at LORA_WEIGHT_DEFAULTS.weight: how a LoRA enters the selection without an explicit weight (checkbox,
 *  added files, model library installs, selections persisted before weights existed). */
export function loraAtDefaultWeight(loraId: string): LoraWeight {
	return { id: loraId, weight: LORA_WEIGHT_DEFAULTS.weight };
}

export function makeLoraMap(library: LoraLibrary): Map<string, LoRASpec> {
	return new Map(library.loras.map((item) => [item.id, item]));
}

/** The items whose LoRA is in the library, in order: the first of duplicate ids wins, weights through
 *  clampLoraWeight. The normalization of every selection written to the store. */
export function filterKnownLoras(items: readonly LoraWeight[], library: LoraLibrary): LoraWeight[] {
	const lorasById = makeLoraMap(library);
	const seen = new Set<string>();
	const known: LoraWeight[] = [];
	for (const { id, weight } of items) {
		if (lorasById.has(id) && !seen.has(id)) {
			seen.add(id);
			known.push({ id, weight: clampLoraWeight(weight) });
		}
	}
	return known;
}

/** `selection` + the known `loraIds` that are not selected yet, appended at the default weight (selected LoRAs
 *  keep their weight). The same array when nothing is added. */
export function addLorasToSelection(selection: readonly LoraWeight[], loraIds: readonly string[], library: LoraLibrary): LoraWeight[] {
	const lorasById = makeLoraMap(library);
	const selected = new Set(selection.map((item) => item.id));
	const added = uniqueStrings(loraIds).filter((loraId) => lorasById.has(loraId) && !selected.has(loraId));
	return added.length > 0 ? [...selection, ...added.map(loraAtDefaultWeight)] : (selection as LoraWeight[]);
}

/** `selection` with the weight of `loraId` set to clampLoraWeight(weight). The same array when the LoRA is not
 *  selected or its weight is unchanged. */
export function withLoraWeight(selection: readonly LoraWeight[], loraId: string, weight: number): LoraWeight[] {
	const next = clampLoraWeight(weight);
	const index = selection.findIndex((item) => item.id === loraId);
	if (index < 0 || selection[index].weight === next) {
		return selection as LoraWeight[];
	}
	return selection.map((item, position) => (position === index ? { id: loraId, weight: next } : item));
}

export type ResolvedLoraSelection = {
	/** The known LoRAs of the active character (src/domain/characters.ts), unique, in order. */
	characterIds: string[];
	/** The known selected LoRAs (also when the character has them too), unique, in order. */
	selectedIds: string[];
	promptLinkedIds: string[];
	/** character ∪ selected ∪ prompt-linked, in that order. */
	activeIds: string[];
	/** The library LoRAs of activeIds with their weights: a character LoRA has the character's weight (also when it
	 *  is selected), a selected LoRA keeps its selected weight, a LoRA that is only prompt-linked gets
	 *  LORA_WEIGHT_DEFAULTS.weight. */
	activeLoras: GenerationLoRA[];
	/** Requested ids absent from the library, unique, in request order: character first, then user-selected, then
	 *  prompt-linked. */
	missingIds: string[];
};

/** The LoRAs of a generation: `characterLoras` (the active character's, [] without one) first, then the user's
 *  selection, then the LoRAs induced by the selected sub-prompts (see ResolvedLoraSelection). */
export function resolveLoraSelection(
	library: LoraLibrary,
	selectedLoras: readonly LoraWeight[],
	promptSelections: readonly Pick<GenerationSelection, 'induced_lora_ids'>[],
	characterLoras: readonly LoraWeight[] = [],
): ResolvedLoraSelection {
	const lorasById = makeLoraMap(library);
	const known = (loraId: string) => lorasById.has(loraId);
	const character = filterKnownLoras(characterLoras, library);
	const selected = filterKnownLoras(selectedLoras, library);
	// Later entries win: the character's weight over the selected one.
	const weights = new Map([...selected, ...character].map((item) => [item.id, item.weight]));
	const requestedIds = [...characterLoras, ...selectedLoras].map((item) => item.id);
	const promptLoraIds = promptSelections.flatMap((item) => item.induced_lora_ids);
	const characterIds = character.map((item) => item.id);
	const selectedIds = selected.map((item) => item.id);
	const promptLinkedIds = uniqueStrings(promptLoraIds).filter(known);
	const activeIds = uniqueStrings([...characterIds, ...selectedIds, ...promptLinkedIds]);
	return {
		characterIds,
		selectedIds,
		promptLinkedIds,
		activeIds,
		activeLoras: activeIds.map((loraId) => ({
			...lorasById.get(loraId)!,
			weight: weights.get(loraId) ?? LORA_WEIGHT_DEFAULTS.weight,
		})),
		missingIds: uniqueStrings([...requestedIds, ...promptLoraIds]).filter((loraId) => !known(loraId)),
	};
}

/** Selections with their induced LoRA ids restricted to known ids (unique). */
export function filterSelectionLoraIds<T extends Pick<GenerationSelection, 'induced_lora_ids'>>(
	selections: readonly T[],
	knownLoraIds: ReadonlySet<string>,
): T[] {
	return selections.map((selection) => ({
		...selection,
		induced_lora_ids: uniqueStrings(selection.induced_lora_ids).filter((loraId) => knownLoraIds.has(loraId)),
	}));
}
