// LoRA selection: which LoRAs a generation uses (the user's default selection + the LoRAs induced by the
// selected sub-prompts) and which requested ids are missing from the library. Pure module.
import type { GenerationSelection, LoRASpec } from '../api/types';
import { uniqueStrings } from './text';

type LoraLibrary = { readonly loras: readonly LoRASpec[] };

export function makeLoraMap(library: LoraLibrary): Map<string, LoRASpec> {
	return new Map(library.loras.map((item) => [item.id, item]));
}

/** Unique ids present in the library, in request order. */
export function filterKnownLoraIds(loraIds: readonly string[], library: LoraLibrary): string[] {
	const lorasById = makeLoraMap(library);
	return uniqueStrings(loraIds).filter((loraId) => lorasById.has(loraId));
}

export type ResolvedLoraSelection = {
	selectedIds: string[];
	promptLinkedIds: string[];
	/** selected ∪ prompt-linked, selected first. */
	activeIds: string[];
	selectedLoras: LoRASpec[];
	promptLinkedLoras: LoRASpec[];
	activeLoras: LoRASpec[];
	/** Requested ids absent from the library, unique, in request order: user-selected first, then prompt-linked. */
	missingIds: string[];
};

export function resolveLoraSelection(
	library: LoraLibrary,
	selectedLoraIds: readonly string[],
	promptSelections: readonly Pick<GenerationSelection, 'induced_lora_ids'>[],
): ResolvedLoraSelection {
	const lorasById = makeLoraMap(library);
	const promptLoraIds = promptSelections.flatMap((item) => item.induced_lora_ids);
	const known = (loraId: string) => lorasById.has(loraId);
	const toLoras = (ids: string[]) => ids.map((loraId) => lorasById.get(loraId)!);
	const selectedIds = uniqueStrings(selectedLoraIds).filter(known);
	const promptLinkedIds = uniqueStrings(promptLoraIds).filter(known);
	const activeIds = uniqueStrings([...selectedIds, ...promptLinkedIds]);
	return {
		selectedIds,
		promptLinkedIds,
		activeIds,
		selectedLoras: toLoras(selectedIds),
		promptLinkedLoras: toLoras(promptLinkedIds),
		activeLoras: toLoras(activeIds),
		missingIds: uniqueStrings([...selectedLoraIds, ...promptLoraIds]).filter((loraId) => !known(loraId)),
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
