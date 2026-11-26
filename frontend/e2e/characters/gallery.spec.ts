// The Characters section in the real browser: the gallery of the fixture characters (thumbnail or a centered
// placeholder, aligned footers, Active switch, Edit, Delete in the danger color), the search of the toolbar, the
// selection with the details of the selected character in the detail panel, one active character at a time from the
// cards, the details and the generation panel (with the 'Go to Create' hand-off), the keyboard, the docked layout at
// 1280 x 720, and the empty and load error states.
import { tokens } from '@fluentui/react-theme';
import { ACTION_COLORS } from '../../src/ui/stateColors';
import { dismissNotifications, expectPicturesLoaded } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { computedStyle, resolveColor } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop } from '../support/visibility';
import {
	BRAM,
	centerY,
	CharactersDriver,
	characterCollection,
	expectCentered,
	expectInside,
	FIXTURE_CHARACTER_NAMES,
	MIRA,
	NOVA,
} from './characters';

test('the gallery shows every fixture character as a readable card', async ({ app, page }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	const section = await characters.open();
	await assertAppVisible(page);

	// One card per character, sorted by name.
	const cards = characters.gallery().getByRole('list', { name: 'Characters' }).getByRole('listitem');
	await expect(cards).toHaveCount(FIXTURE_CHARACTER_NAMES.length);
	for (const [index, name] of FIXTURE_CHARACTER_NAMES.entries()) {
		await expect(cards.nth(index).getByRole('group', { name, exact: true })).toBeVisible();
	}
	await expect(characters.count()).toHaveText('3 characters');
	await expectPicturesLoaded(characters.gallery());
	await expect(characters.card(MIRA.name).getByRole('img', { name: `Thumbnail of ${MIRA.name}` })).toBeVisible();
	await expect(characters.card(MIRA.name).getByText('1girl, short red hair, green eyes, freckles')).toBeVisible();

	// Without a thumbnail: a placeholder icon in the middle of the picture frame.
	const placeholder = characters.card(BRAM.name).getByRole('img', { name: `No thumbnail for ${BRAM.name}` });
	await expect(placeholder).toBeVisible();
	await expectCentered(placeholder.locator('svg'), placeholder, 'placeholder icon');
	const thumbnail = characters.card(MIRA.name).getByRole('img', { name: `Thumbnail of ${MIRA.name}` });
	const [placeholderBox, thumbnailBox] = [await boxOf(placeholder), await boxOf(thumbnail)];
	expect(placeholderBox.height).toBeCloseTo(thumbnailBox.height, 0);
	// 3:4 pictures, bleeding to the edges of the card.
	expect(thumbnailBox.width / thumbnailBox.height).toBeCloseTo(3 / 4, 1);
	expect(Math.abs(thumbnailBox.width - (await boxOf(characters.card(MIRA.name))).width)).toBeLessThanOrEqual(2);

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

	// Delete in the danger color, Edit neutral; New character is the section's primary action.
	const danger = await resolveColor(page, ACTION_COLORS.danger.subtleForeground);
	expect(await computedStyle(characters.card(MIRA.name).getByRole('button', { name: `Delete ${MIRA.name}` }), 'color')).toBe(danger);
	expect(await computedStyle(characters.card(MIRA.name).getByRole('button', { name: `Edit ${MIRA.name}` }), 'color')).not.toBe(danger);
	expect(await computedStyle(characters.newCharacter(), 'background-color')).toBe(await resolveColor(page, ACTION_COLORS.primary.background));

	// The section is named 'Characters' (its h1); nothing inside repeats that name as a region.
	await expect(section.getByRole('heading', { name: 'Characters', exact: true, level: 1 })).toBeVisible();
	await expect(section.getByRole('region', { name: 'Characters', exact: true })).toHaveCount(0);
	// Nothing selected yet: the detail panel says how to see details, the IP-Adapter section is under it.
	await expect(characters.details().getByText('No character selected')).toBeVisible();
	await expect(characters.ipAdapter()).toBeVisible();
	await expectNoHorizontalOverflow(section);

	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'characters-section');
	await expectBaseline(characters.gallery(), 'gallery.png');
});

