import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import type { ModelSpec, OutputRecord, ScenePatch, Story } from '../api/types';
import type { Category } from '../domain/categories';
import type { SceneGenerationInput } from '../domain/stories';
import { flushPersistence } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import { desktop } from '../services/desktop';
import { download } from '../services/download';
import { ALICE_ID, BOB, BOB_ID, character, outputCharacter } from '../test/characterData';
import { fakeStoryBackend } from '../test/storyBackend';
import { illustratedScene, scene, SCENE_IDS, sceneOutput, story, storyCollection, STORY_ID, OTHER_STORY_ID } from '../test/storyData';
import { useCategoriesStore } from './categoriesStore';
import { useCharactersStore } from './charactersStore';
import { GENERATION_BUSY_MESSAGE, useGenerationStore } from './generationStore';
import { useLibraryStore } from './libraryStore';
import { useNavigationStore } from './navigationStore';
import { useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { STORY_FAILURES, useCanGenerateScenes, useMissingSceneIds, useStoryStore } from './storyStore';

const ALICE = character();
const MODEL: ModelSpec = { id: 'model', name: 'model.safetensors', path: 'D:/m/model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };

const stories = () => useStoryStore.getState();

function notifications() {
	return useNotificationsStore.getState().notifications.map(({ intent, title, message, action }) => ({ intent, title, message, action: action?.label ?? null }));
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

/** The store holding the fixture story (selected), its outputs on disk and Alice. */
function seeded(items: Story[] = [story()]) {
	useStoryStore.setState({ stories: items, loadStatus: 'ready', selectedStoryId: items[0]?.id ?? null, selectedSceneId: null });
	useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003'] });
	useCharactersStore.setState({ characters: [ALICE, BOB], activeId: null });
}

const tale = () => stories().stories[0];

describe('load and stories', () => {
	it('loads the stories and selects the first one, keeping a selection that still exists', async () => {
		const other = story({ id: OTHER_STORY_ID, title: 'Other' });
		vi.spyOn(api, 'listStories').mockResolvedValue(storyCollection([story(), other]));

		await stories().load();
		expect(stories()).toMatchObject({ loadStatus: 'ready', selectedStoryId: STORY_ID, selectedSceneId: null });

		useStoryStore.setState({ selectedStoryId: OTHER_STORY_ID, selectedSceneId: SCENE_IDS[1] });
		await stories().load();
		expect(stories()).toMatchObject({ selectedStoryId: OTHER_STORY_ID, selectedSceneId: SCENE_IDS[1] });
	});

	it('keeps the failure for the section (no notification)', async () => {
		vi.spyOn(api, 'listStories').mockRejectedValue(new ApiError('stories.json cannot be read', 503, null));

		await stories().load();

		expect(stories()).toMatchObject({ loadStatus: 'failed', loadError: 'stories.json cannot be read' });
		expect(notifications()).toEqual([]);
	});

	it('creates a story with a unique title and selects it', async () => {
		seeded([story({ title: 'New story' })]);
		const created = story({ id: OTHER_STORY_ID, title: 'New story 2', scenes: [], character_ids: [] });
		const createStory = vi.spyOn(api, 'createStory').mockResolvedValue(created);

		expect(await stories().createStory()).toEqual(created);

		expect(createStory).toHaveBeenCalledWith({ title: 'New story 2', character_ids: [], logline: '', synopsis: '', style_notes: '' });
		expect(stories()).toMatchObject({ selectedStoryId: OTHER_STORY_ID, selectedSceneId: null, reader: null });
		expect(stories().stories.map((item) => item.id)).toEqual([STORY_ID, OTHER_STORY_ID]);
	});

	it('updates and deletes a story; the next one is selected', async () => {
		seeded([story(), story({ id: OTHER_STORY_ID, title: 'Other' })]);
		vi.spyOn(api, 'updateStory').mockImplementation(async (_id, patch) => ({ ...story(), ...patch }) as Story);
		const deleteStory = vi.spyOn(api, 'deleteStory').mockResolvedValue(undefined);

		await stories().updateStory(STORY_ID, { character_ids: [BOB_ID] });
		expect(tale().character_ids).toEqual([BOB_ID]);

		expect(await stories().deleteStory(STORY_ID)).toBe(true);
		expect(deleteStory).toHaveBeenCalledWith(STORY_ID);
		expect(stories()).toMatchObject({ selectedStoryId: OTHER_STORY_ID });
		expect(stories().stories.map((item) => item.id)).toEqual([OTHER_STORY_ID]);
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'The lighthouse was deleted.', action: null }]);
	});

	it('reports a failed write and leaves the story unchanged', async () => {
		seeded();
		vi.spyOn(api, 'updateStory').mockRejectedValue(new ApiError('Unknown story', 503, null));

		expect(await stories().updateStory(STORY_ID, { title: 'X' })).toBeNull();

		expect(tale().title).toBe('The lighthouse');
		expect(notifications()).toEqual([{ intent: 'error', title: STORY_FAILURES.update, message: 'Unknown story', action: null }]);
	});

	it('selects stories and scenes, ignoring unknown ids', () => {
		seeded([story(), story({ id: OTHER_STORY_ID })]);
		stories().selectScene(SCENE_IDS[1]);
		expect(stories().selectedSceneId).toBe(SCENE_IDS[1]);
		stories().selectScene('scn-unknown00000');
		expect(stories().selectedSceneId).toBe(SCENE_IDS[1]);

		stories().selectStory(OTHER_STORY_ID);
		expect(stories()).toMatchObject({ selectedStoryId: OTHER_STORY_ID, selectedSceneId: null });
		stories().selectStory('sty-unknown00000');
		expect(stories().selectedStoryId).toBe(OTHER_STORY_ID);
	});
});

