import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoRASpec, ModelSpec } from '../api/types';
import type { Category } from './categories';
import { makeRule, specificMatcher } from './forbiddenRules';
import {
	buildGenerationRequest,
	nextSeedSnapshot,
	sanitizeGenerationSettings,
	type GenerationInputs,
	type GenerationSettings,
} from './generationRequest';
import { PromptSelectionError } from './promptEngine';

const MODEL: ModelSpec = { id: 'model', name: 'model.safetensors', path: 'D:/m/model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16' };
const LORAS: LoRASpec[] = [
	{ id: 'style', name: 'style.safetensors', path: 'D:/l/style.safetensors' },
	{ id: 'portrait', name: 'portrait.safetensors', path: 'D:/l/portrait.safetensors' },
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
		library: { models: [MODEL], loras: LORAS, selectedModelId: 'model', selectedLoraIds: ['portrait', 'deleted'] },
		...overrides,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('buildGenerationRequest', () => {
	it('builds the request from the selection, settings and library', () => {
		const { request, nextCategorySeedState, missingLoraIds } = buildGenerationRequest(inputs());
		expect(request).toEqual({
			model: MODEL,
			loras: [LORAS[1], LORAS[0]],
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
		});
		expect(nextCategorySeedState).toBe(SETTINGS.promptCategorySeedState);
		expect(missingLoraIds).toEqual(['deleted', 'gone']);
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
		expect(() => buildGenerationRequest(inputs({ library: { models: [MODEL], loras: [], selectedModelId: '', selectedLoraIds: [] } }))).toThrow(
			'Select a model before generating.',
		);
		expect(() => buildGenerationRequest(inputs({ library: { models: [MODEL], loras: [], selectedModelId: 'gone', selectedLoraIds: [] } }))).toThrow(
			"Unknown model 'gone'.",
		);
		expect(() => buildGenerationRequest(inputs({ categories: [] }))).toThrow(PromptSelectionError);
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