test('selecting a card shows its details; Activate there offers to go to Create', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();

	await characters.card(MIRA.name).getByText('1girl, short red hair, green eyes, freckles').click();
	const details = characters.detailsOf(MIRA.name);
	await expect(details).toBeVisible();
	await expect(characters.selectButton(MIRA.name)).toHaveAttribute('aria-current', 'true');
	await expect(characters.selectButton(BRAM.name)).not.toHaveAttribute('aria-current');
	// The selected card is framed in the brand color.
	expect(await computedStyle(characters.card(MIRA.name), 'outline-color')).toBe(await resolveColor(page, tokens.colorBrandStroke1));
	expect(await computedStyle(characters.card(NOVA.name), 'outline-style')).toBe('none');

	const values = details.locator('dl');
	await expect(values.locator('dt')).toHaveText(['Identity tags', 'Outfit tags', 'Negative tags', 'LoRAs', 'Seed', 'Reference focus', 'Reference strength']);
	await expect(values.locator('dd')).toHaveText([
		'1girl, short red hair, green eyes, freckles',
		'leather jacket, white scarf',
		'long hair',
		'Watercolor Wash v1.2 · 0.5',
		'777 (locked)',
		'Face',
		'0.6',
	]);
	await expect(details.getByRole('list', { name: `Reference images of ${MIRA.name}` }).getByRole('listitem')).toHaveCount(2);
	await expect(details.getByText('2 of 4 images')).toBeVisible();
	await expectPicturesLoaded(details);
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'mira-selected');
	await expectBaseline(details, 'details.png');

	// Activate: the primary action of the details.
	const activate = details.getByRole('button', { name: 'Activate' });
	expect(await computedStyle(activate, 'background-color')).toBe(await resolveColor(page, ACTION_COLORS.primary.background));
	await activate.click();
	await expect(details.getByRole('button', { name: 'Deactivate' })).toBeFocused();
	await expect(details.getByText('Active', { exact: true })).toBeVisible();
	await expect(characters.activeSwitch(MIRA.name)).toBeChecked();
	expect((await characterCollection(backend)).active_id).toBe(MIRA.id);
	const toast = characters.toast(`${MIRA.name} is active for generation.`);
	await expect(toast).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'mira-activated-toast');

	// One click to Create, where the generation panel shows her.
	await toast.getByRole('button', { name: 'Go to Create' }).click();
	await expect(app.section('create')).toBeVisible();
	await expect(characters.generationSection().getByText(MIRA.name, { exact: true })).toBeVisible();
	await expect(app.commandBar()).toContainText(MIRA.name);
});

test('the search filters the gallery by name and tags', async ({ app, page }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	// From the keyboard: Ctrl+4 shows the section, Ctrl+F focuses its search.
	await page.keyboard.press('Control+4');
	await expect(characters.section()).toBeVisible();
	await page.keyboard.press('Control+f');
	await expect(characters.search()).toBeFocused();
	const cards = characters.gallery().getByRole('list', { name: 'Characters' }).getByRole('listitem');

	await page.keyboard.type('red hair');
	await expect(characters.search()).toHaveValue('red hair');
	await expect(cards).toHaveCount(1);
	await expect(characters.card(MIRA.name)).toBeVisible();
	await expect(characters.count()).toHaveText('1 of 3 characters');

	// Several comma-separated terms must all match (outfit tags included).
	await characters.search().fill('1girl');
	await expect(cards).toHaveCount(2);
	await characters.search().fill('1girl, space suit');
	await expect(cards).toHaveCount(1);
	await expect(characters.card(NOVA.name)).toBeVisible();
	await characters.search().fill('knight');
	await expect(characters.card(BRAM.name)).toBeVisible();

	await characters.search().fill('dragon');
	await expect(characters.gallery().getByText('No character matches “dragon”')).toBeVisible();
	await expect(characters.count()).toHaveText('0 of 3 characters');
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'no-match');
	await characters.gallery().getByRole('button', { name: 'Clear search' }).click();
	await expect(characters.search()).toHaveValue('');
	await expect(cards).toHaveCount(3);
});