describe('scenes', () => {
	it('adds a scene and selects it', async () => {
		seeded();
		const added = scene({ id: 'scn-00000000000a', title: 'Scene 4' });
		const addScene = vi.spyOn(api, 'addScene').mockResolvedValue(story({ scenes: [...story().scenes, added] }));

		expect(await stories().addScene(STORY_ID)).toEqual(added);

		expect(addScene).toHaveBeenCalledWith(STORY_ID, { text: '', beat: '', shot: '', setting: '', mood: '' });
		expect(stories().selectedSceneId).toBe(added.id);
	});

	it('shows a scene change at once, then the answer; earlier answers never hide a later change', async () => {
		seeded();
		const answers: ReturnType<typeof deferred<Story>>[] = [];
		const updateScene = vi.spyOn(api, 'updateScene').mockImplementation(() => {
			const answer = deferred<Story>();
			answers.push(answer);
			return answer.promise;
		});
		const server = (patches: ScenePatch[]) => {
			const base = story();
			return { ...base, scenes: base.scenes.map((item) => (item.id === SCENE_IDS[0] ? { ...item, ...Object.assign({}, ...patches) } : item)) };
		};

		const first = stories().updateScene(STORY_ID, SCENE_IDS[0], { text: 'One' });
		const second = stories().updateScene(STORY_ID, SCENE_IDS[0], { title: 'Two' });
		expect(tale().scenes[0]).toMatchObject({ text: 'One', title: 'Two' });
		// Writes of one story are serialized: the second waits for the first.
		await Promise.resolve();
		expect(updateScene).toHaveBeenCalledTimes(1);

		answers[0].resolve(server([{ text: 'One' }]));
		await first;
		expect(tale().scenes[0]).toMatchObject({ text: 'One', title: 'Two' });
		await vi.waitFor(() => expect(updateScene).toHaveBeenCalledTimes(2));
		answers[1].resolve(server([{ text: 'One' }, { title: 'Two' }]));
		await second;
		expect(tale().scenes[0]).toMatchObject({ text: 'One', title: 'Two' });
	});

	it('undoes a failed scene change by reading the story again', async () => {
		seeded();
		vi.spyOn(api, 'updateScene').mockRejectedValue(new ApiError('disk full', 500, null));
		const getStory = vi.spyOn(api, 'getStory').mockResolvedValue(story());

		expect(await stories().updateScene(STORY_ID, SCENE_IDS[0], { text: 'Lost' })).toBeNull();

		expect(getStory).toHaveBeenCalledWith(STORY_ID);
		expect(tale().scenes[0].text).toBe('Mira climbed the stairs.');
		expect(notifications()).toEqual([{ intent: 'error', title: STORY_FAILURES.updateScene, message: 'disk full', action: null }]);
	});

	it('locks and unlocks sub-prompts through the scene locks', async () => {
		seeded([story({ scenes: [scene({ locks: [{ category_name: 'Mood', prompt_text: 'calm' }] })] })]);
		const updateScene = vi.spyOn(api, 'updateScene').mockImplementation(async (_storyId, _sceneId, patch) => ({
			...story(),
			scenes: [scene({ locks: patch.locks ?? [] })],
		}));

		await stories().lockSubPrompt(STORY_ID, SCENE_IDS[0], 'Subject', '1girl');
		await stories().lockSubPrompt(STORY_ID, SCENE_IDS[0], 'mood', 'smiling');
		await stories().unlockCategory(STORY_ID, SCENE_IDS[0], 'Subject');

		expect(updateScene.mock.calls.map(([, , patch]) => patch.locks)).toEqual([
			[
				{ category_name: 'Mood', prompt_text: 'calm' },
				{ category_name: 'Subject', prompt_text: '1girl' },
			],
			[
				{ category_name: 'mood', prompt_text: 'smiling' },
				{ category_name: 'Subject', prompt_text: '1girl' },
			],
			[{ category_name: 'mood', prompt_text: 'smiling' }],
		]);
	});

	it('duplicates a scene and selects the copy; deleting the selected scene selects its neighbour', async () => {
		seeded();
		const copy = scene({ id: 'scn-00000000000c', title: 'Arrival (copy)' });
		const [arrival, storm, calm] = story().scenes;
		vi.spyOn(api, 'duplicateScene').mockResolvedValue(story({ scenes: [arrival, copy, storm, calm] }));
		vi.spyOn(api, 'deleteScene').mockResolvedValue(story({ scenes: [arrival, storm, calm] }));

		expect(await stories().duplicateScene(STORY_ID, arrival.id)).toEqual(copy);
		expect(stories().selectedSceneId).toBe(copy.id);

		expect(await stories().deleteScene(STORY_ID, copy.id)).toBe(true);
		expect(stories().selectedSceneId).toBe(storm.id);
	});

	it('moves scenes with the keyboard moves and drops, answering the new position', async () => {
		seeded();
		const reorderScenes = vi.spyOn(api, 'reorderScenes').mockImplementation(async (_id, ids) => ({
			...story(),
			scenes: ids.map((sceneId) => story().scenes.find((item) => item.id === sceneId)!),
		}));

		expect(await stories().moveScene(STORY_ID, SCENE_IDS[0], 'next')).toEqual({ position: 2, total: 3, moved: true });
		expect(reorderScenes).toHaveBeenLastCalledWith(STORY_ID, [SCENE_IDS[1], SCENE_IDS[0], SCENE_IDS[2]]);
		expect(await stories().moveSceneNextTo(STORY_ID, SCENE_IDS[2], SCENE_IDS[1], 'before')).toEqual({ position: 1, total: 3, moved: true });
		expect(tale().scenes.map((item) => item.id)).toEqual([SCENE_IDS[2], SCENE_IDS[1], SCENE_IDS[0]]);

		// Already first: nothing is sent.
		reorderScenes.mockClear();
		expect(await stories().moveScene(STORY_ID, SCENE_IDS[2], 'previous')).toEqual({ position: 1, total: 3, moved: false });
		expect(reorderScenes).not.toHaveBeenCalled();
		expect(await stories().moveScene(STORY_ID, 'scn-unknown00000', 'next')).toBeNull();
	});
});

