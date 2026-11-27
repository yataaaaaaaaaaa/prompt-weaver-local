// The co-writer's tools as this window runs them, over the real stores (the stories API answered by an in-memory
// backend, the other API calls stubbed): what each tool does through the stores' actions, what it answers Codex, and
// how it refuses (checked before anything changes) or fails, for every tool.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import type { Character, CodexToolArguments, CodexToolName, CodexToolResult, LoRASpec, ModelSpec, OutputRecord, Story } from '../api/types';
import type { Category } from '../domain/categories';
import { specificMatcher, makeRule } from '../domain/forbiddenRules';
import { BOB, BOB_ID, character, characterImage, ipAdapterStatus, outputCharacter, READY_SDXL_FACE, referenceSupport } from '../test/characterData';
import { toolCall } from '../test/codexData';
import { fakeStoryBackend, type StoryBackend } from '../test/storyBackend';
import { illustratedScene, scene, SCENE_IDS, sceneOutput, story, STORY_ID } from '../test/storyData';
import { useCategoriesStore } from './categoriesStore';
import { useCharactersStore } from './charactersStore';
import { NO_MODEL_MESSAGE, runCoWriterTool, VIEW_IMAGES_LIMIT } from './coWriterTools';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { GENERATION_BUSY_MESSAGE, useGenerationStore } from './generationStore';
import { useIpAdapterStore } from './ipAdapterStore';
import { useLibraryStore } from './libraryStore';
import { useOutputsStore } from './outputsStore';
import { useStoryStore } from './storyStore';

const MODEL: ModelSpec = { id: 'model', name: 'studio.safetensors', path: 'D:/m/studio.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };
const LIBRARY: LoRASpec[] = [
	{ id: 'watercolor', name: 'Watercolor Wash', path: 'D:/l/watercolor.safetensors', source: null },
	{ id: 'ink', name: 'Ink lines', path: 'D:/l/ink.safetensors', source: null },
];
const UNKNOWN_STORY = 'sty-999999999999';
const UNKNOWN_SCENE = 'scn-999999999999';
const ALICE = character();

const CATEGORIES: Category[] = [
	{ text: 'Weather', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: 'heavy rain', state: 'normal', extraLoraIds: [] }, { text: 'fog', state: 'normal', extraLoraIds: [] }] },
	{ text: 'Mood', activation_text: '', priority: 2, state: 'normal', subPrompts: [{ text: 'calm', state: 'normal', extraLoraIds: [] }] },
];

function run<T extends CodexToolName>(tool: T, args: CodexToolArguments<T>): Promise<CodexToolResult> {
	return runCoWriterTool(toolCall(tool, args));
}

const data = (result: CodexToolResult) => JSON.parse(result.text);
const tale = (): Story => useStoryStore.getState().stories.find((item) => item.id === STORY_ID)!;
const titles = (target: Story) => target.scenes.map((item) => item.title);

type SceneSpec = CodexToolArguments<'add_scenes'>['scenes'][number];
type SceneChange = CodexToolArguments<'update_scenes'>['changes'][number];

function spec(overrides: Partial<SceneSpec> = {}): SceneSpec {
	return { title: null, beat: '', text: '', shot: '', setting: '', mood: '', extra_tags: [], negative_tags: [], locks: [], loras: [], characters: 'story', seed: null, ...overrides };
}

function change(overrides: Partial<SceneChange>): SceneChange {
	return {
		scene_id: null,
		scene_ids: null,
		title: null,
		text: null,
		beat: null,
		shot: null,
		setting: null,
		mood: null,
		extra_tags: null,
		add_tags: [],
		remove_tags: [],
		negative_tags: null,
		add_negative_tags: [],
		remove_negative_tags: [],
		locks: null,
		lock: [],
		unlock: [],
		loras: null,
		set_loras: [],
		remove_loras: [],
		characters: null,
		seed: null,
		...overrides,
	};
}

function newCharacter(overrides: Partial<CodexToolArguments<'create_character'>> = {}): CodexToolArguments<'create_character'> {
	return {
		name: null,
		from_output_id: null,
		from_scene: null,
		identity_tags: null,
		outfit_tags: null,
		negative_tags: null,
		loras: null,
		seed: null,
		seed_locked: null,
		reference_strength: null,
		reference_focus: null,
		reference_output_ids: [],
		...overrides,
	};
}

function characterEdit(overrides: Partial<CodexToolArguments<'update_character'>>): CodexToolArguments<'update_character'> {
	return {
		character_id: ALICE.id,
		name: null,
		identity_tags: null,
		outfit_tags: null,
		negative_tags: null,
		loras: null,
		seed: null,
		seed_locked: null,
		reference_strength: null,
		reference_focus: null,
		add_reference_output_ids: [],
		add_reference_scenes: [],
		remove_reference_image_ids: [],
		active_in_create: null,
		...overrides,
	};
}

let backend: StoryBackend;

