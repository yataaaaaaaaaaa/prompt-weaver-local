// "Create character" from the other panes, in the real browser: from the output shown in the Output browser (#4:
// its tags, LoRAs with weights and seed; its picture as the first, pending reference) and from an image of the Image
// library (950001; its LoRAs are resolved, installed or skipped with a warning). Those views are used read-only.
import { expectPicturesLoaded } from '../support/app';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import { CharactersDriver, characterCollection } from './characters';

test('Create character from the Output browser prefills the editor from output #4', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	const outputBrowser = await app.showPane('Output browser');
	await expect(outputBrowser.getByText('#0000000004', { exact: true })).toBeVisible();
	await outputBrowser.getByRole('button', { name: 'Create character' }).click();

	// The Characters pane opens on the prefilled editor.
	const editor = characters.editor('New character');
	await expect(editor).toBeVisible();
	await expect(editor.getByRole('textbox', { name: /^Name/ })).toHaveValue('Character from #0000000004');
	await expect(editor.getByRole('textbox', { name: 'Identity tags' })).toHaveValue(
		'1girl, silver hair, red dress, neon city street, rain, puddles reflections, smiling',
	);
	await expect(editor.getByRole('spinbutton', { name: 'Weight of Watercolor Wash v1.2' })).toHaveValue('0.65');
	await expect(editor.getByRole('spinbutton', { name: 'Weight of local_detail_tweaker.safetensors' })).toHaveValue('-0.5');
	await expect(editor.getByRole('textbox', { name: 'Seed' })).toHaveValue('1234566');
	await expect(editor.getByRole('switch', { name: 'Lock seed' })).not.toBeChecked();

	// Its picture is the first pending reference: the future thumbnail.
	const pending = characters.references().getByRole('list', { name: 'Pending reference images' });
	await pending.scrollIntoViewIfNeeded();
	await expect(pending.getByRole('listitem')).toHaveCount(1);
	await expect(pending.getByRole('img', { name: 'Reference image 1' })).toBeVisible();
	await expect(pending.getByText('Thumbnail')).toBeVisible();
	await expectPicturesLoaded(pending);
	await assertAppVisible(page, { allowOverlays: true });
	await app.parkPointer();
	await saveScreenshot(characters.pane(), testInfo, 'from-output');

	await editor.getByRole('button', { name: 'Save' }).click();
	const card = characters.card('Character from #0000000004');
	await expect(card).toBeVisible();
	await expect(card.getByRole('img', { name: 'Thumbnail of Character from #0000000004' })).toBeVisible();
	await expectPicturesLoaded(card);
	const created = (await characterCollection(backend)).items.find((character) => character.name === 'Character from #0000000004');
	expect(created).toMatchObject({
		loras: [
			{ id: 'watercolor-wash-safetensors', weight: 0.65 },
			{ id: 'local-detail-tweaker-safetensors', weight: -0.5 },
		],
		seed: 1234566,
		seed_locked: false,
	});
	expect(created?.reference_images.map((image) => image.source)).toEqual([{ kind: 'output', output_id: '0000000004' }]);
	expect(created?.thumbnail).not.toBeNull();
});

test('Create character from an Image library image (950001)', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	const library = await app.showPane('Image library');
	const thumbnail = library.getByRole('button', { name: 'Image by e2e-painter' });
	await expect(thumbnail).toBeVisible({ timeout: 20_000 });
	await thumbnail.click();
	await library.getByRole('button', { name: 'Create character' }).click();

	// Its LoRAs are collected (installed when downloadable), then the editor opens prefilled.
	const editor = characters.editor('New character');
	await expect(editor).toBeVisible({ timeout: 30_000 });
	await expect(editor.getByRole('textbox', { name: /^Name/ })).toHaveValue('Character from e2e-painter');
	await expect(editor.getByRole('textbox', { name: 'Identity tags' })).not.toHaveValue('');
	await expect(editor.getByRole('textbox', { name: 'Seed' })).toHaveValue('123456');
	const pending = characters.references().getByRole('list', { name: 'Pending reference images' });
	await expect(pending.getByRole('img', { name: 'Reference image 1' })).toBeVisible();
	await expectPicturesLoaded(pending);
	// Each LoRA of the image is in the editor with its weight, or named in a warning (not usable here).
	const loraRows = editor.getByRole('list', { name: 'Character LoRAs' }).getByRole('listitem');
	const skipped = page.getByText('Some LoRAs of this image are not in the character');
	await expect(loraRows.first().or(skipped)).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'from-image');

	await editor.getByRole('button', { name: 'Save' }).click();
	await expect(characters.card('Character from e2e-painter')).toBeVisible();
	const created = (await characterCollection(backend)).items.find((character) => character.name === 'Character from e2e-painter');
	expect(created?.seed).toBe(123456);
	expect(created?.reference_images).toHaveLength(1);
	expect(created?.reference_images[0].source.kind).toBe('url');
	expect(created?.thumbnail).not.toBeNull();
});