describe('illustrations', () => {
	function generation() {
		useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id });
		const inputs: SceneGenerationInput[] = [];
		let next = 10;
		const generateScene = vi.fn(async (input: SceneGenerationInput): Promise<OutputRecord> => {
			inputs.push(input);
			return sceneOutput(`00000000${next++}`, { story: { story_id: input.storyId, scene_id: input.sceneId, story_title: '', scene_title: '' } });
		});
		useGenerationStore.setState({ generateScene });
		// The backend made each new output the scene's chosen variant.
		const getStory = vi.spyOn(api, 'getStory').mockImplementation(async () => tale());
		return { inputs, generateScene, getStory };
	}

	it("generates the missing scenes one after the other with each scene's input, then reads the story again", async () => {
		seeded([story({ scenes: [scene({ id: SCENE_IDS[0] }), illustratedScene(['0000000001'], { id: SCENE_IDS[1] }), scene({ id: SCENE_IDS[2], seed: 5 })] })]);
		const { inputs, getStory } = generation();
		const progress: unknown[] = [];
		const unsubscribe = useStoryStore.subscribe((state) => progress.push(state.generation));

		const records = await stories().generateMissing(STORY_ID);
		unsubscribe();

		expect(records.map((record) => record.output_id)).toEqual(['0000000010', '0000000011']);
		expect(inputs.map((input) => [input.sceneId, input.cast.map((member) => member.id), input.seed])).toEqual([
			[SCENE_IDS[0], [ALICE_ID], null],
			[SCENE_IDS[2], [ALICE_ID], 5],
		]);
		expect(getStory).toHaveBeenCalledTimes(2);
		expect(progress).toContainEqual({ storyId: STORY_ID, currentSceneId: SCENE_IDS[2], queuedSceneIds: [], completed: 1, total: 2 });
		expect(stories().generation).toBeNull();
		// Announced, with 'Go to Story' while another section is shown.
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: '2 scenes of The lighthouse were illustrated.', action: 'Go to Story' }]);
	});

	it('refuses while a generation runs', async () => {
		seeded();
		const { generateScene } = generation();
		useGenerationStore.setState({ generating: true });

		expect(await stories().generateScene(STORY_ID, SCENE_IDS[2])).toBeNull();

		expect(generateScene).not.toHaveBeenCalled();
		expect(notifications()).toEqual([{ intent: 'warning', title: null, message: GENERATION_BUSY_MESSAGE, action: null }]);
	});

	it('stops at the first failure and reports it with the scene', async () => {
		seeded();
		const { generateScene } = generation();
		generateScene.mockRejectedValueOnce(new ApiError('Generation failed: out of memory', 409, null));

		expect(await stories().generateScenes(STORY_ID, [SCENE_IDS[0], SCENE_IDS[2]])).toEqual([]);

		expect(generateScene).toHaveBeenCalledTimes(1);
		expect(stories().generation).toBeNull();
		expect(notifications()).toEqual([
			{ intent: 'error', title: `${STORY_FAILURES.generate}: Arrival`, message: 'Generation failed: out of memory', action: null },
		]);
	});

	it('cancels the run: the scene being generated is cancelled and the queue dropped, quietly', async () => {
		seeded();
		const { generateScene } = generation();
		const running = deferred<OutputRecord>();
		generateScene.mockImplementationOnce(() => running.promise);
		const cancel = vi.fn(async () => running.reject(new DOMException('aborted', 'AbortError')));
		useGenerationStore.setState({ cancel });

		const run = stories().generateScenes(STORY_ID, [SCENE_IDS[0], SCENE_IDS[2]]);
		await vi.waitFor(() => expect(stories().generation?.currentSceneId).toBe(SCENE_IDS[0]));
		await stories().cancelGeneration();

		expect(await run).toEqual([]);
		expect(cancel).toHaveBeenCalled();
		expect(generateScene).toHaveBeenCalledTimes(1);
		expect(stories().generation).toBeNull();
		expect(notifications()).toEqual([]);
	});

	it('warns once about characters that no longer exist', async () => {
		seeded([story({ character_ids: ['chr-gone00000000', ALICE_ID] })]);
		const { inputs } = generation();

		await stories().generateScenes(STORY_ID, [SCENE_IDS[0], SCENE_IDS[2]]);

		expect(inputs.map((input) => input.cast.map((member) => member.id))).toEqual([[ALICE_ID], [ALICE_ID]]);
		expect(notifications().filter((item) => item.intent === 'warning')).toEqual([
			{ intent: 'warning', title: 'Missing characters', message: 'Characters that no longer exist were left out: chr-gone00000000.', action: null },
		]);
	});

	it('chooses, adds and removes variants through the backend', async () => {
		seeded();
		const answer = story();
		const choose = vi.spyOn(api, 'chooseSceneVariant').mockResolvedValue(answer);
		const add = vi.spyOn(api, 'addSceneVariant').mockResolvedValue(answer);
		const remove = vi.spyOn(api, 'removeSceneVariant').mockResolvedValue(answer);

		await stories().chooseVariant(STORY_ID, SCENE_IDS[1], '0000000002');
		await stories().addVariant(STORY_ID, SCENE_IDS[2], '0000000001');
		await stories().removeVariant(STORY_ID, SCENE_IDS[1], '0000000003');

		expect(choose).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[1], '0000000002');
		expect(add).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[2], '0000000001');
		expect(remove).toHaveBeenCalledWith(STORY_ID, SCENE_IDS[1], '0000000003');
	});
});

