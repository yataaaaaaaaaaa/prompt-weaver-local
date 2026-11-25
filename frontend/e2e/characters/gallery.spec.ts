// The character gallery of the Characters pane in the real browser: the fixture characters as cards (thumbnail or a
// centered placeholder, aligned footers, Active switch, Edit, Delete in the danger color), one active character at a
// time from the cards and from the Generation pane, the empty and load error states, and no region or heading
// repeating the pane's name.
import { tokens } from '@fluentui/react-theme';
import { ACTION_COLORS } from '../../src/ui/stateColors';
import { expectBaseline } from '../support/baselines';
import { computedStyle, resolveColor } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expectPicturesLoaded } from '../support/app';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import {
	BRAM,
	centerY,
	CharactersDriver,
	characterCollection,
	charactersWindowAt,
	expectCentered,
	expectInside,
	FIXTURE_CHARACTER_NAMES,
	MIRA,
	NOVA,
} from './characters';

test('the gallery shows every fixture character as a readable card', async ({ app, page }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	const pane = await characters.open();
	await app.settle();
	await assertAppVisible(page);

	// One card per character, sorted by name.
	const cards = characters.gallery().getByRole('list', { name: 'Characters' }).getByRole('listitem');
	await expect(cards).toHaveCount(FIXTURE_CHARACTER_NAMES.length);
	for (const [index, name] of FIXTURE_CHARACTER_NAMES.entries()) {
		await expect(cards.nth(index).getByRole('group', { name, exact: true })).toBeVisible();
	}
	await expectPicturesLoaded(characters.gallery());
	await expect(characters.card(MIRA.name).getByRole('img', { name: `Thumbnail of ${MIRA.name}` })).toBeVisible();
	await expect(characters.card(MIRA.name).getByText('1girl, short red hair, green eyes, freckles')).toBeVisible();

	// Without a thumbnail: a placeholder icon in the middle of the preview frame.
	const placeholder = characters.card(BRAM.name).getByRole('img', { name: `No thumbnail for ${BRAM.name}` });
	await expect(placeholder).toBeVisible();
	await expectCentered(placeholder.locator('svg'), placeholder, 'placeholder icon');
	const thumbnail = characters.card(MIRA.name).getByRole('img', { name: `Thumbnail of ${MIRA.name}` });
	const [placeholderBox, thumbnailBox] = [await placeholder.boundingBox(), await thumbnail.boundingBox()];
	expect(placeholderBox?.height).toBeCloseTo(thumbnailBox?.height ?? 0, 0);
	// 3:4 previews.
	expect((thumbnailBox?.width ?? 0) / (thumbnailBox?.height ?? 1)).toBeCloseTo(3 / 4, 1);

	// The footers of a row line up (Mira's tags take two lines), Active, Edit and Delete on one line.
	const switchCenters = await Promise.all(FIXTURE_CHARACTER_NAMES.map((name) => centerY(characters.activeSwitch(name))));
	for (const center of switchCenters) {
		expect(Math.abs(center - switchCenters[0])).toBeLessThanOrEqual(1);
	}
	for (const name of FIXTURE_CHARACTER_NAMES) {
		const [switchY, editY, deleteY] = await Promise.all([
			centerY(characters.activeSwitch(name)),
			centerY(characters.card(name).getByRole('button', { name: `Edit ${name}` })),
			centerY(characters.card(name).getByRole('button', { name: `Delete ${name}` })),
		]);
		expect(Math.abs(editY - switchY), `${name}: Edit on the Active row`).toBeLessThanOrEqual(2);
		expect(Math.abs(deleteY - switchY), `${name}: Delete on the Active row`).toBeLessThanOrEqual(2);
	}

	// Delete in the danger color, Edit neutral.
	const danger = await resolveColor(page, ACTION_COLORS.danger.subtleForeground);
	expect(await computedStyle(characters.card(MIRA.name).getByRole('button', { name: `Delete ${MIRA.name}` }), 'color')).toBe(danger);
	expect(await computedStyle(characters.card(MIRA.name).getByRole('button', { name: `Edit ${MIRA.name}` }), 'color')).not.toBe(danger);

	// The window is 'Characters'; nothing inside repeats that name as a region or heading.
	await expect(pane.getByRole('region', { name: 'Characters', exact: true })).toHaveCount(0);
	await expect(pane.getByRole('heading', { name: 'Characters', exact: true })).toHaveCount(0);
	await expect(pane.getByRole('heading', { name: 'Character gallery' })).toBeVisible();

	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'characters-pane');
	await expectBaseline(characters.gallery(), 'gallery.png');
});

