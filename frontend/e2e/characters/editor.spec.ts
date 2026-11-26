// The character editor in the detail panel of the Characters section, in the real browser: a new character
// (validation, every field, Save; the new character selected with its details), New character from the generation
// panel (the editor in Characters, Cancel back to Create with the focus on the opener), editing a saved one from its
// card and from its details (the focus returns to the opener), its reference images (add the current output, use as
// thumbnail, remove), and Delete with its confirmation. The backend is checked after every change.
import { ACTION_COLORS } from '../../src/ui/stateColors';
import { expectPicturesLoaded } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { computedStyle, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import {
	backendCharacterNames,
	BRAM,
	CharactersDriver,
	characterCollection,
	expectInside,
	MIRA,
	NOVA,
	scrollToBottomEdge,
} from './characters';

test('a new character: Save waits for a valid form, then every field is saved and the character is selected', async ({
	app,
	page,
	backend,
}, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();
	await characters.newCharacter().click();

	const editor = characters.editor('New character');
	await expect(editor).toBeVisible();
	const name = editor.getByRole('textbox', { name: /^Name/ });
	await expect(name).toBeFocused();
	await expect(name).toHaveValue('New character');
	const save = editor.getByRole('button', { name: 'Save' });
	await expect(save).toBeEnabled();
	expect(await computedStyle(save, 'background-color')).toBe(await resolveColor(page, ACTION_COLORS.primary.background));
	await expectInside(characters.editorActions(), characters.details(), 'editor actions in the detail panel');
	// The gallery stays in view next to the editor.
	await expect(characters.card(MIRA.name)).toBeVisible();
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'editor-new');
	await expectBaseline(characters.details(), 'editor-new.png');

	// Invalid: no name, then a seed that is not a whole number.
	await name.fill('');
	await expect(editor.getByText('Give the character a name.')).toBeVisible();
	await expect(save).toBeDisabled();
	await name.fill('Iris');
	await expect(save).toBeEnabled();
	const seed = editor.getByRole('textbox', { name: 'Seed' });
	await seed.fill('12abc');
	await expect(editor.getByText('The seed must be a whole number of 0 or more.')).toBeVisible();
	await expect(save).toBeDisabled();
	await seed.fill('');
	await editor.getByRole('switch', { name: 'Lock seed' }).check();
	await expect(editor.getByText('Enter the seed to lock.')).toBeVisible();
	await expect(save).toBeDisabled();
	await seed.fill('4242');
	await expect(save).toBeEnabled();

	await editor.getByRole('textbox', { name: 'Identity tags' }).fill('1girl, long black hair, violet eyes');
	await editor.getByRole('textbox', { name: 'Outfit tags' }).fill('kimono');
	await editor.getByRole('textbox', { name: 'Negative tags' }).fill('short hair');

	// A library LoRA with its weight.
	const loras = editor.getByRole('group', { name: 'LoRAs' });
	const picker = loras.getByRole('combobox', { name: 'Add a LoRA' });
	await picker.click();
	await picker.pressSequentially('water');
	await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
	await page.getByRole('option', { name: 'Watercolor Wash v1.2' }).click();
	const weight = loras.getByRole('spinbutton', { name: 'Weight of Watercolor Wash v1.2' });
	await weight.fill('0.7');
	await weight.press('Enter');
	await expect(weight).toHaveValue('0.7');

	// Reference focus and strength (the support hint follows the focus).
	await editor.getByRole('radio', { name: 'Whole subject' }).check();
	await expect(editor.getByText('Keeps the overall look of the reference images (IP-Adapter Plus).')).toBeVisible();
	await expect(editor.getByText(/SDXL general \(IP-Adapter Plus ViT-H\)/)).toBeVisible();
	const strength = editor.getByRole('slider', { name: 'Reference strength' });
	await strength.focus();
	await strength.press('ArrowRight');
	await strength.press('ArrowRight');
	await expect(strength).toHaveAttribute('aria-valuetext', '0.7');
	await expect(editor.getByText('Save the character, then add reference images from the current output or from image files.')).toBeVisible();

	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'editor-filled');
	await save.click();
	await expect(editor).toBeHidden();
	await expect(characters.card('Iris')).toBeVisible();
	await expect(characters.toast('Iris was created.')).toBeVisible();
	// The new character is selected: its details replace the editor.
	await expect(characters.selectButton('Iris')).toHaveAttribute('aria-current', 'true');
	await expect(characters.detailsOf('Iris').getByText('4242 (locked)')).toBeVisible();
	// The focus is back on the button that opened the editor.
	await expect(characters.newCharacter()).toBeFocused();

	const iris = (await characterCollection(backend)).items.find((character) => character.name === 'Iris');
	expect(iris).toMatchObject({
		identity_tags: ['1girl', 'long black hair', 'violet eyes'],
		outfit_tags: ['kimono'],
		negative_tags: ['short hair'],
		loras: [{ id: 'watercolor-wash-safetensors', weight: 0.7 }],
		seed: 4242,
		seed_locked: true,
		reference_focus: 'general',
		reference_strength: 0.7,
		reference_images: [],
		thumbnail: null,
	});
});