describe('addSceneFromOutput (Create)', () => {
	const RECORD = sceneOutput('0000000007', {
		story: null,
		character: outputCharacter(),
		image_seed: 4321,
		selections: [
			{ category_name: 'Character', prompt_text: '1girl, silver hair, blue eyes', locked: true, induced_lora_ids: [] },
			{ category_name: 'Subject', prompt_text: '1girl', locked: false, induced_lora_ids: [] },
		],
	});

	it('adds the current output as a scene of a story, announced with Go to Story', async () => {
		seeded();
		useOutputsStore.setState({ record: RECORD });
		useCategoriesStore.setState({ categories: [] as Category[] });
		const added = illustratedScene(['0000000007'], { id: 'scn-00000000000d', title: 'Scene 4' });
		const addScene = vi.spyOn(api, 'addScene').mockResolvedValue(story({ scenes: [...story().scenes, added] }));

		expect(await stories().addSceneFromOutput(STORY_ID)).toEqual(added);

		expect(addScene).toHaveBeenCalledWith(STORY_ID, {
			output_id: '0000000007',
			text: '',
			beat: '', shot: '', setting: '', mood: '',
			character_ids: null,
			locks: [{ category_name: 'Subject', prompt_text: '1girl' }],
			seed: 4321,
		});
		expect(stories()).toMatchObject({ selectedStoryId: STORY_ID, selectedSceneId: added.id });
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Scene 4 was added to The lighthouse.', action: 'Go to Story' }]);
	});

	it("starts a new story with the output's character", async () => {
		seeded([]);
		useOutputsStore.setState({ record: RECORD });
		const created = story({ id: OTHER_STORY_ID, title: 'New story', scenes: [], character_ids: [ALICE_ID] });
		const createStory = vi.spyOn(api, 'createStory').mockResolvedValue(created);
		vi.spyOn(api, 'addScene').mockResolvedValue({ ...created, scenes: [scene({ id: 'scn-00000000000e', title: 'Scene 1' })] });

		await stories().addSceneFromOutput(null);

		expect(createStory).toHaveBeenCalledWith({ title: 'New story', character_ids: [ALICE_ID], logline: '', synopsis: '', style_notes: '' });
		expect(stories().selectedStoryId).toBe(OTHER_STORY_ID);
	});

	it('warns when no output is shown', async () => {
		seeded();
		useOutputsStore.setState({ record: null });

		expect(await stories().addSceneFromOutput(STORY_ID)).toBeNull();
		expect(notifications()[0]).toMatchObject({ intent: 'warning' });
	});
});

