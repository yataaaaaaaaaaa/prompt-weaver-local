// Image library detail view in the real browser, on the synthetic Civitai: opening and leaving it (Back, Escape) with
// the focus back on the thumbnail, the facts and generation parameters (em dashes for missing values), the status of
// each LoRA and checkpoint, 'Use these LoRAs' (exact selection with the image's weights, downloading what is missing),
// 'Use this checkpoint', favorites, Copy prompt and Create character.
import { expectBaseline } from '../support/baselines';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { dismissNotifications, expectPicturesLoaded, notifications, waitForPicturesInView } from '../support/app';
import { expectReadable } from '../support/colors';
import { selectedCheckpoint, selectedLoras } from '../models/libraries';
import { installProgress, statusBadge } from '../models/modelLibrary';
import { AUTHOR, backButton, detailSection, loraRow, openImage, openImageLibrary, parameter, searchResults, thumbnail } from './imageLibrary';

test('opens an image and goes back with Back or Escape, the focus returning to its thumbnail', async ({ app, page }) => {
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.watercolor);
	await expect(backButton(pane)).toBeFocused();
	await expect(searchResults(pane)).toHaveCount(0);
	await assertAppVisible(page);

	await page.keyboard.press('Escape');
	await expect(searchResults(pane)).toBeVisible();
	await expect(thumbnail(searchResults(pane), AUTHOR.watercolor)).toBeFocused();

	await openImage(pane, AUTHOR.pixelForge);
	await backButton(pane).click();
	await expect(thumbnail(searchResults(pane), AUTHOR.pixelForge)).toBeFocused();
});

test('shows the facts, tags, LoRAs, checkpoint and generation parameters of an image', async ({ app }, testInfo) => {
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.watercolor);

	await expect(pane.getByRole('img', { name: `Image by ${AUTHOR.watercolor}` })).toBeVisible();
	await expectPicturesLoaded(pane);
	await expect(pane.getByText(`by ${AUTHOR.watercolor}`, { exact: true })).toBeVisible();
	await expect(pane.getByText('SD 1.5', { exact: true })).toBeVisible();
	await expect(pane.getByRole('link', { name: /Open on civitai\.com/ })).toHaveAttribute('href', 'https://civitai.com/images/950002');

	await expect(detailSection(pane, 'Tags').getByRole('toolbar', { name: 'Tags' }).getByRole('button')).toHaveText(['watercolor', 'harbor town', 'boats', 'soft light']);

	const watercolor = loraRow(pane, 'Watercolor Wash');
	await expect(watercolor.getByText('Weight 0.65')).toBeVisible();
	await expect(statusBadge(watercolor, 'In library')).toBeVisible();
	const neon = loraRow(pane, 'Neon Rim Light');
	await expect(neon.getByText('Weight 1.2')).toBeVisible();
	await expect(statusBadge(neon, 'On disk')).toBeVisible();
	const checkpoint = detailSection(pane, 'Checkpoint');
	await expect(checkpoint.getByRole('link', { name: 'Dreamline 1.5 - v7' })).toBeVisible();
	await expect(statusBadge(checkpoint, 'In library')).toBeVisible();
	await expect(checkpoint.getByRole('button', { name: 'Use this checkpoint' })).toBeEnabled();

	for (const [label, value] of [
		['Prompt', 'watercolor, harbor town, boats, soft light'],
		['Negative prompt', 'lowres, blurry, watermark'],
		['Sampler', 'DPM++ 2M Karras'],
		['Steps', '24'],
		['CFG scale', '7'],
		['Seed', '98765'],
		['Size', '512 × 768'],
		['Clip skip', '2'],
	]) {
		await expect(parameter(pane, label)).toHaveText(value);
	}
	await expectReadable(pane.locator('.fui-Badge'));
	await expectReadable(detailSection(pane, 'Generation parameters').locator('span'));

	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'detail');
	await expectBaseline(pane, 'image-detail.png');
	await detailSection(pane, 'Generation parameters').scrollIntoViewIfNeeded();
	await saveScreenshot(pane, testInfo, 'detail-parameters');
});

