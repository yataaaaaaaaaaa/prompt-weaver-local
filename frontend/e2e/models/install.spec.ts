// Model library installs in the real browser, on the synthetic Civitai (paced downloads of 6 x 1 MiB): 'Download and
// use' with its progress and Cancel, then the LoRA / checkpoint selected for generation (read in the Generation
// pane), a stalled download cancelled, a failed download (SHA-256 mismatch) retried or dismissed, downloads resumed
// after a reload (on their card, or in the Downloads section when no card shows them), and an embedding with its
// prompt token.
import { expectBaseline } from '../support/baselines';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { dismissNotifications, notifications } from '../support/app';
import { expectReadable } from '../support/colors';
import { MODEL_LIBRARY, selectedCheckpoint, selectedLoras } from './libraries';
import { expectPreviewFillsCard, installProgress, openModelLibrary, resultCard, searchFor, statusBadge } from './modelLibrary';

test.describe('a paced download', () => {
	test.use({ e2eOptions: { network: { chunk_delay_ms: 400 } } });

	test("'Download and use' shows the progress with Cancel, then selects the LoRA at the default weight", async ({ app, page }, testInfo) => {
		const pane = await openModelLibrary(app);
		const card = resultCard(pane, 'Pixel Forge Style');
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
		await app.parkPointer();
		await saveScreenshot(card, testInfo, 'downloading');

		// Done: registered, selected for generation, announced.
		await expect(statusBadge(card, 'Selected')).toBeVisible({ timeout: 20_000 });
		await expect(progress).toBeHidden();
		await expect(card.getByRole('button', { name: 'Use', exact: true })).toBeVisible();
		await expect(notifications(page)).toContainText(/Pixel Forge Style.* is ready and selected for generation\./);
		await expect.poll(() => selectedLoras(app)).toMatchObject({ 'Pixel Forge Style - v2.0': '1' });
		await saveScreenshot(card, testInfo, 'installed');
	});
});

test('a checkpoint downloads and becomes the selected model', async ({ app, page }) => {
	const pane = await openModelLibrary(app);
	await expect(selectedCheckpoint(app)).toHaveText('studio_xl_local.safetensors');
	const card = resultCard(pane, 'Aurora XL');
	await card.getByRole('button', { name: 'Download and use' }).click();
	await expect(statusBadge(card, 'Selected')).toBeVisible({ timeout: 20_000 });
	await expect(selectedCheckpoint(app)).toHaveText('Aurora XL - v4.0');
	await expect(notifications(page)).toContainText('Aurora XL - v4.0 is ready and selected for generation.');
});

test("'Use' adds a file found on disk to the library and selects it", async ({ app, page }) => {
	const pane = await openModelLibrary(app);
	const card = resultCard(pane, 'Neon Rim Light');
	await expect(statusBadge(card, 'On disk')).toBeVisible();
	await card.getByRole('button', { name: 'Use', exact: true }).click();
	await expect(statusBadge(card, 'Selected')).toBeVisible();
	await expect(notifications(page)).toContainText(/Neon Rim Light.* is ready and selected for generation\./);
	await expect.poll(() => selectedLoras(app)).toMatchObject({ 'Neon Rim Light - v3': '1' });
});

