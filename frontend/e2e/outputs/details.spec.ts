// The output details panel of the viewer in the real app: the 'Output details' toggle opens and closes it, its Details
// and Used sub-prompts tabs, both saved in the Create layout (layout-store) and restored after a reload, the panel's
// share of the viewer, and the visual baselines of both tabs.
import type { CreateLayout } from '../../src/domain/layout';
import { savedStore, STORE_NAMES } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectOnTop } from '../support/visibility';
import { imageOf, navigationButton, outputDetail, viewerRegion } from './outputBrowser';

test('the Output details toggle closes and reopens the panel; the picture takes the room; a reload keeps it', async ({ app, page }, testInfo) => {
	await app.open();
	const viewer = viewerRegion(app);
	const toggle = navigationButton(app, 'Output details');
	const tabs = viewer.getByRole('tablist');
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await expect(tabs).toBeVisible();
	const withPanel = await boxOf(imageOf(app, '0000000004'));
	const panel = await boxOf(viewer.getByRole('tabpanel'));
	const viewerBox = await boxOf(viewer);
	// A fixed share of the viewer's height (about 38 %), the picture keeps the rest.
	expect(panel.height / viewerBox.height).toBeGreaterThan(0.25);
	expect(panel.height / viewerBox.height).toBeLessThan(0.45);

	const closed = savedStore<CreateLayout>(page, STORE_NAMES.layout, (layout) => layout.details.open === false);
	await toggle.click();
	await closed;

	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await expect(tabs).toHaveCount(0);
	const withoutPanel = await boxOf(imageOf(app, '0000000004'));
	expect(withoutPanel.height, 'the picture grows without the panel').toBeGreaterThan(withPanel.height);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(viewer, testInfo, 'viewer-details-closed');

	await page.reload();
	await app.open();
	await expect(navigationButton(app, 'Output details')).toHaveAttribute('aria-pressed', 'false');
	await expect(viewer.getByRole('tablist')).toHaveCount(0);

	await navigationButton(app, 'Output details').click();
	await expect(viewer.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
	await expect(outputDetail(app, 'Output')).toHaveText('#0000000004');
});

test('the Details and Used sub-prompts tabs; the chosen tab is saved and restored', async ({ app, page }, testInfo) => {
	await app.open();
	const viewer = viewerRegion(app);
	await app.showViewerTab('Details');
	await expect(viewer.getByRole('tabpanel')).toHaveAccessibleName('Details');
	await expect(outputDetail(app, 'Model')).toHaveText('studio_xl_local.safetensors');
	await app.parkPointer({ blur: true });
	await expectBaseline(viewer.getByRole('tabpanel'), 'details-tab.png');

	const saved = savedStore<CreateLayout>(page, STORE_NAMES.layout, (layout) => layout.details.tab === 'used');
	await app.showViewerTab('Used sub-prompts');
	await saved;

	await expect(viewer.getByRole('tabpanel')).toHaveAccessibleName('Used sub-prompts');
	const used = app.usedSubPrompts();
	await expect(used.getByRole('listitem')).toHaveCount(5);
	await expect(used.getByRole('listitem', { name: 'Subject: 1girl, silver hair' })).toBeVisible();
	const outfit = used.getByRole('listitem', { name: 'Outfit: red dress' });
	for (const name of ['P: sub-prompt association', 'C: category association', 'Copy sub-prompt']) {
		await expectOnTop(outfit.getByRole('button', { name, exact: true }));
	}
	await expect(outfit.getByRole('group', { name: 'Tags' })).toBeVisible();
	await expect(outputDetail(app, 'Model')).toHaveCount(0);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(viewer, testInfo, 'viewer-used-sub-prompts');
	await expectBaseline(viewer.getByRole('tabpanel'), 'used-tab.png');

	await page.reload();
	await app.open();
	await expect(viewer.getByRole('tab', { name: 'Used sub-prompts' })).toHaveAttribute('aria-selected', 'true');
	await expect(app.usedSubPrompts().getByRole('listitem')).toHaveCount(5);
});

test('the tabs and the details body work from the keyboard', async ({ app, page }) => {
	await app.open();
	const viewer = viewerRegion(app);
	const details = viewer.getByRole('tab', { name: 'Details' });
	await details.focus();

	await page.keyboard.press('ArrowRight');
	await expect(viewer.getByRole('tab', { name: 'Used sub-prompts' })).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(viewer.getByRole('tab', { name: 'Used sub-prompts' })).toHaveAttribute('aria-selected', 'true');
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Space');
	await expect(details).toHaveAttribute('aria-selected', 'true');
	// The tab body is reachable to scroll the details with the keyboard, with a visible focus ring.
	await page.keyboard.press('Tab');
	await expect(viewer.getByRole('tabpanel')).toBeFocused();
	await expect(viewer.getByRole('tabpanel')).not.toHaveCSS('outline-style', 'none');
});