describe('reader', () => {
	it('opens on the selected scene, turns pages within the story (the page scene becomes selected) and closes', () => {
		seeded();
		stories().selectScene(SCENE_IDS[1]);

		stories().openReader();
		expect(stories()).toMatchObject({ reader: { page: 1 }, selectedSceneId: SCENE_IDS[1] });
		stories().setReaderPage(5);
		expect(stories()).toMatchObject({ reader: { page: 2 }, selectedSceneId: SCENE_IDS[2] });
		stories().openReader(0);
		expect(stories().reader).toEqual({ page: 0 });
		stories().closeReader();
		expect(stories().reader).toBeNull();
		stories().setReaderPage(1);
		expect(stories().reader).toBeNull();
	});

	it('closes when another story is selected', () => {
		seeded([story(), story({ id: OTHER_STORY_ID })]);
		stories().openReader();

		stories().selectStory(OTHER_STORY_ID);

		expect(stories().reader).toBeNull();
	});
});

describe('exportStory', () => {
	it('saves the HTML where the desktop save dialog says', async () => {
		seeded();
		vi.spyOn(api, 'exportStory').mockResolvedValue('<!DOCTYPE html>');
		vi.spyOn(desktop, 'isAvailable').mockReturnValue(true);
		const save = vi.spyOn(desktop, 'saveTextFile').mockResolvedValue('C:/Users/me/The lighthouse.html');

		expect(await stories().exportStory(STORY_ID)).toBe(true);

		expect(save).toHaveBeenCalledWith({
			title: 'Export story',
			defaultPath: 'The lighthouse.html',
			filters: [{ name: 'Web page', extensions: ['html'] }],
			content: '<!DOCTYPE html>',
		});
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'The lighthouse was exported to C:/Users/me/The lighthouse.html.', action: null }]);
		expect(stories().exportingIds).toEqual({});
	});

	it('does nothing more when the dialog is cancelled', async () => {
		seeded();
		vi.spyOn(api, 'exportStory').mockResolvedValue('<!DOCTYPE html>');
		vi.spyOn(desktop, 'isAvailable').mockReturnValue(true);
		vi.spyOn(desktop, 'saveTextFile').mockResolvedValue(null);

		expect(await stories().exportStory(STORY_ID)).toBe(false);
		expect(notifications()).toEqual([]);
	});

	it('downloads the HTML in the browser', async () => {
		seeded();
		vi.spyOn(api, 'exportStory').mockResolvedValue('<!DOCTYPE html>');
		vi.spyOn(desktop, 'isAvailable').mockReturnValue(false);
		const text = vi.spyOn(download, 'text').mockImplementation(() => undefined);

		expect(await stories().exportStory(STORY_ID)).toBe(true);

		expect(text).toHaveBeenCalledWith('The lighthouse.html', '<!DOCTYPE html>', 'text/html');
		expect(notifications()[0]).toMatchObject({ intent: 'success', message: 'The lighthouse was downloaded as The lighthouse.html.' });
	});

	it('reports a failed export', async () => {
		seeded();
		vi.spyOn(api, 'exportStory').mockRejectedValue(new ApiError('Unknown story', 404, null));
		vi.spyOn(api, 'getStory').mockResolvedValue(story());

		expect(await stories().exportStory(STORY_ID)).toBe(false);
		expect(notifications()[0]).toMatchObject({ intent: 'error', title: STORY_FAILURES.export });
	});
});

