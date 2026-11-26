// Download progress is visible from anywhere: a download started outside the shown section (here through the backend
// API, like a reload picking up a running install) puts a count on the Models rail item and its progress in the rail's
// Downloads indicator while Create is shown; the indicator's popover lists it and goes to Models.
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';

// Downloads stop at half their size (3.0 MB of 6.0 MB) until cancelled: their progress stays on screen.
test.use({ e2eOptions: { network: { stall_at_percent: 50 } } });

/** Pixel Forge Style v2.0 of the synthetic catalog (a LoRA to download). */
const PIXEL_FORGE_V2 = { provider: 'civitai', version_id: '920001' };

test('a running download shows on the Models item and in the Downloads indicator, from Create', async ({ app, backend, page }, testInfo) => {
	await app.open();
	await expect(app.downloadsButton()).toHaveAttribute('aria-description', 'No downloads running');

	await backend.post('/api/models/install', PIXEL_FORGE_V2);

	const models = app.navItem('models');
	await expect(models).toHaveAttribute('aria-description', /\. 1 download running$/);
	// The name stays the section's name; the count is a badge.
	await expect(models).toHaveAccessibleName('Models');
	await expect(models.getByText('1', { exact: true })).toBeVisible();
	await expect(app.downloadsButton()).toHaveAttribute('aria-description', '1 download running');
	// The overall progress under the caption (decorative inside the button: hidden from assistive technology).
	await expect(app.downloadsButton().locator('.fui-ProgressBar')).toBeVisible();
	await expect(app.section('create')).toBeVisible();
	await app.parkPointer();
	await saveScreenshot(app.navigation(), testInfo, 'rail-downloading', { allowUniform: true });

	await app.downloadsButton().click();
	const popover = page.getByRole('dialog', { name: 'Downloads' });
	await expect(popover).toBeVisible();
	const item = popover.getByRole('listitem');
	await expect(item).toHaveCount(1);
	await expect(item.getByRole('progressbar', { name: /^Downloading Pixel Forge Style/ })).toBeVisible();
	await expect(item.getByText('3.0 MB of 6.0 MB')).toBeVisible();
	await expectOnTop(popover);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'downloads-popover');

	await popover.getByRole('button', { name: 'Show in Models', exact: true }).click();
	await expect(popover).toBeHidden();
	await expect(app.section('models')).toBeVisible();
	await expect(models).toHaveAttribute('aria-current', 'page');
});

test('the Downloads indicator says so when nothing downloads', async ({ app, page }, testInfo) => {
	await app.open();
	await app.downloadsButton().click();
	const popover = page.getByRole('dialog', { name: 'Downloads' });
	await expect(popover.getByText('No downloads running.')).toBeVisible();
	await expect(popover.getByRole('list')).toHaveCount(0);
	await saveScreenshot(popover, testInfo, 'downloads-idle');
	await page.keyboard.press('Escape');
	await expect(popover).toBeHidden();
	await expect(app.downloadsButton()).toBeFocused();
});
