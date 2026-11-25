import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { characterImageUrl, outputImageUrl } from '../../api/config';
import { REFERENCE_DEFAULTS } from '../../api/defaults.gen';
import type { LoRASpec } from '../../api/types';
import { REFERENCE_FOCUS_LABELS } from '../../domain/characterDrafts';
import { useCharactersStore } from '../../stores/charactersStore';
import { useIpAdapterStore } from '../../stores/ipAdapterStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { ALICE_ID, character, characterImage, ipAdapterStatus, READY_SDXL_FACE, REFERENCE_IMAGE_ID, referenceSupport } from '../../test/characterData';
import { renderWithProviders } from '../../test/render';
import { CharacterEditor } from './CharacterEditor';
import { characterForm, editorState, seedCharacterActions, seedIpAdapterActions } from '../../test/characterStores';
import { hasActionIntent } from '../../test/stateClasses';

const LORA_A: LoRASpec = { id: 'a', name: 'Lora A', path: 'C:/loras/a.safetensors', source: null };
const LORA_B: LoRASpec = { id: 'b', name: 'Lora B', path: 'C:/loras/b.safetensors', source: null };

let actions: ReturnType<typeof seedCharacterActions>;

beforeEach(() => {
	actions = seedCharacterActions();
	seedIpAdapterActions();
});

function renderEditor(editor = editorState()) {
	useCharactersStore.setState({ editor });
	return renderWithProviders(<CharacterEditor />);
}

const saveButton = () => screen.getByRole('button', { name: 'Save' });