beforeEach(() => {
	backend = fakeStoryBackend([story()]);
	useStoryStore.setState({ stories: [story()], loadStatus: 'ready', selectedStoryId: STORY_ID, selectedSceneId: null });
	useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003'] });
	useCharactersStore.setState({ characters: [ALICE, BOB], activeId: null });
	useCategoriesStore.setState({ categories: CATEGORIES });
	useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id, loras: LIBRARY, selectedLoras: [] });
	vi.spyOn(api, 'ipAdapterStatus').mockResolvedValue(ipAdapterStatus());
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('reading', () => {
	it('lists the stories and reads one whole', async () => {
		const stories = await run('list_stories', {});
		expect(stories).toMatchObject({ ok: true, summary: 'Read the stories', story_id: null, images: [] });
		expect(data(stories)).toEqual([{ story_id: STORY_ID, title: 'The lighthouse', scenes: 3, illustrated: 2, viewing: true }]);

		const read = await run('get_story', { story_id: STORY_ID });
		expect(read).toMatchObject({ ok: true, summary: 'Read The lighthouse', story_id: STORY_ID });
		expect(data(read).scenes.map((item: { title: string; status: string; cast: string[] }) => [item.title, item.status, item.cast])).toEqual([
			['Arrival', 'illustrated', ['Alice']],
			['The storm', 'illustrated', ['Alice']],
			['Morning calm', 'not illustrated', ['Alice']],
		]);
	});

	it('reads the stories again for a story this window does not know, then says it does not exist', async () => {
		const result = await run('get_story', { story_id: UNKNOWN_STORY });

		expect(api.listStories).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			ok: false,
			text: `There is no story ${UNKNOWN_STORY}. Call list_stories for the story ids.`,
			summary: `No story ${UNKNOWN_STORY}`,
			story_id: null,
			scene_id: null,
			character_id: null,
			images: [],
		});
	});

	it('reads the characters, the prompt board with its rules and the LoRAs', async () => {
		useCharactersStore.setState({ characters: [character({ loras: [{ id: 'watercolor', weight: 0.5 }] }), BOB], activeId: BOB_ID });
		useForbiddenRulesStore.setState({ rules: [makeRule(specificMatcher('Weather', 'fog'), specificMatcher('Mood', 'calm'))] });
		useLibraryStore.setState({ selectedLoras: [{ id: 'ink', weight: 0.7 }] });

		const characters = data(await run('list_characters', {}));
		expect(characters.map((item: { name: string; active_in_create: boolean }) => [item.name, item.active_in_create])).toEqual([['Alice', false], ['Bob', true]]);
		expect(characters[0].loras).toEqual([{ lora_id: 'watercolor', name: 'Watercolor Wash', weight: 0.5 }]);

		const board = await run('list_categories', { query: 'mood' });
		expect(board.summary).toBe('Read the prompt board');
		expect(data(board)).toEqual({ categories: [{ category: 'Mood', state: 'normal', sub_prompts: ['calm'] }], forbidden_rules: ['Weather: fog never with Mood: calm'] });

		const loras = data(await run('list_loras', { query: null }));
		expect(loras).toEqual([
			{ lora_id: 'watercolor', name: 'Watercolor Wash', used_by_characters: ['Alice'] },
			{ lora_id: 'ink', name: 'Ink lines', selected_weight: 0.7 },
		]);
		expect(data(await run('list_loras', { query: 'oil' }))).toEqual({ loras: [], note: 'No LoRA matches "oil".' });
	});

	it('reads the generation setup, with the reference image support of the model', async () => {
		const setup = await run('get_generation_setup', {});

		expect(setup.summary).toBe('Read the generation setup');
		expect(data(setup)).toMatchObject({ model: { name: 'studio.safetensors' }, generating: false, reference_images: [{ focus: 'face', ready: false }, { focus: 'general', ready: false }] });
		expect(api.ipAdapterStatus).toHaveBeenCalledWith(MODEL.path, expect.anything());
		useLibraryStore.setState({ selectedModelId: '' });
		expect(data(await run('get_generation_setup', {}))).toMatchObject({ model: 'none selected: no picture can be generated' });
	});
});

// ---------------------------------------------------------------------------
// Previews and the consistency report
// ---------------------------------------------------------------------------

describe('previews and the consistency report', () => {
	it('previews what generating a scene would use, from the request builder', async () => {
		const withSettings = story({ scenes: [scene({ id: SCENE_IDS[0], title: 'Arrival', extra_tags: ['storm'], negative_tags: ['sunny'], loras: [{ id: 'ink', weight: 0.4 }], seed: 9 })] });
		useStoryStore.setState({ stories: [withSettings] });

		const preview = await run('preview_scenes', { story_id: STORY_ID, scene_ids: null });

		expect(preview).toMatchObject({ ok: true, summary: 'Previewed the prompt of Scene 1 · Arrival', scene_id: SCENE_IDS[0] });
		const [first] = data(preview).scenes;
		expect(first.prompt).toContain('storm');
		expect(first).toMatchObject({ negative_prompt: 'short hair, sunny', loras: [{ name: 'Ink lines', weight: 0.4, from: 'scene' }], seed: 9, seed_from: 'the scene', cast: ['Alice'] });
		expect(useGenerationStore.getState().generating).toBe(false);
	});

	it('refuses a preview without a model, and unknown scenes with the valid ones', async () => {
		expect(await run('preview_scenes', { story_id: STORY_ID, scene_ids: [UNKNOWN_SCENE] })).toMatchObject({
			ok: false,
			text: `The lighthouse has no scene ${UNKNOWN_SCENE}. Its scenes: ${SCENE_IDS[0]} (Scene 1 · Arrival), ${SCENE_IDS[1]} (Scene 2 · The storm), ${SCENE_IDS[2]} (Scene 3 · Morning calm).`,
		});
		useLibraryStore.setState({ selectedModelId: '' });
		expect(await run('preview_scenes', { story_id: STORY_ID, scene_ids: null })).toMatchObject({ ok: false, text: NO_MODEL_MESSAGE, summary: 'No model selected' });
	});

	it('checks the consistency of a story, reading what its pictures were made with', async () => {
		const getOutput = vi.spyOn(api, 'getOutput').mockImplementation(async (outputId) => sceneOutput(outputId, { character: outputCharacter({ id: BOB_ID, name: 'Bob' }) }));

		const report = await run('consistency_report', { story_id: STORY_ID, scene_ids: [SCENE_IDS[0]] });

		expect(getOutput).toHaveBeenCalledWith('0000000001');
		expect(report).toMatchObject({ ok: true, summary: 'Checked The lighthouse: 2 problems to look at', story_id: STORY_ID });
		expect(data(report).problems.map((item: { problem: string }) => item.problem)).toEqual([
			"Alice's reference images cannot apply: Download the IP-Adapter to use reference images.",
			'Its picture was made with Bob, but its first character is now Alice.',
		]);
		expect(data(report).scenes[0]).toMatchObject({ scene: 'Scene 1 · Arrival', cast_from: 'story', picture: { output_id: '0000000001', character: 'Bob' } });
	});
});

