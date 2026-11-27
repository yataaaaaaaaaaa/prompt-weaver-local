import { describe, expect, it } from 'vitest';
import type { LoRASpec, ModelSpec } from '../api/types';
import { BOB, character, characterImage, ipAdapterStatus, outputCharacter, referenceSupport } from '../test/characterData';
import { illustratedScene, scene, SCENE_IDS, sceneOutput, story, STORY_ID, OTHER_STORY_ID } from '../test/storyData';
import type { Category } from './categories';
import {
	CATEGORY_PROMPT_LIMIT,
	categoriesForCodex,
	characterForCodex,
	compact,
	consistencyReportForCodex,
	forbiddenRuleText,
	generationSetupForCodex,
	lorasForCodex,
	resolveLock,
	resolveLora,
	sceneForCodex,
	scenePreviewForCodex,
	storiesForCodex,
	storyForCodex,
	type StoryViewContext,
} from './coWriterViews';
import { categoryMatcher, makeRule, specificMatcher, tagMatcher } from './forbiddenRules';
import { buildGenerationRequest, DEFAULT_GENERATION_SETTINGS } from './generationRequest';
import { buildReachabilitySnapshot, EMPTY_REACHABILITY } from './reachability';
import { sceneGenerationInput } from './stories';

const LIBRARY: LoRASpec[] = [
	{
		id: 'watercolor',
		name: 'Watercolor Wash',
		path: 'D:/l/watercolor.safetensors',
		source: {
			provider: 'civitai',
			model_id: '1',
			version_id: '2',
			file_id: '3',
			model_name: 'Watercolor',
			version_name: 'v1',
			base_model: 'SDXL 1.0',
			sha256: null,
			preview_url: null,
			trigger_words: ['wtrclr'],
			page_url: null,
		},
	},
	{ id: 'ink', name: 'Ink lines', path: 'D:/l/ink.safetensors', source: null },
];
const MODEL: ModelSpec = { id: 'model', name: 'studio.safetensors', path: 'D:/m/studio.safetensors', default_width: 832, default_height: 1216, torch_dtype: 'float16', source: null };
const CATEGORIES: Category[] = [
	{ text: 'Mood', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: 'smiling', state: 'normal', extraLoraIds: ['ink'] }, { text: 'crying', state: 'skip', extraLoraIds: [] }] },
	{ text: 'Background', activation_text: '', priority: 2, state: 'normal', subPrompts: [{ text: 'beach at sunset', state: 'normal', extraLoraIds: [] }] },
];
const MIRA = character({ name: 'Mira', identity_tags: ['1girl', 'red hair'], outfit_tags: ['raincoat'], loras: [{ id: 'watercolor', weight: 0.5 }], seed: 777, seed_locked: true });
const OUTPUTS = new Set(['0000000001', '0000000002', '0000000003']);

function context(overrides: Partial<StoryViewContext> = {}): StoryViewContext {
	return { categories: CATEGORIES, characters: [MIRA, BOB], activeCharacter: null, library: LIBRARY, outputIds: OUTPUTS, generation: null, ...overrides };
}

function built(tale: ReturnType<typeof story>, sceneId: string, ctx = context()) {
	const target = tale.scenes.find((item) => item.id === sceneId)!;
	const { input } = sceneGenerationInput(tale, target, ctx.characters, ctx.activeCharacter);
	return buildGenerationRequest({
		categories: CATEGORIES,
		rules: [],
		settings: { ...DEFAULT_GENERATION_SETTINGS, promptSeedInput: '5', negativePrompt: 'lowres' },
		library: { models: [MODEL], loras: LIBRARY, selectedModelId: 'model', selectedLoras: [{ id: 'ink', weight: 0.8 }] },
		scene: input,
	});
}

describe('compact answers', () => {
	it('leaves out empty values but keeps zero and false', () => {
		expect(compact({ a: '', b: [], c: null, d: 0, e: false, f: 'x', g: ['y'], characters: [] })).toEqual({ d: 0, e: false, f: 'x', g: ['y'], characters: [] });
	});
});