describe('CharacterEditor fields', () => {
	it('shows the form values and focuses the name', () => {
		renderEditor();

		expect(screen.getByRole('heading', { name: 'New character' })).toBeInTheDocument();
		const name = screen.getByRole('textbox', { name: /^Name/ });
		expect(name).toHaveValue('Alice');
		expect(name).toHaveFocus();
		expect(screen.getByRole('textbox', { name: 'Identity tags' })).toHaveValue('1girl, silver hair, blue eyes');
		expect(screen.getByRole('textbox', { name: 'Outfit tags' })).toHaveValue('school uniform');
		expect(screen.getByRole('textbox', { name: 'Negative tags' })).toHaveValue('short hair');
		expect(screen.getByRole('textbox', { name: 'Seed' })).toHaveValue('1234');
		expect(screen.getByRole('switch', { name: 'Lock seed' })).not.toBeChecked();
		expect(saveButton()).toBeEnabled();
	});

	it('explains how tags are written and used', () => {
		renderEditor();

		expect(screen.getByRole('textbox', { name: 'Identity tags' })).toHaveAccessibleDescription(/^Comma-separated appearance tags/);
		expect(screen.getByRole('textbox', { name: 'Outfit tags' })).toHaveAccessibleDescription(/kept separate from the identity/);
		expect(screen.getByRole('textbox', { name: 'Negative tags' })).toHaveAccessibleDescription(/appended to the negative prompt/);
	});

	it('binds every text field to updateForm', async () => {
		const { user } = renderEditor();

		await user.type(screen.getByRole('textbox', { name: /^Name/ }), ' B');
		expect(actions.updateForm).toHaveBeenLastCalledWith({ name: 'Alice B' });
		await user.type(screen.getByRole('textbox', { name: 'Identity tags' }), ', ribbon');
		expect(actions.updateForm).toHaveBeenLastCalledWith({ identityText: '1girl, silver hair, blue eyes, ribbon' });
		await user.clear(screen.getByRole('textbox', { name: 'Outfit tags' }));
		await user.type(screen.getByRole('textbox', { name: 'Outfit tags' }), 'maid');
		expect(actions.updateForm).toHaveBeenLastCalledWith({ outfitText: 'maid' });
		await user.type(screen.getByRole('textbox', { name: 'Negative tags' }), ', hat');
		expect(actions.updateForm).toHaveBeenLastCalledWith({ negativeText: 'short hair, hat' });
		await user.type(screen.getByRole('textbox', { name: 'Seed' }), '5');
		expect(actions.updateForm).toHaveBeenLastCalledWith({ seedText: '12345' });
		await user.click(screen.getByRole('switch', { name: 'Lock seed' }));
		expect(actions.updateForm).toHaveBeenLastCalledWith({ seedLocked: true });
		expect(useCharactersStore.getState().editor?.form).toMatchObject({ name: 'Alice B', seedText: '12345', seedLocked: true });
	});

	it('shows the name error and disables Save', () => {
		renderEditor(editorState({ form: characterForm({ name: '  ' }) }));

		expect(screen.getByText('Give the character a name.')).toBeInTheDocument();
		expect(saveButton()).toBeDisabled();
	});

	it('shows the seed errors and disables Save', async () => {
		const { user } = renderEditor(editorState({ form: characterForm({ seedText: 'abc' }) }));

		expect(screen.getByText('The seed must be a whole number of 0 or more.')).toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: 'Seed' })).toHaveAttribute('aria-invalid', 'true');
		expect(saveButton()).toBeDisabled();

		await user.clear(screen.getByRole('textbox', { name: 'Seed' }));
		expect(saveButton()).toBeEnabled();
		await user.click(screen.getByRole('switch', { name: 'Lock seed' }));
		expect(screen.getByText('Enter the seed to lock.')).toBeInTheDocument();
		expect(saveButton()).toBeDisabled();
	});

	it('picks the reference focus', async () => {
		const { user } = renderEditor();

		const group = screen.getByRole('radiogroup', { name: 'Reference focus' });
		expect(within(group).getByRole('radio', { name: REFERENCE_FOCUS_LABELS.face.label })).toBeChecked();
		expect(group).toHaveAccessibleDescription(REFERENCE_FOCUS_LABELS.face.description);

		await user.click(within(group).getByRole('radio', { name: REFERENCE_FOCUS_LABELS.general.label }));

		expect(actions.updateForm).toHaveBeenLastCalledWith({ referenceFocus: 'general' });
		expect(within(group).getByRole('radio', { name: REFERENCE_FOCUS_LABELS.general.label })).toBeChecked();
		expect(group).toHaveAccessibleDescription(REFERENCE_FOCUS_LABELS.general.description);
	});

	it('shows the reference support of the chosen focus', () => {
		useIpAdapterStore.setState({
			status: ipAdapterStatus({ variants: [READY_SDXL_FACE], support: [referenceSupport({ ready: true, reason: null })] }),
			loadStatus: 'ready',
		});
		renderEditor();

		expect(screen.getByText(`Reference images apply with ${READY_SDXL_FACE.label}.`)).toBeInTheDocument();
		expect(useIpAdapterStore.getState().refresh).toHaveBeenCalled();
	});

	it('sets the strength with the slider, committed when released', async () => {
		renderEditor();

		const slider = screen.getByRole('slider', { name: 'Reference strength' });
		expect(slider).toHaveAttribute('min', String(REFERENCE_DEFAULTS.min));
		expect(slider).toHaveAttribute('max', String(REFERENCE_DEFAULTS.max));
		expect(slider).toHaveAttribute('step', String(REFERENCE_DEFAULTS.step));
		expect(slider).toHaveValue(String(REFERENCE_DEFAULTS.strength));
		expect(slider).toHaveAttribute('aria-valuetext', '0.6');

		fireEvent.change(slider, { target: { value: '0.85' } });
		expect(slider).toHaveAttribute('aria-valuetext', '0.85');
		expect(screen.getByText('0.85')).toBeInTheDocument();
		expect(actions.updateForm).not.toHaveBeenCalled();

		await act(async () => {
			fireEvent.keyUp(slider, { key: 'ArrowRight' });
			// Released twice (key, then pointer): committed once.
			fireEvent.pointerUp(slider);
		});
		expect(actions.updateForm).toHaveBeenCalledTimes(1);
		expect(actions.updateForm).toHaveBeenLastCalledWith({ referenceStrength: 0.85 });
		// The form holds the new value.
		expect(slider).toHaveValue('0.85');

		// Blurred without a change: nothing to commit.
		await act(async () => {
			fireEvent.blur(slider);
		});
		expect(actions.updateForm).toHaveBeenCalledTimes(1);
	});
});

