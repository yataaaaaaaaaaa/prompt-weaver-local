// Category flows on the prompt board in the real app, dark and light: create (the new card is revealed with its name
// editor open), rename (Enter commits, Escape cancels), priority, activation text (switches 'indirectly disabled' on
// and off), skip / unskip, lock / unlock, add / edit / delete sub-prompts, bulk edit (Ctrl+Enter applies, Escape
// cancels) and delete (dialog Cancel, then confirm). Every change reaches the persisted categories store.
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import type { Category } from '../../src/domain/categories';
import {
	boardCommands,
	categoriesWritten,
	describeRule,
	expectVisualState,
	rulesWritten,
	storedCategories,
	storedRules,
	subPromptItem,
	subPromptRow,
	subPromptText,
} from './categoryDriver';

function named(categories: Category[], name: string): Category | undefined {
	return categories.find((category) => category.text === name);
}

test('create a category, rename it (Enter commits, Escape cancels) and set its priority', async ({ app, page, backend }, testInfo) => {
	await app.open();
	await boardCommands(app).getByRole('button', { name: 'Add category' }).click();
	const created = app.categoryCard('new-category');
	await expect(created).toBeVisible();
	await expect(created.getByRole('button', { name: 'Sub-prompt: Click to edit' })).toBeVisible();

	// The new card is revealed with its name editor open, the name selected: typing replaces it. Escape cancels.
	const nameEditor = created.getByRole('textbox', { name: 'Category name' });
	await expect(nameEditor).toBeFocused();
	await expectOnTop(nameEditor);
	await page.keyboard.type('Discarded');
	await expect(nameEditor).toHaveValue('Discarded');
	await app.parkPointer();
	await saveScreenshot(created, testInfo, 'name-editor');
	await nameEditor.press('Escape');
	await expect(created.getByRole('button', { name: 'Category name: new-category' })).toBeFocused();

	// Enter commits: the card follows the new name.
	await created.getByRole('button', { name: 'Category name: new-category' }).click();
	await created.getByRole('textbox', { name: 'Category name' }).fill('Accessories');
	await created.getByRole('textbox', { name: 'Category name' }).press('Enter');
	const accessories = app.categoryCard('Accessories');
	await expect(accessories).toBeVisible();
	await expect(app.categoryCard('new-category')).toHaveCount(0);

	const priority = accessories.getByRole('textbox', { name: 'Priority' });
	const written = categoriesWritten(page, (categories) => named(categories, 'Accessories')?.priority === 2.5);
	await priority.fill('2.5');
	await written;
	expect(named(await storedCategories(backend), 'Accessories')?.priority).toBe(2.5);
	await app.parkPointer();
	await assertAppVisible(page);
	await saveScreenshot(accessories, testInfo, 'created-category');
});

test('renaming a category to an existing name is rejected with a notification', async ({ app, page }) => {
	await app.open();
	const mood = app.categoryCard('Mood');
	await mood.getByRole('button', { name: 'Category name: Mood' }).click();
	await mood.getByRole('textbox', { name: 'Category name' }).fill('Outfit');
	await mood.getByRole('textbox', { name: 'Category name' }).press('Enter');
	await expect(page.getByText("A category named 'Outfit' already exists.")).toBeVisible();
	await expect(app.categoryCard('Mood')).toBeVisible();
});

test('the activation text switches a category between reachable and indirectly disabled', async ({ app, page, backend }) => {
	await app.open();
	const sea = app.categoryCard('Sea creatures');
	await expectVisualState(sea, 'indirectlyDisabled');
	await expectVisualState(subPromptRow(sea, 'jellyfish'), 'indirectlyDisabled');

	// A sub-prompt selected before it now contains 'underwater': reachable.
	const background = app.categoryCard('Background');
	await subPromptText(background, 'castle courtyard').click();
	await background.getByRole('textbox', { name: 'Sub-prompt' }).fill('castle courtyard, underwater');
	await background.getByRole('textbox', { name: 'Sub-prompt' }).press('Enter');
	await expectVisualState(sea, null);
	await expectVisualState(subPromptRow(sea, 'jellyfish'), null);

	// Its own activation text changed to a term nothing selects: unreachable again.
	await sea.getByRole('button', { name: 'Activation text: underwater' }).click();
	await sea.getByRole('textbox', { name: 'Activation text' }).fill('deep sea');
	await sea.getByRole('textbox', { name: 'Activation text' }).press('Enter');
	await expectVisualState(sea, 'indirectlyDisabled');
	await expect(sea.getByRole('button', { name: 'Activation text: deep sea' })).toBeVisible();

	// Cleared: always active.
	await sea.getByRole('button', { name: 'Activation text: deep sea' }).click();
	await sea.getByRole('textbox', { name: 'Activation text' }).fill('');
	const written = categoriesWritten(page, (categories) => named(categories, 'Sea creatures')?.activation_text === '');
	await sea.getByRole('textbox', { name: 'Activation text' }).press('Enter');
	await written;
	await expectVisualState(sea, null);
	await expect(sea.getByRole('button', { name: 'Activation text: Activation text (optional)' })).toBeVisible();
	expect(named(await storedCategories(backend), 'Sea creatures')?.activation_text).toBe('');
});

