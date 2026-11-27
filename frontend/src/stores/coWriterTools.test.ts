// The co-writer's tools as this window runs them, over the real story store (its API calls stubbed): what each tool
// does through the story store's actions, what it answers Codex, and how it refuses or fails.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import type { CodexToolArguments, CodexToolName, CodexToolResult, ModelSpec, OutputRecord, Story } from '../api/types';
import type { Category } from '../domain/categories';
import { BOB, BOB_ID, character } from '../test/characterData';
import { toolCall } from '../test/codexData';
import { scene, SCENE_IDS, sceneOutput, story, storyCollection, STORY_ID } from '../test/storyData';
import { useCategoriesStore } from './categoriesStore';
import { useCharactersStore } from './charactersStore';
import { NO_MODEL_MESSAGE, runCoWriterTool } from './coWriterTools';
import { GENERATION_BUSY_MESSAGE, useGenerationStore } from './generationStore';
import { useLibraryStore } from './libraryStore';
import { useOutputsStore } from './outputsStore';
import { useStoryStore } from './storyStore';

const MODEL: ModelSpec = { id: 'model', name: 'model.safetensors', path: 'D:/m/model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };
const UNKNOWN_STORY = 'sty-999999999999';
const NEW_SCENE = 'scn-00000000000a';

const CATEGORIES: Category[] = [
	{ text: 'Weather', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: 'heavy rain', state: 'normal', extraLoraIds: [] }, { text: 'fog', state: 'normal', extraLoraIds: [] }] },
	{ text: 'Mood', activation_text: '', priority: 2, state: 'normal', subPrompts: [{ text: 'calm', state: 'normal', extraLoraIds: [] }] },
];

function run<T extends CodexToolName>(tool: T, args: CodexToolArguments<T>): Promise<CodexToolResult> {
	return runCoWriterTool(toolCall(tool, args));
}

const tale = (): Story => useStoryStore.getState().stories.find((item) => item.id === STORY_ID)!;

beforeEach(() => {
	useStoryStore.setState({ stories: [story()], loadStatus: 'ready', selectedStoryId: STORY_ID, selectedSceneId: null });
	useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003'] });
	useCharactersStore.setState({ characters: [character(), BOB], activeId: null });
	useCategoriesStore.setState({ categories: CATEGORIES });
	useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id });
});

describe('reading', () => {
	it('lists the stories, reads one, the characters and the categories', async () => {
		const stories = await run('list_stories', {});
		expect(stories).toMatchObject({ ok: true, summary: 'Read the stories', story_id: null });
		expect(JSON.parse(stories.text)).toEqual([{ story_id: STORY_ID, title: 'The lighthouse', scenes: 3, illustrated: 2, viewing: true }]);

		const read = await run('get_story', { story_id: STORY_ID });
		expect(read).toMatchObject({ ok: true, summary: 'Read The lighthouse', story_id: STORY_ID });
		expect(JSON.parse(read.text).scenes.map((item: { title: string }) => item.title)).toEqual(['Arrival', 'The storm', 'Morning calm']);

		expect(JSON.parse((await run('list_characters', {})).text).map((item: { name: string }) => item.name)).toEqual(['Alice', 'Bob']);
		expect(JSON.parse((await run('list_categories', { query: 'mood' })).text)).toEqual([{ category: 'Mood', skipped: false, activation_text: null, sub_prompts: ['calm'] }]);
	});

	it('reads the stories again for a story this window does not know, then says it does not exist', async () => {
		const list = vi.spyOn(api, 'listStories').mockResolvedValue(storyCollection([story()]));

		const result = await run('get_story', { story_id: UNKNOWN_STORY });

		expect(list).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ ok: false, text: `There is no story ${UNKNOWN_STORY}. Call list_stories for the story ids.`, summary: `No story ${UNKNOWN_STORY}`, story_id: null, scene_id: null });
	});
});

