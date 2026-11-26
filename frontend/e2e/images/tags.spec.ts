// The tags of an image in the real browser: 'Add to category' adds them (all, or the picked ones) as one new
// sub-prompt of an existing category or of a new category; the toast's 'Go to Create' lands on the prompt board with
// that category's card revealed (in view, expanded) showing the sub-prompt; a duplicate is refused with a warning.
// The cards themselves belong to the board specs: only read here, with Create shown (a hidden section is out of the
// accessibility tree).
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { toast } from '../support/app';
import { goToCreateFrom } from '../support/flows';
import { addTagsTo, AUTHOR, detailSection, openImage, openImages, subPrompts, WATERCOLOR_PROMPT } from './imageLibrary';

test('adds every tag to an existing category as one sub-prompt; Go to Create shows its card; refused twice', async ({ app, page }, testInfo) => {
	await app.open();
	await expect(subPrompts(app.categoryCard('Mood'))).not.toHaveCount(0);
	await expect(subPrompts(app.categoryCard('Mood')).filter({ hasText: WATERCOLOR_PROMPT })).toHaveCount(0);
	const section = await app.goTo('images');
	await expect(section.getByRole('list', { name: 'Search results' }).getByRole('button').first()).toBeVisible();
	const detail = await openImage(section, AUTHOR.watercolor);

	await detailSection(detail, 'Tags').getByRole('button', { name: 'Add to category' }).click();
	const menu = page.getByRole('menu');
	await expect(menu.getByRole('menuitem')).toHaveText(['Subject', 'Outfit', 'Background', 'Weather effects', 'Lighting', 'Mood', 'Sea creatures', 'New category']);
	await expectOnTop(menu);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'add-to-category-menu');
	await menu.getByRole('menuitem', { name: 'Mood' }).click();

	await expect(toast(page, "Tags added to the category 'Mood'.")).toBeVisible();
	await goToCreateFrom(app, "Tags added to the category 'Mood'.");
	const mood = app.categoryCard('Mood');
	await expect(mood).toBeInViewport();
	await expect(subPrompts(mood).filter({ hasText: WATERCOLOR_PROMPT })).toHaveCount(1);
	await saveScreenshot(mood, testInfo, 'mood-with-the-tags');

	await app.goTo('images');
	await addTagsTo(detail, 'Mood');
	await expect(toast(page, "Category 'Mood' cannot contain multiple sub-prompts with the same id.")).toBeVisible();
	await app.goTo('create');
	await expect(subPrompts(mood).filter({ hasText: WATERCOLOR_PROMPT })).toHaveCount(1);
});

test('adds only the picked tags', async ({ app, page }) => {
	const section = await openImages(app);
	const detail = await openImage(section, AUTHOR.watercolor);
	const tags = detailSection(detail, 'Tags').getByRole('toolbar', { name: 'Tags' });
	await tags.getByRole('button', { name: 'boats' }).click();
	await tags.getByRole('button', { name: 'soft light' }).click();
	await expect(tags.getByRole('button', { name: 'boats' })).toHaveAttribute('aria-pressed', 'true');
	await addTagsTo(detail, 'Background');
	await expect(toast(page, "Tags added to the category 'Background'.")).toBeVisible();
	await app.goTo('create');
	await expect(subPrompts(app.categoryCard('Background')).filter({ hasText: /^boats, soft light$/ })).toHaveCount(1);
});

test('adds the tags to a new category, whose card Go to Create shows in view', async ({ app, page }, testInfo) => {
	await app.open();
	const cardsBefore = await app.createRegion('board').getByRole('article').count();
	expect(cardsBefore).toBeGreaterThan(0);
	const section = await app.goTo('images');
	await expect(section.getByRole('list', { name: 'Search results' }).getByRole('button').first()).toBeVisible();
	const detail = await openImage(section, AUTHOR.watercolor);
	await addTagsTo(detail, 'New category');

	const announcement = toast(page, /Tags added to the category '.+'\./);
	await expect(announcement).toBeVisible();
	const name = /Tags added to the category '(.+)'\./.exec((await announcement.textContent()) ?? '')?.[1] ?? '';
	expect(name).not.toBe('');
	await goToCreateFrom(app, `Tags added to the category '${name}'.`);

	const created = app.categoryCard(name);
	await expect(created).toBeVisible();
	await expect(created).toBeInViewport();
	await expect(app.createRegion('board').getByRole('article')).toHaveCount(cardsBefore + 1);
	await expect(subPrompts(created)).toHaveText([WATERCOLOR_PROMPT]);
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'new-category');
});