describe('stories and scenes', () => {
	it('lists the stories with their logline, progress and the one viewed', () => {
		expect(storiesForCodex([story({ logline: 'A boat comes home.' }), story({ id: OTHER_STORY_ID, title: 'Other', scenes: [] })], STORY_ID, OUTPUTS)).toEqual([
			{ story_id: STORY_ID, title: 'The lighthouse', logline: 'A boat comes home.', scenes: 3, illustrated: 2, viewing: true },
			{ story_id: OTHER_STORY_ID, title: 'Other', scenes: 0, illustrated: 0, viewing: false },
		]);
	});

	it('reads the whole story: flow, cast, every scene with its notes, per-frame settings and status', () => {
		const tale = story({
			character_ids: [MIRA.id],
			logline: 'A keeper guides a boat home.',
			style_notes: 'watercolor',
			scenes: [
				illustratedScene(['0000000001', '0000000002'], {
					id: SCENE_IDS[0],
					title: 'Arrival',
					beat: 'Mira arrives',
					shot: 'wide shot',
					locks: [{ category_name: 'Mood', prompt_text: 'smiling' }],
					loras: [{ id: 'ink', weight: 0.4 }],
					seed: 7,
				}),
				scene({ id: SCENE_IDS[1], title: 'Storm', text: '', character_ids: [] }),
			],
		});

		const read = storyForCodex(tale, context({ generation: { currentSceneId: SCENE_IDS[1], queuedSceneIds: [] } }));

		expect(read).toMatchObject({ story_id: STORY_ID, title: 'The lighthouse', logline: 'A keeper guides a boat home.', style_notes: 'watercolor', characters: [{ character_id: MIRA.id, name: 'Mira' }] });
		expect(read).not.toHaveProperty('synopsis');
		expect(read.scenes).toEqual([
			{
				scene_id: SCENE_IDS[0],
				position: 1,
				title: 'Arrival',
				beat: 'Mira arrives',
				text: 'Mira climbed the stairs.',
				shot: 'wide shot',
				locks: [{ category: 'Mood', sub_prompt: 'smiling' }],
				loras: [{ lora_id: 'ink', name: 'Ink lines', weight: 0.4 }],
				characters: 'story',
				cast: ['Mira'],
				seed: 7,
				status: 'illustrated',
				picture: '0000000002',
				variants: ['0000000001', '0000000002'],
			},
			{ scene_id: SCENE_IDS[1], position: 2, title: 'Storm', characters: [], seed: 'random', status: 'generating' },
		]);
		expect(storyForCodex(story({ character_ids: ['chr-999999999999'], scenes: [] }), context()).characters).toEqual([{ character_id: 'chr-999999999999', name: '(deleted)' }]);
		expect(sceneForCodex(tale, tale.scenes[0], context({ library: [] })).loras).toEqual([{ lora_id: 'ink', name: '(not in the library)', weight: 0.4 }]);
	});
});

describe('characters', () => {
	it('reads every field of a character, LoRAs named', () => {
		expect(characterForCodex(MIRA, MIRA.id, LIBRARY)).toEqual({
			character_id: MIRA.id,
			name: 'Mira',
			identity_tags: ['1girl', 'red hair'],
			outfit_tags: ['raincoat'],
			negative_tags: ['short hair'],
			loras: [{ lora_id: 'watercolor', name: 'Watercolor Wash', weight: 0.5 }],
			seed: 777,
			seed_locked: true,
			reference_images: [{ image_id: characterImage().id, from: 'output 0000000042' }],
			reference_focus: 'face',
			reference_strength: 0.6,
			active_in_create: true,
		});
		expect(characterForCodex(BOB, null, LIBRARY)).toMatchObject({ seed_locked: false, active_in_create: false });
		expect(characterForCodex(BOB, null, LIBRARY)).not.toHaveProperty('seed');
	});
});

