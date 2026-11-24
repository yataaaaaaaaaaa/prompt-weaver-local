import { describe, expect, it } from 'vitest';
import { outputImageUrl } from '../api/config';
import { LORA_WEIGHT_DEFAULTS, REFERENCE_DEFAULTS } from '../api/defaults.gen';
import type { CharacterImageSource, GenerationSelection, OutputRecord } from '../api/types';
import { BOB, character } from '../test/characterData';
import { imageParams, remoteImage } from '../test/imageLibraryData';
import {
	characterFormErrors,
	characterFormFromValues,
	characterSeedOf,
	characterValuesFromForm,
	characterValuesFromImage,
	characterValuesFromOutput,
	characterValuesOf,
	clampReferenceStrength,
	emptyCharacterValues,
	imageSourcePreviewUrl,
	NEW_CHARACTER_NAME,
	newCharacterName,
	REFERENCE_FOCUS_LABELS,
	type CharacterForm,
	type CharacterValues,
} from './characterDrafts';
import { CHARACTER_CATEGORY_NAME, CHARACTER_OUTFIT_CATEGORY_NAME } from './characters';

const selection = (category_name: string, prompt_text: string): GenerationSelection => ({
	category_name,
	prompt_text,
	locked: false,
	induced_lora_ids: [],
});

function outputRecord(overrides: Partial<OutputRecord> = {}): OutputRecord {
	return {
		output_id: '0000000042',
		generated_at: '2026-11-20T10:00:00Z',
		prompt: '',
		negative_prompt: 'lowres',
		seed: 1111,
		prompt_seed: 94,
		image_seed: 2222,
		width: 832,
		height: 1216,
		steps: 30,
		guidance_scale: 5,
		model_id: 'model-a',
		active_loras: [],
		selections: [],
		image_path: 'D:/data/output/0000000042.png',
		metadata_path: 'D:/data/output/0000000042.json',
		character: null,
		...overrides,
	};
}

const VALUES: CharacterValues = {
	name: 'Alice',
	identity_tags: ['1girl', 'silver hair', 'blue eyes'],
	outfit_tags: ['school uniform', 'red ribbon'],
	negative_tags: ['short hair'],
	loras: [{ id: 'alya', weight: 0.8 }],
	seed: 1234,
	seed_locked: true,
	reference_strength: 0.45,
	reference_focus: 'general',
};

const FORM: CharacterForm = {
	name: 'Alice',
	identityText: '1girl, silver hair, blue eyes',
	outfitText: 'school uniform, red ribbon',
	negativeText: 'short hair',
	loras: [{ id: 'alya', weight: 0.8 }],
	seedText: '1234',
	seedLocked: true,
	referenceStrength: 0.45,
	referenceFocus: 'general',
};

describe('emptyCharacterValues / newCharacterName', () => {
	it('defaults to the reference defaults, no tag, no seed', () => {
		expect(emptyCharacterValues('Alice')).toEqual({
			name: 'Alice',
			identity_tags: [],
			outfit_tags: [],
			negative_tags: [],
			loras: [],
			seed: null,
			seed_locked: false,
			reference_strength: REFERENCE_DEFAULTS.strength,
			reference_focus: REFERENCE_DEFAULTS.focus,
		});
	});

	it('names a new character uniquely (name keys, as uniqueKey numbers them)', () => {
		expect(newCharacterName([])).toBe(NEW_CHARACTER_NAME);
		expect(newCharacterName([BOB])).toBe('New character');
		expect(newCharacterName([{ name: 'new  Character' }])).toBe('New character 2');
		expect(newCharacterName([{ name: 'New character' }, { name: 'New character 2' }, { name: 'New character 4' }])).toBe('New character 3');
	});
});