describe('selectors', () => {
	it('lists the missing scenes of a story and whether scenes can be generated', () => {
		seeded();
		useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id });

		const missing = renderHook(() => useMissingSceneIds(STORY_ID));
		const can = renderHook(() => useCanGenerateScenes());
		expect(missing.result.current).toEqual([SCENE_IDS[2]]);
		expect(can.result.current).toBe(true);

		useStoryStore.setState({ generation: { storyId: STORY_ID, currentSceneId: null, queuedSceneIds: [], completed: 0, total: 1 } });
		can.rerender();
		expect(can.result.current).toBe(false);
	});
});

describe('hand-offs', () => {
	it('offers no Go to Story while the Story section is shown', async () => {
		seeded();
		useNavigationStore.setState({ section: 'story' });
		useOutputsStore.setState({ record: sceneOutput('0000000007', { story: null }) });
		vi.spyOn(api, 'addScene').mockResolvedValue(story({ scenes: [...story().scenes, scene({ id: 'scn-00000000000f', title: 'Scene 4' })] }));

		await stories().addSceneFromOutput(STORY_ID);

		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Scene 4 was added to The lighthouse.', action: null }]);
	});
});

describe('the dock', () => {
	it("keeps the dock's collapse in story-store (version 0), and only that", async () => {
		const memory = createMemoryStoreBackend({ 'story-store': { state: { dockCollapsed: true }, version: 0 } });
		setStoreBackend(memory);

		await useStoryStore.persist.rehydrate();
		expect(stories().dockCollapsed).toBe(true);
		stories().setDockCollapsed(false);
		await flushPersistence();

		expect(memory.snapshot()['story-store']).toEqual({ state: { dockCollapsed: false }, version: 0 });
	});

	it('starts expanded, and ignores a saved value of another shape', async () => {
		setStoreBackend(createMemoryStoreBackend({ 'story-store': { state: { dockCollapsed: 'yes' }, version: 0 } }));
		expect(stories().dockCollapsed).toBe(false);

		await useStoryStore.persist.rehydrate();

		expect(stories().dockCollapsed).toBe(false);
	});
});