// ---------------------------------------------------------------------------
// Looking at pictures
// ---------------------------------------------------------------------------

describe('view_images', () => {
	it("shows the scenes' pictures, outputs and characters' reference images, each labelled", async () => {
		const result = await run('view_images', { story_id: STORY_ID, scene_ids: null, output_ids: ['0000000002'], character_ids: [ALICE.id] });

		expect(result).toMatchObject({ ok: true, summary: 'Looked at 4 pictures of The lighthouse', story_id: STORY_ID });
		expect(result.images).toEqual([
			{ label: 'Scene 1 · Arrival, its picture (output #0000000001)', output_id: '0000000001', character_id: null, image_id: null },
			{ label: 'Scene 2 · The storm, its picture (output #0000000003)', output_id: '0000000003', character_id: null, image_id: null },
			{ label: 'Output #0000000002', output_id: '0000000002', character_id: null, image_id: null },
			{ label: `Alice, reference image 1 of 1 (${characterImage().id})`, output_id: null, character_id: ALICE.id, image_id: characterImage().id },
		]);
		expect(data(result).not_shown).toEqual([]);
	});

	it('says which scenes have no picture, keeps to the limit, and refuses unknown outputs or characters', async () => {
		const scenes = await run('view_images', { story_id: STORY_ID, scene_ids: [SCENE_IDS[2]], output_ids: [], character_ids: [BOB_ID] });
		expect(scenes).toMatchObject({ ok: true, summary: 'No picture to look at', images: [] });
		expect(data(scenes)).toMatchObject({ without_picture: ['Scene 3 · Morning calm'], notes: ['Bob has no reference image.'] });

		const many = Array.from({ length: VIEW_IMAGES_LIMIT + 2 }, (_unused, index) => String(index + 1).padStart(10, '0'));
		useOutputsStore.setState({ ids: many });
		const limited = await run('view_images', { story_id: null, scene_ids: null, output_ids: many, character_ids: [] });
		expect(limited.images).toHaveLength(VIEW_IMAGES_LIMIT);
		expect(data(limited).not_shown).toEqual(['Output #0000000009', 'Output #0000000010']);

		expect(await run('view_images', { story_id: null, scene_ids: null, output_ids: ['0000000099'], character_ids: [] })).toMatchObject({ ok: false, summary: 'No output 0000000099' });
		expect(await run('view_images', { story_id: null, scene_ids: null, output_ids: [], character_ids: ['chr-999999999999'] })).toMatchObject({ ok: false, summary: 'Unknown characters: chr-999999999999' });
	});
});

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