test('missing values show an em dash, and an image without generation data says so', async ({ app }, testInfo) => {
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.pixelForge);
	await expect(parameter(pane, 'Clip skip')).toHaveText('—');
	await expect(parameter(pane, 'Sampler')).toHaveText('Euler a');
	await backButton(pane).click();

	await openImage(pane, AUTHOR.noMeta);
	await expect(pane.getByText('This image publishes no generation data.')).toBeVisible();
	await expect(pane.getByText('This image publishes no prompt tags.')).toBeVisible();
	await expect(pane.getByText('This image publishes no LoRAs.')).toBeVisible();
	await expect(pane.getByText('This image publishes no checkpoint.')).toBeVisible();
	await expect(pane.getByRole('button', { name: 'Use these LoRAs' })).toBeDisabled();
	await expect(pane.getByRole('button', { name: 'Copy prompt' })).toBeDisabled();
	await expect(pane.getByRole('button', { name: 'Add to category' })).toBeDisabled();
	await expectReadable(pane.getByText(/^This image publishes no /));
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'no-generation-data');
});

test('each LoRA and checkpoint shows whether it is local, downloadable or not identified', async ({ app, page }, testInfo) => {
	const pane = await openImageLibrary(app);

	await openImage(pane, AUTHOR.pixelForge);
	const pixel = loraRow(pane, 'Pixel Forge Style');
	await expect(pixel.getByText('Weight 0.8')).toBeVisible();
	await expect(statusBadge(pixel, 'Available to download')).toBeVisible();
	await expect(statusBadge(detailSection(pane, 'Checkpoint'), 'Available to download')).toBeVisible();
	await expectReadable(pane.locator('.fui-Badge'));
	await detailSection(pane, 'LoRAs').scrollIntoViewIfNeeded();
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'available-to-download');
	await backButton(pane).click();

	await openImage(pane, AUTHOR.mystery);
	const mystery = loraRow(pane, 'mystery_detail');
	await expect(mystery.getByText('Weight 0.5')).toBeVisible();
	const notIdentified = statusBadge(mystery, 'Not identified');
	await expect(notIdentified).toBeVisible();
	await expectReadable(notIdentified);
	// The reason is a tooltip, reachable with the keyboard.
	await notIdentified.focus();
	await expect(page.getByRole('tooltip')).toBeVisible();
	await expectOnTop(page.getByRole('tooltip'));
	await saveScreenshot(page, testInfo, 'not-identified-tooltip');
	await page.keyboard.press('Escape');
	const checkpoint = detailSection(pane, 'Checkpoint');
	await expect(statusBadge(checkpoint, 'Not identified')).toBeVisible();
	await expect(checkpoint.getByRole('button', { name: 'Use this checkpoint' })).toBeDisabled();
});

test("'Use these LoRAs' selects exactly the image's LoRAs with its weights", async ({ app, page }) => {
	const pane = await openImageLibrary(app);
	await expect.poll(() => selectedLoras(app)).toEqual({ 'Watercolor Wash v1.2': '0.65', 'local_detail_tweaker.safetensors': '-0.5' });
	await openImage(pane, AUTHOR.watercolor);
	await pane.getByRole('button', { name: 'Use these LoRAs' }).click();
	await expect(notifications(page)).toContainText('LoRAs selected for generation');
	// Neon Rim Light was only on disk: it joined the library; the other LoRA left the selection.
	await expect.poll(() => selectedLoras(app)).toEqual({ 'Watercolor Wash v1.2': '0.65', 'Neon Rim Light - v3': '1.2' });
	await expect(statusBadge(loraRow(pane, 'Neon Rim Light'), 'In library')).toBeVisible();
});

