// The Story section in the real browser: the docked storyboard (stories, scene cards, scene details) at the desktop
// size and at 1280 x 720, creating a story, adding / editing / duplicating / deleting scenes (saved in the backend),
// and reordering scenes by keyboard and by drag (announced, saved).
import { tokens } from '@fluentui/react-theme';
import type { Locator } from '@playwright/test';
import type { Story } from '../../src/api/types';
import { STORY_LABELS } from '../../src/features/story/storyLabels';
import { dismissNotifications, expectPicturesLoaded } from '../support/app';
import { storeFile } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { resolveColor } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { expectNoPageOverflow } from '../support/shell';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop, intersects } from '../support/visibility';
import { backendStory, BRAMS_QUEST, LIGHTHOUSE, storyCollection, StoryDriver } from './storyDriver';

/** The insertion indicator drawn on a grid item while a card is dragged over it (null: none). */
async function indicatorOf(item: Locator): Promise<{ color: string } | null> {
	return item.evaluate((element) => {
		const style = getComputedStyle(element, '::after');
		return style.content === 'none' || style.content === 'normal' ? null : { color: style.backgroundColor };
	});
}

test('the storyboard shows the stories, the scene cards and the scene details, docked side by side', async ({ app, page }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	await expect(app.navItem('story')).toHaveAttribute('aria-current', 'page');

	await expect(story.storyItem(LIGHTHOUSE.title)).toHaveAttribute('aria-current', 'true');
	await expect(story.storyItem(LIGHTHOUSE.title)).toContainText('3 scenes · 2 illustrated');
	await expect(story.storyItem(BRAMS_QUEST.title)).toContainText('1 scene · not illustrated');
	expect(await story.cardTitles()).toEqual([...LIGHTHOUSE.scenes]);
	await expect(story.status(story.card(1, LIGHTHOUSE.scenes[0]))).toHaveText('Illustrated');
	await expect(story.status(story.card(3, LIGHTHOUSE.scenes[2]))).toHaveText('Not illustrated');
	await expect(story.generateMissing()).toHaveText('Generate missing (1)');
	await expectPicturesLoaded(story.scenes());

	// The regions tile the section: nothing overlaps.
	const [list, scenes, details] = await Promise.all([boxOf(story.storyList()), boxOf(story.scenes()), boxOf(story.details())]);
	expect(intersects(list, scenes)).toBe(false);
	expect(intersects(scenes, details)).toBe(false);
	expect(list.x + list.width).toBeLessThanOrEqual(scenes.x + 1);
	expect(scenes.x + scenes.width).toBeLessThanOrEqual(details.x + 1);

	const details2 = await story.openScene(2, LIGHTHOUSE.scenes[1]);
	await expect(details2.getByRole('img', { name: 'Illustration of The storm', exact: true })).toBeVisible();
	await expect(details2.getByRole('button', { name: 'Variant 0000000004', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(details2.getByRole('textbox', { name: STORY_LABELS.extraTags, exact: true })).toHaveValue('storm, night, crashing waves');
	await expect(details2.getByText('In this scene: Mira', { exact: true })).toBeVisible();
	await expect(details2.getByRole('textbox', { name: STORY_LABELS.seed, exact: true })).toHaveValue('4242');
	await expectPicturesLoaded(details2);
	await expectNoHorizontalOverflow(details2);
	await assertAppVisible(page);
	await expectNoPageOverflow(page);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'storyboard-scene');
	await expectBaseline(page, 'storyboard-scene.png');

	// Escape closes the details, back to the card.
	await details2.getByRole('textbox', { name: STORY_LABELS.sceneTitle, exact: true }).focus();
	await page.keyboard.press('Escape');
	await expect(story.details().getByText('No scene selected')).toBeVisible();
	await expect(story.card(2, LIGHTHOUSE.scenes[1]).getByRole('button', { name: LIGHTHOUSE.scenes[1], exact: true })).toBeFocused();
});

test.describe('in the smallest window, the co-writer collapsed', () => {
	// The co-writer dock collapsed (saved in story-store) gives the scenes its room; expanded, see coWriter.spec.ts.
	test.use({ viewport: SMALL_VIEWPORT, e2eOptions: { files: storeFile('story-store', { dockCollapsed: true }, 0) } });

	test('the storyboard and the scene details fit 1280 x 720', async ({ app, page }, testInfo) => {
		const story = new StoryDriver(app);
		await app.open();
		await story.open();
		const details = await story.openScene(2, LIGHTHOUSE.scenes[1]);

		await expectNoPageOverflow(page);
		await expectNoHorizontalOverflow(story.scenes());
		await expectNoHorizontalOverflow(details);
		for (const button of [story.command(STORY_LABELS.newStory), story.generateMissing(), story.command(STORY_LABELS.read), story.command(STORY_LABELS.exportStory)]) {
			await expectOnTop(button);
		}
		await expectOnTop(details.getByRole('button', { name: STORY_LABELS.regenerate, exact: true }));
		// Two card columns next to the list and the details.
		const [first, second] = [await boxOf(story.card(1, LIGHTHOUSE.scenes[0])), await boxOf(story.card(2, LIGHTHOUSE.scenes[1]))];
		expect(Math.abs(first.y - second.y)).toBeLessThan(2);
		expect(first.width).toBeGreaterThanOrEqual(200);
		await assertAppVisible(page);
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'storyboard-1280x720');
		await expectBaseline(page, 'storyboard-scene-1280x720.png');

		// The prompt fields at the bottom of the details are reachable.
		const seed = details.getByRole('textbox', { name: STORY_LABELS.seed, exact: true });
		await seed.scrollIntoViewIfNeeded();
		await expectOnTop(seed);
		await expectOnTop(details.getByRole('button', { name: STORY_LABELS.deleteScene, exact: true }));
		await saveScreenshot(page, testInfo, 'scene-prompt-1280x720');
	});
});

test('create a story, then add, edit, duplicate and delete scenes, saved in the backend', async ({ app, page, backend }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();

	await story.command(STORY_LABELS.newStory).click();
	await expect(story.storyItem('New story')).toHaveAttribute('aria-current', 'true');
	await expect(story.scenes().getByRole('heading', { name: 'No scenes yet', exact: true })).toBeVisible();
	const title = story.scenes().getByRole('textbox', { name: STORY_LABELS.storyTitle, exact: true });
	await title.fill('The night garden');
	await title.press('Enter');
	await expect(story.storyItem('The night garden')).toBeVisible();

	// The story's character: Bram (a Dropdown of the Characters section's characters).
	await story.scenes().getByRole('combobox', { name: STORY_LABELS.storyCharacters, exact: true }).click();
	await page.getByRole('menuitemcheckbox', { name: 'Bram the knight', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(story.scenes().getByRole('combobox', { name: STORY_LABELS.storyCharacters, exact: true })).toHaveText('Bram the knight');

	await story.command(STORY_LABELS.addScene).click();
	await expect(story.details().getByRole('heading', { level: 2, name: 'Scene 1', exact: true })).toBeVisible();
	await story.editField(STORY_LABELS.sceneTitle, 'The gate');
	await story.editField(STORY_LABELS.sceneText, 'Bram opened the gate.\nThe garden was dark.');
	await story.editField(STORY_LABELS.extraTags, 'garden, night, lanterns');
	await story.details().getByRole('button', { name: STORY_LABELS.duplicateScene, exact: true }).click();
	await expect(story.details().getByRole('heading', { level: 2, name: 'The gate (copy)', exact: true })).toBeVisible();
	await story.scenes().getByRole('button', { name: STORY_LABELS.addScene, exact: true }).click();
	await expect.poll(() => story.cardTitles()).toEqual(['The gate', 'The gate (copy)', 'Scene 3']);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'new-story');

	const created = (await storyCollection(backend)).items.find((item) => item.title === 'The night garden') as Story;
	expect(created.character_ids).toEqual(['chr-bbbbbbbbbbb1']);
	expect(created.scenes.map((scene) => [scene.title, scene.text, scene.extra_tags])).toEqual([
		['The gate', 'Bram opened the gate.\nThe garden was dark.', ['garden', 'night', 'lanterns']],
		['The gate (copy)', 'Bram opened the gate.\nThe garden was dark.', ['garden', 'night', 'lanterns']],
		['Scene 3', '', []],
	]);

	// Delete asks first; Cancel keeps the scene.
	const copy = story.card(2, 'The gate (copy)');
	await copy.getByRole('button', { name: `${STORY_LABELS.deleteScene} The gate (copy)`, exact: true }).click();
	const dialog = page.getByRole('alertdialog', { name: "Delete scene 'The gate (copy)'?" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
	await saveScreenshot(page, testInfo, 'delete-scene-dialog');
	await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect.poll(() => story.cardTitles()).toEqual(['The gate', 'Scene 3']);
	expect((await backendStory(backend, created.id)).scenes.map((scene) => scene.title)).toEqual(['The gate', 'Scene 3']);

	// The story survives a reload.
	await page.reload();
	await app.open();
	await story.open();
	await story.storyItem('The night garden').click();
	expect(await story.cardTitles()).toEqual(['The gate', 'Scene 3']);
	await dismissNotifications(page);
});

test('reorder scenes with the keyboard and by dragging a handle: announced and saved', async ({ app, page, backend }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	const [arrival, storm, calm] = LIGHTHOUSE.scenes;

	const handle = story.handle(story.card(1, arrival), arrival);
	await handle.focus();
	await page.keyboard.press('ArrowRight');
	await expect(story.announcer()).toHaveText(`${arrival} moved to position 2 of 3`);
	await expect.poll(() => story.cardTitles()).toEqual([storm, arrival, calm]);
	await expect(story.handle(story.card(2, arrival), arrival)).toBeFocused();
	await page.keyboard.press('End');
	await expect.poll(() => story.cardTitles()).toEqual([storm, calm, arrival]);
	await page.keyboard.press('Home');
	await expect.poll(() => story.cardTitles()).toEqual([arrival, storm, calm]);
	expect((await backendStory(backend, LIGHTHOUSE.id)).scenes.map((scene) => scene.title)).toEqual([arrival, storm, calm]);

	// Drag 'Morning calm' before 'Arrival at the lighthouse'.
	const from = await boxOf(story.handle(story.card(3, calm), calm));
	const target = await boxOf(story.card(1, arrival));
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	for (const step of [0.25, 0.5, 0.75, 1]) {
		await page.mouse.move(from.x + (target.x + target.width / 4 - from.x) * step, from.y + (target.y + target.height / 2 - from.y) * step);
	}
	const firstItem = story.card(1, arrival).locator('xpath=..');
	await expect.poll(() => indicatorOf(firstItem)).not.toBeNull();
	expect((await indicatorOf(firstItem))?.color).toBe(await resolveColor(page, tokens.colorBrandStroke1));
	await saveScreenshot(story.scenes(), testInfo, 'dragging-scene');
	await page.mouse.up();
	await expect.poll(() => story.cardTitles()).toEqual([calm, arrival, storm]);
	await expect(story.announcer()).toHaveText(`${calm} moved to position 1 of 3`);
	await expect.poll(async () => (await backendStory(backend, LIGHTHOUSE.id)).scenes.map((scene) => scene.title)).toEqual([calm, arrival, storm]);
});