describe('stories', () => {
	it('creates a story with its flow and its whole outline in one call, shown in the storyboard', async () => {
		const result = await run('create_story', {
			title: 'Rain',
			character_ids: [BOB_ID],
			logline: 'Bob waits for the rain to stop.',
			synopsis: '',
			style_notes: 'ink and wash',
			scenes: [
				spec({ title: 'Station', beat: 'Bob waits', text: 'The train is late.', shot: 'wide shot', extra_tags: ['train station'], locks: [{ category: 'weather', sub_prompt: 'Heavy Rain' }], loras: [{ lora: 'ink lines', weight: 0.7 }] }),
				spec({ title: 'Home', characters: [], seed: 5 }),
			],
		});

		const created = useStoryStore.getState().stories.find((item) => item.title === 'Rain')!;
		expect(result).toMatchObject({ ok: true, summary: 'Created Rain with 2 scenes', story_id: created.id, scene_id: created.scenes[0].id });
		expect(api.createStory).toHaveBeenCalledWith({ title: 'Rain', character_ids: [BOB_ID], logline: 'Bob waits for the rain to stop.', synopsis: '', style_notes: 'ink and wash' });
		expect(created.scenes[0]).toMatchObject({
			title: 'Station',
			beat: 'Bob waits',
			shot: 'wide shot',
			extra_tags: ['train station'],
			locks: [{ category_name: 'Weather', prompt_text: 'heavy rain' }],
			loras: [{ id: 'ink', weight: 0.7 }],
			character_ids: null,
		});
		expect(created.scenes[1]).toMatchObject({ title: 'Home', character_ids: [], seed: 5 });
		expect(useStoryStore.getState()).toMatchObject({ selectedStoryId: created.id, selectedSceneId: created.scenes[0].id });
		expect(data(result)).toMatchObject({ title: 'Rain', logline: 'Bob waits for the rain to stop.', characters: [{ character_id: BOB_ID, name: 'Bob' }] });
		expect(data(result).scenes).toHaveLength(2);
	});

	it('checks the whole outline first: nothing is created when a part is wrong', async () => {
		const unknownCharacter = await run('create_story', { title: 'Rain', character_ids: ['chr-999999999999'], logline: '', synopsis: '', style_notes: '', scenes: [] });
		expect(unknownCharacter).toMatchObject({ ok: false, summary: 'Unknown characters: chr-999999999999' });
		expect(unknownCharacter.text).toBe('These characters do not exist: chr-999999999999. The characters: Alice (chr-a11ce0000001), Bob (chr-b0b000000002).');

		const unknownPrompt = await run('create_story', { title: 'Rain', character_ids: [], logline: '', synopsis: '', style_notes: '', scenes: [spec(), spec({ title: 'B', locks: [{ category: 'Mood', sub_prompt: 'angry' }] })] });
		expect(unknownPrompt).toMatchObject({ ok: false, summary: 'Could not create the story' });
		expect(unknownPrompt.text).toBe('Scene 2 of the call (B): "angry" is not a sub-prompt of Mood. Its sub-prompts: "calm".');

		const unknownLora = await run('create_story', { title: 'Rain', character_ids: [], logline: '', synopsis: '', style_notes: '', scenes: [spec({ loras: [{ lora: 'Oil', weight: 1 }] })] });
		expect(unknownLora.text).toContain('There is no LoRA "Oil" in the library. The LoRAs: Watercolor Wash (watercolor), Ink lines (ink).');
		expect(api.createStory).not.toHaveBeenCalled();
	});

	it('edits the title, cast and flow of a story', async () => {
		const result = await run('update_story', { story_id: STORY_ID, title: null, character_ids: [BOB_ID], logline: 'A storm.', synopsis: null, style_notes: 'oil' });

		expect(result).toMatchObject({ ok: true, summary: 'Edited The lighthouse (characters, logline, style notes)', story_id: STORY_ID });
		expect(api.updateStory).toHaveBeenCalledWith(STORY_ID, { character_ids: [BOB_ID], logline: 'A storm.', style_notes: 'oil' });
		expect(tale()).toMatchObject({ character_ids: [BOB_ID], logline: 'A storm.', style_notes: 'oil' });
		expect(data(result)).not.toHaveProperty('scenes');
		expect(await run('update_story', { story_id: UNKNOWN_STORY, title: 'x', character_ids: null, logline: null, synopsis: null, style_notes: null })).toMatchObject({ ok: false, summary: `No story ${UNKNOWN_STORY}` });
	});

	it('deletes a story only once the user confirmed', async () => {
		const unconfirmed = await run('delete_story', { story_id: STORY_ID, user_confirmed: false });
		expect(unconfirmed).toMatchObject({ ok: false, summary: 'Deletion not confirmed' });
		expect(unconfirmed.text).toBe('Ask the user to confirm that the story The lighthouse (3 scenes) should be deleted, then call delete_story with user_confirmed true.');
		expect(api.deleteStory).not.toHaveBeenCalled();

		expect(await run('delete_story', { story_id: STORY_ID, user_confirmed: true })).toMatchObject({ ok: true, summary: 'Deleted The lighthouse' });
		expect(useStoryStore.getState().stories).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------

describe('scenes', () => {
	it('adds scenes at a position, in order, shown in the storyboard', async () => {
		const result = await run('add_scenes', { story_id: STORY_ID, position: 2, scenes: [spec({ title: 'Harbor', beat: 'Boats return' }), spec({ title: 'Market', mood: 'busy' })] });

		expect(titles(tale())).toEqual(['Arrival', 'Harbor', 'Market', 'The storm', 'Morning calm']);
		const harbor = tale().scenes[1];
		expect(result).toMatchObject({ ok: true, summary: 'Added 2 scenes to The lighthouse: Scene 2 · Harbor, Scene 3 · Market', story_id: STORY_ID, scene_id: harbor.id });
		expect(data(result).scenes.map((item: { title: string; position: number }) => [item.title, item.position])).toEqual([['Harbor', 2], ['Market', 3]]);
		expect(useStoryStore.getState().selectedSceneId).toBe(harbor.id);

		const appended = await run('add_scenes', { story_id: STORY_ID, position: null, scenes: [spec({ text: 'The end.' })] });
		expect(appended.summary).toBe('Added Scene 6 · Scene 6');
	});

	it("refuses scenes naming unknown characters and reports the store's failure", async () => {
		expect(await run('add_scenes', { story_id: STORY_ID, position: null, scenes: [spec({ characters: ['chr-999999999999'] })] })).toMatchObject({
			ok: false,
			summary: 'Could not add scenes to The lighthouse',
		});
		vi.mocked(api.addScene).mockRejectedValueOnce(new ApiError('Disk full', 500, null));
		const result = await run('add_scenes', { story_id: STORY_ID, position: null, scenes: [spec({ title: 'Harbor' })] });
		expect(result).toMatchObject({ ok: false, summary: 'Added 0 of 1 scenes to The lighthouse' });
		expect(result.text).toContain('Could not add the scene: Disk full');
	});

	it('edits many scenes in one call: story-wide changes, then one scene', async () => {
		useStoryStore.setState({ stories: [story({ scenes: story().scenes.map((item) => ({ ...item, negative_tags: ['blurry'] })) })] });
		backend = fakeStoryBackend([tale()]);

		const result = await run('update_scenes', {
			story_id: STORY_ID,
			changes: [
				change({ scene_ids: 'all', add_negative_tags: ['lowres', 'Blurry'], set_loras: [{ lora: 'Watercolor Wash', weight: 0.6 }] }),
				change({ scene_id: SCENE_IDS[1], text: 'The waves rose high.', add_tags: ['lightning'], remove_tags: ['night'], lock: [{ category: 'Mood', sub_prompt: 'calm' }], seed: 1234 }),
			],
		});

		expect(result).toMatchObject({ ok: true, summary: 'Edited 3 scenes of The lighthouse (text, tags, negative tags, locked sub-prompts, LoRAs, seed)', story_id: STORY_ID, scene_id: null });
		expect(tale().scenes.map((item) => [item.negative_tags, item.loras])).toEqual([
			[['blurry', 'lowres'], [{ id: 'watercolor', weight: 0.6 }]],
			[['blurry', 'lowres'], [{ id: 'watercolor', weight: 0.6 }]],
			[['blurry', 'lowres'], [{ id: 'watercolor', weight: 0.6 }]],
		]);
		expect(tale().scenes[1]).toMatchObject({ text: 'The waves rose high.', extra_tags: ['storm', 'lightning'], locks: [{ category_name: 'Mood', prompt_text: 'calm' }], seed: 1234 });
		// Only the fields that change are sent.
		expect(api.updateScene).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[0], { negative_tags: ['blurry', 'lowres'], loras: [{ id: 'watercolor', weight: 0.6 }] });
		expect(data(result).changed).toHaveLength(3);
		expect(backend.story(STORY_ID).scenes[1].seed).toBe(1234);
	});

	it('replaces and clears fields, unlocks and removes LoRAs; one scene is linked', async () => {
		useStoryStore.setState({
			stories: [story({ scenes: [scene({ id: SCENE_IDS[0], locks: [{ category_name: 'Mood', prompt_text: 'calm' }], loras: [{ id: 'ink', weight: 1 }], character_ids: [BOB_ID], seed: 4 })] })],
		});
		backend = fakeStoryBackend([tale()]);

		const result = await run('update_scenes', {
			story_id: STORY_ID,
			changes: [change({ scene_id: SCENE_IDS[0], title: 'Dawn', unlock: ['MOOD'], remove_loras: ['Ink lines'], characters: 'story', seed: 'random', extra_tags: ['dawn', 'dawn '], negative_tags: [] })],
		});

		expect(result).toMatchObject({ ok: true, summary: 'Edited Scene 1 · Dawn (title, tags, locked sub-prompts, LoRAs, characters, seed)', scene_id: SCENE_IDS[0] });
		expect(tale().scenes[0]).toMatchObject({ title: 'Dawn', extra_tags: ['dawn'], locks: [], loras: [], character_ids: null, seed: null });
	});

	it('checks every change first: nothing changes when one is wrong, and the answer lists the valid choices', async () => {
		const wrongPrompt = await run('update_scenes', {
			story_id: STORY_ID,
			changes: [change({ scene_ids: 'all', add_tags: ['ok'] }), change({ scene_id: SCENE_IDS[0], lock: [{ category: 'Lighting', sub_prompt: 'dusk' }] })],
		});
		expect(wrongPrompt).toMatchObject({ ok: false, summary: 'Could not edit the scenes of The lighthouse' });
		expect(wrongPrompt.text).toBe('Nothing was changed. Change 2: There is no prompt category "Lighting". The categories: Weather, Mood.');
		const wrongScene = await run('update_scenes', { story_id: STORY_ID, changes: [change({ scene_ids: [SCENE_IDS[0], UNKNOWN_SCENE], add_tags: ['x'] })] });
		expect(wrongScene.text).toContain(`Change 1: The lighthouse has no scene ${UNKNOWN_SCENE}. Its scenes:`);
		const wrongLora = await run('update_scenes', { story_id: STORY_ID, changes: [change({ scene_id: SCENE_IDS[0], remove_loras: ['Oil'] })] });
		expect(wrongLora.text).toContain('There is no LoRA "Oil" in the library.');
		const wrongCast = await run('update_scenes', { story_id: STORY_ID, changes: [change({ scene_id: SCENE_IDS[0], characters: ['chr-999999999999'] })] });
		expect(wrongCast.text).toContain('These characters do not exist: chr-999999999999.');
		expect(api.updateScene).not.toHaveBeenCalled();

		expect(await run('update_scenes', { story_id: STORY_ID, changes: [change({ scene_id: SCENE_IDS[1], add_tags: ['Storm'] })] })).toMatchObject({ ok: true, summary: 'Nothing to change in The lighthouse' });
	});

	it('reorders the scenes: a full order or one move, and refuses an order that is not one', async () => {
		const [arrival, storm, calm] = SCENE_IDS;
		expect(await run('reorder_scenes', { story_id: STORY_ID, order: [calm, arrival, storm], scene_id: null, position: null })).toMatchObject({ ok: true, summary: 'Reordered the scenes of The lighthouse' });
		expect(titles(tale())).toEqual(['Morning calm', 'Arrival', 'The storm']);
		const moved = await run('reorder_scenes', { story_id: STORY_ID, order: null, scene_id: storm, position: 1 });
		expect(moved).toMatchObject({ ok: true, summary: 'Moved The storm to position 1', scene_id: storm });
		expect(data(moved).order.map((item: { title: string }) => item.title)).toEqual(['The storm', 'Morning calm', 'Arrival']);
		expect(await run('reorder_scenes', { story_id: STORY_ID, order: null, scene_id: storm, position: 1 })).toMatchObject({ ok: true, summary: 'The scenes of The lighthouse keep their order' });
		const wrong = await run('reorder_scenes', { story_id: STORY_ID, order: [storm, storm, calm], scene_id: null, position: null });
		expect(wrong).toMatchObject({ ok: false, summary: 'Not a scene order' });
		expect(wrong.text).toContain('order must list each of the 3 scenes of The lighthouse once:');
	});

	it('duplicates a scene, and deletes scenes once the user confirmed', async () => {
		const copy = await run('duplicate_scene', { story_id: STORY_ID, scene_id: SCENE_IDS[1] });
		expect(copy).toMatchObject({ ok: true, summary: 'Duplicated The storm as Scene 3 · The storm (copy)' });
		expect(data(copy)).toMatchObject({ title: 'The storm (copy)', position: 3 });

		const unconfirmed = await run('delete_scenes', { story_id: STORY_ID, scene_ids: [SCENE_IDS[0], SCENE_IDS[2]], user_confirmed: false });
		expect(unconfirmed.text).toBe('Ask the user to confirm that Scene 1 · Arrival, Scene 4 · Morning calm should be deleted, then call delete_scenes with user_confirmed true.');
		expect(api.deleteScene).not.toHaveBeenCalled();
		expect(await run('delete_scenes', { story_id: STORY_ID, scene_ids: [SCENE_IDS[0], SCENE_IDS[2]], user_confirmed: true })).toMatchObject({
			ok: true,
			summary: 'Deleted 2 scenes of The lighthouse: Scene 1 · Arrival, Scene 4 · Morning calm',
		});
		expect(titles(tale())).toEqual(['The storm', 'The storm (copy)']);
		expect(await run('delete_scenes', { story_id: STORY_ID, scene_ids: [UNKNOWN_SCENE], user_confirmed: true })).toMatchObject({ ok: false });
	});
});

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

describe('pictures', () => {
	function generation(records: OutputRecord[] = [sceneOutput('0000000009')]) {
		let next = 0;
		const generateScene = vi.fn(async (input: { sceneId: string }) => {
			const record = records[next++];
			const target = backend.story(STORY_ID);
			fakeStoryBackend([{ ...target, scenes: target.scenes.map((item) => (item.id === input.sceneId ? { ...item, variants: [...item.variants, { output_id: record.output_id, added_at: '' }], chosen_output_id: record.output_id } : item)) }]);
			return record;
		});
		useGenerationStore.setState({ generateScene });
		return generateScene;
	}

	it('illustrates the scenes given, through the one generate path', async () => {
		const generateScene = generation([sceneOutput('0000000009'), sceneOutput('0000000010', { image_seed: 8 })]);

		const result = await run('generate_scenes', { story_id: STORY_ID, scene_ids: [SCENE_IDS[2], SCENE_IDS[0]] });

		expect(generateScene).toHaveBeenCalledTimes(2);
		expect(result).toMatchObject({ ok: true, summary: 'Illustrated 2 of 2 scenes of The lighthouse', story_id: STORY_ID, scene_id: null });
		expect(data(result).generated).toEqual([
			{ scene: 'Scene 3 · Morning calm', scene_id: SCENE_IDS[2], output_id: '0000000009', seed: 7 },
			{ scene: 'Scene 1 · Arrival', scene_id: SCENE_IDS[0], output_id: '0000000010', seed: 8 },
		]);
	});

	it('illustrates the scenes without a picture, or says there is none', async () => {
		generation();
		const result = await run('generate_scenes', { story_id: STORY_ID, scene_ids: null });
		expect(result).toMatchObject({ ok: true, summary: 'Illustrated Scene 3 · Morning calm', scene_id: SCENE_IDS[2] });
		expect(tale().scenes[2].chosen_output_id).toBe('0000000009');

		useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003', '0000000009'] });
		expect(await run('generate_scenes', { story_id: STORY_ID, scene_ids: null })).toMatchObject({ ok: true, summary: 'Every scene of The lighthouse has a picture' });
	});

	it('refuses without a model or while a generation runs, and quotes why a generation failed', async () => {
		const generateScene = generation();
		useLibraryStore.setState({ selectedModelId: '' });
		expect(await run('generate_scenes', { story_id: STORY_ID, scene_ids: [SCENE_IDS[2]] })).toMatchObject({ ok: false, text: NO_MODEL_MESSAGE, summary: 'No model selected', scene_id: SCENE_IDS[2] });
		useLibraryStore.setState({ selectedModelId: MODEL.id });
		useGenerationStore.setState({ generating: true });
		expect(await run('generate_scenes', { story_id: STORY_ID, scene_ids: null })).toMatchObject({ ok: false, text: GENERATION_BUSY_MESSAGE });
		expect(generateScene).not.toHaveBeenCalled();

		useGenerationStore.setState({ generating: false });
		generateScene.mockRejectedValueOnce(new ApiError('Generation failed: out of memory', 409, null));
		const failed = await run('generate_scenes', { story_id: STORY_ID, scene_ids: [SCENE_IDS[2]] });
		expect(failed).toMatchObject({ ok: false, summary: 'Could not illustrate Scene 3 · Morning calm' });
		expect(failed.text).toContain('Could not illustrate the scene: Morning calm: Generation failed: out of memory');
	});

	it("picks, adds and removes a scene's variants (the outputs are kept)", async () => {
		const picked = await run('edit_variants', { story_id: STORY_ID, scene_id: SCENE_IDS[1], add: [], choose: '0000000002', remove: [] });
		expect(picked).toMatchObject({ ok: true, summary: 'Changed the pictures of Scene 2 · The storm (picture #0000000002)' });
		expect(tale().scenes[1].chosen_output_id).toBe('0000000002');

		const removed = await run('edit_variants', { story_id: STORY_ID, scene_id: SCENE_IDS[1], add: ['0000000001'], choose: null, remove: ['0000000002'] });
		expect(removed.summary).toBe('Changed the pictures of Scene 2 · The storm (1 added, 1 removed, picture #0000000001)');
		expect(tale().scenes[1].variants.map((item) => item.output_id)).toEqual(['0000000003', '0000000001']);

		expect(await run('edit_variants', { story_id: STORY_ID, scene_id: SCENE_IDS[1], add: [], choose: '0000000002', remove: [] })).toMatchObject({
			ok: false,
			text: '0000000002 is not a variant of Scene 2 · The storm. Its variants: 0000000003, 0000000001.',
		});
		expect(await run('edit_variants', { story_id: STORY_ID, scene_id: SCENE_IDS[1], add: ['0000000077'], choose: null, remove: [] })).toMatchObject({ ok: false, summary: 'No output 0000000077' });
	});
});

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

describe('characters', () => {
	function saved(fields: Partial<Character>): Character {
		return character({ id: 'chr-00000000000c', reference_images: [], thumbnail: null, ...fields });
	}

	it('creates a character from scratch, its LoRAs named', async () => {
		const create = vi.spyOn(api, 'createCharacter').mockImplementation(async (request) => saved({ ...request }));

		const result = await run('create_character', newCharacter({ name: 'Mira', identity_tags: ['1girl', 'red hair'], outfit_tags: ['raincoat'], loras: [{ lora: 'Watercolor Wash', weight: 0.5 }], seed: 777, seed_locked: true }));

		expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mira', identity_tags: ['1girl', 'red hair'], outfit_tags: ['raincoat'], loras: [{ id: 'watercolor', weight: 0.5 }], seed: 777, seed_locked: true, reference_sources: [] }));
		expect(result).toMatchObject({ ok: true, summary: 'Created Mira', character_id: 'chr-00000000000c' });
		expect(data(result)).toMatchObject({ name: 'Mira', loras: [{ lora_id: 'watercolor', name: 'Watercolor Wash', weight: 0.5 }] });
		expect(useCharactersStore.getState().selectedId).toBe('chr-00000000000c');
	});

	it("creates a character from a scene's picture, prefilled like Create character", async () => {
		vi.spyOn(api, 'getOutput').mockResolvedValue(
			sceneOutput('0000000003', { image_seed: 4242, active_loras: [{ id: 'ink', weight: 0.3 }], selections: [{ category_name: 'Subject', prompt_text: '1girl, silver hair', locked: false, induced_lora_ids: [] }] }),
		);
		const create = vi.spyOn(api, 'createCharacter').mockImplementation(async (request) => saved({ ...request }));

		const result = await run('create_character', newCharacter({ name: 'Nova', from_scene: { story_id: STORY_ID, scene_id: SCENE_IDS[1] }, seed_locked: true, reference_output_ids: ['0000000001'] }));

		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Nova',
				identity_tags: ['1girl', 'silver hair'],
				loras: [{ id: 'ink', weight: 0.3 }],
				seed: 4242,
				seed_locked: true,
				reference_sources: [
					{ kind: 'output', output_id: '0000000003' },
					{ kind: 'output', output_id: '0000000001' },
				],
			}),
		);
		expect(result).toMatchObject({ ok: true, summary: 'Created Nova' });
	});

	it('refuses a scene without a picture, a locked seed without a seed, unknown LoRAs and outputs', async () => {
		const create = vi.spyOn(api, 'createCharacter');
		expect((await run('create_character', newCharacter({ from_scene: { story_id: STORY_ID, scene_id: SCENE_IDS[2] } }))).text).toBe('Scene 3 · Morning calm of The lighthouse has no picture yet.');
		expect((await run('create_character', newCharacter({ seed_locked: true }))).text).toBe('seed_locked needs a seed: give seed.');
		expect((await run('create_character', newCharacter({ loras: [{ lora: 'Oil', weight: 1 }] }))).text).toContain('There is no LoRA "Oil"');
		expect(await run('create_character', newCharacter({ from_output_id: '0000000055' }))).toMatchObject({ ok: false, text: expect.stringContaining('These outputs do not exist: 0000000055.') });
		expect(create).not.toHaveBeenCalled();
	});

	it('edits any field, adds reference images from scene pictures, removes one and activates the character', async () => {
		const update = vi.spyOn(api, 'updateCharacter').mockImplementation(async (_id, draft) => character({ ...useCharactersStore.getState().characters[0], ...draft }));
		const remove = vi.spyOn(api, 'removeCharacterReferenceImage').mockImplementation(async () => character({ ...useCharactersStore.getState().characters[0], reference_images: [] }));
		const add = vi.spyOn(api, 'addCharacterReferenceImage').mockImplementation(async (_id, source) =>
			character({ ...useCharactersStore.getState().characters[0], reference_images: [characterImage({ id: 'img-0000000000b2', source })] }),
		);
		vi.spyOn(api, 'setActiveCharacter').mockImplementation(async (id) => ({ items: useCharactersStore.getState().characters, active_id: id }));

		const result = await run(
			'update_character',
			characterEdit({ outfit_tags: ['raincoat'], loras: [{ lora: 'ink', weight: 0.2 }], seed: 9, seed_locked: true, reference_strength: 0.7, add_reference_scenes: [{ story_id: STORY_ID, scene_id: SCENE_IDS[0] }], remove_reference_image_ids: [characterImage().id], active_in_create: true }),
		);

		expect(remove).toHaveBeenCalledWith(ALICE.id, characterImage().id);
		expect(update).toHaveBeenCalledWith(ALICE.id, expect.objectContaining({ outfit_tags: ['raincoat'], loras: [{ id: 'ink', weight: 0.2 }], seed: 9, seed_locked: true, reference_strength: 0.7, identity_tags: ALICE.identity_tags }));
		expect(add).toHaveBeenCalledWith(ALICE.id, { kind: 'output', output_id: '0000000001' });
		expect(result).toMatchObject({
			ok: true,
			summary: 'Edited Alice (outfit tags, LoRAs, seed, seed lock, reference strength, 1 reference image added, 1 reference image removed, active in Create)',
			character_id: ALICE.id,
		});
		expect(useCharactersStore.getState().activeId).toBe(ALICE.id);
		expect(data(result).reference_images).toEqual([{ image_id: 'img-0000000000b2', from: 'output 0000000001' }]);
	});

	it('clears the seed, and refuses unknown images, too many references and unknown characters', async () => {
		const update = vi.spyOn(api, 'updateCharacter').mockImplementation(async (_id, draft) => character({ ...ALICE, ...draft }));
		expect(await run('update_character', characterEdit({ seed: 'none' }))).toMatchObject({ ok: true, summary: 'Edited Alice (seed)' });
		expect(update).toHaveBeenCalledWith(ALICE.id, expect.objectContaining({ seed: null, seed_locked: false }));

		expect((await run('update_character', characterEdit({ remove_reference_image_ids: ['img-000000000099'] }))).text).toBe(
			`img-000000000099 is not a reference image of Alice. Its reference images: ${characterImage().id}.`,
		);
		const many = await run('update_character', characterEdit({ add_reference_output_ids: ['0000000001', '0000000002', '0000000003', '0000000001'] }));
		expect(many.text).toBe('Alice would have 5 reference images; a character holds at most 4. Remove some first (remove_reference_image_ids).');
		expect(await run('update_character', characterEdit({ character_id: 'chr-999999999999', name: 'x' }))).toMatchObject({ ok: false, summary: 'No character chr-999999999999' });
		expect((await run('update_character', characterEdit({ character_id: BOB_ID, seed_locked: true }))).text).toBe('seed_locked needs a seed: give seed.');
	});

	it('deletes a character only once the user confirmed', async () => {
		const remove = vi.spyOn(api, 'deleteCharacter').mockResolvedValue();
		expect(await run('delete_character', { character_id: BOB_ID, user_confirmed: false })).toMatchObject({ ok: false, summary: 'Deletion not confirmed', character_id: BOB_ID });
		expect(remove).not.toHaveBeenCalled();
		expect(await run('delete_character', { character_id: BOB_ID, user_confirmed: true })).toMatchObject({ ok: true, summary: 'Deleted Bob' });
		expect(useCharactersStore.getState().characters.map((item) => item.name)).toEqual(['Alice']);
	});
});

