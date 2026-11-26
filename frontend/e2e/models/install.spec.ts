// Models section installs in the real browser, on the synthetic Civitai (paced downloads of 6 x 1 MiB): 'Download and
// use' with its progress and Cancel on the card and in the detail panel, then the LoRA / checkpoint selected for
// generation and announced with 'Go to Create' (which shows it in Create), a stalled download cancelled, the running
// download visible from Create (the Models rail badge), a failed download (SHA-256 mismatch) retried or dismissed,
// downloads resumed after a reload (on their card, or in the Downloads area when no card shows them), and an embedding
// with its prompt token.
import { expectBaseline } from '../support/baselines';
import { dismissNotifications, notifications, toast } from '../support/app';
import { expectReadable } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { goToCreateFrom } from '../support/flows';
import { checkpointPicker, selectedLoras } from './libraries';
import { expectPreviewFillsCard, installProgress, modelDetail, openModel, openModels, resultCard, searchFor, statusBadge } from './modelLibrary';

test.describe('a paced download', () => {
	test.use({ e2eOptions: { network: { chunk_delay_ms: 400 } } });

	test("'Download and use' shows the progress with Cancel, then selects the LoRA at the default weight; Go to Create shows it", async ({ app, page }, testInfo) => {
		const section = await openModels(app);
		const card = resultCard(section, 'Pixel Forge Style');
		await card.getByRole('button', { name: 'Download and use' }).click();

		// Mid-download: the status, a determinate progress bar with the transferred size, and Cancel.
		await expect(statusBadge(card, 'Downloading')).toBeVisible();
		const progress = installProgress(card);
		await expect(progress).toBeVisible();
		await expect(card.getByText(/^\d+(\.\d)? (B|KB|MB) of 6\.0 MB$/)).toBeVisible();
		await expect.poll(async () => Number(await progress.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
		await expectOnTop(card.getByRole('button', { name: 'Cancel' }));
		await expect(card.getByRole('button', { name: 'Cancel' })).toBeEnabled();
		await expectReadable(card.getByText(/ of 6\.0 MB$/));
		// The detail panel follows the same install.
		const detail = await openModel(section, 'Pixel Forge Style');
		await expect(installProgress(detail)).toBeVisible();
		await expect(statusBadge(detail, 'Downloading')).toBeVisible();
		await app.parkPointer();
		await saveScreenshot(card, testInfo, 'downloading');
		await saveScreenshot(page, testInfo, 'downloading-section');

		// Done: registered, selected for generation, announced with the way to Create; nothing navigates by itself.
		await expect(statusBadge(card, 'Selected')).toBeVisible({ timeout: 20_000 });
		await expect(progress).toBeHidden();
		await expect(card.getByRole('button', { name: 'Use', exact: true })).toBeVisible();
		const announcement = toast(page, /Pixel Forge Style.* is ready and selected for generation\./);
		await expect(announcement).toBeVisible();
		await expect(announcement.getByRole('button', { name: 'Go to Create' })).toBeVisible();
		await expectReadable(announcement.getByRole('button', { name: 'Go to Create' }));
		await saveScreenshot(page, testInfo, 'installed-toast');
		await expect(section).toBeVisible();
		await saveScreenshot(card, testInfo, 'installed');

		await goToCreateFrom(app, /Pixel Forge Style.* is ready and selected for generation\./);
		await expect.poll(() => selectedLoras(app)).toMatchObject({ 'Pixel Forge Style - v2.0': '1' });
		await assertAppVisible(page);
	});
});

test('a checkpoint downloads and becomes the current model, shown by Create after Go to Create', async ({ app, page }, testInfo) => {
	await app.open();
	await expect(await checkpointPicker(app)).toHaveText('studio_xl_local.safetensors');
	const section = await app.goTo('models');
	const card = resultCard(section, 'Aurora XL');
	await card.getByRole('button', { name: 'Download and use' }).click();
	await expect(statusBadge(card, 'Selected')).toBeVisible({ timeout: 20_000 });

	await goToCreateFrom(app, 'Aurora XL - v4.0 is ready and selected for generation.');
	await expect(app.commandBar()).toContainText('Aurora XL - v4.0');
	await expect(await checkpointPicker(app)).toHaveText('Aurora XL - v4.0');
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'create-after-install');
});

test("'Use' adds a file found on disk to the library and selects it", async ({ app, page }) => {
	const section = await openModels(app);
	const card = resultCard(section, 'Neon Rim Light');
	await expect(statusBadge(card, 'On disk')).toBeVisible();
	await card.getByRole('button', { name: 'Use', exact: true }).click();
	await expect(statusBadge(card, 'Selected')).toBeVisible();
	await expect(notifications(page)).toContainText(/Neon Rim Light.* is ready and selected for generation\./);
	await expect.poll(() => selectedLoras(app)).toMatchObject({ 'Neon Rim Light - v3': '1' });
});

test.describe('a stalled download', () => {
	test.use({ e2eOptions: { network: { stall_at_percent: 50 } } });

	test('shows its progress up to the stall, on the card and in the detail panel, and Cancel brings the initial action back', async ({ app, page }, testInfo) => {
		const section = await openModels(app);
		const card = resultCard(section, 'Aurora XL');
		await card.getByRole('button', { name: 'Download and use' }).click();
		await expect(card.getByText('3.0 MB of 6.0 MB')).toBeVisible();
		await expect(installProgress(card)).toHaveAttribute('aria-valuenow', '0.5');
		await app.parkPointer();
		await saveScreenshot(card, testInfo, 'stalled');
		await expectBaseline(card, 'downloading-card.png', { mask: [card.getByText(/ of 6\.0 MB$/)] });

		const detail = await openModel(section, 'Aurora XL');
		await expect(detail.getByText('3.0 MB of 6.0 MB')).toBeVisible();
		await expectReadable(detail.getByText('3.0 MB of 6.0 MB'));
		await detail.getByRole('button', { name: 'Cancel' }).click();
		await expect(card.getByRole('button', { name: 'Download and use' })).toBeEnabled();
		await expect(detail.getByRole('button', { name: 'Download and use' })).toBeEnabled();
		await expect(installProgress(card)).toBeHidden();
		await expect(statusBadge(card, 'Downloading')).toHaveCount(0);
		await expect(await checkpointPicker(app)).toHaveText('studio_xl_local.safetensors');
		await assertAppVisible(page);
	});

	test('the running download stays visible from Create: the Models rail item counts it', async ({ app, page }, testInfo) => {
		const section = await openModels(app);
		await resultCard(section, 'Aurora XL').getByRole('button', { name: 'Download and use' }).click();
		await expect(resultCard(section, 'Aurora XL').getByText('3.0 MB of 6.0 MB')).toBeVisible();

		await app.goTo('create');
		const models = app.navItem('models');
		await expect(models).toHaveAccessibleDescription(/1 download running/);
		const badge = models.locator('.fui-CounterBadge');
		await expect(badge).toHaveText('1');
		// The badge lets the pointer through to its item (elementFromPoint sees the item): visible and in view.
		await expect(badge).toBeInViewport();
		await expectOnTop(models);
		await expectReadable(badge);
		await app.parkPointer();
		await saveScreenshot(app.navigation(), testInfo, 'rail-badge');
		await assertAppVisible(page);

		// Back in Models, Cancel ends it: the count goes away.
		const back = await app.goTo('models');
		await resultCard(back, 'Aurora XL').getByRole('button', { name: 'Cancel' }).click();
		await expect(badge).toHaveCount(0);
		await expect(models).not.toHaveAccessibleDescription(/download running/);
	});

	test('downloads running before a reload are followed again, on their card or in the Downloads area', async ({ app, backend, page }, testInfo) => {
		// Pixel Forge v2.0 (the version its card shows) and v1.0 (shown by no card: the Downloads area).
		await backend.post('/api/models/install', { provider: 'civitai', version_id: '920001' });
		await backend.post('/api/models/install', { provider: 'civitai', version_id: '920002' });
		const section = await openModels(app);

		const card = resultCard(section, 'Pixel Forge Style');
		await expect(statusBadge(card, 'Downloading')).toBeVisible();
		await expect(card.getByText('3.0 MB of 6.0 MB')).toBeVisible();

		const downloads = section.getByRole('list', { name: 'Downloads' });
		await expect(downloads.getByRole('listitem')).toHaveCount(1);
		const detached = downloads.getByRole('listitem', { name: 'Pixel Forge Style - v1.0' });
		await expect(detached.getByText('3.0 MB of 6.0 MB')).toBeVisible();
		await expect(installProgress(detached)).toBeVisible();
		await expectReadable(detached.getByText('Pixel Forge Style - v1.0'));
		await app.parkPointer();
		await saveScreenshot(section, testInfo, 'downloads-area');

		// Picking v1.0 in the detail panel moves that download onto the card, and v2.0 into the Downloads area.
		const detail = await openModel(section, 'Pixel Forge Style');
		await detail.getByRole('combobox', { name: 'Version' }).click();
		await page.getByRole('option', { name: 'v1.0', exact: true }).click();
		await expect(downloads.getByRole('listitem', { name: 'Pixel Forge Style - v2.0' })).toBeVisible();

		await downloads.getByRole('button', { name: 'Cancel' }).click();
		await expect(section.getByRole('heading', { name: 'Downloads' })).toBeHidden();
		await card.getByRole('button', { name: 'Cancel' }).click();
		await expect(card.getByRole('button', { name: 'Download and use' })).toBeEnabled();
	});
});

test.describe('a download that fails its verification', () => {
	test.use({ e2eOptions: { network: { chunk_delay_ms: 50, corrupt_downloads: 1 } } });

	test('shows Failed with the reason; Retry downloads it again and installs it', async ({ app, page }, testInfo) => {
		const section = await openModels(app);
		const card = resultCard(section, 'Pixel Forge Style');
		await card.getByRole('button', { name: 'Download and use' }).click();

		await expect(statusBadge(card, 'Failed')).toBeVisible({ timeout: 20_000 });
		await expect(card.getByText('Install failed')).toBeVisible();
		await expect(card.getByText(/SHA-256 mismatch/)).toBeVisible();
		await expect(notifications(page)).toContainText(/SHA-256 mismatch/);
		await expectReadable(card.getByText(/SHA-256 mismatch/));
		await dismissNotifications(page);
		// The card grew with the error: its preview still fills it.
		await expectPreviewFillsCard(card);
		// The detail panel says it too.
		const detail = await openModel(section, 'Pixel Forge Style');
		await expect(statusBadge(detail, 'Failed')).toBeVisible();
		await expect(detail.getByText(/SHA-256 mismatch/)).toBeVisible();
		await app.parkPointer();
		await saveScreenshot(card, testInfo, 'failed');
		await saveScreenshot(detail, testInfo, 'failed-detail');

		await card.getByRole('button', { name: 'Retry' }).click();
		await expect(statusBadge(card, 'Selected')).toBeVisible({ timeout: 20_000 });
		await expect(card.getByText('Install failed')).toBeHidden();
		await expect.poll(() => selectedLoras(app)).toMatchObject({ 'Pixel Forge Style - v2.0': '1' });
	});

	test('Dismiss clears the failure and brings the initial action back', async ({ app, page }) => {
		const section = await openModels(app);
		const card = resultCard(section, 'Moonlit Night');
		await card.getByRole('button', { name: 'Download and use' }).click();
		await expect(statusBadge(card, 'Failed')).toBeVisible({ timeout: 20_000 });
		await card.getByRole('button', { name: 'Dismiss' }).click();
		await expect(statusBadge(card, 'Failed')).toHaveCount(0);
		await expect(card.getByRole('button', { name: 'Download and use' })).toBeEnabled();
		await dismissNotifications(page);
	});
});

test('an embedding installs and its prompt token is copied', async ({ app, page, context }, testInfo) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	const section = await openModels(app);
	const card = resultCard(section, 'Easy Negative Lite');
	await card.getByRole('button', { name: 'Download and use' }).click();
	const announcement = toast(page, 'write embedding:easy_negative_lite in a prompt to use it');
	await expect(announcement).toBeVisible({ timeout: 20_000 });
	// Nothing was selected for generation: no hand-off.
	await expect(announcement.getByRole('button', { name: 'Go to Create' })).toHaveCount(0);
	await dismissNotifications(page);

	// The embedding is on disk now (it has no library entry): its card says so at once, with 'Use' and 'Copy prompt
	// token', and a new search agrees.
	await expect(statusBadge(card, 'On disk')).toBeVisible();
	await expect(card.getByRole('button', { name: 'Download and use' })).toHaveCount(0);
	await searchFor(section, 'negative', ['Easy Negative Lite']);
	await expect(statusBadge(card, 'On disk')).toBeVisible();
	await card.getByRole('button', { name: 'Copy prompt token' }).click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('embedding:easy_negative_lite');
	await expect(notifications(page)).toBeVisible();
	await saveScreenshot(card, testInfo, 'embedding');
});

test.describe('a backend without any running download', () => {
	test('the Downloads area is hidden', async ({ app }) => {
		const section = await openModels(app);
		await expect(resultCard(section, 'Aurora XL')).toBeVisible();
		await expect(section.getByRole('heading', { name: 'Downloads' })).toHaveCount(0);
		await expect(modelDetail(section)).toBeVisible();
	});
});
