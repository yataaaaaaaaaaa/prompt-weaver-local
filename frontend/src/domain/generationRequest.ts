// Generation request building: categories + forbidden rules + generation settings
// + library + active character -> the GenerateRequest sent to the backend, and the seed settings after the generation.
// Pure module; the generation store snapshots the stores and calls it. The character's precedence is documented in
// src/domain/characters.ts.
import { GENERATION_DEFAULTS } from '../api/defaults.gen';
import type { ForbiddenRule, GenerateRequest, GenerationDefaults, GenerationSelection, OutputRecord } from '../api/types';
import type { Category } from './categories';
import { characterCategories, characterNegativePrompt, lockedCharacterSeed, type CharacterGenerationInput } from './characters';
import type { LibraryData } from './library';
import { filterSelectionLoraIds, makeLoraMap, resolveLoraSelection } from './loraSelection';
import { selectPrompts, selectPromptsWithCategoryCycle } from './promptEngine';
import {
	IMAGE_SEED_BEHAVIORS,
	isSeedBehavior,
	planSeed,
	sanitizeCategorySeedState,
	type CategorySeedState,
	type SeedBehavior,
	type SeedSnapshot,
} from './seeds';
import { isFiniteNumber, isRecord, positiveNumberOr, stringOr } from './guards';

/** Persisted format of the 'settings-store' (version 0): a CONTRACT with the user's existing data. */
export type GenerationSettings = {
	width: number;
	height: number;
	steps: number;
	guidanceScale: number;
	negativePrompt: string;
	/** Raw text of the prompt-selection seed field ('' = random). */
	promptSeedInput: string;
	/** Raw text of the image seed field ('' = random). */
	seedInput: string;
	promptSeedBehavior: SeedBehavior;
	imageSeedBehavior: SeedBehavior;
	promptCategorySeedState: CategorySeedState;
};

/** The backend's snake_case generation fields (GenerationDefaults, legacy app_state.json AppState). */
export type BackendGenerationFields = Pick<
	GenerationDefaults,
	'width' | 'height' | 'steps' | 'guidance_scale' | 'negative_prompt' | 'prompt_seed' | 'seed' | 'prompt_seed_behavior' | 'image_seed_behavior'
>;

/** Backend generation fields -> settings (a null seed = '' = random; no per-category counters yet). */
export function generationSettingsFromBackend(fields: BackendGenerationFields): GenerationSettings {
	return {
		width: fields.width,
		height: fields.height,
		steps: fields.steps,
		guidanceScale: fields.guidance_scale,
		negativePrompt: fields.negative_prompt,
		promptSeedInput: fields.prompt_seed != null ? String(fields.prompt_seed) : '',
		seedInput: fields.seed != null ? String(fields.seed) : '',
		promptSeedBehavior: fields.prompt_seed_behavior,
		imageSeedBehavior: fields.image_seed_behavior,
		promptCategorySeedState: {},
	};
}

/** Defaults of every generation setting, derived from the backend's GenerationDefaults (the single definition,
 *  exported by `npm run gen:api` to src/api/defaults.gen.ts). */
export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = generationSettingsFromBackend(GENERATION_DEFAULTS);

export type GenerationInputs = {
	categories: readonly Category[];
	rules: readonly ForbiddenRule[];
	settings: GenerationSettings;
	library: Pick<LibraryData, 'models' | 'loras' | 'selectedModelId' | 'selectedLoras'>;
	/** The active character (null / absent: none). */
	character?: CharacterGenerationInput | null;
};

export type BuiltGenerationRequest = {
	request: GenerateRequest;
	/** Per-category counters after this selection ('per_category_cycle'; the unchanged state otherwise). */
	nextCategorySeedState: CategorySeedState;
	/** LoRA ids requested by the character, the selection or the selected sub-prompts but absent from the library
	 *  (ignored). */
	missingLoraIds: string[];
	/** The character's seed lock replaced the image seed (nextSeedSnapshot then leaves the image seed field as is). */
	imageSeedLocked: boolean;
};

function isCycle(settings: Pick<GenerationSettings, 'promptSeedBehavior'>): boolean {
	return settings.promptSeedBehavior === 'per_category_cycle';
}

/** Throws (Error / PromptSelectionError) when no model is selected or no prompt can be selected. The active character
 *  takes part as documented in src/domain/characters.ts: its pinned categories (built against the user categories)
 *  are selected first, its LoRAs come first, its negative tags are appended and its locked seed replaces the image
 *  seed. */