test('one character is active at a time, from the cards and from the generation panel', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();

	await characters.toggleActive(MIRA.name, true);
	await expect(characters.toast(`${MIRA.name} is active for generation.`)).toBeVisible();
	expect((await characterCollection(backend)).active_id).toBe(MIRA.id);
	// The active card carries an 'Active' badge on its picture (and its switch is on).
	await expect(characters.card(MIRA.name).getByText('Active', { exact: true }).first()).toBeVisible();
	await expect(characters.card(NOVA.name).locator('.fui-Badge')).toHaveCount(0);
	await assertAppVisible(page, { allowOverlays: true });

	await characters.toggleActive(NOVA.name, true);
	await expect(characters.activeSwitch(MIRA.name)).not.toBeChecked();
	expect((await characterCollection(backend)).active_id).toBe(NOVA.id);

	await characters.toggleActive(NOVA.name, false);
	expect((await characterCollection(backend)).active_id).toBeNull();
	for (const name of FIXTURE_CHARACTER_NAMES) {
		await expect(characters.activeSwitch(name)).not.toBeChecked();
	}

	// The generation panel: pick one in the dropdown, then Deactivate.
	await app.goTo('create');
	const section = characters.generationSection();
	await section.getByRole('combobox', { name: 'Active character' }).click();
	await page.getByRole('option', { name: BRAM.name, exact: true }).click();
	await expect(section.getByRole('button', { name: 'Deactivate' })).toBeVisible();
	await expect(section.getByText(BRAM.name, { exact: true })).toBeVisible();
	await expect(section.getByText('No reference images: add some with Edit for a stronger likeness.')).toBeVisible();
	expect((await characterCollection(backend)).active_id).toBe(BRAM.id);
	// Activated in Create: nothing to go to.
	await expect(characters.toast(`${BRAM.name} is active for generation.`).getByRole('button', { name: 'Go to Create' })).toHaveCount(0);
	await app.parkPointer();
	await saveScreenshot(app.createRegion('generation'), testInfo, 'generation-bram-active');

	await section.getByRole('button', { name: 'Deactivate' }).click();
	await expect(section.getByRole('combobox', { name: 'Active character' })).toBeVisible();
	expect((await characterCollection(backend)).active_id).toBeNull();
	await characters.open();
	await expect(characters.activeSwitch(BRAM.name)).not.toBeChecked();
});

test('the cards work with the keyboard, with a visible focus', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();
	await characters.newCharacter().focus();

	// New character -> Bram's picture (selects) -> Active switch -> Edit -> Delete, then the next card.
	await page.keyboard.press('Tab');
	await expect(characters.selectButton(BRAM.name)).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(characters.detailsOf(BRAM.name)).toBeVisible();
	await expect(characters.selectButton(BRAM.name)).toHaveAttribute('aria-current', 'true');
	await saveScreenshot(characters.card(BRAM.name), testInfo, 'focused-picture');
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
	// The focus ring is drawn around the button: compare the focused card with its unfocused look.
	await saveScreenshot(characters.card(BRAM.name), testInfo, 'focused-delete');

	await page.keyboard.press('Enter');
	const dialog = page.getByRole('alertdialog', { name: `Delete character '${BRAM.name}'?` });
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(remove).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(characters.selectButton(MIRA.name)).toBeFocused();
	await assertAppVisible(page, { allowOverlays: true });
});

