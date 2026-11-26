// The app is what the user sees: visible, in color, not covered by any overlay, docked (the rail, the Create header
// and the three Create regions side by side, nothing overlapping, Generate never covered), in every section, at the
// desktop size and at the smallest supported size, in dark and light (projects). Regression of ead54a3: a Fluent
// portal mount node turned into an opaque full-screen overlay as soon as the first tooltip existed.
import type { Page, TestInfo } from '@playwright/test';
import { SECTION_IDS, type SectionId } from '../src/app/sections';
import type { AppDriver } from './support/app';
import { FIXTURE_CATEGORIES } from './support/backend';
import { expectBaseline } from './support/baselines';
import { SMALL_VIEWPORT } from './support/env';
import { expect, test } from './support/fixtures';
import { saveScreenshot } from './support/screenshots';
import { expectDockedLayout, expectNoPageOverflow } from './support/shell';
import { assertAppVisible, expectOnTop } from './support/visibility';

/** Every section is visible and in color; each one gets a screenshot to look at and a baseline. */
async function checkEverySection(app: AppDriver, page: Page, testInfo: TestInfo, suffix: string): Promise<void> {
	for (const section of SECTION_IDS.filter((id): id is Exclude<SectionId, 'create'> => id !== 'create')) {
		const shown = await app.goTo(section);
		await expect(shown).toBeVisible();
		await expect(app.navItem(section)).toHaveAttribute('aria-current', 'page');
		await assertAppVisible(page);
		await expectNoPageOverflow(page);
		await app.parkPointer();
		await saveScreenshot(page, testInfo, `${section}${suffix}`);
		await expectBaseline(page, `${section}${suffix}.png`);
	}
}

test('the docked app is visible, in color, in every section at the desktop size', async ({ app, page }, testInfo) => {
	await app.open();
	await assertAppVisible(page);
	await expect(app.navItem('create')).toHaveAttribute('aria-current', 'page');
	await expect(app.commandBar()).toBeVisible();
	for (const name of FIXTURE_CATEGORIES) {
		await expect(app.categoryCard(name)).toBeVisible();
	}
	await expectDockedLayout(app);
	await expectNoPageOverflow(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'create');
	await expectBaseline(page, 'create.png');

	await checkEverySection(app, page, testInfo, '');
});

test('a tooltip does not turn its portal into a full-screen overlay', async ({ app, page }) => {
	await app.open();
	await assertAppVisible(page);
	await app.navItem('models').hover({ timeout: 5_000 });
	await expect(page.getByRole('tooltip')).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await expectOnTop(app.generationAction());
	await expectOnTop(app.commandBar());
});

test('the docked app fits the smallest supported window in every section', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	await assertAppVisible(page);
	await expectDockedLayout(app);
	await expectNoPageOverflow(page);
	await expectOnTop(app.commandBar());
	await expectOnTop(app.layoutToolbar());
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'create-1280x720');
	await expectBaseline(page, 'create-1280x720.png');

	await checkEverySection(app, page, testInfo, '-1280x720');
});
