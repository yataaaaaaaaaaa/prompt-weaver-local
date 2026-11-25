// Forbidden associations in the real app, dark and light: picks in the Used sub-prompts pane (P = sub-prompt,
// C = category, tag chips) mark the source 'associated' and what it is forbidden with 'forbidden' (or
// 'forbiddenLocked' when a lock is involved) in the category windows and their rows; a second pick toggles a rule,
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
} from './categoryDriver';

const PICK_HINT = 'Pick P, C, or a tag on a row to select the source association target.';

test('P on a sub-prompt marks it and its window associated, what it is forbidden with red; the same P clears', async ({ app, page }, testInfo) => {
	await app.open();
	const outfit = app.categoryWindow('Outfit');
	const background = app.categoryWindow('Background');
	const status = app.pane('Used sub-prompts').getByRole('status');
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
	const mood = app.categoryWindow('Mood');
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
	const subject = app.categoryWindow('Subject');
	const outfit = app.categoryWindow('Outfit');
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
	const background = app.categoryWindow('Background');
	const mood = app.categoryWindow('Mood');
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

test('a C pick designates the whole category; a category-wide rule makes the other window red', async ({ app, page }, testInfo) => {
	await app.open();
	const weather = app.categoryWindow('Weather effects');
	const sea = app.categoryWindow('Sea creatures');
	await categoryButton(usedRow(app, 'Weather effects', 'puddles reflections')).click();
	await expect(categoryButton(usedRow(app, 'Weather effects', 'puddles reflections'))).toHaveAttribute('aria-pressed', 'true');
	await expectVisualState(weather, 'associated');
	await expectVisualState(subPromptRow(weather, 'lightning bolts'), 'associated');
	await expectVisualState(subPromptRow(weather, 'puddles reflections'), 'associated');
	await expectVisualState(sea, 'forbidden');
	await expectVisualState(subPromptRow(sea, 'jellyfish'), 'forbidden');
	await expectVisualState(subPromptRow(sea, 'coral reef'), 'forbidden');
	// The other windows are untouched.
	for (const name of FIXTURE_CATEGORIES.filter((category) => category !== 'Weather effects' && category !== 'Sea creatures')) {
		await expect(app.categoryWindow(name)).not.toHaveAttribute('data-visual-state', /forbidden|associated/);
	}
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'weather-category-source');

	// A C pick in the source's own category only clears the source.
	await categoryButton(usedRow(app, 'Weather effects', 'puddles reflections')).click();
	await expectVisualState(weather, null);
	await expectVisualState(sea, 'indirectlyDisabled');
});

test('rules created in the Used pane survive a reload', async ({ app, page, backend }) => {
	const rule = 'specific:Background:neon city street, rain x specific:Weather effects:puddles reflections';
	await app.open();
	await promptButton(usedRow(app, 'Background', 'neon city street, rain')).click();
	const added = rulesWritten(page, (rules) => rules.includes(rule));
	await promptButton(usedRow(app, 'Weather effects', 'puddles reflections')).click();
	await added;
	expect((await storedRules(backend)).map(describeRule)).toContain(rule);

	await page.reload();
	await app.open();
	await promptButton(usedRow(app, 'Background', 'neon city street, rain')).click();
	await expectVisualState(subPromptRow(app.categoryWindow('Weather effects'), 'puddles reflections'), 'forbidden');
	await expectVisualState(app.categoryWindow('Weather effects'), 'forbidden');
	// The source is not persisted: after a reload nothing is picked.
	await page.reload();
	await app.open();
	await expectVisualState(app.categoryWindow('Weather effects'), null);
	await expect(app.pane('Used sub-prompts').getByRole('status')).toHaveText(PICK_HINT);
});

test.describe('without any output', () => {
	test.use({ e2eOptions: { remove: ['output'] } });

	test('the Used pane shows its empty state and no row is used by an output', async ({ app, page }, testInfo) => {
		await app.open();
		const used = app.pane('Used sub-prompts');
		await expect(used.getByText('No selected sub-prompts for the current image.')).toBeVisible();
		await expect(used.getByRole('list', { name: 'Used sub-prompts' })).toHaveCount(0);
		await expectVisualState(subPromptRow(app.categoryWindow('Outfit'), 'red dress'), null);
		// Without an output the locked subject shows its lock.
		await expectVisualState(subPromptRow(app.categoryWindow('Subject'), '1girl, silver hair'), 'locked');
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(used, testInfo, 'used-empty');
	});
});
