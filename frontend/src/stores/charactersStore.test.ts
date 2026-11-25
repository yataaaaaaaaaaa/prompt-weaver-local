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
	CHARACTERS_PANE_ID,
	selectActiveCharacter,
	selectIsCharacterBusy,
	selectThumbnailReferenceId,
	useCharacterFormErrors,
	useCharactersStore,
	useSortedCharacters,
} from './charactersStore';
import { useImageLibraryStore, type ImageLoraCollection } from './imageLibraryStore';
import { DESKTOP_DIALOGS_UNAVAILABLE, useLibraryStore } from './libraryStore';
import { useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { useWorkspaceStore } from './workspaceStore';

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

/** Replaces the workspace action the store calls (the workspace store tests own its effect). */
function mockRevealPane() {
	const revealPane = vi.fn();
	useWorkspaceStore.setState({ revealPane });
	return revealPane;
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
	it('startCreate opens an empty editor with a unique name and reveals the pane', () => {
		seedCharacters([character({ name: 'New character' })]);
		const revealPane = mockRevealPane();

		store().startCreate();

		expect(store().editor).toEqual({
			characterId: null,
			form: characterFormFromValues(emptyCharacterValues('New character 2')),
			pendingSources: [],
			saving: false,
			error: null,
		});
		expect(revealPane).toHaveBeenCalledWith(CHARACTERS_PANE_ID);
	});

	it('startCreateFromOutput prefills from the current output, its image pending as reference', () => {
		useOutputsStore.setState({ currentId: OUTPUT_ID, record: RECORD });
		const revealPane = mockRevealPane();

		store().startCreateFromOutput();

		expect(store().editor).toEqual({
			characterId: null,
			form: characterFormFromValues(characterValuesFromOutput(RECORD)),
			pendingSources: [{ kind: 'output', output_id: OUTPUT_ID }],
			saving: false,
			error: null,
		});
		expect(store().editor?.form).toMatchObject({ name: `Character from #${OUTPUT_ID}`, identityText: '1girl, silver hair', outfitText: 'school uniform', seedText: '2222' });
		expect(revealPane).toHaveBeenCalledWith(CHARACTERS_PANE_ID);
	});

	it('startCreateFromOutput warns when no output is shown', () => {
		const revealPane = mockRevealPane();

		store().startCreateFromOutput();

		expect(store().editor).toBeNull();
		expect(revealPane).not.toHaveBeenCalled();
		expect(notifications()).toEqual([
			{ intent: 'warning', title: null, message: 'There is no output to create a character from: generate or open an output first.' },
		]);
	});

	it('startEdit opens a saved character (unknown ids ignored)', () => {
		seedCharacters();
		const revealPane = mockRevealPane();

		store().startEdit('chr-000000000000');
		expect(store().editor).toBeNull();

		store().startEdit(ALICE_ID);
		expect(store().editor).toEqual({
			characterId: ALICE_ID,
			form: characterFormFromValues(characterValuesOf(ALICE)),
			pendingSources: [],
			saving: false,
			error: null,
		});
		expect(revealPane).toHaveBeenCalledTimes(1);
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
		const revealPane = mockRevealPane();

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
		expect(revealPane).toHaveBeenCalledWith(CHARACTERS_PANE_ID);
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
		mockRevealPane();

		await store().startCreateFromImage(KEY);

		expect(store().editor).not.toBeNull();
		expect(notifications()).toEqual([]);
	});

	it('is a no-op for an unknown image', async () => {
		const collectImageLoras = seedImage(async () => COLLECTION);
		const revealPane = mockRevealPane();

		await store().startCreateFromImage('civitai:unknown');

		expect(collectImageLoras).not.toHaveBeenCalled();
		expect(revealPane).not.toHaveBeenCalled();
		expect(store()).toMatchObject({ editor: null, preparingImageKey: null });
	});

	it('reports a failure of the LoRA collection', async () => {
		seedImage(async () => Promise.reject(new Error('resolution crashed')));
		mockRevealPane();

		await expect(store().startCreateFromImage(KEY)).resolves.toBeUndefined();

		expect(store()).toMatchObject({ editor: null, preparingImageKey: null });
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not create the character', message: 'resolution crashed' }]);
	});
});

describe('charactersStore editor edits', () => {
	function openEditor() {
		mockRevealPane();
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
		mockRevealPane();
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
		expect(store()).toMatchObject({ characters: [BOB, ALICE], editor: null });
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Alice was created.' }]);
	});

	it('updates a saved character in place', async () => {
		mockRevealPane();
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
		mockRevealPane();
		store().startCreate();
		store().updateForm({ name: '  ', seedLocked: true });
		const create = vi.spyOn(api, 'createCharacter');

		await expect(store().saveEditor()).resolves.toBe(false);

		expect(create).not.toHaveBeenCalled();
		expect(store().editor).toMatchObject({ saving: false, error: null });
	});

	it('keeps the editor open with the error on failure', async () => {
		mockRevealPane();
		store().startCreate();
		vi.spyOn(api, 'createCharacter').mockRejectedValue(new Error('Could not read the output image.'));

		await expect(store().saveEditor()).resolves.toBe(false);

		expect(store().editor).toMatchObject({ characterId: null, saving: false, error: 'Could not read the output image.' });
		expect(store().characters).toEqual([]);
		expect(notifications()).toEqual([]);
	});

	it('notifies a failure when the editor was closed meanwhile', async () => {
		mockRevealPane();
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
		mockRevealPane();
		seedCharacters([ALICE, BOB], ALICE_ID);
		store().startEdit(ALICE_ID);
		const remove = vi.spyOn(api, 'deleteCharacter').mockResolvedValue(undefined);

		await store().remove(ALICE_ID);

		expect(remove).toHaveBeenCalledWith(ALICE_ID);
		expect(store()).toMatchObject({ characters: [BOB], activeId: null, editor: null, busyIds: {} });
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Alice was deleted.' }]);
	});

	it('keeps another active character and editor', async () => {
		mockRevealPane();
		seedCharacters([ALICE, BOB], BOB_ID);
		store().startEdit(BOB_ID);
		vi.spyOn(api, 'deleteCharacter').mockResolvedValue(undefined);

		await store().remove(ALICE_ID);

		expect(store()).toMatchObject({ characters: [BOB], activeId: BOB_ID, editor: { characterId: BOB_ID } });
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
		mockRevealPane();
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
