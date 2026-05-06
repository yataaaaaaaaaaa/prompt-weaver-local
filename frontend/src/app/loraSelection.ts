import type { GenerationSelection, LibraryState, LoRASpec } from '../types';

type CategoryWithLoras = {
    subPrompts: Array<{
        extraLoraIds: string[];
    }>;
};

export type ResolvedLoraSelection = {
    selectedIds: string[];
    promptLinkedIds: string[];
    activeIds: string[];
    missingIds: string[];
    selectedLoras: LoRASpec[];
    promptLinkedLoras: LoRASpec[];
    activeLoras: LoRASpec[];
};

function uniqueStable(items: string[]): string[] {
    return Array.from(new Set(items));
}

export function makeLoraMap(library: LibraryState): Map<string, LoRASpec> {
    return new Map(library.loras.map((item) => [item.id, item]));
}

export function filterKnownLoraIds(loraIds: string[], library: LibraryState): string[] {
    const lorasById = makeLoraMap(library);
    return uniqueStable(loraIds).filter((loraId) => lorasById.has(loraId));
}

export function resolveLoraSelection(
    library: LibraryState,
    selectedLoraIds: string[],
    promptSelections: GenerationSelection[],
): ResolvedLoraSelection {
    const lorasById = makeLoraMap(library);
    const promptLoraIds = promptSelections.flatMap((item) => item.induced_lora_ids);
    const selectedIds = uniqueStable(selectedLoraIds).filter((loraId) => lorasById.has(loraId));
    const promptLinkedIds = uniqueStable(promptLoraIds).filter((loraId) => lorasById.has(loraId));
    const activeIds = uniqueStable([...selectedIds, ...promptLinkedIds]);
    const missingIds = uniqueStable([...selectedLoraIds, ...promptLoraIds].filter((loraId) => !lorasById.has(loraId)));

    return {
        selectedIds,
        promptLinkedIds,
        activeIds,
        missingIds,
        selectedLoras: selectedIds.map((loraId) => lorasById.get(loraId)).filter((item): item is LoRASpec => item != null),
        promptLinkedLoras: promptLinkedIds.map((loraId) => lorasById.get(loraId)).filter((item): item is LoRASpec => item != null),
        activeLoras: activeIds.map((loraId) => lorasById.get(loraId)).filter((item): item is LoRASpec => item != null),
    };
}

export function filterSelectionLoraIds(
    selections: GenerationSelection[],
    knownLoraIds: Set<string>,
): GenerationSelection[] {
    return selections.map((selection) => ({
        ...selection,
        induced_lora_ids: uniqueStable(selection.induced_lora_ids).filter((loraId) => knownLoraIds.has(loraId)),
    }));
}

export function removeLoraReferencesFromCategories<TCategory extends CategoryWithLoras>(
    categories: TCategory[],
    loraId: string,
): TCategory[] {
    return categories.map((category) => ({
        ...category,
        subPrompts: category.subPrompts.map((subPrompt) => ({
            ...subPrompt,
            extraLoraIds: subPrompt.extraLoraIds.filter((item) => item !== loraId),
        })),
    }));
}

export function removeMissingLoraReferencesFromCategories<TCategory extends CategoryWithLoras>(
    categories: TCategory[],
    validLoraIds: Set<string>,
): TCategory[] {
    return categories.map((category) => ({
        ...category,
        subPrompts: category.subPrompts.map((subPrompt) => ({
            ...subPrompt,
            extraLoraIds: subPrompt.extraLoraIds.filter((item) => validLoraIds.has(item)),
        })),
    }));
}