describe('the prompt board', () => {
	it('lists the categories in generation order with their states, shortened unless one is asked for', () => {
		const many = Array.from({ length: CATEGORY_PROMPT_LIMIT + 5 }, (_unused, index) => ({ text: `tag ${index}`, state: 'normal' as const, extraLoraIds: [] }));
		const categories: Category[] = [
			{
				text: 'Weather',
				activation_text: '',
				priority: 2,
				state: 'normal',
				subPrompts: [
					{ text: 'rain', state: 'lock', extraLoraIds: ['ink'] },
					{ text: 'snow', state: 'skip', extraLoraIds: [] },
					{ text: ' ', state: 'normal', extraLoraIds: [] },
				],
			},
			{ text: 'Place', activation_text: 'outdoors', priority: 1, state: 'skip', subPrompts: many },
		];

		const board = categoriesForCodex(categories, [], EMPTY_REACHABILITY, LIBRARY, null);
		const [place, weather] = board.categories!;
		expect(board.categories!.map((item) => item.category)).toEqual(['Place', 'Weather']);
		expect(place).toMatchObject({ state: 'skipped', activation_text: 'outdoors', more_sub_prompts: 5 });
		expect(place.sub_prompts).toHaveLength(CATEGORY_PROMPT_LIMIT);
		expect(weather).toEqual({ category: 'Weather', state: 'normal', sub_prompts: ['rain'], locked: 'rain', skipped: ['snow'], linked_loras: [{ sub_prompt: 'rain', loras: ['Ink lines'] }] });
		expect(board).not.toHaveProperty('forbidden_rules');
		expect(categoriesForCodex(categories, [], EMPTY_REACHABILITY, LIBRARY, 'PLA').categories![0].sub_prompts).toHaveLength(CATEGORY_PROMPT_LIMIT + 5);
	});

	it('says which sub-prompts can never be picked and lists the forbidden rules in words', () => {
		const rules = [makeRule(specificMatcher('Mood', 'smiling'), specificMatcher('Background', 'beach at sunset'))];
		const locked: Category[] = [{ ...CATEGORIES[0], subPrompts: [{ text: 'smiling', state: 'lock', extraLoraIds: [] }] }, CATEGORIES[1]];

		const board = categoriesForCodex(locked, rules, buildReachabilitySnapshot(locked, rules), LIBRARY, null);

		expect(board.categories![1]).toEqual({ category: 'Background', state: 'never picked', never_picked: ['beach at sunset'] });
		expect(board.forbidden_rules).toEqual(['Mood: smiling never with Background: beach at sunset']);
		expect(forbiddenRuleText(makeRule(categoryMatcher('Mood'), tagMatcher(null, 'rain')))).toBe('any sub-prompt of Mood never with the tag "rain"');
	});
});

describe('LoRAs and the generation setup', () => {
	it('lists the library LoRAs with their trigger words and who uses them', () => {
		const tale = story({ scenes: [scene({ loras: [{ id: 'ink', weight: 1 }] })] });
		expect(lorasForCodex(LIBRARY, [{ id: 'ink', weight: 0.8 }], [MIRA, BOB], [tale], null)).toEqual([
			{ lora_id: 'watercolor', name: 'Watercolor Wash', trigger_words: ['wtrclr'], base_model: 'SDXL 1.0', used_by_characters: ['Mira'] },
			{ lora_id: 'ink', name: 'Ink lines', selected_weight: 0.8, used_in_scenes: ['The lighthouse · Scene 1 · Arrival'] },
		]);
		expect(lorasForCodex(LIBRARY, [], [], [], 'WATER').map((item) => item.name)).toEqual(['Watercolor Wash']);
	});

	it('reads the model, the settings and whether reference images work, with the files to install', () => {
		const setup = generationSetupForCodex({
			model: MODEL,
			settings: { ...DEFAULT_GENERATION_SETTINGS, negativePrompt: 'lowres' },
			selectedLoras: [{ id: 'ink', weight: 0.8 }],
			library: LIBRARY,
			activeCharacter: MIRA,
			generating: false,
			ipAdapters: ipAdapterStatus({ support: [referenceSupport(), referenceSupport({ focus: 'general', variant_id: null, ready: false, reason: 'No IP-Adapter.' })] }),
		});
		expect(setup).toMatchObject({
			model: { name: 'studio.safetensors', default_size: '832x1216' },
			size: '1024x1024',
			negative_prompt: 'lowres',
			selected_loras: [{ lora_id: 'ink', name: 'Ink lines', weight: 0.8 }],
			active_character: 'Mira',
			generating: false,
			reference_images: [
				{
					focus: 'face',
					ready: false,
					reason: 'Download the IP-Adapter to use reference images.',
					downloading: false,
					install: 'SDXL face (IP-Adapter Plus Face ViT-H): ip-adapter-plus-face_sdxl_vit-h.safetensors (848 MB), CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors (2.5 GB)',
				},
				{ focus: 'general', ready: false, reason: 'No IP-Adapter.', downloading: false },
			],
		});
		expect(generationSetupForCodex({ model: null, settings: DEFAULT_GENERATION_SETTINGS, selectedLoras: [], library: [], activeCharacter: null, generating: true, ipAdapters: null })).toMatchObject({
			model: 'none selected: no picture can be generated',
			generating: true,
			reference_images: 'unknown (no model selected, or the IP-Adapter status could not be read)',
		});
	});
});

