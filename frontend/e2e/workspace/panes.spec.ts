// Pane visibility from the app bar, the windows' Close button and the visibility mode (button and Ctrl+H), in the
// real browser. Every shown pane is checked on screen (on top, not covered) and saved for inspection: PaneLayout
// (src/ui/PaneLayout.tsx) is shared by every pane.
import { FIXTURE_CATEGORIES } from '../support/backend';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { FIXTURE_HIDDEN_PANES, FIXTURE_VISIBLE_PANES, PANE_TITLES, savedWorkspace, storedWorkspace } from './workspace';

const FIXTURE_HIDDEN_PANE_IDS = ['characters', 'images', 'models'];
const sorted = (ids: string[]) => [...ids].sort();

test('the app bar has one pressed toggle per pane, and each one hides and shows its pane', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const toggles = app.appBar().locator('button[aria-pressed]');
	await expect(toggles).toHaveCount(PANE_TITLES.length);

	for (const title of FIXTURE_VISIBLE_PANES) {
		await expect(app.paneToggle(title)).toHaveAttribute('aria-pressed', 'true');
		await expect(app.pane(title)).toBeVisible();
	}
	for (const title of FIXTURE_HIDDEN_PANES) {
		await expect(app.paneToggle(title)).toHaveAttribute('aria-pressed', 'false');
		await expect(app.pane(title)).toHaveCount(0);
	}

	// Hidden panes: the toggle shows each one in front of every window (they share the categories' area).
	for (const title of FIXTURE_HIDDEN_PANES) {
		await app.paneToggle(title).click();
		await app.parkPointer({ blur: true });
		await expect(app.paneToggle(title)).toHaveAttribute('aria-pressed', 'true');
		await expectOnTop(app.pane(title));
		await app.settle();
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, `shown-${title}`);
		await app.paneToggle(title).click();
		await expect(app.pane(title)).toHaveCount(0);
	}

	// Visible panes: hide, then show again.
	const allHidden = savedWorkspace(page, (state) => state.hiddenPaneIds.length === PANE_TITLES.length);
	for (const title of FIXTURE_VISIBLE_PANES) {
		await app.paneToggle(title).click();
		await expect(app.pane(title)).toHaveCount(0);
		await expect(app.paneToggle(title)).toHaveAttribute('aria-pressed', 'false');
	}
	await allHidden;
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'every-pane-hidden');
	const fixtureVisibility = savedWorkspace(page, (state) => sorted(state.hiddenPaneIds).join() === FIXTURE_HIDDEN_PANE_IDS.join());
	for (const title of FIXTURE_VISIBLE_PANES) {
		await app.paneToggle(title).click();
		await app.parkPointer({ blur: true });
		await expectOnTop(app.pane(title));
	}
	await fixtureVisibility;
	expect(sorted((await storedWorkspace(backend)).hiddenPaneIds)).toEqual(FIXTURE_HIDDEN_PANE_IDS);
});

test('a pane closed from its window comes back from the app bar, also after a reload', async ({ app, page, backend }) => {
	await app.open();
	const generation = app.pane('Generation');
	const closed = savedWorkspace(page, (state) => state.hiddenPaneIds.includes('controls'));
	await generation.getByRole('button', { name: 'Close Generation', exact: true }).click();
	await expect(generation).toHaveCount(0);
	await expect(app.paneToggle('Generation')).toHaveAttribute('aria-pressed', 'false');
	await closed;
	expect((await storedWorkspace(backend)).hiddenPaneIds).toContain('controls');

	await page.reload();
	await expect(app.workspace()).toBeVisible();
	await expect(app.pane('Image')).toBeVisible();
	await expect(generation).toHaveCount(0);

	const reopened = savedWorkspace(page, (state) => !state.hiddenPaneIds.includes('controls'));
	await app.paneToggle('Generation').click();
	await app.parkPointer({ blur: true });
	await expectOnTop(generation);
	await expect(app.paneToggle('Generation')).toHaveAttribute('aria-pressed', 'true');
	await reopened;
});

test('the visibility mode cycles all windows, categories only, panes only (button and Ctrl+H)', async ({ app, page }, testInfo) => {
	await app.open();
	const mode = (label: string) => app.appBar().getByRole('button', { name: `Showing: ${label}`, exact: true });
	const expectWindows = async (panes: boolean, categories: boolean) => {
		for (const title of FIXTURE_VISIBLE_PANES) {
			await expect(app.pane(title)).toHaveCount(panes ? 1 : 0);
		}
		for (const name of FIXTURE_CATEGORIES) {
			await expect(app.categoryWindow(name)).toHaveCount(categories ? 1 : 0);
		}
	};

	await expect(mode('All windows')).toHaveAttribute('aria-keyshortcuts', 'Control+H');
	await expectWindows(true, true);

	await mode('All windows').click();
	await expect(mode('Categories only')).toBeVisible();
	await expectWindows(false, true);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'categories-only');

	await mode('Categories only').click();
	await expect(mode('Panes only')).toBeVisible();
	await expectWindows(true, false);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'panes-only');

	await mode('Panes only').click();
	await expect(mode('All windows')).toBeVisible();
	await expectWindows(true, true);

	// The shortcut, with the focus on the page (not in a text field).
	await app.workspace().click({ position: { x: 4, y: 4 } });
	await page.keyboard.press('Control+H');
	await expect(mode('Categories only')).toBeVisible();
	await expectWindows(false, true);
	await page.keyboard.press('Control+H');
	await expect(mode('Panes only')).toBeVisible();
	await expectWindows(true, false);
	await page.keyboard.press('Control+H');
	await expect(mode('All windows')).toBeVisible();
	await expectWindows(true, true);
});

test('showing a pane in "categories only" switches back to all windows', async ({ app }) => {
	await app.open();
	await app.appBar().getByRole('button', { name: 'Showing: All windows', exact: true }).click();
	await expect(app.pane('Generation')).toHaveCount(0);
	await app.paneToggle('Characters').click();
	await app.parkPointer({ blur: true });
	await expectOnTop(app.pane('Characters'));
	await expect(app.appBar().getByRole('button', { name: 'Showing: All windows', exact: true })).toBeVisible();
});