describe('CharacterEditor LoRAs', () => {
	beforeEach(() => {
		useLibraryStore.setState({ loras: [LORA_A, LORA_B] });
	});

	it('lists the character LoRAs with their weights, and edits or removes them', async () => {
		const { user } = renderEditor(editorState({ form: characterForm({ loras: [{ id: 'a', weight: 0.8 }, { id: 'gone', weight: 1 }] }) }));

		const rows = within(screen.getByRole('list', { name: 'Character LoRAs' })).getAllByRole('listitem');
		expect(rows).toHaveLength(2);
		expect(within(rows[0]).getByText('Lora A')).toBeInTheDocument();
		// A LoRA no longer in the library shows its id.
		expect(within(rows[1]).getByText('gone')).toBeInTheDocument();

		const weight = within(rows[0]).getByRole('spinbutton', { name: 'Weight of Lora A' });
		expect(weight).toHaveValue('0.8');
		await user.click(weight);
		await user.keyboard('{ArrowUp}');
		expect(actions.setFormLoraWeight).toHaveBeenLastCalledWith('a', 0.85);

		const remove = within(rows[0]).getByRole('button', { name: 'Remove Lora A' });
		expect(hasActionIntent(remove, 'subtle', 'danger')).toBe(true);
		await user.click(remove);
		expect(actions.removeFormLora).toHaveBeenCalledWith('a');
		// The rows and the picker are one group, named by its visible label.
		const group = screen.getByRole('group', { name: 'LoRAs' });
		expect(within(group).getByRole('list', { name: 'Character LoRAs' })).toBeInTheDocument();
		expect(within(group).getByRole('combobox', { name: 'Add a LoRA' })).toHaveAccessibleDescription(/Character LoRAs apply first/);
	});

	it('adds a library LoRA from the combobox (filtered by the typed text; present ones not pickable)', async () => {
		const { user } = renderEditor(editorState({ form: characterForm({ loras: [{ id: 'a', weight: 1 }] }) }));

		const combobox = screen.getByRole('combobox', { name: 'Add a LoRA' });
		await user.click(combobox);
		const listbox = screen.getByRole('listbox');
		expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Lora A', 'Lora B']);
		expect(within(listbox).getByRole('option', { name: 'Lora A' })).toHaveAttribute('aria-disabled', 'true');

		await user.type(combobox, 'b');
		expect(within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Lora B']);
		await user.click(screen.getByRole('option', { name: 'Lora B' }));

		expect(actions.addFormLora).toHaveBeenCalledWith('b');
		expect(combobox).toHaveValue('');
	});

	it('disables the combobox without library LoRAs', () => {
		useLibraryStore.setState({ loras: [] });
		renderEditor();

		const combobox = screen.getByRole('combobox', { name: 'Add a LoRA' });
		expect(combobox).toBeDisabled();
		expect(combobox).toHaveAttribute('placeholder', 'No LoRAs in the library');
		expect(screen.queryByRole('list', { name: 'Character LoRAs' })).not.toBeInTheDocument();
	});
});

describe('CharacterEditor reference images', () => {
	it('previews the pending images of a new character and removes one', async () => {
		const { user } = renderEditor(
			editorState({
				pendingSources: [
					{ kind: 'output', output_id: '0000000042' },
					{ kind: 'url', url: 'https://image.example/alice.jpeg' },
					{ kind: 'file', path: 'D:/pictures/alice.png' },
				],
			}),
		);

		const list = screen.getByRole('list', { name: 'Pending reference images' });
		expect(within(list).getByRole('img', { name: 'Reference image 1' })).toHaveAttribute('src', outputImageUrl('0000000042'));
		expect(within(list).getByRole('img', { name: 'Reference image 2' })).toHaveAttribute('src', 'https://image.example/alice.jpeg');
		// A file has no preview URL: its icon and name.
		expect(within(list).queryByRole('img', { name: 'Reference image 3' })).not.toBeInTheDocument();
		expect(within(list).getByText('alice.png')).toBeInTheDocument();
		expect(screen.getByText('Imported when the character is saved; the first one becomes its thumbnail.')).toBeInTheDocument();
		// Saved-character actions are not offered before the character exists.
		expect(screen.queryByRole('button', { name: 'Add image file' })).not.toBeInTheDocument();

		// The first one becomes the thumbnail when saved.
		const tiles = within(list).getAllByRole('listitem');
		expect(within(tiles[0]).getByText('Thumbnail')).toBeInTheDocument();
		expect(within(tiles[1]).queryByText('Thumbnail')).not.toBeInTheDocument();

		const remove = within(list).getByRole('button', { name: 'Remove reference image 2' });
		expect(hasActionIntent(remove, 'subtle', 'danger')).toBe(true);
		await user.click(remove);
		expect(actions.removePendingSource).toHaveBeenCalledWith(1);
	});

	it('explains how to add references to a new character without pending images', () => {
		renderEditor();

		expect(screen.getByText(/Save the character, then add reference images/)).toBeInTheDocument();
	});

	it('edits the saved reference images of a character', async () => {
		const second = characterImage({ id: 'img-0000000000a2' });
		useCharactersStore.setState({ characters: [character({ reference_images: [characterImage(), second] })] });
		useOutputsStore.setState({ currentId: '0000000042' });
		const { user } = renderEditor(editorState({ characterId: ALICE_ID }));

		expect(screen.getByRole('heading', { name: 'Edit Alice' })).toBeInTheDocument();
		const list = screen.getByRole('list', { name: 'Saved reference images' });
		const [first, other] = within(list).getAllByRole('listitem');
		expect(within(first).getByRole('img', { name: 'Reference image 1' })).toHaveAttribute('src', characterImageUrl(ALICE_ID, REFERENCE_IMAGE_ID));
		expect(screen.getByText(`2 of ${REFERENCE_DEFAULTS.max_images} images`)).toBeInTheDocument();
		// The thumbnail was made from image 1: marked, and not offered again.
		expect(within(first).getByText('Thumbnail')).toBeInTheDocument();
		expect(within(first).getByRole('button', { name: 'Reference image 1 is the thumbnail' })).toBeDisabled();
		expect(within(other).queryByText('Thumbnail')).not.toBeInTheDocument();

		await user.click(within(other).getByRole('button', { name: 'Use reference image 2 as thumbnail' }));
		expect(actions.setThumbnailFromReference).toHaveBeenCalledWith(ALICE_ID, second.id);
		const remove = within(first).getByRole('button', { name: 'Remove reference image 1' });
		expect(hasActionIntent(remove, 'subtle', 'danger')).toBe(true);
		await user.click(remove);
		expect(actions.removeReference).toHaveBeenCalledWith(ALICE_ID, REFERENCE_IMAGE_ID);
		await user.click(screen.getByRole('button', { name: 'Add current output' }));
		expect(actions.addReferenceFromCurrentOutput).toHaveBeenCalledWith(ALICE_ID);
		await user.click(screen.getByRole('button', { name: 'Add image file' }));
		expect(actions.addReferenceFromFile).toHaveBeenCalledWith(ALICE_ID);
	});

	it('disables adding without an output, at the image limit, and while the character is busy', () => {
		const full = Array.from({ length: REFERENCE_DEFAULTS.max_images }, (_value, index) => characterImage({ id: `img-00000000000${index}` }));
		useCharactersStore.setState({ characters: [character()] });
		const { unmount } = renderEditor(editorState({ characterId: ALICE_ID }));
		expect(screen.getByRole('button', { name: 'Add current output' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Add image file' })).toBeEnabled();
		unmount();

		useCharactersStore.setState({ characters: [character({ reference_images: full })] });
		useOutputsStore.setState({ currentId: '0000000042' });
		const second = renderEditor(editorState({ characterId: ALICE_ID }));
		expect(screen.getByRole('button', { name: 'Add current output' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Add image file' })).toBeDisabled();
		second.unmount();

		useCharactersStore.setState({ characters: [character({ reference_images: [] })], busyIds: { [ALICE_ID]: true } });
		renderEditor(editorState({ characterId: ALICE_ID }));
		expect(screen.getByText('No reference images yet.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Add current output' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Add image file' })).toBeDisabled();
	});
});

describe('CharacterEditor actions', () => {
	it('saves and cancels through the store', async () => {
		const { user } = renderEditor();

		expect(hasActionIntent(saveButton(), 'filled', 'primary')).toBe(true);
		expect(screen.getByRole('group', { name: 'Character editor actions' })).toContainElement(saveButton());
		await user.click(saveButton());
		expect(actions.saveEditor).toHaveBeenCalledTimes(1);
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(actions.cancelEdit).toHaveBeenCalledTimes(1);
	});

	it('disables Save while saving and shows why the last save failed', () => {
		renderEditor(editorState({ saving: true, error: 'The backend refused the character.' }));

		// Disabled but focusable: the focus stays in the editor while it saves.
		expect(saveButton()).toHaveAttribute('aria-disabled', 'true');
		expect(saveButton()).not.toHaveAttribute('disabled');
		// The primary intent stays on: its classes color enabled buttons only (src/ui/stateStyles.tsx), so a disabled
		// button keeps Fluent's disabled look.
		expect(hasActionIntent(saveButton(), 'filled', 'primary')).toBe(true);
		expect(within(saveButton()).getByRole('progressbar')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
		expect(screen.getByText('Could not save the character')).toBeInTheDocument();
		expect(screen.getByText('The backend refused the character.')).toBeInTheDocument();
	});
});