test('New character from the generation panel opens the editor in Characters; Cancel goes back to Create', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	const opener = characters.generationSection().getByRole('button', { name: 'New character' });
	await opener.click();

	// The hand-off lands in the Characters section, on the editor, its name field focused.
	await expect(characters.section()).toBeVisible();
	await expect(app.section('create')).toBeHidden();
	const editor = characters.editor('New character');
	await expect(editor).toBeVisible();
	const name = editor.getByRole('textbox', { name: /^Name/ });
	await expect(name).toBeFocused();
	await expectOnTop(name);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'editor-from-generation-panel');
	await name.fill('Never saved');
	await editor.getByRole('button', { name: 'Cancel' }).click();

	// Back where it was opened, with the focus on the opener.
	await expect(app.section('create')).toBeVisible();
	await expect(opener).toBeFocused();
	await characters.open();
	await expect(characters.editor('New character')).toHaveCount(0);
	await expect(characters.card('Never saved')).toHaveCount(0);
	expect(await backendCharacterNames(backend)).toEqual([BRAM.name, MIRA.name, NOVA.name].sort());
});

test('editing a character from its card shows its values; a rename and new tags are saved', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();
	await characters.card(MIRA.name).getByRole('button', { name: `Edit ${MIRA.name}` }).click();

	const editor = characters.editor(`Edit ${MIRA.name}`);
	await expect(editor).toBeVisible();
	await expect(editor.getByRole('textbox', { name: /^Name/ })).toBeFocused();
	// Edit selects the card too; its details are hidden while the editor is open.
	await expect(characters.selectButton(MIRA.name)).toHaveAttribute('aria-current', 'true');
	await expect(characters.detailsOf(MIRA.name)).toHaveCount(0);
	await expect(editor.getByRole('textbox', { name: /^Name/ })).toHaveValue(MIRA.name);
	await expect(editor.getByRole('textbox', { name: 'Identity tags' })).toHaveValue('1girl, short red hair, green eyes, freckles');
	await expect(editor.getByRole('textbox', { name: 'Outfit tags' })).toHaveValue('leather jacket, white scarf');
	await expect(editor.getByRole('spinbutton', { name: 'Weight of Watercolor Wash v1.2' })).toHaveValue('0.5');
	await expect(editor.getByRole('textbox', { name: 'Seed' })).toHaveValue('777');
	await expect(editor.getByRole('switch', { name: 'Lock seed' })).toBeChecked();
	await expect(editor.getByRole('radio', { name: 'Face' })).toBeChecked();
	await expect(editor.getByRole('slider', { name: 'Reference strength' })).toHaveAttribute('aria-valuetext', '0.6');
	// The LoRA's Remove is a danger action.
	const removeLora = editor.getByRole('button', { name: 'Remove Watercolor Wash v1.2' });
	expect(await computedStyle(removeLora, 'color')).toBe(await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'editor-edit');
	await expectBaseline(characters.details(), 'editor-edit.png');

	// A control at the bottom edge of the panel (where the sticky actions are) moves above them when focused.
	for (const name of ['Remove reference image 2', 'Add image file']) {
		const control = characters.references().getByRole('button', { name });
		await scrollToBottomEdge(control);
		await control.focus();
		await expectOnTop(control);
	}
	await expectPicturesLoaded(characters.references());
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'editor-edit-references');
	await expectBaseline(characters.details(), 'editor-edit-references.png');

	await editor.getByRole('textbox', { name: /^Name/ }).fill('Mira Vale');
	await editor.getByRole('textbox', { name: 'Identity tags' }).fill('1girl, short red hair, green eyes, freckles, scar');
	await editor.getByRole('button', { name: 'Save' }).click();

	await expect(editor).toBeHidden();
	await expect(characters.card('Mira Vale')).toBeVisible();
	await expect(characters.card('Mira Vale').getByRole('button', { name: 'Edit Mira Vale' })).toBeFocused();
	await expect(characters.card('Mira Vale').getByText('1girl, short red hair, green eyes, freckles, scar')).toBeVisible();
	await expect(characters.detailsOf('Mira Vale').getByText('1girl, short red hair, green eyes, freckles, scar')).toBeVisible();
	const saved = (await characterCollection(backend)).items.find((character) => character.id === MIRA.id);
	expect(saved).toMatchObject({ name: 'Mira Vale', identity_tags: ['1girl', 'short red hair', 'green eyes', 'freckles', 'scar'], seed: 777 });
});