export function buildGenerationRequest({ categories, rules, settings, library, character = null }: GenerationInputs): BuiltGenerationRequest {
	if (!library.selectedModelId) {
		throw new Error('Select a model before generating.');
	}
	const model = library.models.find((item) => item.id === library.selectedModelId);
	if (!model) {
		throw new Error(`Unknown model '${library.selectedModelId}'.`);
	}

	const pinned = characterCategories(character, categories);
	const lockedSeed = lockedCharacterSeed(character);
	const imageSeed = lockedSeed ?? planSeed(settings.imageSeedBehavior, settings.seedInput).requestSeed;
	let selections: GenerationSelection[];
	let promptSeed: number | null;
	let nextCategorySeedState: CategorySeedState;
	if (isCycle(settings)) {
		const result = selectPromptsWithCategoryCycle(categories, rules, settings.promptCategorySeedState, pinned);
		selections = result.selections;
		promptSeed = result.promptSeed;
		nextCategorySeedState = result.nextCategorySeedState;
	} else {
		promptSeed = planSeed(settings.promptSeedBehavior, settings.promptSeedInput).requestSeed;
		selections = selectPrompts(categories, rules, promptSeed, pinned);
		nextCategorySeedState = settings.promptCategorySeedState;
	}

	const knownLoraIds = new Set(makeLoraMap(library).keys());
	const loraResolution = resolveLoraSelection(library, library.selectedLoras, selections, character?.loras ?? []);
	const requestSelections = filterSelectionLoraIds(selections, knownLoraIds);
	const request: GenerateRequest = {
		model,
		// Character LoRAs with their weight, then selected LoRAs with their selected weight, then prompt-linked ones at
		// the default weight.
		loras: loraResolution.activeLoras,
		prompt: requestSelections
			.map((item) => item.prompt_text)
			.filter(Boolean)
			.join(', '),
		selections: requestSelections,
		width: settings.width,
		height: settings.height,
		steps: settings.steps,
		guidance_scale: settings.guidanceScale,
		prompt_seed: promptSeed,
		seed: imageSeed,
		negative_prompt: characterNegativePrompt(settings.negativePrompt, character),
		character_id: character?.id ?? null,
	};
	return { request, nextCategorySeedState, missingLoraIds: loraResolution.missingIds, imageSeedLocked: lockedSeed !== null };
}

export type NextSeedOptions = {
	/** The image seed came from the character's seed lock (BuiltGenerationRequest.imageSeedLocked): the image seed
	 *  field is left unchanged (no seedInput in the snapshot). */
	imageSeedLocked?: boolean;
};

/** Seed settings after a successful generation: the prompt seed field advances (except in cycle mode, where
 *  the per-category counters are replaced instead) and the image seed field advances from the seed the
 *  backend reports (image_seed, else seed), unless the image seed was locked by the character. */
export function nextSeedSnapshot(
	settings: GenerationSettings,
	response: Pick<OutputRecord, 'prompt_seed' | 'image_seed' | 'seed'>,
	nextCategorySeedState: CategorySeedState,
	{ imageSeedLocked = false }: NextSeedOptions = {},
): Partial<SeedSnapshot> {
	const imageSeed: Partial<SeedSnapshot> = imageSeedLocked
		? {}
		: { seedInput: planSeed(settings.imageSeedBehavior, settings.seedInput, response.image_seed ?? response.seed).nextInput };
	if (isCycle(settings)) {
		return { ...imageSeed, promptCategorySeedState: nextCategorySeedState };
	}
	return {
		...imageSeed,
		promptSeedInput: planSeed(settings.promptSeedBehavior, settings.promptSeedInput, response.prompt_seed).nextInput,
	};
}

// ---------------------------------------------------------------------------
// Sanitizing (persisted settings-store, legacy import)
// ---------------------------------------------------------------------------

function seedText(value: unknown, fallback: string): string {
	return isFiniteNumber(value) ? String(value) : stringOr(value, fallback);
}

/** Settings from untrusted input (fields missing or invalid in `value` come from `fallback`). */
export function sanitizeGenerationSettings(value: unknown, fallback: GenerationSettings): GenerationSettings {
	const raw = isRecord(value) ? value : {};
	const imageSeedBehavior = raw.imageSeedBehavior;
	return {
		width: positiveNumberOr(raw.width, fallback.width),
		height: positiveNumberOr(raw.height, fallback.height),
		steps: positiveNumberOr(raw.steps, fallback.steps),
		guidanceScale: isFiniteNumber(raw.guidanceScale) && raw.guidanceScale >= 0 ? raw.guidanceScale : fallback.guidanceScale,
		negativePrompt: stringOr(raw.negativePrompt, fallback.negativePrompt),
		promptSeedInput: seedText(raw.promptSeedInput, fallback.promptSeedInput),
		seedInput: seedText(raw.seedInput, fallback.seedInput),
		promptSeedBehavior: isSeedBehavior(raw.promptSeedBehavior) ? raw.promptSeedBehavior : fallback.promptSeedBehavior,
		imageSeedBehavior: IMAGE_SEED_BEHAVIORS.includes(imageSeedBehavior as SeedBehavior)
			? (imageSeedBehavior as SeedBehavior)
			: fallback.imageSeedBehavior,
		promptCategorySeedState:
			'promptCategorySeedState' in raw ? sanitizeCategorySeedState(raw.promptCategorySeedState) : fallback.promptCategorySeedState,
	};
}
