// Forbidden associations in the real app, dark and light: picks in the Used sub-prompts list of the viewer (P =
// sub-prompt, C = category, tag chips) mark the source 'associated' and what it is forbidden with 'forbidden' (or
// 'forbiddenLocked' when a lock is involved) on the category cards and their rows; a second pick toggles a rule,
// which is persisted and survives a reload.
import { FIXTURE_CATEGORIES } from '../support/backend';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import {
	categoryButton,
	describeRule,
	expectVisualState,
	promptButton,
	rulesWritten,
	storedRules,
	subPromptRow,
	tagButton,
	usedRow,
	usedStatus,
} from './categoryDriver';

const PICK_HINT = 'Pick P, C, or a tag on a row to select the source association target.';

test('P on a sub-prompt marks it and its card associated, what it is forbidden with red; the same P clears', async ({ app, page }, testInfo) => {
	await app.open();
	await app.showViewerTab('Used sub-prompts');
	const outfit = app.categoryCard('Outfit');
	const background = app.categoryCard('Background');
	const status = usedStatus(app);
	await expect(status).toHaveText(PICK_HINT);

	await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
	await expect(status).toHaveText('Source selected: sub-prompt. Choose P, C, or a tag on another row to create or disable the association.');
	await expect(promptButton(usedRow(app, 'Outfit', 'red dress'))).toHaveAttribute('aria-pressed', 'true');
	await expectVisualState(subPromptRow(outfit, 'red dress'), 'associated');
	await expectVisualState(outfit, 'associated');
	await expectVisualState(subPromptRow(outfit, 'school uniform'), null);
	await expectVisualState(subPromptRow(background, 'beach at sunset'), 'forbidden');
	await expectVisualState(background, 'forbidden');
	await expectVisualState(subPromptRow(background, 'castle courtyard'), null);
	await app.parkPointer();
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'red-dress-source');

	await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
	await expect(status).toHaveText(PICK_HINT);
	await expectVisualState(subPromptRow(outfit, 'red dress'), 'current');
	await expectVisualState(outfit, null);
	await expectVisualState(background, null);
	await expectVisualState(subPromptRow(background, 'beach at sunset'), null);
});

const DRESS_SMILING = 'specific:Mood:smiling x specific:Outfit:red dress';

test('a second pick toggles a rule (persisted); the target is then forbidden with the source', async ({ app, page, backend }) => {
	await app.open();
	await app.showViewerTab('Used sub-prompts');
	const mood = app.categoryCard('Mood');
	const before = (await storedRules(backend)).length;

	await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
	const added = rulesWritten(page, (rules) => rules.includes(DRESS_SMILING));
	await promptButton(usedRow(app, 'Mood', 'smiling')).click();
	await added;
	await expect(promptButton(usedRow(app, 'Outfit', 'red dress'))).toHaveAttribute('aria-pressed', 'false');
	const stored = (await storedRules(backend)).map(describeRule);
	expect(stored).toContain(DRESS_SMILING);
	expect(stored.length).toBe(before + 1);

	await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
	await expectVisualState(subPromptRow(mood, 'smiling'), 'forbidden');
	await expectVisualState(mood, 'forbidden');
	await expectVisualState(promptButton(usedRow(app, 'Mood', 'smiling')), 'forbidden');

	// The same two picks again remove the rule.
	const removed = rulesWritten(page, (rules) => !rules.includes(DRESS_SMILING));
	await promptButton(usedRow(app, 'Mood', 'smiling')).click();
	await removed;
	expect((await storedRules(backend)).map(describeRule)).not.toContain(DRESS_SMILING);
	await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
	await expectVisualState(subPromptRow(mood, 'smiling'), 'current');
	await expectVisualState(mood, null);
});

test('P on the locked subject: what it forbids is purple (forbidden by a lock)', async ({ app, page }, testInfo) => {
	await app.open();
	await app.showViewerTab('Used sub-prompts');
	const subject = app.categoryCard('Subject');
	const outfit = app.categoryCard('Outfit');
	await promptButton(usedRow(app, 'Subject', '1girl, silver hair')).click();
	await expectVisualState(subPromptRow(subject, '1girl, silver hair'), 'associated');
	await expectVisualState(subject, 'associated');
	await expectVisualState(subPromptRow(outfit, 'swimsuit'), 'forbiddenLocked');
	await expectVisualState(outfit, 'forbiddenLocked');
	await expectVisualState(subPromptRow(outfit, 'red dress'), 'current');
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'locked-source');
});

