// "Add to story" from Create in the real browser: the output shown becomes a scene of an existing story or of a new
// one, prefilled from it (its picture as the chosen variant, its sub-prompts as the scene's locks, its seed), announced
// with 'Go to Story', which lands on the new scene. Also: a scene uses Create's current output as its picture.
import { STORY_LABELS } from '../../src/features/story/storyLabels';
import { VIEWER_LABELS } from '../../src/features/outputs/viewerLabels';
import { toast } from '../support/app';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { backendStory, BRAMS_QUEST, LIGHTHOUSE, storyCollection, StoryDriver } from './storyDriver';

/** The 'Add to story' menu button of the viewer's output actions. */
function addToStory(app: StoryDriver['app']) {
	return app.createRegion('viewer').getByRole('toolbar', { name: VIEWER_LABELS.outputActions }).getByRole('button', { name: STORY_LABELS.addToStory, exact: true });
}

test('Add to story turns the output shown into a scene of a story, with Go to Story', async ({ app, page, backend }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	// Output 4 (fixture): made without a character, with a locked Subject and 4 more selections, image seed 1234566.
	await expect(app.createRegion('viewer').getByRole('img', { name: 'Output 0000000004', exact: true })).toBeVisible();

	await addToStory(app).click();
	const menu = page.getByRole('menu');
	await expect(menu.getByRole('menuitem')).toHaveText(['New story', LIGHTHOUSE.title, BRAMS_QUEST.title]);
	await expectOnTop(menu);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'add-to-story-menu');
	await menu.getByRole('menuitem', { name: BRAMS_QUEST.title }).click();

	const added = toast(page, `Scene 2 was added to ${BRAMS_QUEST.title}.`);
	await expect(added).toBeVisible();
	const scene = (await backendStory(backend, BRAMS_QUEST.id)).scenes[1];
	expect(scene.chosen_output_id).toBe('0000000004');
	expect(scene.seed).toBe(1234566);
	// The story names Bram; the output had no character: the scene names none (it reproduces the output).
	expect(scene.character_ids).toEqual([]);
	expect(scene.locks.map((lock) => [lock.category_name, lock.prompt_text])).toEqual([
		['Subject', '1girl, silver hair'],
		['Outfit', 'red dress'],
		['Background', 'neon city street, rain'],
		['Weather effects', 'puddles reflections'],
		['Mood', 'smiling'],
	]);

	await added.getByRole('button', { name: 'Go to Story', exact: true }).click();
	await expect(story.section()).toBeVisible();
	await expect(story.storyItem(BRAMS_QUEST.title)).toHaveAttribute('aria-current', 'true');
	const details = story.details();
	await expect(details.getByRole('heading', { level: 2, name: 'Scene 2', exact: true })).toBeVisible();
	await expect(details.getByRole('img', { name: 'Illustration of Scene 2', exact: true })).toHaveAttribute('src', /0000000004\/image$/);
	await expect(details.getByRole('switch', { name: STORY_LABELS.sameCharacters })).not.toBeChecked();
	await expect(details.getByText('Weather effects', { exact: true })).toBeVisible();
	await expect(story.status(story.card(2, 'Scene 2'))).toHaveText('Illustrated');
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'added-scene');
});

test('Add to story with New story starts a story with the output', async ({ app, page, backend }) => {
	const story = new StoryDriver(app);
	await app.open();
	// Output 2 (fixture) was made with Mira active.
	await app.createRegion('viewer').getByRole('option', { name: 'Output 0000000002', exact: true }).click();
	await expect(app.createRegion('viewer').getByRole('img', { name: 'Output 0000000002', exact: true })).toBeVisible();

	await addToStory(app).click();
	await page.getByRole('menu').getByRole('menuitem', { name: 'New story', exact: true }).click();
	await expect(toast(page, 'Scene 1 was added to New story.')).toBeVisible();

	const created = (await storyCollection(backend)).items.find((item) => item.title === 'New story')!;
	// The new story's character is the output's; the scene uses the story's (no own characters), without the pinned
	// character selections among its locks.
	expect(created.character_ids).toEqual(['chr-aaaaaaaaaaa1']);
	expect(created.scenes).toHaveLength(1);
	expect(created.scenes[0]).toMatchObject({ title: 'Scene 1', chosen_output_id: '0000000002', character_ids: null });
	expect(created.scenes[0].locks.map((lock) => lock.category_name)).not.toContain('Character');

	await app.goTo('story');
	await expect(story.storyItem('New story')).toHaveAttribute('aria-current', 'true');
	await expect(story.storyItem('New story')).toContainText('1 scene · all illustrated');
});

test('a scene takes the current output of Create as its picture', async ({ app, backend }) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	const details = await story.openScene(3, LIGHTHOUSE.scenes[2]);

	await details.getByRole('button', { name: STORY_LABELS.useCurrentOutput, exact: true }).click();

	await expect(details.getByRole('img', { name: `Illustration of ${LIGHTHOUSE.scenes[2]}`, exact: true })).toHaveAttribute('src', /0000000004\/image$/);
	await expect(story.status(story.card(3, LIGHTHOUSE.scenes[2]))).toHaveText('Illustrated');
	await expect(details.getByRole('button', { name: STORY_LABELS.useCurrentOutput, exact: true })).toBeDisabled();
	expect((await backendStory(backend, LIGHTHOUSE.id)).scenes[2].chosen_output_id).toBe('0000000004');
});