test.describe('at 1280 x 720 with the navigation rail', () => {
	test.use({ viewport: SMALL_VIEWPORT });

	test('the gallery and the detail panel sit side by side; the editor fits with its actions in view', async ({ app, page }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		const section = await characters.open();
		await assertAppVisible(page);
		await expectOnTop(characters.newCharacter());
		await expectOnTop(characters.search());

		// Docked: the rail, then the gallery, then the detail panel, without overlap.
		const [rail, gallery, details] = [await boxOf(app.navigation()), await boxOf(characters.gallery()), await boxOf(characters.details())];
		expect(gallery.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1);
		expect(details.x).toBeGreaterThanOrEqual(gallery.x + gallery.width - 1);
		expect(details.x + details.width).toBeLessThanOrEqual(SMALL_VIEWPORT.width + 1);
		expect(details.width).toBeGreaterThanOrEqual(360);

		// Cards side by side, with one-line footers.
		const firstRow = [BRAM.name, MIRA.name];
		const [left, right] = [await boxOf(characters.card(firstRow[0])), await boxOf(characters.card(firstRow[1]))];
		expect(left.y, 'two cards side by side').toBe(right.y);
		for (const name of firstRow) {
			const switchY = await centerY(characters.activeSwitch(name));
			expect(Math.abs((await centerY(characters.card(name).getByRole('button', { name: `Delete ${name}` }))) - switchY)).toBeLessThanOrEqual(2);
		}
		await expectNoHorizontalOverflow(section);
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'small-gallery');

		await characters.newCharacter().click();
		const editor = characters.editor('New character');
		await expect(editor).toBeVisible();
		await expect(editor.getByRole('textbox', { name: /^Name/ })).toBeFocused();
		// The actions stay reachable at the bottom of the panel while the long form scrolls.
		await expectInside(characters.editorActions(), characters.details(), 'editor actions in the detail panel');
		await expectOnTop(editor.getByRole('button', { name: 'Save' }));
		await expectOnTop(editor.getByRole('button', { name: 'Cancel' }));
		await expectNoHorizontalOverflow(characters.details());
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'small-editor');
	});
});

test.describe('without characters', () => {
	test.use({ e2eOptions: { remove: ['characters'] } });

	test('the empty gallery explains the three ways to create one, each one click away', async ({ app, page }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		await app.goTo('create');
		const picker = characters.generationSection().getByRole('combobox', { name: 'Active character' });
		await expect(picker).toBeDisabled();
		await expect(picker).toContainText('No characters yet');

		await characters.open();
		await assertAppVisible(page);
		const gallery = characters.gallery();
		await expect(gallery.getByText('No characters yet')).toBeVisible();
		const ways = gallery.getByRole('list', { name: 'Ways to create a character' }).getByRole('listitem');
		await expect(ways).toHaveCount(3);
		await expect(ways.getByRole('button')).toHaveText(['New character', 'Go to Create', 'Browse images']);
		await expect(gallery.getByRole('list', { name: 'Characters' })).toHaveCount(0);
		await expect(characters.count()).toHaveText('0 characters');
		await expect(characters.details().getByText('No character yet')).toBeVisible();
		for (const button of await ways.getByRole('button').all()) {
			await expectOnTop(button);
		}
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'empty-gallery');
		await expectBaseline(gallery, 'gallery-empty.png');

		await ways.getByRole('button', { name: 'Go to Create' }).click();
		await expect(app.section('create')).toBeVisible();
		await characters.open();
		await ways.getByRole('button', { name: 'Browse images' }).click();
		await expect(app.section('images')).toBeVisible();
		await characters.open();
		await ways.getByRole('button', { name: 'New character' }).click();
		await expect(characters.editor('New character').getByRole('textbox', { name: /^Name/ })).toBeFocused();
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
	await characters.open();

	const error = characters.gallery().getByText('Could not load the characters');
	await expect(error).toBeVisible();
	await expect(characters.gallery().getByText('The characters file is locked.')).toBeVisible();
	// Nothing is counted or said about a collection that is not known.
	await expect(characters.count()).toHaveText('');
	await expect(characters.details().getByText('No character yet')).toHaveCount(0);
	await assertAppVisible(page);
	await dismissNotifications(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'load-error');

	await page.unroute(isCharacterList);
	await characters.gallery().getByRole('button', { name: 'Retry' }).click();
	await expect(error).toBeHidden();
	await expect(characters.card(MIRA.name)).toBeVisible();
	await expect(characters.count()).toHaveText('3 characters');
});