test('a tag pick designates the rows carrying the tag; the rule of the tag is red', async ({ app }) => {
	await app.open();
	await app.showViewerTab('Used sub-prompts');
	const background = app.categoryCard('Background');
	const mood = app.categoryCard('Mood');
	const rainRow = usedRow(app, 'Background', 'neon city street, rain');
	await tagButton(rainRow, 'rain').click();
	await expect(tagButton(rainRow, 'rain')).toHaveAttribute('aria-pressed', 'true');
	await expectVisualState(subPromptRow(background, 'neon city street, rain'), 'associated');
	await expectVisualState(subPromptRow(background, 'castle courtyard'), null);
	await expectVisualState(background, 'associated');
	await expectVisualState(subPromptRow(mood, 'crying'), 'forbidden');
	await expectVisualState(mood, 'forbidden');
	await expectVisualState(subPromptRow(mood, 'smiling'), 'current');
});

test('a C pick designates the whole category; a category-wide rule makes the other card red', async ({ app, page }, testInfo) => {
	await app.open();
	await app.showViewerTab('Used sub-prompts');
	const weather = app.categoryCard('Weather effects');
	const sea = app.categoryCard('Sea creatures');
	await categoryButton(usedRow(app, 'Weather effects', 'puddles reflections')).click();
	await expect(categoryButton(usedRow(app, 'Weather effects', 'puddles reflections'))).toHaveAttribute('aria-pressed', 'true');
	await expectVisualState(weather, 'associated');
	await expectVisualState(subPromptRow(weather, 'lightning bolts'), 'associated');
	await expectVisualState(subPromptRow(weather, 'puddles reflections'), 'associated');
	await expectVisualState(sea, 'forbidden');
	await expectVisualState(subPromptRow(sea, 'jellyfish'), 'forbidden');
	await expectVisualState(subPromptRow(sea, 'coral reef'), 'forbidden');
	// The other cards are untouched.
	for (const name of FIXTURE_CATEGORIES.filter((category) => category !== 'Weather effects' && category !== 'Sea creatures')) {
		await expect(app.categoryCard(name)).not.toHaveAttribute('data-visual-state', /forbidden|associated/);
	}
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'weather-category-source');

	// A C pick in the source's own category only clears the source.
	await categoryButton(usedRow(app, 'Weather effects', 'puddles reflections')).click();
	await expectVisualState(weather, null);
	await expectVisualState(sea, 'indirectlyDisabled');
});

test('rules created in the Used sub-prompts list survive a reload', async ({ app, page, backend }) => {
	const rule = 'specific:Background:neon city street, rain x specific:Weather effects:puddles reflections';
	await app.open();
	await app.showViewerTab('Used sub-prompts');
	await promptButton(usedRow(app, 'Background', 'neon city street, rain')).click();
	const added = rulesWritten(page, (rules) => rules.includes(rule));
	await promptButton(usedRow(app, 'Weather effects', 'puddles reflections')).click();
	await added;
	expect((await storedRules(backend)).map(describeRule)).toContain(rule);

	await page.reload();
	await app.open();
	await app.showViewerTab('Used sub-prompts');
	await promptButton(usedRow(app, 'Background', 'neon city street, rain')).click();
	await expectVisualState(subPromptRow(app.categoryCard('Weather effects'), 'puddles reflections'), 'forbidden');
	await expectVisualState(app.categoryCard('Weather effects'), 'forbidden');
	// The source is not persisted: after a reload nothing is picked.
	await page.reload();
	await app.open();
	await app.showViewerTab('Used sub-prompts');
	await expectVisualState(app.categoryCard('Weather effects'), null);
	await expect(usedStatus(app)).toHaveText(PICK_HINT);
});

test.describe('without any output', () => {
	test.use({ e2eOptions: { remove: ['output'] } });

	test('the Used sub-prompts list shows its empty state and no row is used by an output', async ({ app, page }, testInfo) => {
		await app.open();
		await app.showViewerTab('Used sub-prompts');
		const used = app.createRegion('viewer');
		await expect(used.getByText('No selected sub-prompts for the current image.')).toBeVisible();
		await expect(app.usedSubPrompts()).toHaveCount(0);
		await expectVisualState(subPromptRow(app.categoryCard('Outfit'), 'red dress'), null);
		// Without an output the locked subject shows its lock.
		await expectVisualState(subPromptRow(app.categoryCard('Subject'), '1girl, silver hair'), 'locked');
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'used-empty');
	});
});