describe('previews', () => {
	it('reads the request the builder made: prompt, negative prompt, LoRAs and where they come from, seed and references', () => {
		const tale = story({
			character_ids: [MIRA.id],
			scenes: [scene({ extra_tags: ['storm'], negative_tags: ['sunny'], loras: [{ id: 'ink', weight: 0 }], locks: [{ category_name: 'Mood', prompt_text: 'smiling' }] })],
		});
		const request = built(tale, SCENE_IDS[0]);

		const preview = scenePreviewForCodex({ story: tale, scene: tale.scenes[0], built: request, error: null, missingCharacterIds: [], context: context(), ipAdapters: ipAdapterStatus() });

		expect(preview).toMatchObject({
			scene_id: SCENE_IDS[0],
			scene: 'Scene 1 · Arrival',
			prompt: '1girl, red hair, raincoat, smiling, storm, beach at sunset',
			negative_prompt: 'lowres, short hair, sunny',
			loras: [
				{ name: 'Watercolor Wash', weight: 0.5, from: 'character' },
				{ name: 'Ink lines', weight: 0, from: 'scene' },
			],
			seed: 777,
			seed_from: "Mira's locked seed",
			random_categories: ['Background'],
			cast: ['Mira'],
			reference_images: { character: 'Mira', images: 1, focus: 'face', strength: 0.6, applies: false, reason: 'Download the IP-Adapter to use reference images.' },
			size: '1024x1024',
			model: 'studio.safetensors',
		});
		expect(preview).not.toHaveProperty('warnings');
	});

	it('says why no preview could be built, and warns about what is left out', () => {
		const tale = story({ character_ids: ['chr-999999999999'] });
		expect(scenePreviewForCodex({ story: tale, scene: tale.scenes[0], built: null, error: 'No model.', missingCharacterIds: [], context: context(), ipAdapters: null })).toEqual({
			scene_id: SCENE_IDS[0],
			scene: 'Scene 1 · Arrival',
			error: 'No model.',
		});
		const request = built(story({ character_ids: [], scenes: [scene({ loras: [{ id: 'gone', weight: 1 }] })] }), SCENE_IDS[0]);
		const preview: Record<string, unknown> = scenePreviewForCodex({ story: tale, scene: tale.scenes[0], built: request, error: null, missingCharacterIds: ['chr-999999999999'], context: context(), ipAdapters: null });
		expect(preview.warnings).toEqual(['Character chr-999999999999 no longer exists: it is left out.', 'LoRA gone is not in the library: it is left out.']);
		expect(preview.seed).toBe('random (a new seed for every picture)');
	});
});

