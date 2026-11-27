import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { LORA_WEIGHT_DEFAULTS, REFERENCE_DEFAULTS } from '../api/defaults.gen';
import type { Character, CharacterCollection, GenerationSelection, LoRASpec, OutputRecord } from '../api/types';
import {
	characterFormFromValues,
	characterValuesFromForm,
	characterValuesFromOutput,
	characterValuesOf,
	emptyCharacterValues,
} from '../domain/characterDrafts';
import { imageKey } from '../domain/imageLibrary';
import { desktop } from '../services/desktop';
import { ALICE_ID, BOB, BOB_ID, character, characterCollection, characterImage, REFERENCE_IMAGE_ID } from '../test/characterData';
import { imageParams, remoteImage } from '../test/imageLibraryData';
import {
	selectActiveCharacter,
	selectIsCharacterBusy,
	selectSelectedCharacter,
	selectThumbnailReferenceId,
	useCharacterFormErrors,
	useCharactersStore,
	useGalleryCharacters,
	useSortedCharacters,
} from './charactersStore';
import { useImageLibraryStore, type ImageLoraCollection } from './imageLibraryStore';
import { DESKTOP_DIALOGS_UNAVAILABLE, useLibraryStore } from './libraryStore';
import { useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { useNavigationStore } from './navigationStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALICE = character();
const OUTPUT_ID = '0000000042';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

const store = () => useCharactersStore.getState();
const notifications = () => useNotificationsStore.getState().notifications.map(({ intent, title, message }) => ({ intent, title, message }));

/** The store holds these characters (loaded), `activeId` active. */
function seedCharacters(characters: Character[] = [ALICE, BOB], activeId: string | null = null): void {
	useCharactersStore.setState({ characters, activeId, loadStatus: 'ready' });
}

/** Replaces the navigation action the store calls (the navigation store tests own its effect). */
function mockShowSection() {
	const showSection = vi.fn();
	useNavigationStore.setState({ showSection });
	return showSection;
}

const selection = (category_name: string, prompt_text: string): GenerationSelection => ({
	category_name,
	prompt_text,
	locked: false,
	induced_lora_ids: [],
});

const RECORD = {
	output_id: OUTPUT_ID,
	seed: 1111,
	image_seed: 2222,
	active_loras: [{ id: 'alya', weight: 0.6 }],
	selections: [selection('Main', '1girl, silver hair'), selection('Character outfit', 'school uniform')],
	character: null,
	story: null,
} as unknown as OutputRecord;

const lora = (id: string): LoRASpec => ({ id, name: `${id}.safetensors`, path: `D:/loras/${id}.safetensors`, source: null });

// ---------------------------------------------------------------------------
// Loading and activation
// ---------------------------------------------------------------------------

describe('charactersStore.load', () => {
	it('reads the collection and the active character', async () => {
		const answer = deferred<CharacterCollection>();
		vi.spyOn(api, 'listCharacters').mockReturnValue(answer.promise);

		const loading = store().load();
		expect(store()).toMatchObject({ loadStatus: 'loading', loadError: null });
		answer.resolve(characterCollection([ALICE, BOB], BOB_ID));
		await loading;

		expect(store()).toMatchObject({ characters: [ALICE, BOB], activeId: BOB_ID, loadStatus: 'ready', loadError: null });
		expect(selectActiveCharacter(store())).toEqual(BOB);
	});

	it('keeps the failure in the store without notifying', async () => {
		vi.spyOn(api, 'listCharacters').mockRejectedValue(new Error('backend down'));

		await expect(store().load()).resolves.toBeUndefined();

		expect(store()).toMatchObject({ characters: [], loadStatus: 'failed', loadError: 'backend down' });
		expect(notifications()).toEqual([]);
	});

	it('ignores the answer of an older load', async () => {
		const first = deferred<CharacterCollection>();
		vi.spyOn(api, 'listCharacters').mockReturnValueOnce(first.promise).mockResolvedValueOnce(characterCollection([BOB]));

		const older = store().load();
		await store().load();
		first.resolve(characterCollection([ALICE, BOB], ALICE_ID));
		await older;

		expect(store()).toMatchObject({ characters: [BOB], activeId: null, loadStatus: 'ready' });
	});

	it('keeps the selected character when it is still there, else unselects it', async () => {
		useCharactersStore.setState({ selectedId: BOB_ID });
		vi.spyOn(api, 'listCharacters').mockResolvedValueOnce(characterCollection([ALICE, BOB])).mockResolvedValueOnce(characterCollection([ALICE]));

		await store().load();
		expect(store().selectedId).toBe(BOB_ID);
		await store().load();
		expect(store().selectedId).toBeNull();
	});
});

describe('charactersStore.toggleActive', () => {
	it('activates a character: busy meanwhile, then the answered collection and a notification', async () => {
		seedCharacters();
		const answer = deferred<CharacterCollection>();
		const setActive = vi.spyOn(api, 'setActiveCharacter').mockReturnValue(answer.promise);

		const toggling = store().toggleActive(ALICE_ID);
		expect(selectIsCharacterBusy(ALICE_ID)(store())).toBe(true);
		answer.resolve(characterCollection([ALICE, BOB], ALICE_ID));
		await toggling;

		expect(setActive).toHaveBeenCalledWith(ALICE_ID);
		expect(store()).toMatchObject({ activeId: ALICE_ID, busyIds: {} });
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Alice is active for generation.' }]);
		// Activated in Create (the section shown): nothing to go to.
		expect(useNotificationsStore.getState().notifications[0].action).toBeNull();
	});

	it('activated outside Create, the notification offers Go to Create', async () => {
		seedCharacters();
		useNavigationStore.setState({ section: 'characters' });
		vi.spyOn(api, 'setActiveCharacter').mockResolvedValue(characterCollection([ALICE, BOB], BOB_ID));

		await store().toggleActive(BOB_ID);

		const [notification] = useNotificationsStore.getState().notifications;
		expect(notification).toMatchObject({ intent: 'success', message: 'Bob is active for generation.', action: { label: 'Go to Create' } });
		useNotificationsStore.getState().runAction(notification.id);
		expect(useNavigationStore.getState().section).toBe('create');
	});

	it('deactivates the active character (the active one is busy meanwhile)', async () => {
		seedCharacters([ALICE, BOB], ALICE_ID);
		const answer = deferred<CharacterCollection>();
		const setActive = vi.spyOn(api, 'setActiveCharacter').mockReturnValue(answer.promise);

		const toggling = store().toggleActive(ALICE_ID);
		expect(store().busyIds).toEqual({ [ALICE_ID]: true });
		answer.resolve(characterCollection([ALICE, BOB], null));
		await toggling;

		expect(setActive).toHaveBeenCalledWith(null);
		expect(store()).toMatchObject({ activeId: null, busyIds: {} });
		expect(notifications()).toEqual([]);
	});

	it('switches to another character', async () => {
		seedCharacters([ALICE, BOB], BOB_ID);
		const setActive = vi.spyOn(api, 'setActiveCharacter').mockResolvedValue(characterCollection([ALICE, BOB], ALICE_ID));

		await store().toggleActive(ALICE_ID);

		expect(setActive).toHaveBeenCalledWith(ALICE_ID);
		expect(store().activeId).toBe(ALICE_ID);
	});

	it('reports a failure and leaves the state unchanged', async () => {
		seedCharacters([ALICE, BOB], BOB_ID);
		vi.spyOn(api, 'setActiveCharacter').mockRejectedValue(new Error('Unknown character'));

		await expect(store().toggleActive(ALICE_ID)).resolves.toBeUndefined();

		expect(store()).toMatchObject({ activeId: BOB_ID, characters: [ALICE, BOB], busyIds: {} });
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not activate the character', message: 'Unknown character' }]);
	});

	it('ignores a busy character, and setActive without a change', async () => {
		seedCharacters([ALICE, BOB], BOB_ID);
		useCharactersStore.setState({ busyIds: { [ALICE_ID]: true } });
		const setActive = vi.spyOn(api, 'setActiveCharacter');

		await store().toggleActive(ALICE_ID);
		await store().setActive(BOB_ID);
		useCharactersStore.setState({ activeId: null });
		await store().setActive(null);

		expect(setActive).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

describe('charactersStore editor entry points', () => {
	it('startCreate opens an empty editor with a unique name and shows the Characters section', () => {
		seedCharacters([character({ name: 'New character' })]);
		const showSection = mockShowSection();

		store().startCreate();

		expect(store().editor).toEqual({
			session: expect.any(Number),
			characterId: null,
			// Opened from Create (the section shown): Cancel goes back there.
			returnSection: 'create',
			form: characterFormFromValues(emptyCharacterValues('New character 2')),
			pendingSources: [],
			saving: false,
			error: null,
		});
		expect(showSection).toHaveBeenCalledWith('characters');
	});

	it('startCreateFromOutput prefills from the current output, its image pending as reference', () => {
		useOutputsStore.setState({ currentId: OUTPUT_ID, record: RECORD });
		const showSection = mockShowSection();

		store().startCreateFromOutput();

		expect(store().editor).toEqual({
			session: expect.any(Number),
			characterId: null,
			returnSection: 'create',
			form: characterFormFromValues(characterValuesFromOutput(RECORD)),
			pendingSources: [{ kind: 'output', output_id: OUTPUT_ID }],
			saving: false,
			error: null,
		});
		expect(store().editor?.form).toMatchObject({ name: `Character from #${OUTPUT_ID}`, identityText: '1girl, silver hair', outfitText: 'school uniform', seedText: '2222' });
		expect(showSection).toHaveBeenCalledWith('characters');
	});

	it('startCreateFromOutput warns when no output is shown', () => {
		const showSection = mockShowSection();

		store().startCreateFromOutput();

		expect(store().editor).toBeNull();
		expect(showSection).not.toHaveBeenCalled();
		expect(notifications()).toEqual([
			{ intent: 'warning', title: null, message: 'There is no output to create a character from: generate or open an output first.' },
		]);
	});

	it('startEdit opens a saved character (unknown ids ignored)', () => {
		seedCharacters();
		const showSection = mockShowSection();

		store().startEdit('chr-000000000000');
		expect(store().editor).toBeNull();

		store().startEdit(ALICE_ID);
		expect(store().editor).toEqual({
			session: expect.any(Number),
			characterId: ALICE_ID,
			returnSection: 'create',
			form: characterFormFromValues(characterValuesOf(ALICE)),
			pendingSources: [],
			saving: false,
			error: null,
		});
		expect(showSection).toHaveBeenCalledTimes(1);
		// The edited character is the selected one.
		expect(store().selectedId).toBe(ALICE_ID);
	});

	it('remembers the section it was opened from; inside Characters, a replaced editor passes its own on', () => {
		seedCharacters();
		useNavigationStore.setState({ section: 'images' });
		store().startCreate();
		const first = store().editor!;
		// The real navigation action: the Characters section is shown.
		expect(useNavigationStore.getState().section).toBe('characters');
		expect(first.returnSection).toBe('images');

		// Edit from the gallery (the Characters section is shown): the return section stays Images.
		store().startEdit(BOB_ID);
		expect(store().editor).toMatchObject({ characterId: BOB_ID, returnSection: 'images' });
		expect(store().editor!.session).toBeGreaterThan(first.session);

		// Closed, then opened from the Characters section: nowhere to go back to.
		store().cancelEdit();
		useNavigationStore.setState({ section: 'characters' });
		store().startCreate();
		expect(store().editor?.returnSection).toBeNull();
	});

	it('opening a new character keeps the selection; each opening is a new session', () => {
		seedCharacters();
		mockShowSection();
		useCharactersStore.setState({ selectedId: BOB_ID });

		store().startCreate();
		const session = store().editor!.session;
		store().startCreate();

		expect(store().selectedId).toBe(BOB_ID);
		expect(store().editor!.session).toBe(session + 1);
	});
});

describe('charactersStore.cancelEdit', () => {
	it('closes the editor and shows the section it was opened from again', () => {
		seedCharacters();
		useNavigationStore.setState({ section: 'create' });
		store().startEdit(ALICE_ID);
		expect(useNavigationStore.getState().section).toBe('characters');

		store().cancelEdit();

		expect(store().editor).toBeNull();
		expect(useNavigationStore.getState().section).toBe('create');
		// The selection stays.
		expect(store().selectedId).toBe(ALICE_ID);
	});

	it('stays in the Characters section when it was opened there; no-op when closed', () => {
		seedCharacters();
		useNavigationStore.setState({ section: 'characters' });
		store().startCreate();

		store().cancelEdit();
		store().cancelEdit();

		expect(store().editor).toBeNull();
		expect(useNavigationStore.getState().section).toBe('characters');
	});
});

describe('charactersStore gallery', () => {
	it('select selects a known character or none; unknown ids and repeats are ignored', () => {
		seedCharacters();

		store().select(BOB_ID);
		expect(store().selectedId).toBe(BOB_ID);
		expect(selectSelectedCharacter(store())).toEqual(BOB);

		store().select('chr-000000000404');
		expect(store().selectedId).toBe(BOB_ID);

		const before = store();
		store().select(BOB_ID);
		expect(store()).toBe(before);

		store().select(null);
		expect(store().selectedId).toBeNull();
		expect(selectSelectedCharacter(store())).toBeNull();
	});

	it('select keeps an open editor', () => {
		seedCharacters();
		mockShowSection();
		store().startEdit(ALICE_ID);

		store().select(BOB_ID);

		expect(store()).toMatchObject({ selectedId: BOB_ID, editor: { characterId: ALICE_ID } });
	});

	it('setQuery sets the search text (unchanged text: no update)', () => {
		store().setQuery('red hair');
		expect(store().query).toBe('red hair');

		const before = store();
		store().setQuery('red hair');
		expect(store()).toBe(before);
	});

	it('useGalleryCharacters filters by the query and sorts by name, memoized on the list and the query', () => {
		const zoe = character({ id: 'chr-000000000003', name: 'zoe', identity_tags: ['1girl', 'red hair'], outfit_tags: [] });
		seedCharacters([zoe, BOB, ALICE]);

		const { result, rerender } = renderHook(() => useGalleryCharacters());
		const all = result.current;
		rerender();
		expect(result.current).toBe(all);
		expect(all.map((item) => item.name)).toEqual(['Alice', 'Bob', 'zoe']);

		act(() => store().setQuery('1girl'));
		expect(result.current.map((item) => item.name)).toEqual(['Alice', 'zoe']);
		act(() => store().setQuery('1girl, school uniform'));
		expect(result.current.map((item) => item.name)).toEqual(['Alice']);
		act(() => store().setQuery('nobody'));
		expect(result.current).toEqual([]);
		// The full list is unaffected by the search.
		expect(renderHook(() => useSortedCharacters()).result.current).toHaveLength(3);
	});
});

describe('charactersStore.startCreateFromImage', () => {
	const IMAGE = remoteImage({ params: imageParams({ clean_prompt: '1girl, red hair', seed: 777 }) });
	const KEY = imageKey(IMAGE);
	const COLLECTION: ImageLoraCollection = {
		rowCount: 3,
		items: [{ id: 'detail', weight: 0.6 }],
		applied: [{ name: 'add_detail', weight: 0.6 }],
		skipped: [
			{ name: 'kim_v_1', problem: 'Its model could not be identified.' },
			{ name: 'realistic filter', problem: 'Not published.' },
		],
	};

	function seedImage(collect: (key: string) => Promise<ImageLoraCollection | null>) {
		const collectImageLoras = vi.fn(collect);
		useImageLibraryStore.setState({ results: [IMAGE], collectImageLoras });
		return collectImageLoras;
	}

	it("prefills from the image and its LoRAs, the image pending as reference; skipped LoRAs in one warning", async () => {
		const answer = deferred<ImageLoraCollection | null>();
		const collectImageLoras = seedImage(() => answer.promise);
		const showSection = mockShowSection();

		const starting = store().startCreateFromImage(KEY);
		expect(store().preparingImageKey).toBe(KEY);
		await store().startCreateFromImage(KEY);
		answer.resolve(COLLECTION);
		await starting;

		expect(collectImageLoras).toHaveBeenCalledTimes(1);
		expect(collectImageLoras).toHaveBeenCalledWith(KEY);
		expect(store().preparingImageKey).toBeNull();
		expect(store().editor).toMatchObject({
			characterId: null,
			form: { name: 'Character from alice', identityText: '1girl, red hair', loras: [{ id: 'detail', weight: 0.6 }], seedText: '777', seedLocked: false },
			pendingSources: [{ kind: 'url', url: IMAGE.url }],
		});
		expect(showSection).toHaveBeenCalledWith('characters');
		expect(notifications()).toEqual([
			{
				intent: 'warning',
				title: 'Some LoRAs of this image are not in the character',
				message: 'kim_v_1: Its model could not be identified; realistic filter: Not published.',
			},
		]);
	});

	it('does not warn when every LoRA is usable', async () => {
		seedImage(async () => ({ ...COLLECTION, skipped: [] }));
		mockShowSection();

		await store().startCreateFromImage(KEY);

		expect(store().editor).not.toBeNull();
		expect(notifications()).toEqual([]);
	});

	it('is a no-op for an unknown image', async () => {
		const collectImageLoras = seedImage(async () => COLLECTION);
		const showSection = mockShowSection();

		await store().startCreateFromImage('civitai:unknown');

		expect(collectImageLoras).not.toHaveBeenCalled();
		expect(showSection).not.toHaveBeenCalled();
		expect(store()).toMatchObject({ editor: null, preparingImageKey: null });
	});

	it('reports a failure of the LoRA collection', async () => {
		seedImage(async () => Promise.reject(new Error('resolution crashed')));
		mockShowSection();

		await expect(store().startCreateFromImage(KEY)).resolves.toBeUndefined();

		expect(store()).toMatchObject({ editor: null, preparingImageKey: null });
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not create the character', message: 'resolution crashed' }]);
	});
});

describe('charactersStore editor edits', () => {
	function openEditor() {
		mockShowSection();
		useOutputsStore.setState({ currentId: OUTPUT_ID, record: RECORD });
		store().startCreateFromOutput();
	}

	it('updateForm merges a patch, and is a no-op when the editor is closed', () => {
		store().updateForm({ name: 'Ignored' });
		expect(store().editor).toBeNull();

		openEditor();
		store().updateForm({ name: 'Alice', seedLocked: true });

		expect(store().editor?.form).toMatchObject({ name: 'Alice', seedLocked: true, identityText: '1girl, silver hair' });
	});

	it('edits the LoRAs with the library (default weight, clamped weights, unknown ids ignored)', () => {
		useLibraryStore.setState({ loras: [lora('alya'), lora('detail')] });
		openEditor();

		store().addFormLora('detail');
		expect(store().editor?.form.loras).toEqual([
			{ id: 'alya', weight: 0.6 },
			{ id: 'detail', weight: LORA_WEIGHT_DEFAULTS.weight },
		]);

		const editor = store().editor;
		store().addFormLora('detail');
		store().addFormLora('unknown');
		store().setFormLoraWeight('unknown', 0.5);
		store().removeFormLora('unknown');
		expect(store().editor).toBe(editor);

		store().setFormLoraWeight('alya', 99);
		expect(store().editor?.form.loras[0]).toEqual({ id: 'alya', weight: LORA_WEIGHT_DEFAULTS.max });

		store().removeFormLora('alya');
		expect(store().editor?.form.loras).toEqual([{ id: 'detail', weight: LORA_WEIGHT_DEFAULTS.weight }]);
	});

	it('drops a pending reference image (out-of-range indexes ignored) and cancels', () => {
		openEditor();

		store().removePendingSource(3);
		expect(store().editor?.pendingSources).toHaveLength(1);
		store().removePendingSource(0);
		expect(store().editor?.pendingSources).toEqual([]);

		store().cancelEdit();
		expect(store().editor).toBeNull();
	});
});

describe('charactersStore.saveEditor', () => {
	it('creates a character with the pending reference images, closes the editor and notifies', async () => {
		mockShowSection();
		useOutputsStore.setState({ currentId: OUTPUT_ID, record: RECORD });
		seedCharacters([BOB]);
		store().startCreateFromOutput();
		store().updateForm({ name: ' Alice ' });
		const form = store().editor!.form;
		const answer = deferred<Character>();
		const create = vi.spyOn(api, 'createCharacter').mockReturnValue(answer.promise);

		const saving = store().saveEditor();
		expect(store().editor).toMatchObject({ saving: true, error: null });
		answer.resolve(ALICE);

		await expect(saving).resolves.toBe(true);
		expect(create).toHaveBeenCalledWith({ ...characterValuesFromForm(form), name: 'Alice', reference_sources: [{ kind: 'output', output_id: OUTPUT_ID }] });
		// The new character is selected: the detail panel shows it.
		expect(store()).toMatchObject({ characters: [BOB, ALICE], editor: null, selectedId: ALICE_ID });
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Alice was created.' }]);
	});

	it('opened from another section: stays in Characters, and the notification offers to go back', async () => {
		useNavigationStore.setState({ section: 'create' });
		useOutputsStore.setState({ currentId: OUTPUT_ID, record: RECORD });
		store().startCreateFromOutput();
		vi.spyOn(api, 'createCharacter').mockResolvedValue(ALICE);

		await store().saveEditor();

		expect(useNavigationStore.getState().section).toBe('characters');
		const [notification] = useNotificationsStore.getState().notifications;
		expect(notification).toMatchObject({ message: 'Alice was created.', action: { label: 'Go to Create' } });
		useNotificationsStore.getState().runAction(notification.id);
		expect(useNavigationStore.getState().section).toBe('create');
	});

	it('an update made from another section is notified with the way back; one made in Characters is not', async () => {
		seedCharacters([ALICE, BOB]);
		vi.spyOn(api, 'updateCharacter').mockResolvedValue(ALICE);
		useNavigationStore.setState({ section: 'create' });
		store().startEdit(ALICE_ID);
		await store().saveEditor();
		expect(useNotificationsStore.getState().notifications).toMatchObject([{ message: 'Alice was saved.', action: { label: 'Go to Create' } }]);

		useNotificationsStore.getState().clear();
		store().startEdit(ALICE_ID);
		await store().saveEditor();
		expect(notifications()).toEqual([]);
	});

	it('clears a gallery search that would hide the saved character, keeps one that shows it', async () => {
		mockShowSection();
		seedCharacters([BOB]);
		vi.spyOn(api, 'createCharacter').mockResolvedValue(ALICE);
		useCharactersStore.setState({ query: '1boy' });
		store().startCreate();
		await store().saveEditor();
		expect(store()).toMatchObject({ selectedId: ALICE_ID, query: '' });

		useCharactersStore.setState({ query: 'silver' });
		store().startCreate();
		await store().saveEditor();
		expect(store().query).toBe('silver');
	});

	it('a save that ends after the editor was replaced selects nothing', async () => {
		mockShowSection();
		seedCharacters([BOB]);
		store().startCreate();
		const answer = deferred<Character>();
		vi.spyOn(api, 'createCharacter').mockReturnValue(answer.promise);

		const saving = store().saveEditor();
		store().startEdit(BOB_ID);
		answer.resolve(ALICE);
		await saving;

		expect(store()).toMatchObject({ characters: [BOB, ALICE], selectedId: BOB_ID, editor: { characterId: BOB_ID } });
	});

	it('updates a saved character in place', async () => {
		// Edited from the gallery: no notification (the details show the change).
		useNavigationStore.setState({ section: 'characters' });
		seedCharacters([ALICE, BOB]);
		store().startEdit(ALICE_ID);
		store().updateForm({ name: 'Alicia', negativeText: '' });
		const renamed = character({ name: 'Alicia', negative_tags: [] });
		const update = vi.spyOn(api, 'updateCharacter').mockResolvedValue(renamed);

		await expect(store().saveEditor()).resolves.toBe(true);

		expect(update).toHaveBeenCalledWith(ALICE_ID, { ...characterValuesOf(ALICE), name: 'Alicia', negative_tags: [] });
		expect(store()).toMatchObject({ characters: [renamed, BOB], editor: null });
		expect(notifications()).toEqual([]);
	});

	it('sends nothing while the form has errors', async () => {
		mockShowSection();
		store().startCreate();
		store().updateForm({ name: '  ', seedLocked: true });
		const create = vi.spyOn(api, 'createCharacter');

		await expect(store().saveEditor()).resolves.toBe(false);

		expect(create).not.toHaveBeenCalled();
		expect(store().editor).toMatchObject({ saving: false, error: null });
	});

	it('keeps the editor open with the error on failure', async () => {
		mockShowSection();
		store().startCreate();
		vi.spyOn(api, 'createCharacter').mockRejectedValue(new Error('Could not read the output image.'));

		await expect(store().saveEditor()).resolves.toBe(false);

		expect(store().editor).toMatchObject({ characterId: null, saving: false, error: 'Could not read the output image.' });
		expect(store().characters).toEqual([]);
		expect(notifications()).toEqual([]);
	});

	it('notifies a failure when the editor was closed meanwhile', async () => {
		mockShowSection();
		store().startCreate();
		const answer = deferred<Character>();
		vi.spyOn(api, 'createCharacter').mockReturnValue(answer.promise);

		const saving = store().saveEditor();
		store().cancelEdit();
		answer.reject(new Error('disk full'));

		await expect(saving).resolves.toBe(false);
		expect(store().editor).toBeNull();
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not save the character', message: 'disk full' }]);
	});

	it('is a no-op when the editor is closed', async () => {
		await expect(store().saveEditor()).resolves.toBe(false);
	});
});

describe('charactersStore.remove', () => {
	it('drops the character, resets the active one and closes its editor', async () => {
		mockShowSection();
		seedCharacters([ALICE, BOB], ALICE_ID);
		store().startEdit(ALICE_ID);
		const remove = vi.spyOn(api, 'deleteCharacter').mockResolvedValue(undefined);

		await store().remove(ALICE_ID);

		expect(remove).toHaveBeenCalledWith(ALICE_ID);
		expect(store()).toMatchObject({ characters: [BOB], activeId: null, editor: null, busyIds: {}, selectedId: null });
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Alice was deleted.' }]);
	});

	it('keeps another active character and editor', async () => {
		mockShowSection();
		seedCharacters([ALICE, BOB], BOB_ID);
		store().startEdit(BOB_ID);
		vi.spyOn(api, 'deleteCharacter').mockResolvedValue(undefined);

		await store().remove(ALICE_ID);

		expect(store()).toMatchObject({ characters: [BOB], activeId: BOB_ID, editor: { characterId: BOB_ID }, selectedId: BOB_ID });
	});

	it('reports a failure', async () => {
		seedCharacters();
		vi.spyOn(api, 'deleteCharacter').mockRejectedValue(new Error('locked file'));

		await store().remove(ALICE_ID);

		expect(store().characters).toEqual([ALICE, BOB]);
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not delete the character', message: 'locked file' }]);
	});
});

// ---------------------------------------------------------------------------
// Reference images and strength
// ---------------------------------------------------------------------------

describe('charactersStore reference images', () => {
	const WITH_TWO_IMAGES = character({ reference_images: [characterImage(), characterImage({ id: 'img-0000000000a2' })] });

	it('imports the current output (busy meanwhile) and replaces the character', async () => {
		seedCharacters();
		useOutputsStore.setState({ currentId: OUTPUT_ID });
		const answer = deferred<Character>();
		const add = vi.spyOn(api, 'addCharacterReferenceImage').mockReturnValue(answer.promise);

		const adding = store().addReferenceFromCurrentOutput(ALICE_ID);
		expect(store().busyIds).toEqual({ [ALICE_ID]: true });
		answer.resolve(WITH_TWO_IMAGES);
		await adding;

		expect(add).toHaveBeenCalledWith(ALICE_ID, { kind: 'output', output_id: OUTPUT_ID });
		expect(store()).toMatchObject({ characters: [WITH_TWO_IMAGES, BOB], busyIds: {} });
	});

	it('warns without a current output', async () => {
		seedCharacters();
		const add = vi.spyOn(api, 'addCharacterReferenceImage');

		await store().addReferenceFromCurrentOutput(ALICE_ID);

		expect(add).not.toHaveBeenCalled();
		expect(notifications()).toEqual([
			{ intent: 'warning', title: null, message: 'There is no output to use as a reference image: generate or open an output first.' },
		]);
	});

	it('imports a file picked with the desktop dialog (image filters); a cancelled dialog imports nothing', async () => {
		seedCharacters();
		vi.spyOn(desktop, 'isAvailable').mockReturnValue(true);
		const pickFile = vi.spyOn(desktop, 'pickFile').mockResolvedValueOnce('D:/pictures/alice.webp').mockResolvedValueOnce(null);
		const add = vi.spyOn(api, 'addCharacterReferenceImage').mockResolvedValue(WITH_TWO_IMAGES);

		await store().addReferenceFromFile(ALICE_ID);
		await store().addReferenceFromFile(ALICE_ID);

		expect(pickFile).toHaveBeenCalledWith({
			title: 'Add reference image',
			filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
		});
		expect(add).toHaveBeenCalledTimes(1);
		expect(add).toHaveBeenCalledWith(ALICE_ID, { kind: 'file', path: 'D:/pictures/alice.webp' });
		expect(store()).toMatchObject({ characters: [WITH_TWO_IMAGES, BOB], busyIds: {} });
	});

	it('warns when file dialogs are unavailable (browser)', async () => {
		seedCharacters();
		vi.spyOn(desktop, 'isAvailable').mockReturnValue(false);
		const pickFile = vi.spyOn(desktop, 'pickFile');

		await store().addReferenceFromFile(ALICE_ID);

		expect(pickFile).not.toHaveBeenCalled();
		expect(notifications()).toEqual([{ intent: 'warning', title: null, message: DESKTOP_DIALOGS_UNAVAILABLE }]);
	});

	it('reports an import failure', async () => {
		seedCharacters();
		useOutputsStore.setState({ currentId: OUTPUT_ID });
		vi.spyOn(api, 'addCharacterReferenceImage').mockRejectedValue(new Error('Alice already has 4 reference images.'));

		await store().addReferenceFromCurrentOutput(ALICE_ID);

		expect(store()).toMatchObject({ characters: [ALICE, BOB], busyIds: {} });
		expect(notifications()).toEqual([
			{ intent: 'error', title: 'Could not add the reference image', message: 'Alice already has 4 reference images.' },
		]);
	});

	it('removes a reference image and sets the thumbnail from one', async () => {
		seedCharacters();
		const withoutImages = character({ reference_images: [] });
		const remove = vi.spyOn(api, 'removeCharacterReferenceImage').mockResolvedValue(withoutImages);
		const thumbnail = vi.spyOn(api, 'setCharacterThumbnail').mockResolvedValue(WITH_TWO_IMAGES);

		await store().removeReference(ALICE_ID, REFERENCE_IMAGE_ID);
		expect(remove).toHaveBeenCalledWith(ALICE_ID, REFERENCE_IMAGE_ID);
		expect(store().characters).toEqual([withoutImages, BOB]);

		await store().setThumbnailFromReference(ALICE_ID, REFERENCE_IMAGE_ID);
		expect(thumbnail).toHaveBeenCalledWith(ALICE_ID, { kind: 'character_image', image_id: REFERENCE_IMAGE_ID });
		expect(store().characters).toEqual([WITH_TWO_IMAGES, BOB]);
	});

	it('reports a removal failure', async () => {
		seedCharacters();
		vi.spyOn(api, 'removeCharacterReferenceImage').mockRejectedValue(new Error('Unknown image'));

		await store().removeReference(ALICE_ID, REFERENCE_IMAGE_ID);

		expect(store().characters).toEqual([ALICE, BOB]);
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not remove the reference image', message: 'Unknown image' }]);
	});
});

describe('charactersStore.setReferenceStrength', () => {
	it('saves the clamped strength with the other values unchanged', async () => {
		seedCharacters();
		const saved = character({ reference_strength: REFERENCE_DEFAULTS.max });
		const update = vi.spyOn(api, 'updateCharacter').mockResolvedValue(saved);

		await store().setReferenceStrength(ALICE_ID, 1.5);

		expect(update).toHaveBeenCalledWith(ALICE_ID, { ...characterValuesOf(ALICE), reference_strength: REFERENCE_DEFAULTS.max });
		expect(store()).toMatchObject({ characters: [saved, BOB], busyIds: {} });
	});

	it('is a no-op when unchanged (after clamping) or for an unknown character', async () => {
		seedCharacters([character({ reference_strength: REFERENCE_DEFAULTS.min }), BOB]);
		const update = vi.spyOn(api, 'updateCharacter');

		await store().setReferenceStrength(ALICE_ID, -3);
		await store().setReferenceStrength('chr-000000000000', 0.3);

		expect(update).not.toHaveBeenCalled();
	});

	it('reports a failure', async () => {
		seedCharacters();
		vi.spyOn(api, 'updateCharacter').mockRejectedValue(new Error('backend down'));

		await store().setReferenceStrength(ALICE_ID, 0.2);

		expect(store().characters).toEqual([ALICE, BOB]);
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not change the reference strength', message: 'backend down' }]);
	});
});

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

describe('charactersStore selectors', () => {
	it('selectThumbnailReferenceId reads the reference image the thumbnail was made from', () => {
		const second = characterImage({ id: 'img-0000000000a2' });
		const fromSecond = characterImage({ id: 'img-0000000000f2', source: { kind: 'character_image', image_id: second.id } });
		seedCharacters([
			character({ reference_images: [characterImage(), second], thumbnail: fromSecond }),
			// Its thumbnail came from an output, not from a reference image.
			character({ id: 'chr-000000000005', name: 'Carl', thumbnail: characterImage({ id: 'img-0000000000f3' }) }),
			// Its thumbnail's reference image was removed since.
			character({ id: 'chr-000000000006', name: 'Dana', reference_images: [second] }),
			BOB,
		]);

		expect(selectThumbnailReferenceId(ALICE_ID)(store())).toBe(second.id);
		expect(selectThumbnailReferenceId('chr-000000000005')(store())).toBeNull();
		expect(selectThumbnailReferenceId('chr-000000000006')(store())).toBeNull();
		expect(selectThumbnailReferenceId(BOB_ID)(store())).toBeNull();
		expect(selectThumbnailReferenceId('chr-000000000404')(store())).toBeNull();
		expect(selectThumbnailReferenceId(null)(store())).toBeNull();
	});

	it('selectIsCharacterBusy and selectActiveCharacter read the flags and the active id', () => {
		seedCharacters();
		expect(selectActiveCharacter(store())).toBeNull();
		useCharactersStore.setState({ activeId: BOB_ID, busyIds: { [ALICE_ID]: true } });

		expect(selectActiveCharacter(store())).toEqual(BOB);
		expect(selectIsCharacterBusy(ALICE_ID)(store())).toBe(true);
		expect(selectIsCharacterBusy(BOB_ID)(store())).toBe(false);
		// An active id the list does not hold (not loaded yet): none.
		useCharactersStore.setState({ activeId: 'chr-000000000404' });
		expect(selectActiveCharacter(store())).toBeNull();
	});
});

describe('charactersStore hooks', () => {
	it('useSortedCharacters sorts by name (case-insensitive), memoized on the list', () => {
		const zoe = character({ id: 'chr-000000000003', name: 'zoe' });
		const anna = character({ id: 'chr-000000000004', name: 'Anna' });
		seedCharacters([zoe, BOB, anna]);

		const { result, rerender } = renderHook(() => useSortedCharacters());
		const first = result.current;
		rerender();

		expect(first.map((item) => item.name)).toEqual(['Anna', 'Bob', 'zoe']);
		expect(result.current).toBe(first);
		expect(store().characters.map((item) => item.name)).toEqual(['zoe', 'Bob', 'Anna']);
	});

	it('useCharacterFormErrors follows the editor form', () => {
		mockShowSection();
		const { result } = renderHook(() => useCharacterFormErrors());
		expect(result.current).toEqual({});

		act(() => store().startCreate());
		expect(result.current).toEqual({});

		act(() => store().updateForm({ name: '', seedText: '-4' }));
		expect(result.current).toEqual({ name: 'Give the character a name.', seed: 'The seed must be a whole number of 0 or more.' });

		act(() => store().cancelEdit());
		expect(result.current).toEqual({});
	});
});

describe('charactersStore values API (the co-writer)', () => {
	it('createCharacter creates a character with its reference images and selects it (the caller reports it)', async () => {
		seedCharacters();
		const created = character({ id: 'chr-00000000000c', name: 'Mira' });
		const create = vi.spyOn(api, 'createCharacter').mockResolvedValue(created);

		const saved = await store().createCharacter({ ...emptyCharacterValues('Mira'), seed: 5 }, [{ kind: 'output', output_id: OUTPUT_ID }]);

		expect(saved).toEqual(created);
		expect(create).toHaveBeenCalledWith({ ...emptyCharacterValues('Mira'), seed: 5, reference_sources: [{ kind: 'output', output_id: OUTPUT_ID }] });
		expect(store().characters.map((item) => item.name)).toEqual(['Alice', 'Bob', 'Mira']);
		expect(store().selectedId).toBe(created.id);
		expect(notifications()).toEqual([]);
	});

	it('createCharacter reports a failure and answers null', async () => {
		seedCharacters();
		vi.spyOn(api, 'createCharacter').mockRejectedValue(new Error('Bad image'));

		expect(await store().createCharacter(emptyCharacterValues('Mira'))).toBeNull();
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not create the character', message: 'Bad image' }]);
	});

	it('updateCharacter changes fields and keeps the others; addReferenceImage imports one more image', async () => {
		seedCharacters();
		const update = vi.spyOn(api, 'updateCharacter').mockImplementation(async (_id, draft) => character({ ...draft }));
		const add = vi.spyOn(api, 'addCharacterReferenceImage').mockResolvedValue(character({ reference_images: [characterImage(), characterImage({ id: 'img-0000000000b2' })] }));

		const saved = await store().updateCharacter(ALICE_ID, { outfit_tags: ['raincoat'], seed_locked: true });
		expect(update).toHaveBeenCalledWith(ALICE_ID, { ...characterValuesOf(ALICE), outfit_tags: ['raincoat'], seed_locked: true });
		expect(saved?.outfit_tags).toEqual(['raincoat']);
		expect(store().characters[0].outfit_tags).toEqual(['raincoat']);

		const withImage = await store().addReferenceImage(ALICE_ID, { kind: 'output', output_id: OUTPUT_ID });
		expect(add).toHaveBeenCalledWith(ALICE_ID, { kind: 'output', output_id: OUTPUT_ID });
		expect(withImage?.reference_images).toHaveLength(2);
		expect(await store().updateCharacter('chr-999999999999', { name: 'x' })).toBeNull();
	});

	it('a busy character answers null', async () => {
		seedCharacters();
		useCharactersStore.setState({ busyIds: { [ALICE_ID]: true } });
		const update = vi.spyOn(api, 'updateCharacter');

		expect(await store().updateCharacter(ALICE_ID, { name: 'x' })).toBeNull();
		expect(update).not.toHaveBeenCalled();
	});
});