describe('stories', () => {
	it('creates a story (shown) with its characters', async () => {
		const created = story({ id: 'sty-00000000000b', title: 'Rain', character_ids: [BOB_ID], scenes: [] });
		const create = vi.spyOn(api, 'createStory').mockResolvedValue(created);

		const result = await run('create_story', { title: 'Rain', character_ids: [BOB_ID] });

		expect(create).toHaveBeenCalledWith({ title: 'Rain', character_ids: [BOB_ID] });
		expect(result).toMatchObject({ ok: true, summary: 'Created Rain', story_id: created.id });
		expect(useStoryStore.getState().selectedStoryId).toBe(created.id);
	});

	it('refuses unknown characters without asking the backend', async () => {
		const create = vi.spyOn(api, 'createStory');

		const result = await run('create_story', { title: 'Rain', character_ids: ['chr-999999999999'] });

		expect(create).not.toHaveBeenCalled();
		expect(result).toMatchObject({ ok: false, summary: 'Unknown characters: chr-999999999999' });
	});

	it('edits a story, and says when there is nothing to change', async () => {
		const update = vi.spyOn(api, 'updateStory').mockResolvedValue(story({ title: 'The keeper' }));

		expect(await run('update_story', { story_id: STORY_ID, title: 'The keeper', character_ids: null })).toMatchObject({ ok: true, summary: 'Edited The keeper' });
		expect(update).toHaveBeenCalledWith(STORY_ID, { title: 'The keeper' });
		expect(await run('update_story', { story_id: STORY_ID, title: null, character_ids: null })).toMatchObject({ ok: false, summary: 'Nothing to change' });
	});
});

