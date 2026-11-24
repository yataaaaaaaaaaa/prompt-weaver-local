import { afterEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_DEFAULTS, LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { LoRASpec, ModelSpec } from '../api/types';
import { ALICE_ID, BOB, character } from '../test/characterData';
import type { Category } from './categories';
import { makeRule, specificMatcher, tagMatcher } from './forbiddenRules';
import {
	buildGenerationRequest,
	DEFAULT_GENERATION_SETTINGS,
	generationSettingsFromBackend,
	nextSeedSnapshot,
	sanitizeGenerationSettings,
	type GenerationInputs,
	type GenerationSettings,
} from './generationRequest';
import { PromptSelectionError } from './promptEngine';

const MODEL: ModelSpec = { id: 'model', name: 'model.safetensors', path: 'D:/m/model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };
const LORAS: LoRASpec[] = [
	{ id: 'style', name: 'style.safetensors', path: 'D:/l/style.safetensors', source: null },
	{ id: 'portrait', name: 'portrait.safetensors', path: 'D:/l/portrait.safetensors', source: null },
];

const SETTINGS: GenerationSettings = {
	width: 768,
	height: 1344,
	steps: 28,
	guidanceScale: 3,
	negativePrompt: 'ugly',
	promptSeedInput: '100',
	seedInput: '200',
	promptSeedBehavior: 'fixed',
	imageSeedBehavior: 'increment',
	promptCategorySeedState: {},
};

const CATEGORIES: Category[] = [
	{
		text: 'Main',
		activation_text: '',
		priority: 1,
		state: 'normal',
		subPrompts: [{ text: '1girl, smile', state: 'lock', extraLoraIds: ['style', 'gone'] }],
	},
	{ text: 'Empty text', activation_text: '', priority: 2, state: 'normal', subPrompts: [{ text: '', state: 'normal', extraLoraIds: [] }] },
	{ text: 'Style', activation_text: '', priority: 3, state: 'normal', subPrompts: [{ text: 'oil painting', state: 'normal', extraLoraIds: [] }] },
];

function inputs(overrides: Partial<GenerationInputs> = {}): GenerationInputs {
	return {
		categories: CATEGORIES,
		rules: [],
		settings: SETTINGS,
		library: {
			models: [MODEL],
			loras: LORAS,
			selectedModelId: 'model',
			selectedLoras: [
				{ id: 'portrait', weight: 0.6 },
				{ id: 'deleted', weight: 1 },
			],
		},
		...overrides,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('buildGenerationRequest', () => {
	it('builds the request from the selection, settings and library', () => {
		const { request, nextCategorySeedState, missingLoraIds, imageSeedLocked } = buildGenerationRequest(inputs());
		expect(request).toEqual({
			model: MODEL,
			// The selected LoRA with its weight, then the prompt-linked one at the default weight.
			loras: [
				{ ...LORAS[1], weight: 0.6 },
				{ ...LORAS[0], weight: LORA_WEIGHT_DEFAULTS.weight },
			],
			prompt: '1girl, smile, oil painting',
			selections: [
				{ category_name: 'Main', prompt_text: '1girl, smile', locked: true, induced_lora_ids: ['style'] },
				{ category_name: 'Empty text', prompt_text: '', locked: false, induced_lora_ids: [] },
				{ category_name: 'Style', prompt_text: 'oil painting', locked: false, induced_lora_ids: [] },
			],
			width: 768,
			height: 1344,
			steps: 28,
			guidance_scale: 3,
			prompt_seed: 100,
			seed: 200,
			negative_prompt: 'ugly',
			character_id: null,
		});
		expect(nextCategorySeedState).toBe(SETTINGS.promptCategorySeedState);
		expect(missingLoraIds).toEqual(['deleted', 'gone']);
		expect(imageSeedLocked).toBe(false);
	});

	it('a LoRA both selected and prompt-linked keeps its selected weight', () => {
		const library = { ...inputs().library, selectedLoras: [{ id: 'style', weight: -1.25 }] };
		const { request, missingLoraIds } = buildGenerationRequest(inputs({ library }));
		expect(request.loras).toEqual([{ ...LORAS[0], weight: -1.25 }]);
		expect(missingLoraIds).toEqual(['gone']);
	});

	it('uses one random prompt seed for both the selection and the request', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.5);
		const { request } = buildGenerationRequest(inputs({ settings: { ...SETTINGS, promptSeedBehavior: 'randomize', imageSeedBehavior: 'randomize' } }));
		expect(request.prompt_seed).toBe(1073741824);
		expect(request.seed).toBe(1073741824);
	});

	it('per-category cycle: prompt seed = first counter used, next counters returned', () => {
		const settings: GenerationSettings = {
			...SETTINGS,
			promptSeedBehavior: 'per_category_cycle',
			promptCategorySeedState: { style: { seed: 41, remaining: 1, prompt_count: 1 }, 'empty-text': { seed: 7, remaining: 1, prompt_count: 1 } },
		};
		vi.spyOn(Math, 'random').mockReturnValue(0.25);
		const { request, nextCategorySeedState } = buildGenerationRequest(inputs({ settings }));
		expect(request.prompt_seed).toBe(7);
		expect(nextCategorySeedState).toEqual({
			main: { seed: 536870912, remaining: 1, prompt_count: 1 },
			'empty-text': { seed: 536870912, remaining: 1, prompt_count: 1 },
			style: { seed: 536870912, remaining: 1, prompt_count: 1 },
		});
	});

	it('honours forbidden rules', () => {
		const rules = [makeRule(specificMatcher('Main', 'smile, 1girl'), specificMatcher('Style', 'oil painting'))];
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { request } = buildGenerationRequest(inputs({ rules }));
		expect(request.selections?.map((item) => item.category_name)).toEqual(['Main', 'Empty text']);
	});

	it('throws clear errors without a usable model or selection', () => {
		expect(() => buildGenerationRequest(inputs({ library: { models: [MODEL], loras: [], selectedModelId: '', selectedLoras: [] } }))).toThrow(
			'Select a model before generating.',
		);
		expect(() => buildGenerationRequest(inputs({ library: { models: [MODEL], loras: [], selectedModelId: 'gone', selectedLoras: [] } }))).toThrow(
			"Unknown model 'gone'.",
		);
		expect(() => buildGenerationRequest(inputs({ categories: [] }))).toThrow(PromptSelectionError);
	});
});

describe('buildGenerationRequest with an active character', () => {
	const ALICE = character({
		loras: [
			{ id: 'style', weight: 0.3 },
			{ id: 'missing-character-lora', weight: 1 },
		],
		negative_tags: ['short hair', 'UGLY'],
		seed: 4242,
		seed_locked: true,
	});

	it('builds the full request: pinned selections first, character LoRAs, negative tags, locked seed, character_id', () => {
		const { request, nextCategorySeedState, missingLoraIds, imageSeedLocked } = buildGenerationRequest(inputs({ character: ALICE }));
		expect(request).toEqual({
			model: MODEL,
			// The character's LoRA with its weight (wins over the prompt-linked default), then the selected one.
			loras: [
				{ ...LORAS[0], weight: 0.3 },
				{ ...LORAS[1], weight: 0.6 },
			],
			prompt: '1girl, silver hair, blue eyes, school uniform, 1girl, smile, oil painting',
			selections: [
				{ category_name: 'Character', prompt_text: '1girl, silver hair, blue eyes', locked: true, induced_lora_ids: [] },
				{ category_name: 'Character outfit', prompt_text: 'school uniform', locked: true, induced_lora_ids: [] },
				{ category_name: 'Main', prompt_text: '1girl, smile', locked: true, induced_lora_ids: ['style'] },
				{ category_name: 'Empty text', prompt_text: '', locked: false, induced_lora_ids: [] },
				{ category_name: 'Style', prompt_text: 'oil painting', locked: false, induced_lora_ids: [] },
			],
			width: 768,
			height: 1344,
			steps: 28,
			guidance_scale: 3,
			prompt_seed: 100,
			seed: 4242,
			negative_prompt: 'ugly, short hair',
			character_id: ALICE_ID,
		});
		expect(nextCategorySeedState).toBe(SETTINGS.promptCategorySeedState);
		expect(missingLoraIds).toEqual(['missing-character-lora', 'deleted', 'gone']);
		expect(imageSeedLocked).toBe(true);
	});

	it('an unlocked character seed leaves the planned image seed', () => {
		const { request, imageSeedLocked } = buildGenerationRequest(inputs({ character: { ...ALICE, seed_locked: false } }));
		expect(request.seed).toBe(200);
		expect(request.character_id).toBe(ALICE_ID);
		expect(imageSeedLocked).toBe(false);
	});

	it('pins the character against the USER categories (a user category named Character keeps its name)', () => {
		const categories: Category[] = [{ ...CATEGORIES[0], text: 'Character' }];
		const { request } = buildGenerationRequest(inputs({ categories, character: BOB }));
		expect(request.selections?.map((item) => [item.category_name, item.prompt_text])).toEqual([
			['character-2', '1boy, black hair'],
			['Character', '1girl, smile'],
		]);
	});

	it('honours forbidden rules with the character (the user sub-prompt gives way)', () => {
		const rules = [makeRule(tagMatcher('Character', 'silver hair'), specificMatcher('Style', 'oil painting'))];
		vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const { request } = buildGenerationRequest(inputs({ rules, character: ALICE }));
		expect(request.selections?.map((item) => item.category_name)).toEqual(['Character', 'Character outfit', 'Main', 'Empty text']);
	});

	it('cycle mode: no counter for the character and the same prompt seed', () => {
		const settings: GenerationSettings = {
			...SETTINGS,
			promptSeedBehavior: 'per_category_cycle',
			promptCategorySeedState: { main: { seed: 3, remaining: 1, prompt_count: 1 }, 'empty-text': { seed: 7, remaining: 1, prompt_count: 1 } },
		};
		vi.spyOn(Math, 'random').mockReturnValue(0.25);
		const withCharacter = buildGenerationRequest(inputs({ settings, character: ALICE }));
		const without = buildGenerationRequest(inputs({ settings }));
		expect(withCharacter.request.prompt_seed).toBe(7);
		expect(withCharacter.request.prompt_seed).toBe(without.request.prompt_seed);
		expect(withCharacter.nextCategorySeedState).toEqual(without.nextCategorySeedState);
		expect(Object.keys(withCharacter.nextCategorySeedState)).toEqual(['main', 'empty-text', 'style']);
	});
});

describe('nextSeedSnapshot', () => {
	const response = { prompt_seed: 100, image_seed: 200, seed: 200 };

	it('advances the prompt and image seed fields', () => {
		expect(nextSeedSnapshot(SETTINGS, response, {})).toEqual({ seedInput: '201', promptSeedInput: '100' });
		expect(nextSeedSnapshot({ ...SETTINGS, promptSeedBehavior: 'increment', seedInput: '' }, { ...response, image_seed: null, seed: 9 }, {})).toEqual({
			seedInput: '10',
			promptSeedInput: '101',
		});
	});

	it('replaces the per-category counters (not the prompt seed field) in cycle mode', () => {
		const next = { main: { seed: 1, remaining: 1, prompt_count: 1 } };
		expect(nextSeedSnapshot({ ...SETTINGS, promptSeedBehavior: 'per_category_cycle' }, response, next)).toEqual({
			seedInput: '201',
			promptCategorySeedState: next,
		});
	});

	it('randomize: the field shows a new random seed', () => {
		vi.spyOn(Math, 'random').mockReturnValue(0.25);
		expect(nextSeedSnapshot({ ...SETTINGS, imageSeedBehavior: 'randomize' }, response, {}).seedInput).toBe('536870912');
	});

	it('keeps the image seed field when the character locked the image seed; the prompt seed still advances', () => {
		const locked = { ...response, image_seed: 4242, seed: 4242 };
		expect(nextSeedSnapshot({ ...SETTINGS, promptSeedBehavior: 'increment' }, locked, {}, { imageSeedLocked: true })).toEqual({ promptSeedInput: '101' });
		const next = { main: { seed: 1, remaining: 1, prompt_count: 1 } };
		expect(nextSeedSnapshot({ ...SETTINGS, promptSeedBehavior: 'per_category_cycle' }, locked, next, { imageSeedLocked: true })).toEqual({
			promptCategorySeedState: next,
		});
		expect(nextSeedSnapshot(SETTINGS, response, {}, { imageSeedLocked: false })).toEqual({ seedInput: '201', promptSeedInput: '100' });
	});
});

describe('generation defaults', () => {
	it('come from the backend GenerationDefaults (generated), never from a frontend copy', () => {
		expect(DEFAULT_GENERATION_SETTINGS).toEqual(generationSettingsFromBackend(GENERATION_DEFAULTS));
		expect(DEFAULT_GENERATION_SETTINGS).toMatchObject({
			width: GENERATION_DEFAULTS.width,
			height: GENERATION_DEFAULTS.height,
			steps: GENERATION_DEFAULTS.steps,
			guidanceScale: GENERATION_DEFAULTS.guidance_scale,
			promptSeedInput: '',
			seedInput: '',
			promptCategorySeedState: {},
		});
	});

	it('maps backend fields (seeds as text, null = random)', () => {
		expect(
			generationSettingsFromBackend({ ...GENERATION_DEFAULTS, width: 832, guidance_scale: 4.5, prompt_seed: 12, seed: null, image_seed_behavior: 'increment' }),
		).toMatchObject({ width: 832, guidanceScale: 4.5, promptSeedInput: '12', seedInput: '', imageSeedBehavior: 'increment' });
	});
});

describe('sanitizeGenerationSettings', () => {
	it('keeps valid persisted settings', () => {
		const persisted = { ...SETTINGS, promptCategorySeedState: { 'day-moment': { seed: 933776099, remaining: 12, prompt_count: 16 } } };
		expect(sanitizeGenerationSettings(persisted, SETTINGS)).toEqual(persisted);
	});

	it('falls back for invalid values', () => {
		const result = sanitizeGenerationSettings(
			{
				width: -1,
				height: 'big',
				steps: Number.NaN,
				guidanceScale: -2,
				negativePrompt: null,
				promptSeedInput: 42,
				seedInput: {},
				promptSeedBehavior: 'keep',
				imageSeedBehavior: 'per_category_cycle',
				promptCategorySeedState: { bad: 1 },
			},
			SETTINGS,
		);
		expect(result).toEqual({ ...SETTINGS, promptSeedInput: '42', promptCategorySeedState: {} });
		expect(sanitizeGenerationSettings(undefined, SETTINGS)).toEqual(SETTINGS);
	});
});