test("Edit in the details: Save and Cancel return the focus to the details' Edit", async ({ app, backend }) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();
	await characters.selectButton(NOVA.name).click();
	const edit = characters.detailsOf(NOVA.name).getByRole('button', { name: 'Edit', exact: true });

	await edit.click();
	const editor = characters.editor(`Edit ${NOVA.name}`);
	await expect(editor.getByRole('textbox', { name: /^Name/ })).toBeFocused();
	await editor.getByRole('textbox', { name: 'Outfit tags' }).fill('space suit, helmet');
	await editor.getByRole('button', { name: 'Save' }).click();
	await expect(editor).toBeHidden();
	await expect(characters.detailsOf(NOVA.name).getByText('space suit, helmet')).toBeVisible();
	await expect(edit).toBeFocused();
	expect((await characterCollection(backend)).items.find((character) => character.id === NOVA.id)?.outfit_tags).toEqual(['space suit', 'helmet']);

	// From the keyboard; Cancel: back to the details too (opened in Characters: the section stays shown).
	await edit.press('Enter');
	await expect(editor.getByRole('textbox', { name: /^Name/ })).toBeFocused();
	await editor.getByRole('button', { name: 'Cancel' }).click();
	await expect(characters.section()).toBeVisible();
	await expect(edit).toBeFocused();
});

test('reference images: add the current output, use it as thumbnail, remove one', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();
	await characters.card(MIRA.name).getByRole('button', { name: `Edit ${MIRA.name}` }).click();
	const references = characters.references();
	await references.scrollIntoViewIfNeeded();
	const tiles = references.getByRole('list', { name: 'Saved reference images' }).getByRole('listitem');
	await expect(tiles).toHaveCount(2);
	await expect(references.getByText('2 of 4 images')).toBeVisible();
	await expect(tiles.nth(0).getByText('Thumbnail')).toBeVisible();
	await expect(tiles.nth(0).getByRole('button', { name: 'Reference image 1 is the thumbnail' })).toBeDisabled();

	await references.getByRole('button', { name: 'Add current output' }).click();
	await expect(tiles).toHaveCount(3);
	await expect(references.getByText('3 of 4 images')).toBeVisible();
	await expectPicturesLoaded(references);

	const cardThumbnail = characters.card(MIRA.name).getByRole('img', { name: `Thumbnail of ${MIRA.name}` });
	const thumbnailBefore = await cardThumbnail.getAttribute('src');
	await tiles.nth(2).getByRole('button', { name: 'Use reference image 3 as thumbnail' }).click();
	await expect(tiles.nth(2).getByText('Thumbnail')).toBeVisible();
	await expect(tiles.nth(0).getByText('Thumbnail')).toHaveCount(0);
	await expect(cardThumbnail).not.toHaveAttribute('src', thumbnailBefore ?? '');
	let mira = (await characterCollection(backend)).items.find((character) => character.id === MIRA.id);
	expect(mira?.thumbnail?.source).toEqual({ kind: 'character_image', image_id: mira?.reference_images[2].id });
	expect(mira?.reference_images[2].source).toEqual({ kind: 'output', output_id: '0000000004' });

	const remove = tiles.nth(1).getByRole('button', { name: 'Remove reference image 2' });
	expect(await computedStyle(remove, 'color')).toBe(await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
	await remove.click();
	await expect(tiles).toHaveCount(2);
	await expect(references.getByText('2 of 4 images')).toBeVisible();
	mira = (await characterCollection(backend)).items.find((character) => character.id === MIRA.id);
	expect(mira?.reference_images.map((image) => image.source.kind)).toEqual(['output', 'output']);

	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'references-edited');
});

test('Delete asks for a confirmation; Cancel keeps the character', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();

	await characters.card(BRAM.name).getByRole('button', { name: `Delete ${BRAM.name}` }).click();
	let dialog = page.getByRole('alertdialog', { name: `Delete character '${BRAM.name}'?` });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('Its reference images and thumbnail are deleted too. Outputs generated with it are kept.')).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await expectOnTop(dialog.getByRole('button', { name: 'Delete' }));
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'delete-confirmation');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(characters.card(BRAM.name)).toBeVisible();
	expect(await backendCharacterNames(backend)).toContain(BRAM.name);

	// Delete from the details of the selected character: it leaves the gallery and the details.
	await characters.selectButton(BRAM.name).click();
	await characters.detailsOf(BRAM.name).getByRole('button', { name: `Delete ${BRAM.name}` }).click();
	dialog = page.getByRole('alertdialog', { name: `Delete character '${BRAM.name}'?` });
	await dialog.getByRole('button', { name: 'Delete' }).click();
	await expect(dialog).toBeHidden();
	await expect(characters.card(BRAM.name)).toHaveCount(0);
	await expect(characters.toast(`${BRAM.name} was deleted.`)).toBeVisible();
	await expect(characters.details().getByText('No character selected')).toBeVisible();
	// Its focused Delete is gone: the focus goes to New character.
	await expect(characters.newCharacter()).toBeFocused();
	expect(await backendCharacterNames(backend)).toEqual([MIRA.name, NOVA.name]);
	await assertAppVisible(page, { allowOverlays: true });
});