describe('scenes', () => {
	const withHarbor = () => story({ scenes: [...story().scenes.slice(0, 1), scene({ id: NEW_SCENE, title: 'Harbor', text: 'Boats.' }), ...story().scenes.slice(1)] });

	it('adds a scene where asked, shown in the storyboard', async () => {
		const add = vi.spyOn(api, 'addScene').mockResolvedValue(withHarbor());

		const result = await run('add_scene', { story_id: STORY_ID, title: 'Harbor', text: 'Boats.', extra_tags: ['harbor'], negative_tags: [], characters: 'story', position: 2 });

		expect(add).toHaveBeenCalledWith(STORY_ID, { title: 'Harbor', text: 'Boats.', extra_tags: ['harbor'], negative_tags: [], character_ids: null, index: 1 });
		expect(result).toEqual({ ok: true, text: JSON.stringify({ scene_id: NEW_SCENE, position: 2, title: 'Harbor' }), summary: 'Added Scene 2 · Harbor', story_id: STORY_ID, scene_id: NEW_SCENE });
		expect(useStoryStore.getState()).toMatchObject({ selectedStoryId: STORY_ID, selectedSceneId: NEW_SCENE });
	});

	it("reports the store's failure", async () => {
		vi.spyOn(api, 'addScene').mockRejectedValue(new ApiError('stories.json cannot be read', 503, null));

		const result = await run('add_scene', { story_id: STORY_ID, title: null, text: '', extra_tags: [], negative_tags: [], characters: [BOB_ID], position: null });

		expect(result).toMatchObject({ ok: false, text: 'Could not add the scene: stories.json cannot be read', summary: 'Could not add a scene to The lighthouse' });
	});

	it('edits only the fields given; "story" characters and a "random" seed clear', async () => {
		const update = vi.spyOn(api, 'updateScene').mockImplementation(async () => story());

		const result = await run('update_scene', { story_id: STORY_ID, scene_id: SCENE_IDS[1], title: null, text: 'The waves rose high.', extra_tags: null, negative_tags: null, characters: 'story', seed: 'random' });

		expect(update).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[1], { text: 'The waves rose high.', character_ids: null, seed: null });
		expect(result).toMatchObject({ ok: true, summary: 'Edited Scene 2 · The storm (text, characters, seed)', scene_id: SCENE_IDS[1] });
		const nothing = await run('update_scene', { story_id: STORY_ID, scene_id: SCENE_IDS[1], title: null, text: null, extra_tags: null, negative_tags: null, characters: null, seed: null });
		expect(nothing).toMatchObject({ ok: false, summary: 'Nothing to change' });
		expect(await run('update_scene', { story_id: STORY_ID, scene_id: 'scn-999999999999', title: 'x', text: null, extra_tags: null, negative_tags: null, characters: null, seed: 3 })).toMatchObject({
			ok: false,
			text: 'The lighthouse has no scene scn-999999999999. Call get_story for its scene ids.',
		});
	});

	it("locks a sub-prompt of the user's categories, and unlocks it", async () => {
		const update = vi.spyOn(api, 'updateScene').mockImplementation(async (_story, _scene, patch) => story({ scenes: story().scenes.map((item) => (item.id === SCENE_IDS[2] ? { ...item, ...patch } as typeof item : item)) }));

		const unknownCategory = await run('lock_sub_prompt', { story_id: STORY_ID, scene_id: SCENE_IDS[2], category: 'Lighting', sub_prompt: 'dusk' });
		expect(unknownCategory).toMatchObject({ ok: false, text: 'There is no prompt category "Lighting". The categories: Weather, Mood.' });
		const unknownPrompt = await run('lock_sub_prompt', { story_id: STORY_ID, scene_id: SCENE_IDS[2], category: 'weather', sub_prompt: 'snow' });
		expect(unknownPrompt.text).toBe('"snow" is not a sub-prompt of Weather. Call list_categories with query "Weather" for its sub-prompts.');
		expect(update).not.toHaveBeenCalled();

		const locked = await run('lock_sub_prompt', { story_id: STORY_ID, scene_id: SCENE_IDS[2], category: 'weather', sub_prompt: 'Heavy Rain' });
		expect(update).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[2], { locks: [{ category_name: 'Weather', prompt_text: 'heavy rain' }] });
		expect(locked).toMatchObject({ ok: true, summary: 'Locked Weather in Scene 3 · Morning calm: heavy rain' });

		const unlocked = await run('unlock_category', { story_id: STORY_ID, scene_id: SCENE_IDS[2], category: 'WEATHER' });
		expect(update).toHaveBeenLastCalledWith(STORY_ID, SCENE_IDS[2], { locks: [] });
		expect(unlocked).toMatchObject({ ok: true, summary: 'Unlocked Weather in Scene 3 · Morning calm' });
		expect(await run('unlock_category', { story_id: STORY_ID, scene_id: SCENE_IDS[2], category: 'Mood' })).toMatchObject({ ok: false, summary: 'Morning calm has no lock of Mood' });
	});

	it('moves, duplicates and (once the user confirmed) deletes a scene', async () => {
		const [first, second, third] = story().scenes;
		const reorder = vi.spyOn(api, 'reorderScenes').mockResolvedValue(story({ scenes: [third, first, second] }));
		const duplicate = vi.spyOn(api, 'duplicateScene').mockResolvedValue(story({ scenes: [first, second, scene({ id: NEW_SCENE, title: 'The storm (copy)' }), third] }));
		const remove = vi.spyOn(api, 'deleteScene').mockResolvedValue(story({ scenes: [first, second] }));

		expect(await run('move_scene', { story_id: STORY_ID, scene_id: third.id, position: 1 })).toMatchObject({ ok: true, summary: 'Moved Morning calm to position 1' });
		expect(reorder).toHaveBeenCalledWith(STORY_ID, [third.id, first.id, second.id]);
		expect(await run('move_scene', { story_id: STORY_ID, scene_id: third.id, position: 1 })).toMatchObject({ ok: true, summary: 'Morning calm stays at position 1' });
		expect(reorder).toHaveBeenCalledTimes(1);

		expect(await run('duplicate_scene', { story_id: STORY_ID, scene_id: second.id })).toMatchObject({ ok: true, summary: 'Duplicated The storm as Scene 3 · The storm (copy)', scene_id: NEW_SCENE });
		expect(duplicate).toHaveBeenCalledWith(STORY_ID, second.id);

		const unconfirmed = await run('delete_scene', { story_id: STORY_ID, scene_id: second.id, user_confirmed: false });
		expect(unconfirmed).toMatchObject({ ok: false, summary: 'Deletion not confirmed' });
		expect(unconfirmed.text).toBe('Ask the user to confirm that Scene 2 · The storm should be deleted, then call delete_scene with user_confirmed true.');
		expect(remove).not.toHaveBeenCalled();
		expect(await run('delete_scene', { story_id: STORY_ID, scene_id: second.id, user_confirmed: true })).toMatchObject({ ok: true, summary: 'Deleted Scene 2 · The storm', scene_id: null });
		expect(remove).toHaveBeenCalledWith(STORY_ID, second.id);
	});
});

