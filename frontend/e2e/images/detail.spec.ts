// The Images section's detail panel in the real browser, on the synthetic Civitai: opening an image next to the grid
// and closing it (Close, Escape) with the focus back on its thumbnail, the facts and generation parameters (em dashes
// for missing values), the status of each LoRA and checkpoint, 'Use these LoRAs' (exact selection with the image's
// weights, downloading what is missing) and 'Use this checkpoint' announced with 'Go to Create' (which shows the result
// in Create), favorites, Copy prompt and Create character.
import { expectBaseline } from '../support/baselines';
import { dismissNotifications, expectPicturesLoaded, notifications, toast, waitForPicturesInView } from '../support/app';
import { expectReadable } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { goToCreateFrom } from '../support/flows';
import { checkpointPicker, selectedLoras } from '../models/libraries';
import { installProgress, statusBadge } from '../models/modelLibrary';
import {
	AUTHOR,
	closeButton,
	detailSection,
	imageDetail,
	loraRow,
	openImage,
	openImages,
	parameter,
	searchResults,
	thumbnail,
	WATERCOLOR_PROMPT,
} from './imageLibrary';

test('opens an image next to the grid and closes it with Close or Escape, the focus returning to its thumbnail', async ({ app, page }, testInfo) => {
	const section = await openImages(app);
	const detail = await openImage(section, AUTHOR.watercolor);
	await expect(detail.getByRole('heading', { name: `Image by ${AUTHOR.watercolor}`, level: 2 })).toBeFocused();
	// The grid stays next to the detail panel.
	await expect(searchResults(section)).toBeVisible();
	await expectOnTop(thumbnail(searchResults(section), AUTHOR.pixelForge));
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'grid-and-detail');

	await page.keyboard.press('Escape');
	await expect(thumbnail(searchResults(section), AUTHOR.watercolor)).toBeFocused();
	await expect(detail.getByRole('heading', { name: 'Pick an image to see its tags, LoRAs and checkpoint' })).toBeVisible();

	await openImage(section, AUTHOR.pixelForge);
	// Another image replaces the shown one at once.
	const replaced = await openImage(section, AUTHOR.noMeta);
	await expect(replaced.getByRole('heading', { name: `Image by ${AUTHOR.noMeta}`, level: 2 })).toBeFocused();
	await closeButton(replaced).click();
	await expect(thumbnail(searchResults(section), AUTHOR.noMeta)).toBeFocused();
});

test('shows the facts, tags, LoRAs, checkpoint and generation parameters of an image', async ({ app, page }, testInfo) => {
	const section = await openImages(app);
	const detail = await openImage(section, AUTHOR.watercolor);

	await expect(detail.getByRole('img', { name: `Image by ${AUTHOR.watercolor}` })).toBeVisible();
	await expectPicturesLoaded(detail);
	await expect(detail.getByText(`by ${AUTHOR.watercolor}`, { exact: true })).toBeVisible();
	await expect(detail.getByText('SD 1.5', { exact: true })).toBeVisible();
	await expect(detail.getByRole('link', { name: /Open on civitai\.com/ })).toHaveAttribute('href', 'https://civitai.com/images/950002');

	await expect(detailSection(detail, 'Tags').getByRole('toolbar', { name: 'Tags' }).getByRole('button')).toHaveText(['watercolor', 'harbor town', 'boats', 'soft light']);

	const watercolor = loraRow(detail, 'Watercolor Wash');
	await expect(watercolor.getByText('Weight 0.65')).toBeVisible();
	await expect(statusBadge(watercolor, 'In library')).toBeVisible();
	const neon = loraRow(detail, 'Neon Rim Light');
	await expect(neon.getByText('Weight 1.2')).toBeVisible();
	await expect(statusBadge(neon, 'On disk')).toBeVisible();
	const checkpoint = detailSection(detail, 'Checkpoint');
	await expect(checkpoint.getByRole('link', { name: 'Dreamline 1.5 - v7' })).toBeVisible();
	await expect(statusBadge(checkpoint, 'In library')).toBeVisible();
	await expect(checkpoint.getByRole('button', { name: 'Use this checkpoint' })).toBeEnabled();

	for (const [label, value] of [
		['Prompt', WATERCOLOR_PROMPT],
		['Negative prompt', 'lowres, blurry, watermark'],
		['Sampler', 'DPM++ 2M Karras'],
		['Steps', '24'],
		['CFG scale', '7'],
		['Seed', '98765'],
		['Size', '512 × 768'],
		['Clip skip', '2'],
	]) {
		await expect(parameter(detail, label)).toHaveText(value);
	}
	await expectReadable(detail.locator('.fui-Badge'));
	await expectReadable(detailSection(detail, 'Generation parameters').locator('span'));

	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'detail');
	await expectBaseline(detail, 'image-detail.png');
	await detailSection(detail, 'Generation parameters').scrollIntoViewIfNeeded();
	await saveScreenshot(detail, testInfo, 'detail-parameters');
});

