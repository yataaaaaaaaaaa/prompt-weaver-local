// Character drafts (pure): the editor form of a character, its validation, and the values prefilled by the entry
// points ("Create character" manually, from an output, from an image library item). The characters store
// (src/stores/charactersStore.ts) holds the form while the editor is open and sends CharacterValues to the backend.
// Reused, never re-implemented here: tag splitting / joining (splitPromptTags / joinPromptTags, src/domain/text.ts),
// image tags (imageTags, src/domain/imageLibrary.ts), LoRA weights (clampLoraWeight, src/domain/loraSelection.ts),
// reference defaults and range (REFERENCE_DEFAULTS), image URLs (src/api/config.ts).
import { outputImageUrl } from '../api/config';
import { REFERENCE_DEFAULTS } from '../api/defaults.gen';
import { categoryKeyOf } from './categories';
import { CHARACTER_OUTFIT_CATEGORY_NAME } from './characters';
import { clamp } from './guards';
import { imageTags } from './imageLibrary';
import { clampLoraWeight } from './loraSelection';
import { nonNegativeSeedOf } from './seeds';
import { joinPromptTags, splitPromptTags, uniqueDisplayName } from './text';
import type {
	Character,
	CharacterDraft,
	CharacterImageSource,
	GenerationSelection,
	LoraWeight,
	OutputRecord,
	ReferenceFocus,
	RemoteImage,
} from '../api/types';

/** Every editable field of a character with a value (the backend Character's own field types): what the store
 *  sends as CharacterDraft (create / update). */
export type CharacterValues = Pick<Character, keyof CharacterDraft>;

/** The editor form: tags as comma-separated text (splitPromptTags / joinPromptTags), the seed as text ('' = none). */
export type CharacterForm = {
	name: string;
	identityText: string;
	outfitText: string;
	negativeText: string;
	/** Character LoRAs with their weights (library entry ids; weights through clampLoraWeight). */
	loras: LoraWeight[];
	seedText: string;
	seedLocked: boolean;
	referenceStrength: number;
	referenceFocus: ReferenceFocus;
};

/** Field -> message of the problems that prevent saving (empty when the form can be saved). */
export type CharacterFormErrors = Partial<Record<'name' | 'seed', string>>;

/** Every ReferenceFocus with its UI label and description (exhaustive: the type-check fails when the backend adds
 *  one). */
export const REFERENCE_FOCUS_LABELS: Record<ReferenceFocus, { label: string; description: string }> = {
	face: { label: 'Face', description: 'Keeps the face of the reference images (IP-Adapter Plus Face).' },
	general: { label: 'Whole subject', description: 'Keeps the overall look of the reference images (IP-Adapter Plus).' },
};

/** Default values of a new character named `name` (REFERENCE_DEFAULTS strength and focus, no tag, no seed). */
export function emptyCharacterValues(name: string): CharacterValues {
	return {
		name,
		identity_tags: [],
		outfit_tags: [],
		negative_tags: [],
		loras: [],
		seed: null,
		seed_locked: false,
		reference_strength: REFERENCE_DEFAULTS.strength,
		reference_focus: REFERENCE_DEFAULTS.focus,
	};
}

/** Default name of a manually created character. */
export const NEW_CHARACTER_NAME = 'New character';

/** Name of a new character: 'New character', else 'New character 2', 3, ... (uniqueDisplayName, src/domain/text.ts). */
export function newCharacterName(characters: readonly Pick<Character, 'name'>[]): string {
	return uniqueDisplayName(NEW_CHARACTER_NAME, characters.map((character) => character.name));
}

/** A usable IP-Adapter strength: clamped to REFERENCE_DEFAULTS.min..max (the backend's accepted range); a
 *  non-finite value -> REFERENCE_DEFAULTS.strength. The one strength normalization of the frontend. */
export function clampReferenceStrength(strength: number): number {
	return Number.isFinite(strength) ? clamp(strength, REFERENCE_DEFAULTS.min, REFERENCE_DEFAULTS.max) : REFERENCE_DEFAULTS.strength;
}

/** The editable values of a saved character. */
export function characterValuesOf(character: Character): CharacterValues {
	return {
		name: character.name,
		identity_tags: character.identity_tags,
		outfit_tags: character.outfit_tags,
		negative_tags: character.negative_tags,
		loras: character.loras,
		seed: character.seed,
		seed_locked: character.seed_locked,
		reference_strength: character.reference_strength,
		reference_focus: character.reference_focus,
	};
}