test.describe('a stalled download', () => {
	test.use({ e2eOptions: { network: { stall_at_percent: 50 } } });

	test('shows its progress up to the stall, and Cancel brings the initial action back', async ({ app, page }, testInfo) => {
		const pane = await openModelLibrary(app);
		const card = resultCard(pane, 'Aurora XL');
		await card.getByRole('button', { name: 'Download and use' }).click();
		await expect(card.getByText('3.0 MB of 6.0 MB')).toBeVisible();
		await expect(installProgress(card)).toHaveAttribute('aria-valuenow', '0.5');
		await app.parkPointer();
		await saveScreenshot(card, testInfo, 'stalled');
		await expectBaseline(card, 'downloading-card.png', { mask: [card.getByText(/ of 6\.0 MB$/)] });

		await card.getByRole('button', { name: 'Cancel' }).click();
		await expect(card.getByRole('button', { name: 'Download and use' })).toBeEnabled();
		await expect(installProgress(card)).toBeHidden();
		await expect(statusBadge(card, 'Downloading')).toHaveCount(0);
		await expect(selectedCheckpoint(app)).toHaveText('studio_xl_local.safetensors');
		await assertAppVisible(page);
	});

	test('downloads running before a reload are followed again, on their card or in the Downloads section', async ({ app, backend, page }, testInfo) => {
		// Pixel Forge v2.0 (the version its card shows) and v1.0 (shown by no card: the Downloads section).
		await backend.post('/api/models/install', { provider: 'civitai', version_id: '920001' });
		await backend.post('/api/models/install', { provider: 'civitai', version_id: '920002' });
		const pane = await openModelLibrary(app);

		const card = resultCard(pane, 'Pixel Forge Style');
		await expect(statusBadge(card, 'Downloading')).toBeVisible();
		await expect(card.getByText('3.0 MB of 6.0 MB')).toBeVisible();

		const downloads = pane.getByRole('list', { name: 'Downloads' });
		await expect(downloads.getByRole('listitem')).toHaveCount(1);
		const detached = downloads.getByRole('listitem', { name: 'Pixel Forge Style - v1.0' });
		await expect(detached.getByText('3.0 MB of 6.0 MB')).toBeVisible();
		await expect(installProgress(detached)).toBeVisible();
		await expectReadable(detached.getByText('Pixel Forge Style - v1.0'));
		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'downloads-section');

		// Picking v1.0 on the card moves that download onto the card, and v2.0 into the Downloads section.
		await card.getByRole('combobox', { name: 'Version' }).click();
		await page.getByRole('option', { name: 'v1.0', exact: true }).click();
		await expect(downloads.getByRole('listitem', { name: 'Pixel Forge Style - v2.0' })).toBeVisible();

		await downloads.getByRole('button', { name: 'Cancel' }).click();
		await expect(pane.getByRole('heading', { name: 'Downloads' })).toBeHidden();
		await card.getByRole('button', { name: 'Cancel' }).click();
		await expect(card.getByRole('button', { name: 'Download and use' })).toBeEnabled();
	});
});

test.describe('a download that fails its verification', () => {
	test.use({ e2eOptions: { network: { chunk_delay_ms: 50, corrupt_downloads: 1 } } });

	test('shows Failed with the reason; Retry downloads it again and installs it', async ({ app, page }, testInfo) => {
		const pane = await openModelLibrary(app);
		const card = resultCard(pane, 'Pixel Forge Style');
		await card.getByRole('button', { name: 'Download and use' }).click();

		await expect(statusBadge(card, 'Failed')).toBeVisible({ timeout: 20_000 });
		await expect(card.getByText('Install failed')).toBeVisible();
		await expect(card.getByText(/SHA-256 mismatch/)).toBeVisible();
		await expect(notifications(page)).toContainText(/SHA-256 mismatch/);
		await expectReadable(card.getByText(/SHA-256 mismatch/));
		await dismissNotifications(page);
		// The card grew with the error: its preview still fills it.
		await expectPreviewFillsCard(card);
		await app.parkPointer();
		await saveScreenshot(card, testInfo, 'failed');

		await card.getByRole('button', { name: 'Retry' }).click();
		await expect(statusBadge(card, 'Selected')).toBeVisible({ timeout: 20_000 });
		await expect(card.getByText('Install failed')).toBeHidden();
		await expect.poll(() => selectedLoras(app)).toMatchObject({ 'Pixel Forge Style - v2.0': '1' });
	});

	test('Dismiss clears the failure and brings the initial action back', async ({ app, page }) => {
		const pane = await openModelLibrary(app);
		const card = resultCard(pane, 'Moonlit Night');
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
	const pane = await openModelLibrary(app);
	const card = resultCard(pane, 'Easy Negative Lite');
	await card.getByRole('button', { name: 'Download and use' }).click();
	await expect(notifications(page)).toContainText('write embedding:easy_negative_lite in a prompt to use it', { timeout: 20_000 });
	await dismissNotifications(page);

	// The embedding is on disk now (it has no library entry): its card says so at once, with 'Use' and 'Copy prompt
	// token', and a new search agrees.
	await expect(statusBadge(card, 'On disk')).toBeVisible();
	await expect(card.getByRole('button', { name: 'Download and use' })).toHaveCount(0);
	await searchFor(pane, 'negative', ['Easy Negative Lite']);
	await expect(statusBadge(card, 'On disk')).toBeVisible();
	await card.getByRole('button', { name: 'Copy prompt token' }).click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('embedding:easy_negative_lite');
	await expect(notifications(page)).toBeVisible();
	await saveScreenshot(card, testInfo, 'embedding');
});

test.describe('a backend without any running download', () => {
	test('the Downloads section is hidden', async ({ app }) => {
		await app.open();
		const pane = await app.showPane(MODEL_LIBRARY);
		await expect(resultCard(pane, 'Aurora XL')).toBeVisible();
		await expect(pane.getByRole('heading', { name: 'Downloads' })).toHaveCount(0);
	});
});
