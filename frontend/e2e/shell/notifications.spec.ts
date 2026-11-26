// Toasts (NotificationsHost) in the real browser, docked: at the bottom-end corner above the app (in Create, the corner
// left of the generation panel), never over the navigation rail, the Create header or the generation panel and its
// Generate button. A failed save of the Create layout shows the 'Saving failed' error toast until
// it is dismissed; a hand-off made outside Create (activating a character in the Characters section) offers
// 'Go to Create', which shows Create and closes the toast.
import { tokens } from '@fluentui/react-theme';
import { CharactersDriver, MIRA } from '../characters/characters';
import { storeFile } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { computedStyle, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectOnTop, intersects } from '../support/visibility';
import type { Locator, Page } from '@playwright/test';
import type { AppDriver } from '../support/app';

const FAILURE_DETAIL = 'The disk is full (e2e).';

/** The toast is at the bottom-end corner (in Create: left of the generation panel), on top, and covers neither the
 *  rail, nor the Create header, nor the generation panel and its Generate button. */
async function expectToastPlacement(app: AppDriver, page: Page, toast: Locator): Promise<void> {
	await expectOnTop(toast);
	const [toastBox, railBox, viewport] = [await boxOf(toast), await boxOf(app.navigation()), page.viewportSize()!];
	expect(intersects(toastBox, railBox), 'the toast covers the navigation rail').toBe(false);
	let end = viewport.width;
	if (await app.section('create').isVisible()) {
		const panel = await boxOf(app.createRegion('generation'));
		expect(intersects(toastBox, await boxOf(app.commandBar())), 'the toast covers the Create header').toBe(false);
		expect(intersects(toastBox, panel), 'the toast covers the generation panel').toBe(false);
		await expectOnTop(app.generationAction());
		end = panel.x;
	}
	expect(toastBox.x + toastBox.width, 'the toast sits at the end of the free area').toBeGreaterThan(end - 48);
	expect(toastBox.y + toastBox.height).toBeGreaterThan(viewport.height - 48);
}

test('a failed save shows the "Saving failed" toast above the app until it is dismissed', async ({ app, page, diagnostics }, testInfo) => {
	await app.open();
	// The browser logs the failed request itself.
	diagnostics.allow(/status of 500/);
	await page.route('**/api/stores/layout-store', (route) =>
		route.request().method() === 'PUT'
			? route.fulfill({
					status: 500,
					contentType: 'application/json',
					// The backend is another origin than the page (like the real backend's CORS answer).
					headers: { 'access-control-allow-origin': '*' },
					body: JSON.stringify({ detail: FAILURE_DETAIL }),
				})
			: route.fallback(),
	);

	// Change the Create layout (Ctrl+H): it cannot be saved.
	await page.keyboard.press('Control+h');

	const notifications = page.getByRole('region', { name: 'Notifications' });
	const toast = notifications.getByRole('group').filter({ hasText: 'Saving failed' });
	await expect(toast).toBeVisible();
	await expect(toast).toContainText(`Changes to 'layout-store' could not be saved: ${FAILURE_DETAIL}`);
	// The error intent shows (Fluent status danger colors), not a neutral bar.
	expect(await computedStyle(toast, 'background-color')).toBe(await resolveColor(page, tokens.colorStatusDangerBackground1));
	expect(await computedStyle(toast, 'border-top-color')).toBe(await resolveColor(page, tokens.colorStatusDangerBorder1));
	await app.parkPointer({ blur: true });
	await assertAppVisible(page, { allowOverlays: true });
	await expectToastPlacement(app, page, toast);

	// Saving again (the error repeats) keeps one toast, not a pile.
	await page.keyboard.press('Control+h');
	await expect(notifications.getByRole('group')).toHaveCount(1);
	await app.parkPointer({ blur: true });

	await saveScreenshot(page, testInfo, 'saving-failed-toast');
	await expectBaseline(toast, 'toast-error.png');

	await toast.getByRole('button', { name: 'Dismiss' }).click();
	await expect(toast).toHaveCount(0);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
});

test.describe('the widest generation panel in the smallest window', () => {
	test.use({
		e2eOptions: {
			files: storeFile(
				'layout-store',
				{ widths: { viewer: 560, generation: 640 }, collapsed: { board: false, viewer: false, generation: false }, details: { open: true, tab: 'details' } },
				0,
			),
		},
	});

	test('a toast never covers the generation panel, the rail or the header', async ({ app, page, diagnostics }, testInfo) => {
		await page.setViewportSize(SMALL_VIEWPORT);
		await app.open();
		diagnostics.allow(/status of 500/);
		await page.route('**/api/stores/layout-store', (route) =>
			route.request().method() === 'PUT'
				? route.fulfill({
						status: 500,
						contentType: 'application/json',
						headers: { 'access-control-allow-origin': '*' },
						body: JSON.stringify({ detail: FAILURE_DETAIL }),
					})
				: route.fallback(),
		);
		// Collapse the viewer (its toggle): the change cannot be saved.
		await app.regionToggle('viewer').click();
		const toast = page.getByRole('region', { name: 'Notifications' }).getByRole('group').filter({ hasText: 'Saving failed' });
		await expect(toast).toBeVisible();
		await app.parkPointer({ blur: true });
		await expectToastPlacement(app, page, toast);
		await saveScreenshot(page, testInfo, 'toast-1280x720');

		// Collapsed, the panel keeps its strip (compact Generate) clear of the toast too.
		await app.regionToggle('generation').click();
		await app.parkPointer({ blur: true });
		await expectToastPlacement(app, page, toast);
		await expectOnTop(app.generationAction());
	});
});

test("a hand-off made outside Create offers 'Go to Create', which shows Create and closes the toast", async ({ app, page }, testInfo) => {
	await app.open();
	const characters = new CharactersDriver(app);
	await characters.open();
	await characters.toggleActive(MIRA.name, true);

	const toast = characters.toast(`${MIRA.name} is active for generation.`);
	await expect(toast).toBeVisible();
	const goToCreate = toast.getByRole('button', { name: 'Go to Create', exact: true });
	await expectOnTop(goToCreate);
	await expectToastPlacement(app, page, toast);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'go-to-create-toast');

	await goToCreate.click();
	await expect(app.section('create')).toBeVisible();
	await expect(app.navItem('create')).toHaveAttribute('aria-current', 'page');
	await expect(toast).toHaveCount(0);
	await assertAppVisible(page);
});