/** The editor form of `values`: tags joined with joinPromptTags, the seed as text ('' without one). */
export function characterFormFromValues(values: CharacterValues): CharacterForm {
	return {
		name: values.name,
		identityText: joinPromptTags(values.identity_tags),
		outfitText: joinPromptTags(values.outfit_tags),
		negativeText: joinPromptTags(values.negative_tags),
		loras: values.loras,
		seedText: values.seed === null ? '' : String(values.seed),
		seedLocked: values.seed_locked,
		referenceStrength: values.reference_strength,
		referenceFocus: values.reference_focus,
	};
}

/** name: required (after trimming); seed: a non-negative integer when given, and required when seedLocked. */
export function characterFormErrors(form: CharacterForm): CharacterFormErrors {
	const errors: CharacterFormErrors = {};
	if (!form.name.trim()) {
		errors.name = 'Give the character a name.';
	}
	if (form.seedText.trim() === '') {
		if (form.seedLocked) {
			errors.seed = 'Enter the seed to lock.';
		}
	} else if (characterSeedOf(form.seedText) === null) {
		errors.seed = 'The seed must be a whole number of 0 or more.';
	}
	return errors;
}

/** The seed of the form's seed field (nonNegativeSeedOf of src/domain/seeds.ts: the non-negative integers the backend
 *  accepts); null when empty or invalid. */
export function characterSeedOf(seedText: string): number | null {
	return nonNegativeSeedOf(seedText);
}

/** The values of a valid form (call when characterFormErrors is empty): name trimmed, tags split with
 *  splitPromptTags, seed parsed, strength clamped to REFERENCE_DEFAULTS.min..max. */
export function characterValuesFromForm(form: CharacterForm): CharacterValues {
	const seed = characterSeedOf(form.seedText);
	return {
		name: form.name.trim(),
		identity_tags: splitPromptTags(form.identityText),
		outfit_tags: splitPromptTags(form.outfitText),
		negative_tags: splitPromptTags(form.negativeText),
		loras: form.loras.map(({ id, weight }) => ({ id, weight: clampLoraWeight(weight) })),
		seed,
		seed_locked: form.seedLocked && seed !== null,
		reference_strength: clampReferenceStrength(form.referenceStrength),
		reference_focus: form.referenceFocus,
	};
}

/** The tags of prompt texts (comma-separated tags each), unique by normalizeTagId, in order (splitPromptTags). */
function selectionTags(selections: readonly GenerationSelection[]): string[] {
	return splitPromptTags(joinPromptTags(selections.map((selection) => selection.prompt_text)));
}

/** "Create character from this output": name 'Character from #<output id>'; identity tags = the tags of every
 *  selection except the pinned 'Character outfit' one (whose tags become outfit_tags), unique, in order; the output's
 *  LoRAs with their weights (active_loras); seed = the output's image seed (not locked); no negative tags; other
 *  fields default. */
export function characterValuesFromOutput(record: OutputRecord): CharacterValues {
	const outfitKey = categoryKeyOf(CHARACTER_OUTFIT_CATEGORY_NAME);
	const isOutfit = (selection: GenerationSelection) => categoryKeyOf(selection.category_name) === outfitKey;
	return {
		...emptyCharacterValues(`Character from #${record.output_id}`),
		identity_tags: selectionTags(record.selections.filter((selection) => !isOutfit(selection))),
		outfit_tags: selectionTags(record.selections.filter(isOutfit)),
		loras: record.active_loras.map(({ id, weight }) => ({ id, weight })),
		seed: record.image_seed ?? record.seed,
	};
}

/** "Create character from image library item": name from the image ('Character from <username>' / image id);
 *  identity tags = imageTags(image); `loras` (the image's LoRAs resolved to library entries by
 *  imageLibraryStore.collectImageLoras); seed = params.seed (not locked); other fields default. */
export function characterValuesFromImage(image: RemoteImage, loras: readonly LoraWeight[]): CharacterValues {
	return {
		...emptyCharacterValues(`Character from ${image.username || `image ${image.id}`}`),
		identity_tags: imageTags(image),
		loras: loras.map(({ id, weight }) => ({ id, weight })),
		seed: image.params?.seed ?? null,
	};
}

/** Preview URL of an image source not imported yet (the editor shows pending reference images): an output's image
 *  URL (outputImageUrl), a URL source itself; null for files and character images. */
export function imageSourcePreviewUrl(source: CharacterImageSource): string | null {
	switch (source.kind) {
		case 'output':
			return outputImageUrl(source.output_id);
		case 'url':
			return source.url;
		case 'file':
		case 'character_image':
			return null;
	}
}
