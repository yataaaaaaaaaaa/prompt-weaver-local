// The app bar in the real browser: one row at every supported width (the title hides first, then labels collapse to
// icon-only items that keep their names and tooltips), every pane toggle reachable and working, Undo's disabled
// state, baselines.
import type { Page } from '@playwright/test';
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectOnTop } from '../support/visibility';
import { expectOneRow, PANE_TITLES, windowHandles } from './workspace';

const COMMANDS = ['Add category', 'Reorganize categories', 'Showing: All windows', 'Undo'] as const;

/** The default Electron window (electron/main.cjs: 1680 x 1020) minus its frame. */
const DESKTOP_WINDOW_VIEWPORT = { width: 1664, height: 960 } as const;

/** The app bar (the page's banner: the window headers are not landmarks). */
const appBarHeader = (page: Page) => page.getByRole('banner');

/** The app title heading: always there for assistive technology, visible only when everything fits. */
async function titleWidth(page: Page): Promise<number> {
	const box = await appBarHeader(page).getByRole('heading', { level: 1, name: 'Prompt Weaver' }).boundingBox();
	return box?.width ?? 0;
}

test('at 1920 x 1080 the title and every label show on one row', async ({ app, page }, testInfo) => {
	await app.open();
	await expectOneRow(app);
	expect(await titleWidth(page)).toBeGreaterThan(80);
	for (const title of PANE_TITLES) {
		await expect(app.paneToggle(title)).toHaveText(title);
	}
	for (const name of COMMANDS) {
		await expect(app.appBar().getByRole('button', { name, exact: true })).toHaveText(name);
	}
	await app.parkPointer({ blur: true });
	await saveScreenshot(appBarHeader(page), testInfo, 'app-bar');
	await expectBaseline(appBarHeader(page), 'app-bar.png');
});

test('in the default desktop window every label still shows, without the title', async ({ app, page }, testInfo) => {
	await page.setViewportSize(DESKTOP_WINDOW_VIEWPORT);
	await app.open();
	await expectOneRow(app);
	expect(await titleWidth(page)).toBeLessThanOrEqual(1);
	for (const title of PANE_TITLES) {
		await expect(app.paneToggle(title)).toHaveText(title);
	}
	for (const name of COMMANDS) {
		await expectOnTop(app.appBar().getByRole('button', { name, exact: true }));
	}
	await app.parkPointer({ blur: true });
	await saveScreenshot(appBarHeader(page), testInfo, 'app-bar-desktop-window');
	await expectBaseline(appBarHeader(page), 'app-bar-desktop-window.png');
});

test('at 1280 x 720 the app bar stays on one row and every pane toggle is reachable', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	await expectOneRow(app);
	await assertAppVisible(page);
	expect(await titleWidth(page)).toBeLessThanOrEqual(1);
	for (const name of COMMANDS) {
		await expectOnTop(app.appBar().getByRole('button', { name, exact: true }));
	}
	// Icon-only toggles keep their names (the pane titles) and say what they do in their tooltip.
	for (const title of PANE_TITLES) {
		await expectOnTop(app.paneToggle(title));
	}
	await app.paneToggle('Image library').hover();
	await expect(page.getByRole('tooltip')).toHaveText('Show the Image library pane');
	await app.parkPointer({ blur: true });
	await saveScreenshot(appBarHeader(page), testInfo, 'app-bar-1280');
	await expectBaseline(appBarHeader(page), 'app-bar-1280.png');

	// Every toggle works at this size.
	for (const title of PANE_TITLES) {
		const shown = (await app.paneToggle(title).getAttribute('aria-pressed')) === 'true';
		await app.paneToggle(title).click();
		await expect(app.pane(title)).toHaveCount(shown ? 0 : 1);
		await app.paneToggle(title).click();
		await expect(app.pane(title)).toHaveCount(shown ? 1 : 0);
	}

	// A longer label (visibility mode) still fits; growing the window brings the labels back.
	await app.appBar().getByRole('button', { name: 'Showing: All windows', exact: true }).click();
	await expect(app.appBar().getByRole('button', { name: 'Showing: Categories only', exact: true })).toBeVisible();
	await expectOneRow(app);
	await page.setViewportSize({ width: 1920, height: 1080 });
	await expect(app.paneToggle('Image')).toHaveText('Image');
	await expectOneRow(app);
	expect(await titleWidth(page)).toBeGreaterThan(80);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'back-to-1920');
});

test('the workspace surface scrolls to every window at 1280 x 720', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	const lowest = app.categoryWindow('Sea creatures');
	await lowest.scrollIntoViewIfNeeded();
	// Its resize grip is its bottom-right corner, the farthest point of the fixture layout.
	await expectOnTop(windowHandles(lowest, 'Sea creatures category').resize);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'scrolled-to-bottom-right');
	await expectOnTop(app.appBar());
});

test('a pane shown from the app bar at 1280 x 720 scrolls into view, even when stored beyond the window edge', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	// The fixture stores the Characters window at x = 880, 1024 px wide: most of it lies beyond the right edge.
	const characters = app.pane('Characters');
	await app.paneToggle('Characters').click();
	await expect(characters).toBeVisible();
	await app.parkPointer({ blur: true });
	const box = await boxOf(characters);
	expect(box.x, 'left edge of the revealed window').toBeGreaterThanOrEqual(0);
	expect(box.x + box.width, 'right edge of the revealed window').toBeLessThanOrEqual(SMALL_VIEWPORT.width);
	// Its header commands are reachable without scrolling.
	const close = characters.getByRole('button', { name: 'Close Characters', exact: true });
	const closeBox = await boxOf(close);
	expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(SMALL_VIEWPORT.width);
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'characters-revealed-1280');
});

test('Undo is disabled until there is something to undo', async ({ app, page }) => {
	await app.open();
	const undo = app.appBar().getByRole('button', { name: 'Undo', exact: true });
	await expect(undo).toBeDisabled();
	await expect(undo).toHaveAttribute('aria-keyshortcuts', 'Control+Z');

	// Deleting the current output (moved to the trash) can be undone, once.
	const browser = app.pane('Output browser');
	await browser.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(browser.getByText('3 / 3', { exact: true })).toBeVisible();
	await expect(undo).toBeEnabled();
	await undo.click();
	await expect(browser.getByText('4 / 4', { exact: true })).toBeVisible();
	await expect(undo).toBeDisabled();
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
});
