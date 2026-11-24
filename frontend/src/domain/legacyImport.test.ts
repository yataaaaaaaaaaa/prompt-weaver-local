import { describe, expect, it } from 'vitest';
import { LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { AppState, LibraryState } from '../api/types';
import {
	legacyCategories,
	legacyForbiddenRules,
	legacyGenerationSettings,
	legacyLibrary,
	legacyWorkspaceWindows,
} from './legacyImport';

// Trimmed from a real app_state.json (the real workspace has image/controls/details but no 'used').
const LEGACY_APP_STATE = {
	categories: [
		{
			id: 'style',
			name: 'Main',
			muted: false,
			priority: '1',
			activation_text: '',
			locked_prompt_id: 'style-1',
			locked_prompt_text: null,
			position: { x: 24, y: 24 },
			size: { width: 760, height: 190 },
			z_index: 210,
			prompts: [
				{ id: 'style-1', text: 'masterpiece, best quality, 1girl, \n', skipped: false, extra_lora_ids: [] },
				{ id: 'style-2', text: 'sketch', skipped: true, extra_lora_ids: [] },
			],
		},
		{
			id: 'category-m1w65ofh',
			name: 'Clothed',
			muted: true,
			priority: '2',
			activation_text: '',
			locked_prompt_id: null,
			locked_prompt_text: 'naked',
			position: { x: 796, y: 4 },
			size: { width: 300, height: 232 },
			z_index: 211,
			prompts: [
				{ id: 'prompt-bawr87oi', text: 'clothed', skipped: false, extra_lora_ids: ['alya-multicharacter', 'deleted-lora'] },
				{ id: 'prompt-35xm2wra', text: 'naked', skipped: false, extra_lora_ids: [] },
			],
		},
		{
			id: 'category-dfqfzb7u',
			name: 'Lora Ideas',
			muted: false,
			priority: 'not a number',
			activation_text: 'my_lora_prompt',
			locked_prompt_id: null,
			locked_prompt_text: null,
			position: { x: Number.NaN, y: 268 },
			size: { width: 760, height: 245 },
			z_index: 226,
			prompts: [{ id: 'prompt-81nf4mwc', text: '<lora:mareep:1>', skipped: false, extra_lora_ids: [] }],
		},
	],
	forbidden_rules: [
		{
			left: { kind: 'specific', category_name: 'Clothed', prompt_text: 'naked', contains_text: null, tag_text: null },
			right: { kind: 'tag', category_name: null, prompt_text: null, contains_text: null, tag_text: 'thighhighs' },
		},
	],
	last_model_id: 'jankuv5nsfwtrainednoobai-v50-safetensors',
	last_lora_ids: ['alya-multicharacter'],
	last_model_dir: 'D:\\models\\checkpoints',
	last_lora_dir: 'D:\\models\\loras',
	width: 832,
	height: 1216,
	steps: 30,
	guidance_scale: 5.0,
	prompt_seed: 94,
	seed: 689303569,
	seed_mode: 'manual',
	seed_advance_mode: 'increment',
	prompt_seed_behavior: 'increment',
	image_seed_behavior: 'increment',
	negative_prompt: 'ugly, \nworst quality',
	workspace: {
		image: { x: 420, y: 8, width: 542, height: 928, z_index: 228 },
		controls: { x: 43, y: 34, width: 359, height: 752, z_index: 230 },
		details: { x: 1068, y: 47, width: 607, height: 775, z_index: 217 },
	},
	editor: {
		overlays_hidden: false,
		visibility_mode: 'all',
		selected_category_id: null,
		selected_prompt_id: null,
		editing_target: { kind: 'none', category_id: null, prompt_id: null },
	},
	last_output_id: '0000000112',
} as unknown as AppState;

const LEGACY_LIBRARY: LibraryState = {
	models: [
		{
			id: 'jankuv5nsfwtrainednoobai-v50-safetensors',
			name: 'JANKUV5.safetensors',
			path: 'D:\\models\\checkpoints\\JANKUV5.safetensors',
			default_width: 1024,
			default_height: 1024,
			torch_dtype: 'float16',
			source: null,
		},
		{ id: 'other', name: 'other', path: 'D:\\models\\other', default_width: 512, default_height: 512, torch_dtype: 'float16', source: null },
	],
	loras: [{ id: 'alya-multicharacter', name: 'alya.safetensors', path: 'D:\\models\\loras\\alya.safetensors', source: null }],
};

describe('legacyCategories', () => {
	it('maps names, priorities, muted, locked and skipped prompts, and keeps only library LoRA links', () => {
		expect(legacyCategories(LEGACY_APP_STATE, new Set(['alya-multicharacter']))).toEqual([
			{
				text: 'Main',
				activation_text: '',
				priority: 1,
				state: 'normal',
				subPrompts: [
					{ text: 'masterpiece, best quality, 1girl, \n', state: 'lock', extraLoraIds: [] },
					{ text: 'sketch', state: 'skip', extraLoraIds: [] },
				],
			},
			{
				text: 'Clothed',
				activation_text: '',
				priority: 2,
				state: 'skip',
				subPrompts: [
					{ text: 'clothed', state: 'normal', extraLoraIds: ['alya-multicharacter'] },
					{ text: 'naked', state: 'lock', extraLoraIds: [] },
				],
			},
			{
				text: 'Lora Ideas',
				activation_text: 'my_lora_prompt',
				priority: 1,
				state: 'normal',
				subPrompts: [{ text: '<lora:mareep:1>', state: 'normal', extraLoraIds: [] }],
			},
		]);
	});
});

describe('legacyForbiddenRules', () => {
	it('keeps the rules as they are', () => {
		expect(legacyForbiddenRules(LEGACY_APP_STATE)).toBe(LEGACY_APP_STATE.forbidden_rules);
	});
});

describe('legacyLibrary', () => {
	it('takes models/LoRAs from library.json and the selection/directories from app_state.json', () => {
		expect(legacyLibrary(LEGACY_APP_STATE, LEGACY_LIBRARY)).toEqual({
			models: LEGACY_LIBRARY.models,
			loras: LEGACY_LIBRARY.loras,
			selectedModelId: 'jankuv5nsfwtrainednoobai-v50-safetensors',
			// app_state.json has no weights: every LoRA at the default weight.
			selectedLoras: [{ id: 'alya-multicharacter', weight: LORA_WEIGHT_DEFAULTS.weight }],
			lastModelDir: 'D:\\models\\checkpoints',
			lastLoraDir: 'D:\\models\\loras',
		});
	});

	it('maps every last_lora_ids entry to the default weight, in order', () => {
		expect(legacyLibrary({ ...LEGACY_APP_STATE, last_lora_ids: ['b', 'a'] }, LEGACY_LIBRARY).selectedLoras).toEqual([
			{ id: 'b', weight: LORA_WEIGHT_DEFAULTS.weight },
			{ id: 'a', weight: LORA_WEIGHT_DEFAULTS.weight },
		]);
		expect(legacyLibrary({ ...LEGACY_APP_STATE, last_lora_ids: [] }, LEGACY_LIBRARY).selectedLoras).toEqual([]);
	});

	it('selects the first model when app_state has none', () => {
		expect(legacyLibrary({ ...LEGACY_APP_STATE, last_model_id: null }, LEGACY_LIBRARY).selectedModelId).toBe(
			'jankuv5nsfwtrainednoobai-v50-safetensors',
		);
		expect(legacyLibrary({ ...LEGACY_APP_STATE, last_model_id: null }, { models: [], loras: [] }).selectedModelId).toBe('');
	});
});

describe('legacyGenerationSettings', () => {
	it('maps the generation settings and seed fields', () => {
		expect(legacyGenerationSettings(LEGACY_APP_STATE)).toEqual({
			width: 832,
			height: 1216,
			steps: 30,
			guidanceScale: 5,
			negativePrompt: 'ugly, \nworst quality',
			promptSeedInput: '94',
			seedInput: '689303569',
			promptSeedBehavior: 'increment',
			imageSeedBehavior: 'increment',
			promptCategorySeedState: {},
		});
	});

	it('maps missing seeds to empty inputs (random)', () => {
		expect(legacyGenerationSettings({ ...LEGACY_APP_STATE, prompt_seed: null, seed: null })).toMatchObject({
			promptSeedInput: '',
			seedInput: '',
		});
	});
});

describe('legacyWorkspaceWindows', () => {
	it('maps the image/controls/used panes and every category window, skipping invalid rects', () => {
		expect(legacyWorkspaceWindows(LEGACY_APP_STATE)).toEqual({
			'pane:image': { x: 420, y: 8, width: 542, height: 928, z: 228 },
			'pane:controls': { x: 43, y: 34, width: 359, height: 752, z: 230 },
			'category:main': { x: 24, y: 24, width: 760, height: 190, z: 210 },
			'category:clothed': { x: 796, y: 8, width: 300, height: 232, z: 211 },
		});
	});

	it('includes the used pane when present', () => {
		const state = {
			...LEGACY_APP_STATE,
			categories: [],
			workspace: { ...LEGACY_APP_STATE.workspace, used: { x: 690, y: 320, width: 790, height: 420, z_index: 6 } },
		};
		expect(legacyWorkspaceWindows(state)['pane:used']).toEqual({ x: 690, y: 320, width: 790, height: 420, z: 6 });
	});

	it('imports no window for missing or incomplete legacy geometry (the frontend defaults apply)', () => {
		const state = {
			categories: [
				{ ...LEGACY_APP_STATE.categories[0], position: null, size: null, z_index: null },
				{ ...LEGACY_APP_STATE.categories[1], position: { x: 5, y: null }, z_index: null },
			],
			workspace: { image: null, controls: { x: 1, y: 2, width: 300, height: 400, z_index: null } },
		};
		expect(legacyWorkspaceWindows(state)).toEqual({ 'pane:controls': { x: 8, y: 8, width: 300, height: 400, z: expect.any(Number) } });
	});
});
