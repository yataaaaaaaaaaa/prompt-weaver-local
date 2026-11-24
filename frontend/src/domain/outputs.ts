// Output domain: output id format, ordering/navigation over the ascending id list, the current-output
// selection index and the details view model. Pure; state lives in src/stores/outputsStore.ts.
import type { GenerationSelection, LoRASpec, OutputCharacter, OutputRecord } from '../api/types';
import { categoryKeyOf, subPromptKeyOf, type CategoryKey, type SubPromptKey } from './categories';
import { basename } from './paths';
import { formatWeight } from './text';

/** Output files are named <10-digit id>.png / .json. */
export const OUTPUT_ID_DIGITS = 10;

const OUTPUT_ID_PATTERN = /^\d+$/;

/** 3 -> '0000000003'. Throws for negative or non-integer numbers. */
export function formatOutputId(value: number): string {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Invalid output number: ${value}`);
	}
	return String(value).padStart(OUTPUT_ID_DIGITS, '0');
}

/** '0000000003' -> 3; null when the text is not an output id. */
export function parseOutputId(outputId: string | null | undefined): number | null {
	if (!outputId || !OUTPUT_ID_PATTERN.test(outputId)) {
		return null;
	}
	const value = Number.parseInt(outputId, 10);
	return Number.isSafeInteger(value) ? value : null;
}

/** Numeric order (ids may exceed 10 digits one day); non-ids sort last, by text. */
export function compareOutputIds(left: string, right: string): number {
	const a = parseOutputId(left);
	const b = parseOutputId(right);
	if (a !== null && b !== null) {
		return a - b;
	}
	if (a !== null) {
		return -1;
	}
	if (b !== null) {
		return 1;
	}
	return left.localeCompare(right);
}

/** Unique ids, ascending. */
export function normalizeOutputIds(ids: readonly string[]): string[] {
	return Array.from(new Set(ids)).sort(compareOutputIds);
}

/** Inserts keeping the list ascending (returns the same array when already present). */
export function insertOutputId(ids: readonly string[], outputId: string): string[] {
	if (ids.includes(outputId)) {
		return ids as string[];
	}
	const last = ids[ids.length - 1];
	if (last === undefined || compareOutputIds(outputId, last) > 0) {
		return [...ids, outputId];
	}
	return normalizeOutputIds([...ids, outputId]);
}

/** Removes the id (returns the same array when absent). */
export function removeOutputId(ids: readonly string[], outputId: string): string[] {
	return ids.includes(outputId) ? ids.filter((id) => id !== outputId) : (ids as string[]);
}

/** First id after `currentId` (the first id when there is no current output). */
export function nextOutputId(ids: readonly string[], currentId: string | null): string | null {
	if (currentId === null) {
		return ids[0] ?? null;
	}
	return ids.find((id) => compareOutputIds(id, currentId) > 0) ?? null;
}

/** Last id before `currentId` (the latest id when there is no current output). */
export function previousOutputId(ids: readonly string[], currentId: string | null): string | null {
	if (currentId === null) {
		return ids[ids.length - 1] ?? null;
	}
	for (let index = ids.length - 1; index >= 0; index -= 1) {
		if (compareOutputIds(ids[index], currentId) < 0) {
			return ids[index];
		}
	}
	return null;
}

/** What to show instead of an output that disappeared (deleted, or missing on disk): the output now at
 *  its position (the next one), else the previous one, else nothing. */
export function nearestOutputId(ids: readonly string[], goneId: string): string | null {
	return nextOutputId(ids, goneId) ?? previousOutputId(ids, goneId);
}

// ---------------------------------------------------------------------------
// Current output selections
// ---------------------------------------------------------------------------

/** Sub-prompt keys used by an output, per category key (legacy selectionMatches: key equivalence). */
export type SelectionIndex = ReadonlyMap<CategoryKey, readonly SubPromptKey[]>;

export function indexSelections(selections: readonly Pick<GenerationSelection, 'category_name' | 'prompt_text'>[]): SelectionIndex {
	const index = new Map<CategoryKey, SubPromptKey[]>();
	for (const selection of selections) {
		const key = categoryKeyOf(selection.category_name);
		const promptKeys = index.get(key) ?? [];
		promptKeys.push(subPromptKeyOf(selection.prompt_text));
		index.set(key, promptKeys);
	}
	return index;
}

// ---------------------------------------------------------------------------
// Details view model
// ---------------------------------------------------------------------------

export type OutputLoraDetails = { name: string; weight: number };

export type CurrentOutputDetails = {
	outputId: string;
	imageName: string;
	generatedAt: string;
	width: number;
	height: number;
	steps: number;
	guidanceScale: number;
	seed: number;
	promptSeed: number | null;
	modelName: string;
	/** The LoRAs the output was generated with (OutputRecord.active_loras), names resolved from the library. */
	loras: OutputLoraDetails[];
	prompt: string;
	negativePrompt: string;
	/** The character active for the output and how its reference images were used (null without one). */
	character: OutputCharacter | null;
};

/** Details shown by the output browser; LoRA ids missing from the library are shown as is (with their weight). */
export function outputDetails(record: OutputRecord, modelName: string, loras: readonly LoRASpec[]): CurrentOutputDetails {
	const loraNames = new Map(loras.map((lora) => [lora.id, lora.name]));
	return {
		outputId: record.output_id,
		imageName: record.image_path ? basename(record.image_path) : record.output_id,
		generatedAt: record.generated_at,
		width: record.width,
		height: record.height,
		steps: record.steps,
		guidanceScale: record.guidance_scale,
		seed: record.seed,
		promptSeed: record.prompt_seed,
		modelName,
		loras: record.active_loras.map(({ id, weight }) => ({ name: loraNames.get(id) ?? id, weight })),
		prompt: record.prompt,
		negativePrompt: record.negative_prompt,
		character: record.character ?? null,
	};
}

/** Display text of an output's character: 'Alice · references applied (strength 0.6, 2 images)', or
 *  'Alice · references not applied: <reason>' (the reason comes from the backend). */
export function outputCharacterText(character: OutputCharacter): string {
	const { reference } = character;
	if (reference.applied) {
		const images = reference.image_ids.length === 1 ? '1 image' : `${reference.image_ids.length} images`;
		return `${character.name} · references applied (strength ${reference.strength === null ? '—' : formatWeight(reference.strength)}, ${images})`;
	}
	return `${character.name} · references not applied${reference.reason ? `: ${reference.reason}` : ''}`;
}