test('skip and unskip a category and a sub-prompt', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const mood = app.categoryCard('Mood');
	const skipCategory = mood.getByRole('button', { name: 'Skip category' });
	await expect(skipCategory).toHaveAttribute('aria-pressed', 'false');
	const skippedWritten = categoriesWritten(page, (categories) => named(categories, 'Mood')?.state === 'skip');
	await skipCategory.click();
	await skippedWritten;
	await expect(skipCategory).toHaveAttribute('aria-pressed', 'true');
	await expectVisualState(mood, 'skipped');
	await expectVisualState(subPromptRow(mood, 'crying'), 'skipped');
	await app.parkPointer();
	await saveScreenshot(mood, testInfo, 'mood-skipped');
	expect(named(await storedCategories(backend), 'Mood')?.state).toBe('skip');
	await skipCategory.click();
	await expectVisualState(mood, null);
	await expectVisualState(subPromptRow(mood, 'crying'), null);

	const skipCrying = subPromptRow(mood, 'crying').getByRole('button', { name: 'Skip sub-prompt' });
	await skipCrying.click();
	await expect(skipCrying).toHaveAttribute('aria-pressed', 'true');
	await expectVisualState(subPromptRow(mood, 'crying'), 'skipped');
	const unskipped = categoriesWritten(page, (categories) => named(categories, 'Mood')?.subPrompts[2].state === 'normal');
	await skipCrying.click();
	await unskipped;
	await expectVisualState(subPromptRow(mood, 'crying'), null);
	expect(named(await storedCategories(backend), 'Mood')?.subPrompts.map((item) => item.state)).toEqual(['normal', 'skip', 'normal']);
});

test('lock and unlock: one lock per category, the others become unreachable', async ({ app }) => {
	await app.open();
	const subject = app.categoryCard('Subject');
	const lockOf = (text: string) => subPromptRow(subject, text).getByRole('button', { name: 'Lock sub-prompt' });
	await expect(lockOf('1girl, silver hair')).toHaveAttribute('aria-pressed', 'true');

	// Locking another sub-prompt moves the lock.
	await lockOf('2girls, twins').click();
	await expect(lockOf('2girls, twins')).toHaveAttribute('aria-pressed', 'true');
	await expect(lockOf('1girl, silver hair')).toHaveAttribute('aria-pressed', 'false');
	await expectVisualState(subPromptRow(subject, '2girls, twins'), 'locked');
	await expectVisualState(subPromptRow(subject, '1boy, short hair'), 'indirectlyDisabled');
	// '1girl, silver hair' is used by the current output: brand wins over unreachable.
	await expectVisualState(subPromptRow(subject, '1girl, silver hair'), 'current');

	// The Outfit 'swimsuit' was unreachable because of the '1girl' lock only.
	await expectVisualState(subPromptRow(app.categoryCard('Outfit'), 'swimsuit'), null);

	await lockOf('2girls, twins').click();
	await expect(lockOf('2girls, twins')).toHaveAttribute('aria-pressed', 'false');
	await expectVisualState(subPromptRow(subject, '2girls, twins'), null);
	await expectVisualState(subPromptRow(subject, '1boy, short hair'), null);
});

