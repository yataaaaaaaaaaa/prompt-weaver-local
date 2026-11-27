// LoRA selection: which LoRAs a generation uses (the active character's LoRAs (a story scene's cast) + a story scene's
// own LoRAs + the user's selection with its per-LoRA weights + the LoRAs induced by the selected sub-prompts), which
// requested ids are missing from the library, and the pure edits of a LoRA list (LoraWeight items, the one
// representation: see src/api/types.ts; the selection, a character's LoRAs, a scene's LoRAs).
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

/** The two parts of weightedLoraText: the name and the weight label '(formatWeight)' (the output browser shows them
 *  apart, so a long name can be truncated while its weight stays visible). */
export function weightedLoraParts({ name, weight }: { name: string; weight: number }): { name: string; weight: string } {
	return { name, weight: `(${formatWeight(weight)})` };
}

/** Display text of one named LoRA with its weight: 'name (formatWeight)'. */
export function weightedLoraText(item: { name: string; weight: number }): string {
	const { name, weight } = weightedLoraParts(item);
	return `${name} ${weight}`;
}

/** Display text of named LoRAs with their weights: weightedLoraText joined with ', ' ("Use these LoRAs"
 *  notification). */
export function weightedLorasText(items: readonly { name: string; weight: number }[]): string {
	return items.map(weightedLoraText).join(', ');
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

/** `loras` with `loraId` at clampLoraWeight(weight): its weight changed when it is there, else appended. The same
 *  array when nothing changes. */
export function withLora(loras: readonly LoraWeight[], loraId: string, weight: number): LoraWeight[] {
	return loras.some((item) => item.id === loraId) ? withLoraWeight(loras, loraId, weight) : [...loras, { id: loraId, weight: clampLoraWeight(weight) }];
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
	/** The known LoRAs of the active character (src/domain/characters.ts; a scene's cast), unique, in order. */
	characterIds: string[];
	/** The known LoRAs of a story scene (src/domain/stories.ts), unique, in order. */
	sceneIds: string[];
	/** The known selected LoRAs (also when the character has them too), unique, in order. */
	selectedIds: string[];
	promptLinkedIds: string[];
	/** character ∪ scene ∪ selected ∪ prompt-linked, in that order. */
	activeIds: string[];
	/** The library LoRAs of activeIds with their weights: a scene LoRA has the scene's weight (also when the character
	 *  or the selection has it), a character LoRA the character's weight (also when it is selected), a selected LoRA
	 *  keeps its selected weight, a LoRA that is only prompt-linked gets LORA_WEIGHT_DEFAULTS.weight. */
	activeLoras: GenerationLoRA[];
	/** Requested ids absent from the library, unique, in request order: character first, then scene, then
	 *  user-selected, then prompt-linked. */
	missingIds: string[];
};

/** Where the weight of a LoRA of a generation comes from: the scene, else the character, else the selection, else a
 *  sub-prompt (the default weight). */
export type LoraSource = 'character' | 'scene' | 'selection' | 'prompt';

export function loraSourceOf(resolution: Pick<ResolvedLoraSelection, 'characterIds' | 'sceneIds' | 'selectedIds'>, loraId: string): LoraSource {
	if (resolution.sceneIds.includes(loraId)) {
		return 'scene';
	}
	if (resolution.characterIds.includes(loraId)) {
		return 'character';
	}
	return resolution.selectedIds.includes(loraId) ? 'selection' : 'prompt';
}

/** The LoRAs of a generation: `characterLoras` (the active character's or a scene's cast's, [] without one) first,
 *  then `sceneLoras` (a story scene's own, [] otherwise), then the user's selection, then the LoRAs induced by the
 *  selected sub-prompts (see ResolvedLoraSelection). */
export function resolveLoraSelection(
	library: LoraLibrary,
	selectedLoras: readonly LoraWeight[],
	promptSelections: readonly Pick<GenerationSelection, 'induced_lora_ids'>[],
	characterLoras: readonly LoraWeight[] = [],
	sceneLoras: readonly LoraWeight[] = [],
): ResolvedLoraSelection {
	const lorasById = makeLoraMap(library);
	const known = (loraId: string) => lorasById.has(loraId);
	const character = filterKnownLoras(characterLoras, library);
	const scene = filterKnownLoras(sceneLoras, library);
	const selected = filterKnownLoras(selectedLoras, library);
	// Later entries win: the scene's weight over the character's, the character's over the selected one.
	const weights = new Map([...selected, ...character, ...scene].map((item) => [item.id, item.weight]));
	const requestedIds = [...characterLoras, ...sceneLoras, ...selectedLoras].map((item) => item.id);
	const promptLoraIds = promptSelections.flatMap((item) => item.induced_lora_ids);
	const characterIds = character.map((item) => item.id);
	const sceneIds = scene.map((item) => item.id);
	const selectedIds = selected.map((item) => item.id);
	const promptLinkedIds = uniqueStrings(promptLoraIds).filter(known);
	const activeIds = uniqueStrings([...characterIds, ...sceneIds, ...selectedIds, ...promptLinkedIds]);
	return {
		characterIds,
		sceneIds,
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