test('one character is active at a time, from the cards and from the Generation pane', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();

	await characters.toggleActive(MIRA.name, true);
	await expect(page.getByText(`${MIRA.name} is active for generation.`)).toBeVisible();
	expect((await characterCollection(backend)).active_id).toBe(MIRA.id);
	// The active card is framed in the brand color (and its switch is on).
	const brand = await resolveColor(page, tokens.colorBrandStroke1);
	expect(await computedStyle(characters.card(MIRA.name), 'outline-color')).toBe(brand);
	expect(await computedStyle(characters.card(NOVA.name), 'outline-style')).toBe('none');
	await assertAppVisible(page, { allowOverlays: true });

	await characters.toggleActive(NOVA.name, true);
	await expect(characters.activeSwitch(MIRA.name)).not.toBeChecked();
	expect((await characterCollection(backend)).active_id).toBe(NOVA.id);
	await expect(characters.generationSection().getByText(NOVA.name, { exact: true })).toBeVisible();

	await characters.toggleActive(NOVA.name, false);
	expect((await characterCollection(backend)).active_id).toBeNull();
	for (const name of FIXTURE_CHARACTER_NAMES) {
		await expect(characters.activeSwitch(name)).not.toBeChecked();
	}

	// The Generation pane: pick one in the dropdown, then Deactivate.
	const generation = await app.showPane('Generation');
	const section = characters.generationSection();
	await section.getByRole('combobox', { name: 'Active character' }).click();
	await page.getByRole('option', { name: BRAM.name, exact: true }).click();
	await expect(section.getByRole('button', { name: 'Deactivate' })).toBeVisible();
	await expect(section.getByText(BRAM.name, { exact: true })).toBeVisible();
	await expect(section.getByText('No reference images: add some in the Characters pane for a stronger likeness.')).toBeVisible();
	expect((await characterCollection(backend)).active_id).toBe(BRAM.id);
	await expect(characters.activeSwitch(BRAM.name)).toBeChecked();
	await app.parkPointer();
	await saveScreenshot(generation, testInfo, 'generation-bram-active');

	await section.getByRole('button', { name: 'Deactivate' }).click();
	await expect(section.getByRole('combobox', { name: 'Active character' })).toBeVisible();
	await expect(characters.activeSwitch(BRAM.name)).not.toBeChecked();
	expect((await characterCollection(backend)).active_id).toBeNull();
});

test('the cards work with the keyboard, with a visible focus', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();
	await characters.gallery().getByRole('button', { name: 'New character' }).focus();

	// New character -> Bram's Active switch -> Edit -> Delete, then the next card.
	await page.keyboard.press('Tab');
	const bramSwitch = characters.activeSwitch(BRAM.name);
	await expect(bramSwitch).toBeFocused();
	await page.keyboard.press('Space');
	await expect(bramSwitch).toBeChecked();
	await expect.poll(async () => (await characterCollection(backend)).active_id).toBe(BRAM.id);
	await page.keyboard.press('Tab');
	await expect(characters.card(BRAM.name).getByRole('button', { name: `Edit ${BRAM.name}` })).toBeFocused();
	await page.keyboard.press('Tab');
	const remove = characters.card(BRAM.name).getByRole('button', { name: `Delete ${BRAM.name}` });
	await expect(remove).toBeFocused();
	// The focus ring is drawn outside the button: compare the focused card with its unfocused look.
	await saveScreenshot(characters.card(BRAM.name), testInfo, 'focused-delete');

	await page.keyboard.press('Enter');
	const dialog = page.getByRole('alertdialog', { name: `Delete character '${BRAM.name}'?` });
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(remove).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(characters.activeSwitch(MIRA.name)).toBeFocused();
	await assertAppVisible(page, { allowOverlays: true });
});