test.describe('with a paced download', () => {
	test.use({ e2eOptions: { network: { chunk_delay_ms: 300 } } });

	test("'Use these LoRAs' downloads a missing LoRA first, with its progress, then selects it", async ({ app, page }, testInfo) => {
		const pane = await openImageLibrary(app);
		await openImage(pane, AUTHOR.pixelForge);
		await pane.getByRole('button', { name: 'Use these LoRAs' }).click();
		const row = loraRow(pane, 'Pixel Forge Style');
		await expect(statusBadge(row, 'Downloading')).toBeVisible();
		await expect(installProgress(row)).toBeVisible();
		await expect(row.getByRole('button', { name: 'Cancel' })).toBeEnabled();
		await expect(pane.getByRole('button', { name: 'Use these LoRAs' })).toBeDisabled();
		await app.parkPointer();
		await saveScreenshot(detailSection(pane, 'LoRAs'), testInfo, 'downloading-lora');

		await expect(statusBadge(row, 'In library')).toBeVisible({ timeout: 20_000 });
		await expect.poll(() => selectedLoras(app)).toEqual({ 'Pixel Forge Style - v2.0': '0.8' });
		await expect(notifications(page)).toContainText('LoRAs selected for generation');
	});

	test("'Use this checkpoint' downloads a missing checkpoint and selects it", async ({ app }) => {
		const pane = await openImageLibrary(app);
		await openImage(pane, AUTHOR.pixelForge);
		const checkpoint = detailSection(pane, 'Checkpoint');
		await checkpoint.getByRole('button', { name: 'Use this checkpoint' }).click();
		await expect(installProgress(checkpoint)).toBeVisible();
		await expect(selectedCheckpoint(app)).toHaveText('Aurora XL - v4.0', { timeout: 20_000 });
		await expect(statusBadge(checkpoint, 'In library')).toBeVisible();
	});
});

test("'Use this checkpoint' selects a checkpoint of the library", async ({ app, page }) => {
	const pane = await openImageLibrary(app);
	await expect(selectedCheckpoint(app)).toHaveText('studio_xl_local.safetensors');
	await openImage(pane, AUTHOR.watercolor);
	await detailSection(pane, 'Checkpoint').getByRole('button', { name: 'Use this checkpoint' }).click();
	await expect(selectedCheckpoint(app)).toHaveText('Dreamline 1.5 v7');
	await expect(notifications(page)).toContainText('Dreamline 1.5 - v7 is selected for generation.');
});

test('Favorite keeps an image in the Favorites tab until it is removed', async ({ app }, testInfo) => {
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.watercolor);
	const favorite = pane.getByRole('button', { name: 'Favorite' });
	await expect(favorite).toHaveAttribute('aria-pressed', 'false');
	await favorite.click();
	await expect(favorite).toHaveAttribute('aria-pressed', 'true');

	await pane.getByRole('tab', { name: 'Favorites' }).click();
	const favorites = pane.getByRole('list', { name: 'Favorites' });
	await expect(favorites.getByRole('button')).toHaveCount(1);
	await expect(thumbnail(favorites, AUTHOR.watercolor)).toBeVisible();
	await waitForPicturesInView(pane.page());
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'favorites');

	await thumbnail(favorites, AUTHOR.watercolor).click();
	await expect(pane.getByRole('heading', { name: `Image by ${AUTHOR.watercolor}` })).toBeVisible();
	await pane.getByRole('button', { name: 'Favorite' }).click();
	await expect(pane.getByRole('button', { name: 'Favorite' })).toHaveAttribute('aria-pressed', 'false');
	await backButton(pane).click();
	await expect(pane.getByText('No favorites yet. Open an image and select Favorite to keep it here.')).toBeVisible();
	// The image is no longer listed in the favorites: the focus goes back to the tab.
	await expect(pane.getByRole('tab', { name: 'Favorites' })).toBeFocused();
});

test('Copy prompt copies the published prompt', async ({ app, page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.watercolor);
	await pane.getByRole('button', { name: 'Copy prompt' }).click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('watercolor, harbor town, boats, soft light');
	await expect(notifications(page)).toBeVisible();
	await dismissNotifications(page);
});

test("'Create character' opens the character editor prefilled from the image", async ({ app, page }) => {
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.watercolor);
	await pane.getByRole('button', { name: 'Create character' }).click();
	const characters = app.pane('Characters');
	await expect(characters).toBeVisible();
	await expect(characters.getByRole('heading', { name: 'New character' })).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
});
