// The app is what the user sees: visible, in color, not covered by any overlay, at the desktop size and at the
// smallest supported size, in dark and light (projects). Regression of ead54a3: a Fluent portal mount node turned
// into an opaque full-screen overlay as soon as the first tooltip existed.
import { expectBaseline } from './support/baselines';
import { SMALL_VIEWPORT } from './support/env';
import { expect, test } from './support/fixtures';
import { saveScreenshot } from './support/screenshots';
import { assertAppVisible, expectOnTop } from './support/visibility';

test('the workspace is visible, in color, with every fixture window', async ({ app, page }, testInfo) => {
	await app.open();
	await assertAppVisible(page);
	for (const title of ['Image', 'Output browser', 'Generation', 'Used sub-prompts']) {
		await expect(app.pane(title)).toBeVisible();
	}
	for (const name of ['Subject', 'Outfit', 'Background', 'Weather effects', 'Lighting', 'Mood', 'Sea creatures']) {
		await expect(app.categoryWindow(name)).toBeVisible();
	}
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'workspace');
	await expectBaseline(page, 'workspace.png');
});

test('a tooltip does not turn its portal into a full-screen overlay', async ({ app, page }) => {
	await app.open();
	await assertAppVisible(page);
	await app.appBar().getByRole('button', { name: 'Add category' }).hover({ timeout: 5_000 });
	await expect(page.getByRole('tooltip')).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await expectOnTop(app.pane('Generation'));
});

test('the workspace stays usable at the smallest supported window size', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	await assertAppVisible(page);
	await expectOnTop(app.appBar());
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'workspace-1280x720');
	await expectBaseline(page, 'workspace-1280x720.png');
});