describe('batches, scene LoRAs and previews', () => {
	it('addScenes adds scenes one after the other from an index, then selects the first one', async () => {
		seeded();
		fakeStoryBackend([story()]);

		const added = await stories().addScenes(STORY_ID, [{ text: 'a', beat: 'one', shot: '', setting: '', mood: '', title: 'Harbor' }, { text: '', beat: '', shot: '', setting: '', mood: 'busy', title: 'Market' }], 1);

		expect(added.map((item) => item.title)).toEqual(['Harbor', 'Market']);
		expect(tale().scenes.map((item) => item.title)).toEqual(['Arrival', 'Harbor', 'Market', 'The storm', 'Morning calm']);
		expect(api.addScene).toHaveBeenNthCalledWith(2, STORY_ID, expect.objectContaining({ title: 'Market', index: 2 }));
		expect(stories()).toMatchObject({ selectedStoryId: STORY_ID, selectedSceneId: added[0].id });
	});

	it('addScenes stops at the first failure (reported) and answers the scenes added', async () => {
		seeded();
		fakeStoryBackend([story()]);
		vi.mocked(api.addScene).mockRejectedValueOnce(new ApiError('Disk full', 500, null));

		expect(await stories().addScenes(STORY_ID, [{ text: '', beat: '', shot: '', setting: '', mood: '' }, { text: '', beat: '', shot: '', setting: '', mood: '' }])).toEqual([]);
		expect(api.addScene).toHaveBeenCalledTimes(1);
		expect(notifications()).toEqual([{ intent: 'error', title: STORY_FAILURES.addScene, message: 'Disk full', action: null }]);
	});

	it('updateScenes saves several scenes in order and answers the story; null when one failed', async () => {
		seeded();
		fakeStoryBackend([story()]);

		const saved = await stories().updateScenes(STORY_ID, [
			{ sceneId: SCENE_IDS[0], patch: { beat: 'She arrives' } },
			{ sceneId: SCENE_IDS[2], patch: { mood: 'quiet', loras: [{ id: 'ink', weight: 0.5 }] } },
		]);

		expect(saved?.scenes.map((item) => [item.beat, item.mood, item.loras])).toEqual([
			['She arrives', '', []],
			['', '', []],
			['', 'quiet', [{ id: 'ink', weight: 0.5 }]],
		]);
		vi.mocked(api.updateScene).mockRejectedValueOnce(new ApiError('Nope', 422, null));
		expect(await stories().updateScenes(STORY_ID, [{ sceneId: SCENE_IDS[0], patch: { beat: 'x' } }])).toBeNull();
	});

	it('setSceneLora adds a LoRA at the default weight or changes its weight; removeSceneLora removes it', async () => {
		seeded();
		fakeStoryBackend([story()]);

		await stories().setSceneLora(STORY_ID, SCENE_IDS[0], 'ink');
		expect(tale().scenes[0].loras).toEqual([{ id: 'ink', weight: 1 }]);
		await stories().setSceneLora(STORY_ID, SCENE_IDS[0], 'ink', 0.35);
		expect(tale().scenes[0].loras).toEqual([{ id: 'ink', weight: 0.35 }]);
		vi.mocked(api.updateScene).mockClear();
		await stories().setSceneLora(STORY_ID, SCENE_IDS[0], 'ink', 0.35);
		expect(api.updateScene).not.toHaveBeenCalled();
		await stories().removeSceneLora(STORY_ID, SCENE_IDS[0], 'ink');
		expect(tale().scenes[0].loras).toEqual([]);
		expect(await stories().setSceneLora(STORY_ID, 'scn-999999999999', 'ink')).toBeNull();
	});

	it("previewScene builds the scene's request with the one builder, sending nothing", () => {
		seeded([story({ scenes: [scene({ extra_tags: ['storm'], loras: [{ id: 'gone', weight: 1 }], character_ids: [ALICE_ID, 'chr-999999999999'] })] })]);
		useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id });
		const generate = vi.spyOn(api, 'generate');

		const preview = stories().previewScene(STORY_ID, SCENE_IDS[0]);

		expect(preview?.built.request).toMatchObject({ story: { story_id: STORY_ID, scene_id: SCENE_IDS[0] }, character_id: ALICE_ID });
		expect(preview?.built.request.prompt).toContain('storm');
		expect(preview?.built.missingLoraIds).toEqual(['gone']);
		expect(preview?.missingCharacterIds).toEqual(['chr-999999999999']);
		expect(generate).not.toHaveBeenCalled();
		expect(stories().previewScene(STORY_ID, 'scn-999999999999')).toBeNull();
		useLibraryStore.setState({ selectedModelId: '' });
		expect(() => stories().previewScene(STORY_ID, SCENE_IDS[0])).toThrow('Select a model before generating.');
	});
});