test('missing values show an em dash, and an image without generation data says so', async ({ app }, testInfo) => {
	const section = await openImages(app);
	const detail = await openImage(section, AUTHOR.pixelForge);
	await expect(parameter(detail, 'Clip skip')).toHaveText('—');
	await expect(parameter(detail, 'Sampler')).toHaveText('Euler a');

	await openImage(section, AUTHOR.noMeta);
	await expect(detail.getByText('This image publishes no generation data.')).toBeVisible();
	await expect(detail.getByText('This image publishes no prompt tags.')).toBeVisible();
	await expect(detail.getByText('This image publishes no LoRAs.')).toBeVisible();
	await expect(detail.getByText('This image publishes no checkpoint.')).toBeVisible();
	await expect(detail.getByRole('button', { name: 'Use these LoRAs' })).toBeDisabled();
	await expect(detail.getByRole('button', { name: 'Copy prompt' })).toBeDisabled();
	await expect(detail.getByRole('button', { name: 'Add to category' })).toBeDisabled();
	await expectReadable(detail.getByText(/^This image publishes no /));
	await app.parkPointer();
	await saveScreenshot(detail, testInfo, 'no-generation-data');
});

test('each LoRA and checkpoint shows whether it is local, downloadable or not identified', async ({ app, page }, testInfo) => {
	const section = await openImages(app);

	const detail = await openImage(section, AUTHOR.pixelForge);
	const pixel = loraRow(detail, 'Pixel Forge Style');
	await expect(pixel.getByText('Weight 0.8')).toBeVisible();
	await expect(statusBadge(pixel, 'Available to download')).toBeVisible();
	await expect(statusBadge(detailSection(detail, 'Checkpoint'), 'Available to download')).toBeVisible();
	await expectReadable(detail.locator('.fui-Badge'));
	await detailSection(detail, 'LoRAs').scrollIntoViewIfNeeded();
	await app.parkPointer();
	await saveScreenshot(detail, testInfo, 'available-to-download');

	await openImage(section, AUTHOR.mystery);
	const mystery = loraRow(detail, 'mystery_detail');
	await expect(mystery.getByText('Weight 0.5')).toBeVisible();
	const notIdentified = statusBadge(mystery, 'Not identified');
	await expect(notIdentified).toBeVisible();
	await expectReadable(notIdentified);
	// The reason is a tooltip, reachable with the keyboard.
	await notIdentified.focus();
	await expect(page.getByRole('tooltip')).toBeVisible();
	await expectOnTop(page.getByRole('tooltip'));
	await saveScreenshot(page, testInfo, 'not-identified-tooltip');
	// Escape closes the tooltip first, the detail panel stays.
	await page.keyboard.press('Escape');
	await expect(page.getByRole('tooltip')).toHaveCount(0);
	await expect(detail.getByRole('heading', { name: `Image by ${AUTHOR.mystery}`, level: 2 })).toBeVisible();
	const checkpoint = detailSection(detail, 'Checkpoint');
	await expect(statusBadge(checkpoint, 'Not identified')).toBeVisible();
	await expect(checkpoint.getByRole('button', { name: 'Use this checkpoint' })).toBeDisabled();
});

test("'Use these LoRAs' selects exactly the image's LoRAs with its weights; Go to Create shows them", async ({ app, page }, testInfo) => {
	await app.open();
	await expect.poll(() => selectedLoras(app)).toEqual({ 'Watercolor Wash v1.2': '0.65', 'local_detail_tweaker.safetensors': '-0.5' });
	const section = await app.goTo('images');
	await expect(searchResults(section).getByRole('button').first()).toBeVisible();
	const detail = await openImage(section, AUTHOR.watercolor);
	await detail.getByRole('button', { name: 'Use these LoRAs' }).click();
	const announcement = toast(page, 'LoRAs selected for generation');
	await expect(announcement).toBeVisible();
	await expect(announcement.getByRole('button', { name: 'Go to Create' })).toBeVisible();
	// Nothing navigates by itself.
	await expect(section).toBeVisible();
	// Neon Rim Light was only on disk: it joined the library.
	await expect(statusBadge(loraRow(detail, 'Neon Rim Light'), 'In library')).toBeVisible();
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'hand-off-toast');

	await goToCreateFrom(app, 'LoRAs selected for generation');
	// The other LoRA left the selection; the image's weights are set.
	await expect.poll(() => selectedLoras(app)).toEqual({ 'Watercolor Wash v1.2': '0.65', 'Neon Rim Light - v3': '1.2' });
	await expect(app.commandBar()).toBeVisible();
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'create-with-the-loras');
});