describe('install_ip_adapter', () => {
	it('needs a model and the user consent, and says when the files are there', async () => {
		useLibraryStore.setState({ selectedModelId: '' });
		expect(await run('install_ip_adapter', { focus: 'face', user_confirmed: true })).toMatchObject({ ok: false, text: NO_MODEL_MESSAGE });
		useLibraryStore.setState({ selectedModelId: MODEL.id });
		expect(await run('install_ip_adapter', { focus: 'face', user_confirmed: false })).toMatchObject({ ok: false, summary: 'Download not confirmed' });

		vi.mocked(api.ipAdapterStatus).mockResolvedValue(ipAdapterStatus({ variants: [READY_SDXL_FACE], support: [referenceSupport({ ready: true, reason: null })] }));
		expect(await run('install_ip_adapter', { focus: 'face', user_confirmed: true })).toMatchObject({ ok: true, summary: 'Reference images are ready (face)' });
		vi.mocked(api.ipAdapterStatus).mockResolvedValue(ipAdapterStatus({ support: [referenceSupport({ focus: 'general', variant_id: null, reason: 'Flux has no IP-Adapter.' })] }));
		expect(await run('install_ip_adapter', { focus: 'general', user_confirmed: true })).toMatchObject({ ok: false, text: 'Flux has no IP-Adapter.' });
	});

	it('starts the download through the IP-Adapter store and answers once it runs', async () => {
		const install = vi.spyOn(api, 'installIpAdapter').mockImplementation(async () => {
			const downloading = ipAdapterStatus();
			downloading.variants[0].files = downloading.variants[0].files.map((file, index) => ({ ...file, task_id: `task-${index}` }));
			vi.mocked(api.ipAdapterStatus).mockResolvedValue(downloading);
			return { state: 'downloading', task_ids: ['task-0', 'task-1'] };
		});

		const result = await run('install_ip_adapter', { focus: 'face', user_confirmed: true });

		expect(install).toHaveBeenCalledWith('sdxl-face');
		expect(result).toMatchObject({ ok: true, summary: 'Downloading SDXL face (IP-Adapter Plus Face ViT-H)' });
		expect(data(result).files.every((file: { downloading: boolean }) => file.downloading)).toBe(true);
		expect(useIpAdapterStore.getState().installing).toEqual({ 'sdxl-face': true });
	});
});

it('answers a failure when a tool throws', async () => {
	useStoryStore.setState({ addScenes: vi.fn().mockRejectedValue(new Error('boom')) });

	const result = await run('add_scenes', { story_id: STORY_ID, position: null, scenes: [spec()] });

	expect(result).toMatchObject({ ok: false, text: 'add_scenes failed: boom', summary: 'add_scenes failed' });
});

it('illustrated scenes are listed with their variants', async () => {
	useStoryStore.setState({ stories: [story({ scenes: [illustratedScene(['0000000002', '0000000003'])] })] });
	expect(data(await run('get_story', { story_id: STORY_ID })).scenes[0]).toMatchObject({ picture: '0000000003', variants: ['0000000002', '0000000003'] });
});