describe('clampReferenceStrength', () => {
	it('clamps to the backend range and replaces non-finite values with the default', () => {
		expect(clampReferenceStrength(0.35)).toBe(0.35);
		expect(clampReferenceStrength(-0.2)).toBe(REFERENCE_DEFAULTS.min);
		expect(clampReferenceStrength(1.7)).toBe(REFERENCE_DEFAULTS.max);
		expect(clampReferenceStrength(Number.NaN)).toBe(REFERENCE_DEFAULTS.strength);
		expect(clampReferenceStrength(Number.POSITIVE_INFINITY)).toBe(REFERENCE_DEFAULTS.strength);
	});
});

describe('characterValuesOf', () => {
	it('keeps the editable fields of a saved character only', () => {
		const alice = character({ seed_locked: true, loras: [{ id: 'alya', weight: 0.5 }] });
		expect(characterValuesOf(alice)).toEqual({
			name: 'Alice',
			identity_tags: ['1girl', 'silver hair', 'blue eyes'],
			outfit_tags: ['school uniform'],
			negative_tags: ['short hair'],
			loras: [{ id: 'alya', weight: 0.5 }],
			seed: 1234,
			seed_locked: true,
			reference_strength: REFERENCE_DEFAULTS.strength,
			reference_focus: REFERENCE_DEFAULTS.focus,
		});
	});
});

describe('characterFormFromValues / characterValuesFromForm', () => {
	it('turns values into a form (tags joined, seed as text) and back (round trip)', () => {
		expect(characterFormFromValues(VALUES)).toEqual(FORM);
		expect(characterValuesFromForm(characterFormFromValues(VALUES))).toEqual(VALUES);
		expect(characterFormFromValues(characterValuesFromForm(FORM))).toEqual(FORM);
	});

	it('shows no seed as an empty field', () => {
		expect(characterFormFromValues(emptyCharacterValues('Bob'))).toMatchObject({ seedText: '', seedLocked: false, identityText: '' });
	});

	it('trims the name, splits the tags (trimmed, unique, empty ones dropped) and parses the seed', () => {
		const values = characterValuesFromForm({
			...FORM,
			name: '  Alice  ',
			identityText: ' 1girl ,, Silver Hair, silver_hair, blue eyes ,',
			outfitText: '',
			negativeText: 'short hair,short hair',
			seedText: ' 77 ',
		});
		expect(values).toMatchObject({
			name: 'Alice',
			identity_tags: ['1girl', 'Silver Hair', 'blue eyes'],
			outfit_tags: [],
			negative_tags: ['short hair'],
			seed: 77,
		});
	});

	it('clamps the strength and the LoRA weights, and never locks a missing seed', () => {
		const values = characterValuesFromForm({
			...FORM,
			referenceStrength: 3,
			loras: [{ id: 'alya', weight: 99 }],
			seedText: '',
			seedLocked: true,
		});
		expect(values).toMatchObject({
			reference_strength: REFERENCE_DEFAULTS.max,
			loras: [{ id: 'alya', weight: LORA_WEIGHT_DEFAULTS.max }],
			seed: null,
			seed_locked: false,
		});
		expect(characterValuesFromForm({ ...FORM, referenceStrength: -1 }).reference_strength).toBe(REFERENCE_DEFAULTS.min);
	});
});

describe('characterFormErrors / characterSeedOf', () => {
	it('accepts a valid form', () => {
		expect(characterFormErrors(FORM)).toEqual({});
		expect(characterFormErrors({ ...FORM, seedText: '', seedLocked: false })).toEqual({});
	});

	it('requires a name', () => {
		expect(characterFormErrors({ ...FORM, name: '   ' })).toEqual({ name: 'Give the character a name.' });
	});

	it('requires a seed to lock', () => {
		expect(characterFormErrors({ ...FORM, seedText: ' ', seedLocked: true })).toEqual({ seed: 'Enter the seed to lock.' });
	});

	it.each(['abc', '-1', '1.5', '1e400'])('refuses the seed %j', (seedText) => {
		expect(characterFormErrors({ ...FORM, seedText, seedLocked: false })).toEqual({ seed: 'The seed must be a whole number of 0 or more.' });
		expect(characterSeedOf(seedText)).toBeNull();
	});

	it('reports every problem at once', () => {
		expect(Object.keys(characterFormErrors({ ...FORM, name: '', seedText: 'x' }))).toEqual(['name', 'seed']);
	});

	it('parses whole non-negative seeds', () => {
		expect(characterSeedOf('0')).toBe(0);
		expect(characterSeedOf(' 4294967295 ')).toBe(4294967295);
		expect(characterSeedOf('')).toBeNull();
	});
});

