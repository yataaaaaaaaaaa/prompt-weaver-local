// The tags of an image in the real browser: 'Add to category' adds them (all, or the picked ones) as one new
// sub-prompt of an existing category or of a new category, whose window shows it; a duplicate is refused with a
// warning. The category windows themselves belong to the categories specs: only read here.
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { notifications } from '../support/app';
import { AUTHOR, detailSection, openImage, openImageLibrary } from './imageLibrary';
import type { Locator, Page } from '@playwright/test';

const PROMPT = 'watercolor, harbor town, boats, soft light';

/** The sub-prompt rows of a category window (read-only). */
function subPrompts(window: Locator): Locator {
	return window.getByRole('list', { name: 'Sub-prompts' }).getByRole('button', { name: /^Sub-prompt: / });
}

async function addTagsTo(page: Page, pane: Locator, category: string): Promise<void> {
	await detailSection(pane, 'Tags').getByRole('button', { name: /^Add (\d+ )?to category$/ }).click();
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await menu.getByRole('menuitem', { name: category, exact: true }).click();
	await expect(menu).toBeHidden();
}

test('adds every tag to an existing category as one sub-prompt, and refuses it twice', async ({ app, page }, testInfo) => {
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.watercolor);
	const mood = app.categoryWindow('Mood');
	await expect(subPrompts(mood).filter({ hasText: PROMPT })).toHaveCount(0);

	await detailSection(pane, 'Tags').getByRole('button', { name: 'Add to category' }).click();
	const menu = page.getByRole('menu');
	await expect(menu.getByRole('menuitem')).toHaveText(['Subject', 'Outfit', 'Background', 'Weather effects', 'Lighting', 'Mood', 'Sea creatures', 'New category']);
	await expectOnTop(menu);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'add-to-category-menu');
	await menu.getByRole('menuitem', { name: 'Mood' }).click();

	await expect(notifications(page)).toContainText("Tags added to the category 'Mood'.");
	await expect(subPrompts(mood).filter({ hasText: PROMPT })).toHaveCount(1);
	await app.bringToFront(mood);
	await saveScreenshot(mood, testInfo, 'mood-with-the-tags');

	await app.bringToFront(pane);
	await addTagsTo(page, pane, 'Mood');
	await expect(notifications(page)).toContainText("Category 'Mood' cannot contain multiple sub-prompts with the same id.");
	await expect(subPrompts(mood).filter({ hasText: PROMPT })).toHaveCount(1);
});

test('adds only the picked tags', async ({ app, page }) => {
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.watercolor);
	const tags = detailSection(pane, 'Tags').getByRole('toolbar', { name: 'Tags' });
	await tags.getByRole('button', { name: 'boats' }).click();
	await tags.getByRole('button', { name: 'soft light' }).click();
	await expect(tags.getByRole('button', { name: 'boats' })).toHaveAttribute('aria-pressed', 'true');
	await addTagsTo(page, pane, 'Background');
	await expect(notifications(page)).toContainText("Tags added to the category 'Background'.");
	await expect(subPrompts(app.categoryWindow('Background')).filter({ hasText: /^boats, soft light$/ })).toHaveCount(1);
});

test('adds the tags to a new category whose window shows them', async ({ app, page }, testInfo) => {
	const pane = await openImageLibrary(app);
	await openImage(pane, AUTHOR.watercolor);
	const windowsBefore = await app.workspace().locator(':scope > section[aria-label$=" category"]').count();
	await addTagsTo(page, pane, 'New category');

	await expect(notifications(page)).toContainText(/Tags added to the category '.+'\./);
	const name = /Tags added to the category '(.+)'\./.exec((await notifications(page).textContent()) ?? '')?.[1] ?? '';
	const created = app.categoryWindow(name);
	await expect(created).toBeVisible();
	await expect(app.workspace().locator(':scope > section[aria-label$=" category"]')).toHaveCount(windowsBefore + 1);
	await expect(subPrompts(created)).toHaveText([PROMPT]);
	await expectOnTop(created);
	await saveScreenshot(page, testInfo, 'new-category');
});
