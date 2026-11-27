// Read mode and the HTML export in the real browser: the picture book (one scene per page, picture and text side by
// side), paging with the arrow keys / Home / End and the page buttons, Escape back to the storyboard, at the desktop
// size and at 1280 x 720; Export downloads one self-contained HTML file (pictures embedded) that reads as a picture
// book on its own.
import { readFile } from 'node:fs/promises';
import { STORY_LABELS } from '../../src/features/story/storyLabels';
import { expectPicturesLoaded } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { expectNoPageOverflow } from '../support/shell';
import { assertAppVisible, boxOf, expectOnTop, intersects } from '../support/visibility';
import { LIGHTHOUSE, StoryDriver } from './storyDriver';

test('read mode shows one scene per page; the arrow keys, Home / End and the buttons turn the pages, Escape closes it', async ({ app, page }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	await story.command(STORY_LABELS.read).click();

	const reader = story.reader();
	await expect(reader).toBeVisible();
	await expect(story.command(STORY_LABELS.read)).toHaveAttribute('aria-pressed', 'true');
	await expect(story.storyList()).toHaveCount(0);
	// The picture book (named after the story and its page) takes the focus.
	const book = reader.getByRole('group', { name: /^The lighthouse keeper, Page [1-3] of 3$/ });
	await expect(book).toHaveAccessibleName(`${LIGHTHOUSE.title}, Page 1 of 3`);
	await expect(book).toBeFocused();
	await expect(reader.getByRole('heading', { level: 2, name: LIGHTHOUSE.scenes[0], exact: true })).toBeVisible();
	const picture = reader.getByRole('img', { name: `Illustration of ${LIGHTHOUSE.scenes[0]}`, exact: true });
	await expect(picture).toBeVisible();
	await expectPicturesLoaded(reader);
	// The picture and the text side by side.
	const text = reader.getByText(/^Mira climbed the hundred stairs/);
	expect(intersects(await boxOf(picture), await boxOf(text))).toBe(false);
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'reader-page-1');
	await expectBaseline(page, 'reader.png');

	await page.keyboard.press('ArrowRight');
	await expect(reader.getByRole('heading', { level: 2, name: LIGHTHOUSE.scenes[1], exact: true })).toBeVisible();
	await expect(reader.getByText('Page 2 of 3').first()).toBeVisible();
	await page.keyboard.press('End');
	await expect(reader.getByRole('heading', { level: 2, name: LIGHTHOUSE.scenes[2], exact: true })).toBeVisible();
	await expect(reader.getByText('No picture yet', { exact: true })).toBeVisible();
	await expect(reader.getByRole('button', { name: STORY_LABELS.nextPage })).toBeDisabled();
	await saveScreenshot(page, testInfo, 'reader-page-3');
	await reader.getByRole('button', { name: STORY_LABELS.previousPage }).click();
	await expect(reader.getByRole('heading', { level: 2, name: LIGHTHOUSE.scenes[1], exact: true })).toBeVisible();
	await book.focus();
	await page.keyboard.press('Home');
	await expect(reader.getByRole('heading', { level: 2, name: LIGHTHOUSE.scenes[0], exact: true })).toBeVisible();
	await page.keyboard.press('ArrowLeft');
	await expect(reader.getByRole('heading', { level: 2, name: LIGHTHOUSE.scenes[0], exact: true })).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(story.scenes()).toBeVisible();
	await expect(story.command(STORY_LABELS.read)).toHaveAttribute('aria-pressed', 'false');
	// The page read last is the selected scene.
	await expect(story.details().getByRole('heading', { level: 2, name: LIGHTHOUSE.scenes[0], exact: true })).toBeVisible();
});

test.describe('in the smallest window', () => {
	test.use({ viewport: SMALL_VIEWPORT });

	test('the reader fits 1280 x 720 with its page buttons in view', async ({ app, page }, testInfo) => {
		const story = new StoryDriver(app);
		await app.open();
		await story.open();
		await story.openScene(2, LIGHTHOUSE.scenes[1]);
		await story.command(STORY_LABELS.read).click();

		const reader = story.reader();
		await expect(reader.getByRole('heading', { level: 2, name: LIGHTHOUSE.scenes[1], exact: true })).toBeVisible();
		await expectPicturesLoaded(reader);
		await expectNoPageOverflow(page);
		for (const name of [STORY_LABELS.previousPage, STORY_LABELS.nextPage, STORY_LABELS.closeReader]) {
			await expectOnTop(reader.getByRole('button', { name, exact: true }));
		}
		const picture = await boxOf(reader.getByRole('img', { name: `Illustration of ${LIGHTHOUSE.scenes[1]}`, exact: true }));
		expect(picture.height).toBeGreaterThan(300);
		await assertAppVisible(page);
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'reader-1280x720');
		await expectBaseline(page, 'reader-1280x720.png');

		await reader.getByRole('button', { name: STORY_LABELS.closeReader, exact: true }).click();
		await expect(story.scenes()).toBeVisible();
	});
});

test('Export downloads one HTML file with the pictures embedded, readable on its own', async ({ app, page }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();

	const downloading = page.waitForEvent('download');
	await story.command(STORY_LABELS.exportStory).click();
	const download = await downloading;
	expect(download.suggestedFilename()).toBe(`${LIGHTHOUSE.title}.html`);
	const html = await readFile((await download.path())!, 'utf8');

	expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
	expect(html).toContain(`<title>${LIGHTHOUSE.title}</title>`);
	expect(html.match(/data:image\/jpeg;base64,/g)).toHaveLength(2);
	for (const title of LIGHTHOUSE.scenes) {
		expect(html).toContain(`<h2>${title}</h2>`);
	}
	expect(html).toContain('Mira climbed the hundred stairs of the old lighthouse with a lantern in her hand.\nAt the top');
	// Self-contained: no script, no external resource.
	expect(html).not.toMatch(/<script|src="http|href="http/);
	await expect(page.getByRole('region', { name: 'Notifications' }).getByText(`${LIGHTHOUSE.title} was downloaded as ${LIGHTHOUSE.title}.html.`)).toBeVisible();

	// It reads as a picture book in a browser on its own.
	const exported = await page.context().newPage();
	await exported.setContent(html);
	await expect(exported.getByRole('heading', { level: 1, name: LIGHTHOUSE.title })).toBeVisible();
	await expect(exported.getByRole('img', { name: `Illustration of ${LIGHTHOUSE.scenes[0]}` })).toBeVisible();
	expect(await exported.getByRole('img').evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
	await saveScreenshot(exported, testInfo, 'exported-story');
	await exported.close();
});