test.describe('with a paced download', () => {
	test.use({ e2eOptions: { network: { chunk_delay_ms: 300 } } });

	test("'Use these LoRAs' downloads a missing LoRA first, with its progress, then selects it", async ({ app, page }, testInfo) => {
		const section = await openImages(app);
		const detail = await openImage(section, AUTHOR.pixelForge);
		await detail.getByRole('button', { name: 'Use these LoRAs' }).click();
		const row = loraRow(detail, 'Pixel Forge Style');
		await expect(statusBadge(row, 'Downloading')).toBeVisible();
		await expect(installProgress(row)).toBeVisible();
		await expect(row.getByRole('button', { name: 'Cancel' })).toBeEnabled();
		await expect(detail.getByRole('button', { name: 'Use these LoRAs' })).toBeDisabled();
		// Visible from anywhere: the Models rail item counts the download.
		await expect(app.navItem('models').locator('.fui-CounterBadge')).toHaveText('1');
		await app.parkPointer();
		await saveScreenshot(detailSection(detail, 'LoRAs'), testInfo, 'downloading-lora');

		await expect(statusBadge(row, 'In library')).toBeVisible({ timeout: 20_000 });
		await expect(toast(page, 'LoRAs selected for generation')).toBeVisible();
		await expect.poll(() => selectedLoras(app)).toEqual({ 'Pixel Forge Style - v2.0': '0.8' });
	});

	test("'Use this checkpoint' downloads a missing checkpoint and makes it the current model", async ({ app, page }) => {
		const section = await openImages(app);
		const detail = await openImage(section, AUTHOR.pixelForge);
		const checkpoint = detailSection(detail, 'Checkpoint');
		await checkpoint.getByRole('button', { name: 'Use this checkpoint' }).click();
		await expect(installProgress(checkpoint)).toBeVisible();
		await expect(statusBadge(checkpoint, 'In library')).toBeVisible({ timeout: 20_000 });
		await goToCreateFrom(app, 'Aurora XL - v4.0 is ready and selected for generation.');
		await expect(app.commandBar()).toContainText('Aurora XL - v4.0');
		await expect(await checkpointPicker(app)).toHaveText('Aurora XL - v4.0');
		await assertAppVisible(page);
	});
});

test("'Use this checkpoint' selects a checkpoint of the library; Go to Create shows it", async ({ app, page }) => {
	await app.open();
	await expect(await checkpointPicker(app)).toHaveText('studio_xl_local.safetensors');
	const section = await app.goTo('images');
	await expect(searchResults(section).getByRole('button').first()).toBeVisible();
	const detail = await openImage(section, AUTHOR.watercolor);
	await detailSection(detail, 'Checkpoint').getByRole('button', { name: 'Use this checkpoint' }).click();
	await expect(notifications(page)).toContainText('Dreamline 1.5 - v7 is selected for generation.');
	await goToCreateFrom(app, 'Dreamline 1.5 - v7 is selected for generation.');
	await expect(app.commandBar()).toContainText('Dreamline 1.5 v7');
	await expect(await checkpointPicker(app)).toHaveText('Dreamline 1.5 v7');
});

test('Favorite keeps an image in the Favorites view until it is removed', async ({ app }, testInfo) => {
	const section = await openImages(app);
	const detail = await openImage(section, AUTHOR.watercolor);
	const favorite = detail.getByRole('button', { name: 'Favorite' });
	await expect(favorite).toHaveAttribute('aria-pressed', 'false');
	await favorite.click();
	await expect(favorite).toHaveAttribute('aria-pressed', 'true');

	await section.getByRole('tab', { name: 'Favorites' }).click();
	const favorites = section.getByRole('list', { name: 'Favorites' });
	await expect(favorites.getByRole('button')).toHaveCount(1);
	await expect(thumbnail(favorites, AUTHOR.watercolor)).toBeVisible();
	// The image stays shown next to the favorites, marked in their grid.
	await expect(thumbnail(favorites, AUTHOR.watercolor)).toHaveAttribute('aria-current', 'true');
	await waitForPicturesInView(section.page());
	await app.parkPointer();
	await saveScreenshot(section, testInfo, 'favorites');

	await favorite.click();
	await expect(favorite).toHaveAttribute('aria-pressed', 'false');
	await expect(section.getByText('No favorites yet. Open an image and select Favorite to keep it here.')).toBeVisible();
	// No longer listed in the shown grid: Close sends the focus to the results.
	await closeButton(detail).click();
	await expect(section.getByRole('region', { name: 'Favorite images' })).toBeFocused();
});

test('Copy prompt copies the published prompt', async ({ app, page, context }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const section = await openImages(app);
	const detail = await openImage(section, AUTHOR.watercolor);
	await detail.getByRole('button', { name: 'Copy prompt' }).click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(WATERCOLOR_PROMPT);
	await expect(notifications(page)).toBeVisible();
	await dismissNotifications(page);
});

test("'Create character' opens the Characters section", async ({ app, page }) => {
	const section = await openImages(app);
	const detail = await openImage(section, AUTHOR.watercolor);
	await detail.getByRole('button', { name: 'Create character' }).click();
	await expect(app.section('characters')).toBeVisible();
	await expect(section).toBeHidden();
	await assertAppVisible(page, { allowOverlays: true });
});