describe('characterValuesFromOutput', () => {
	it('takes the identity from every selection, the outfit from the pinned outfit category, the LoRAs and the image seed', () => {
		const record = outputRecord({
			selections: [
				selection(CHARACTER_CATEGORY_NAME, '1girl, silver hair'),
				selection('character  OUTFIT', 'school uniform, red ribbon'),
				selection('Main', 'masterpiece, Silver Hair, best quality'),
				selection('Pose', 'standing, 1girl'),
				selection('Empty', ''),
			],
			active_loras: [
				{ id: 'alya', weight: 0.6 },
				{ id: 'detail', weight: 1 },
			],
		});

		expect(characterValuesFromOutput(record)).toEqual({
			name: 'Character from #0000000042',
			identity_tags: ['1girl', 'silver hair', 'masterpiece', 'best quality', 'standing'],
			outfit_tags: ['school uniform', 'red ribbon'],
			negative_tags: [],
			loras: [
				{ id: 'alya', weight: 0.6 },
				{ id: 'detail', weight: 1 },
			],
			seed: 2222,
			seed_locked: false,
			reference_strength: REFERENCE_DEFAULTS.strength,
			reference_focus: REFERENCE_DEFAULTS.focus,
		});
		expect(CHARACTER_OUTFIT_CATEGORY_NAME).toBe('Character outfit');
	});

	it('falls back to the request seed without an image seed', () => {
		expect(characterValuesFromOutput(outputRecord({ image_seed: null })).seed).toBe(1111);
		expect(characterValuesFromOutput(outputRecord())).toMatchObject({ identity_tags: [], outfit_tags: [], loras: [] });
	});
});

describe('characterValuesFromImage', () => {
	it('takes the image tags, the given LoRAs and the published seed, named after the author', () => {
		const image = remoteImage({ params: imageParams({ clean_prompt: '1girl, silver hair\nblue eyes, 1girl', seed: 98765 }) });

		expect(characterValuesFromImage(image, [{ id: 'detail', weight: 0.6 }])).toEqual({
			name: 'Character from alice',
			identity_tags: ['1girl', 'silver hair', 'blue eyes'],
			outfit_tags: [],
			negative_tags: [],
			loras: [{ id: 'detail', weight: 0.6 }],
			seed: 98765,
			seed_locked: false,
			reference_strength: REFERENCE_DEFAULTS.strength,
			reference_focus: REFERENCE_DEFAULTS.focus,
		});
	});

	it('names the image by id without an author, and has no tag nor seed without generation data', () => {
		expect(characterValuesFromImage(remoteImage({ username: null, params: null }), [])).toMatchObject({
			name: 'Character from image 1001',
			identity_tags: [],
			loras: [],
			seed: null,
		});
	});
});

describe('imageSourcePreviewUrl / REFERENCE_FOCUS_LABELS', () => {
	it.each<[CharacterImageSource, string | null]>([
		[{ kind: 'output', output_id: '0000000042' }, outputImageUrl('0000000042')],
		[{ kind: 'url', url: 'https://image.example/1001.jpeg' }, 'https://image.example/1001.jpeg'],
		[{ kind: 'file', path: 'D:/pictures/alice.png' }, null],
		[{ kind: 'character_image', image_id: 'img-0000000000a1' }, null],
	])('previews %j', (source, url) => {
		expect(imageSourcePreviewUrl(source)).toBe(url);
	});

	it('labels every focus', () => {
		expect(Object.keys(REFERENCE_FOCUS_LABELS).sort()).toEqual(['face', 'general']);
		expect(REFERENCE_FOCUS_LABELS.face.label).toBe('Face');
	});
});