test.describe('in the narrowest Characters window of the smallest app window', () => {
	// The pane's minimum width (paneRegistry minWidth 420), inside the 1280 x 720 viewport.
	test.use({ e2eOptions: { files: charactersWindowAt({ x: 840, y: 16, width: 420, height: 640 }) }, viewport: SMALL_VIEWPORT });

	test('the cards keep two columns with one-line footers, and the editor fits', async ({ app, page }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		const pane = await characters.open();
		await assertAppVisible(page);
		await expectOnTop(pane.getByRole('button', { name: 'New character' }));

		const firstRow = [BRAM.name, MIRA.name];
		const [left, right] = await Promise.all(firstRow.map((name) => characters.card(name).boundingBox()));
		expect(left?.y, 'two cards side by side').toBe(right?.y);
		for (const name of firstRow) {
			const switchY = await centerY(characters.activeSwitch(name));
			expect(Math.abs((await centerY(characters.card(name).getByRole('button', { name: `Delete ${name}` }))) - switchY)).toBeLessThanOrEqual(2);
		}
		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'narrow-gallery');

		await characters.gallery().getByRole('button', { name: 'New character' }).click();
		const editor = characters.editor('New character');
		await expect(editor).toBeVisible();
		// The actions stay reachable at the bottom of the pane while the long form scrolls.
		await expectInside(characters.editorActions(), pane, 'editor actions in the window');
		await expectOnTop(editor.getByRole('button', { name: 'Save' }));
		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'narrow-editor');
	});
});

test.describe('without characters', () => {
	test.use({ e2eOptions: { remove: ['characters'] } });

	test('the empty gallery explains the entry points', async ({ app, page }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		const pane = await characters.open();
		await assertAppVisible(page);

		await expect(characters.gallery().getByText('No characters yet')).toBeVisible();
		await expect(characters.gallery().getByText(/Create one with New character/)).toBeVisible();
		await expect(characters.gallery().getByRole('list', { name: 'Characters' })).toHaveCount(0);
		await expectOnTop(characters.gallery().getByRole('button', { name: 'New character' }));
		const picker = characters.generationSection().getByRole('combobox', { name: 'Active character' });
		await expect(picker).toBeDisabled();
		await expect(picker).toContainText('No characters yet');

		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'empty-gallery');
		await expectBaseline(characters.gallery(), 'gallery-empty.png');
	});
});

test('a failed load shows the error, and Retry loads the characters', async ({ app, page, diagnostics }, testInfo) => {
	diagnostics.allow(/status of 503/);
	const characters = new CharactersDriver(app);
	const isCharacterList = (url: URL) => url.pathname === '/api/characters';
	await page.route(isCharacterList, (route) =>
		route.request().method() === 'GET'
			? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'The characters file is locked.' }) })
			: route.fallback(),
	);
	await app.open();
	const pane = await characters.open();

	const error = characters.gallery().getByText('Could not load the characters');
	await expect(error).toBeVisible();
	await expect(characters.gallery().getByText('The characters file is locked.')).toBeVisible();
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'load-error');

	await page.unroute(isCharacterList);
	await characters.gallery().getByRole('button', { name: 'Retry' }).click();
	await expect(error).toBeHidden();
	await expect(characters.card(MIRA.name)).toBeVisible();
});