describe('pictures', () => {
	function generation(record: OutputRecord = sceneOutput('0000000009')) {
		const generateScene = vi.fn(async () => record);
		useGenerationStore.setState({ generateScene });
		const illustrated = story({ scenes: story().scenes.map((item) => (item.id === SCENE_IDS[2] ? { ...item, variants: [{ output_id: record.output_id, added_at: '2026-11-27T00:00:00Z' }], chosen_output_id: record.output_id } : item)) });
		vi.spyOn(api, 'getStory').mockResolvedValue(illustrated);
		return generateScene;
	}

	it('illustrates a scene through the one generate path', async () => {
		const generateScene = generation();

		const result = await run('generate_scene', { story_id: STORY_ID, scene_id: SCENE_IDS[2] });

		expect(generateScene).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ ok: true, text: JSON.stringify({ scene_id: SCENE_IDS[2], output_id: '0000000009', seed: 7 }), summary: 'Illustrated Scene 3 · Morning calm', story_id: STORY_ID, scene_id: SCENE_IDS[2] });
		expect(tale().scenes[2].chosen_output_id).toBe('0000000009');
	});

	it('refuses without a model or while a generation runs', async () => {
		const generateScene = generation();
		useLibraryStore.setState({ selectedModelId: undefined });
		expect(await run('generate_scene', { story_id: STORY_ID, scene_id: SCENE_IDS[2] })).toMatchObject({ ok: false, text: NO_MODEL_MESSAGE, summary: 'No model selected', scene_id: SCENE_IDS[2] });

		useLibraryStore.setState({ selectedModelId: MODEL.id });
		useGenerationStore.setState({ generating: true });
		expect(await run('generate_missing_scenes', { story_id: STORY_ID })).toMatchObject({ ok: false, text: GENERATION_BUSY_MESSAGE, story_id: STORY_ID });
		expect(generateScene).not.toHaveBeenCalled();
	});

	it('quotes why a generation failed', async () => {
		const generateScene = generation();
		generateScene.mockRejectedValueOnce(new ApiError('Generation failed: out of memory', 409, null));

		const result = await run('generate_scene', { story_id: STORY_ID, scene_id: SCENE_IDS[2] });

		expect(result).toMatchObject({ ok: false, text: 'Could not illustrate the scene: Morning calm: Generation failed: out of memory', summary: 'Could not illustrate Scene 3 · Morning calm' });
	});

	it('illustrates every missing scene, or says there is none', async () => {
		generation();
		const result = await run('generate_missing_scenes', { story_id: STORY_ID });
		expect(result).toMatchObject({ ok: true, summary: 'Illustrated 1 of 1 scenes of The lighthouse' });
		expect(JSON.parse(result.text)).toEqual({ generated: 1, missing: 1, output_ids: ['0000000009'] });

		useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003', '0000000009'] });
		expect(await run('generate_missing_scenes', { story_id: STORY_ID })).toMatchObject({ ok: true, summary: 'Every scene of The lighthouse has a picture' });
	});
});

it('answers a failure when a tool throws', async () => {
	useStoryStore.setState({ addScene: vi.fn().mockRejectedValue(new Error('boom')) });

	const result = await run('add_scene', { story_id: STORY_ID, title: null, text: '', extra_tags: [], negative_tags: [], characters: 'story', position: null });

	expect(result).toMatchObject({ ok: false, text: 'add_scene failed: boom' });
});