describe('the consistency report', () => {
	it('reports each scene and the problems found, with what to do', () => {
		const tale = story({
			character_ids: [MIRA.id],
			scenes: [
				illustratedScene(['0000000001'], { id: SCENE_IDS[0], title: 'Arrival', extra_tags: ['Red Hair', 'stairs'], loras: [{ id: 'ink', weight: 0.4 }] }),
				illustratedScene(['0000000002'], { id: SCENE_IDS[1], title: 'Storm', character_ids: [], loras: [{ id: 'ink', weight: 0.9 }] }),
				scene({ id: SCENE_IDS[2], title: 'Calm', character_ids: [BOB.id], locks: [{ category_name: 'Character', prompt_text: 'x' }] }),
			],
		});
		const ctx = context();
		const pictures = [
			sceneOutput('0000000001', { character: outputCharacter({ id: MIRA.id, name: 'Mira' }), image_seed: 777, active_loras: [{ id: 'watercolor', weight: 0.5 }, { id: 'ink', weight: 0.4 }] }),
			sceneOutput('0000000002', { character: outputCharacter({ id: MIRA.id, name: 'Mira', reference: { applied: false, variant_id: null, strength: null, image_ids: [], reason: 'No IP-Adapter.' } }), image_seed: 5 }),
			null,
		];
		const inputs = tale.scenes.map((item, index) => ({
			story: tale,
			scene: item,
			built: built(tale, item.id),
			error: null,
			missingCharacterIds: [],
			context: ctx,
			ipAdapters: ipAdapterStatus({ support: [referenceSupport({ ready: true, reason: null })] }),
			picture: pictures[index],
		}));

		const report = consistencyReportForCodex(tale, inputs, ctx);

		expect(report.story).toBe('The lighthouse');
		expect(report.scenes[0]).toMatchObject({
			scene: 'Scene 1 · Arrival',
			cast_from: 'story',
			cast: [{ name: 'Mira', identity_tags: ['1girl', 'red hair'], outfit_tags: ['raincoat'], seed: 777, seed_locked: true, reference_images: 1 }],
			loras: [
				{ name: 'Watercolor Wash', weight: 0.5, from: 'character' },
				{ name: 'Ink lines', weight: 0.4, from: 'scene' },
			],
			seed: 777,
			references: { character: 'Mira', applies: true },
			picture: { output_id: '0000000001', seed: 777, character: 'Mira', references_applied: true },
		});
		expect(report.scenes[1]).toMatchObject({ cast_from: 'scene', seed: 'random', picture: { character: 'Mira', references_applied: false, references_reason: 'No IP-Adapter.' } });
		expect(report.scenes[2]).toMatchObject({ cast: [{ name: 'Bob' }], references: { character: 'Bob', images: 0, applies: false, reason: 'no reference image' } });
		expect(report.problems.map((item) => [item.scene, item.problem])).toEqual([
			['Scene 1 · Arrival', "The scene tags repeat Mira's appearance (red hair)."],
			['Scene 2 · Storm', 'This scene has no character while the story has some.'],
			['Scene 2 · Storm', 'Its picture was made with Mira, but its first character is now none.'],
			['Scene 2 · Storm', 'Its picture was made with other LoRAs or weights than the scene would use now.'],
			['Scene 3 · Calm', "The lock of Character is replaced by a character's tags."],
			[null, 'Bob has neither a locked seed nor reference images: their look can change from scene to scene.'],
			[null, 'Ink lines has different weights: 0.4 in Scene 1 · Arrival; 0.9 in Scene 2 · Storm.'],
		]);
		expect(report.problems.every((item) => item.fix.length > 0)).toBe(true);
	});
});

describe('resolving what Codex names', () => {
	it('finds a LoRA by id or name, else lists the valid ones', () => {
		expect(resolveLora('ink', LIBRARY)).toEqual({ lora: LIBRARY[1] });
		expect(resolveLora('watercolor wash', LIBRARY)).toEqual({ lora: LIBRARY[0] });
		expect(resolveLora('Watercolor', LIBRARY)).toEqual({ lora: LIBRARY[0] });
		expect(resolveLora('Oil', LIBRARY)).toEqual({ error: 'There is no LoRA "Oil" in the library. The LoRAs: Watercolor Wash (watercolor), Ink lines (ink).' });
		expect(resolveLora('Oil', [])).toEqual({ error: 'There is no LoRA "Oil" in the library. The library has no LoRA.' });
	});

	it('finds a category and its sub-prompt (casing, spaces and tag order ignored), else lists the valid ones', () => {
		expect(resolveLock('mood', '  Smiling ', CATEGORIES)).toEqual({ lock: { category_name: 'Mood', prompt_text: 'smiling' } });
		expect(resolveLock('Lighting', 'dusk', CATEGORIES)).toEqual({ error: 'There is no prompt category "Lighting". The categories: Mood, Background.' });
		expect(resolveLock('Mood', 'angry', CATEGORIES)).toEqual({ error: '"angry" is not a sub-prompt of Mood. Its sub-prompts: "smiling", "crying".' });
	});
});