test('add, edit and delete sub-prompts', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const mood = app.categoryCard('Mood');
	await mood.getByRole('button', { name: 'Add sub-prompt' }).click();
	const empty = subPromptText(mood, 'Click to edit');
	await expect(empty).toBeVisible();
	await empty.click();
	const editor = mood.getByRole('textbox', { name: 'Sub-prompt' });
	await editor.fill('angry');
	await app.parkPointer();
	await saveScreenshot(mood, testInfo, 'sub-prompt-editor');
	await editor.press('Enter');
	await expect(subPromptText(mood, 'angry')).toBeVisible();

	// Shift+Enter inserts a newline, Escape cancels the edit.
	await subPromptText(mood, 'angry').click();
	await mood.getByRole('textbox', { name: 'Sub-prompt' }).press('Shift+Enter');
	await mood.getByRole('textbox', { name: 'Sub-prompt' }).press('Escape');
	await expect(subPromptText(mood, 'angry')).toBeFocused();

	// Editing a prompt named by a rule rewrites the rule ('crying' x the 'rain' tag of Background).
	await subPromptText(mood, 'crying').click();
	await mood.getByRole('textbox', { name: 'Sub-prompt' }).fill('crying, tears');
	const ruleRenamed = rulesWritten(page, (rules) => rules.includes('specific:Mood:crying, tears x tag:Background:rain'));
	await mood.getByRole('textbox', { name: 'Sub-prompt' }).press('Enter');
	await ruleRenamed;
	await expect(subPromptText(mood, 'crying, tears')).toBeVisible();

	const deleted = categoriesWritten(page, (categories) => !named(categories, 'Mood')?.subPrompts.some((item) => item.text === 'angry'));
	await subPromptRow(mood, 'angry').getByRole('button', { name: 'Delete sub-prompt' }).click();
	await deleted;
	await expect(subPromptItem(mood, 'angry')).toHaveCount(0);
	expect(named(await storedCategories(backend), 'Mood')?.subPrompts.map((item) => item.text)).toEqual(['smiling', 'serious expression', 'crying, tears']);
	expect((await storedRules(backend)).map(describeRule)).toContain('specific:Mood:crying, tears x tag:Background:rain');
});

test('bulk edit: Ctrl+Enter applies, Escape cancels', async ({ app, page }, testInfo) => {
	await app.open();
	const weather = app.categoryCard('Weather effects');
	await weather.getByRole('button', { name: 'Edit all sub-prompts' }).click();
	const bulk = weather.getByRole('textbox', { name: 'All sub-prompts' });
	await expect(bulk).toBeFocused();
	await expect(bulk).toHaveValue('lightning bolts\n|\npuddles reflections');
	await app.parkPointer();
	await assertAppVisible(page);
	await saveScreenshot(weather, testInfo, 'bulk-editor');

	await bulk.fill('discarded');
	await bulk.press('Escape');
	await expect(subPromptText(weather, 'lightning bolts')).toBeVisible();
	await expect(weather.getByRole('textbox', { name: 'All sub-prompts' })).toHaveCount(0);

	await weather.getByRole('button', { name: 'Edit all sub-prompts' }).click();
	await weather.getByRole('textbox', { name: 'All sub-prompts' }).fill('lightning bolts\n|\nsnowfall\n|\nfog');
	await weather.getByRole('textbox', { name: 'All sub-prompts' }).press('Control+Enter');
	await expect(weather.getByRole('list', { name: 'Sub-prompts' }).getByRole('listitem')).toHaveText(['lightning bolts', 'snowfall', 'fog']);
});

test('delete a category: Cancel keeps it, Delete removes it and its rules', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const weather = app.categoryCard('Weather effects');
	await weather.getByRole('button', { name: 'Delete category' }).click();
	const dialog = page.getByRole('alertdialog', { name: "Delete category 'Weather effects'?" });
	await expect(dialog).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'delete-dialog');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(weather).toBeVisible();
	// The focus returns to the button that opened the dialog.
	await expect(weather.getByRole('button', { name: 'Delete category' })).toBeFocused();

	await weather.getByRole('button', { name: 'Delete category' }).click();
	const categoryRemoved = categoriesWritten(page, (categories) => !named(categories, 'Weather effects'));
	const rulesRemoved = rulesWritten(page, (rules) => !rules.join('|').includes('Weather effects'));
	await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
	await Promise.all([categoryRemoved, rulesRemoved]);
	await expect(app.categoryCard('Weather effects')).toHaveCount(0);
	expect(named(await storedCategories(backend), 'Weather effects')).toBeUndefined();
	expect((await storedRules(backend)).map(describeRule).join('|')).not.toContain('Weather effects');
	await assertAppVisible(page);
});
