// Semantic state colors in the real browser, dark and light (projects): every visual state of the sub-prompt rows,
// the category windows and the Used sub-prompts pane shows the tokens of src/ui/stateColors.ts (browser-computed
// colors), with readable contrast (text 4.5:1, state borders and icons 3:1), a non-color cue (icon, dashed border,
// italic / line-through, accessible description) and stable element baselines.
import type { Locator, Page } from '@playwright/test';
import { ACTION_COLORS, STATE_COLORS, type VisualState } from '../../src/ui/stateColors';
import type { AppDriver } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { computedStyle, contrastRatio, MIN_GRAPHICS_CONTRAST, MIN_TEXT_CONTRAST, paintedBackground, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import {
	categoryButton,
	expectFrameColors,
	expectSurfaceColors,
	expectVisualState,
	promptButton,
	subPromptRow,
	subPromptText,
	tagButton,
	usedRow,
	windowHeader,
} from './categoryDriver';

/** States whose border identifies them (skipped keeps the neutral card stroke: its cues are the muted, struck-through
 *  text and the checked Skip toggle). */
const BORDER_STATES: readonly VisualState[] = ['forbiddenLocked', 'forbidden', 'associated', 'current', 'locked', 'indirectlyDisabled'];

/** Rows whose text is preceded by the state icon (locked and skipped show theirs on the checked toggles). */
const ROW_ICON_STATES: readonly VisualState[] = ['forbiddenLocked', 'forbidden', 'associated', 'current', 'indirectlyDisabled'];

async function iconColor(button: Locator): Promise<string> {
	return computedStyle(button.locator('.fui-Button__icon'), 'color');
}

/** Every check of one sub-prompt row in `state`: attribute, computed tokens, contrast, icon and description. */
async function expectRowState(page: Page, window: Locator, text: string, state: VisualState): Promise<void> {
	const row = subPromptRow(window, text);
	await expectVisualState(row, state);
	await expectSurfaceColors(page, row, state);

	const rowBackground = await computedStyle(row, 'background-color');
	const textColor = await computedStyle(subPromptText(window, text), 'color');
	expect(contrastRatio(textColor, rowBackground), `${state} row text contrast`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
	if (BORDER_STATES.includes(state)) {
		const border = await computedStyle(row, 'border-top-color');
		expect(contrastRatio(border, rowBackground), `${state} row border vs its background`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
		expect(contrastRatio(border, await paintedBackground(row.locator('xpath=..'))), `${state} row border vs the window`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
	}

	await expect(subPromptText(window, text)).toHaveAccessibleDescription(STATE_COLORS[state].label);
	const icon = row.locator(`[data-state-icon="${state}"]`);
	if (ROW_ICON_STATES.includes(state)) {
		await expect(icon).toBeVisible();
		const accent = await computedStyle(icon, 'color');
		expect(accent).toBe(await resolveColor(page, STATE_COLORS[state].accent));
		expect(contrastRatio(accent, rowBackground), `${state} icon contrast`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
	} else {
		await expect(icon).toHaveCount(0);
	}
	if (state === 'indirectlyDisabled') {
		expect(await computedStyle(subPromptText(window, text), 'font-style')).toBe('italic');
	}
	if (state === 'skipped') {
		expect(await computedStyle(subPromptText(window, text), 'text-decoration-line')).toContain('line-through');
	}
}

/** Every check of one category window in `state`: attribute, frame and header tokens, contrast, icon, description. */
async function expectWindowState(page: Page, app: AppDriver, name: string, state: VisualState | null): Promise<void> {
	const window = app.categoryWindow(name);
	await expectVisualState(window, state);
	if (state === null) {
		await expect(window).not.toHaveAttribute('aria-description');
		expect(await computedStyle(window, 'border-top-style')).toBe('solid');
		return;
	}
	await expectFrameColors(page, window, state);
	await expect(window).toHaveAttribute('aria-description', STATE_COLORS[state].label);
	await expect(windowHeader(window).getByRole('img', { name: STATE_COLORS[state].label })).toBeVisible();
	if (BORDER_STATES.includes(state)) {
		const frame = await computedStyle(window, 'border-top-color');
		expect(contrastRatio(frame, await paintedBackground(app.workspace())), `${state} frame vs the workspace`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
	}
	const header = windowHeader(window);
	const headerBackground = await computedStyle(header, 'background-color');
	const stateIcon = header.getByRole('img', { name: STATE_COLORS[state].label });
	expect(contrastRatio(await computedStyle(stateIcon, 'color'), headerBackground), `${state} header icon contrast`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
}

/** Checks of one Used sub-prompts endpoint (P, C or tag chip) in `state`. */
async function expectEndpointState(page: Page, button: Locator, state: VisualState): Promise<void> {
	await expectVisualState(button, state);
	await expectSurfaceColors(page, button, state);
	await expect(button).toHaveAccessibleDescription(STATE_COLORS[state].label);
	const background = await computedStyle(button, 'background-color');
	expect(contrastRatio(await computedStyle(button, 'color'), background), `${state} chip text contrast`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
	expect(contrastRatio(await computedStyle(button, 'border-top-color'), background), `${state} chip border contrast`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
	await expect(button.locator('.fui-Button__icon')).toBeVisible();
	await expect.poll(() => iconColor(button), { message: `${state} chip icon` }).toBe(await resolveColor(page, STATE_COLORS[state].accent));
}

test.describe('sub-prompt rows', () => {
	test('show every state with its tokens, contrast and non-color cues', async ({ app, page }, testInfo) => {
		await app.open();
		const subject = app.categoryWindow('Subject');
		const outfit = app.categoryWindow('Outfit');
		const background = app.categoryWindow('Background');
		const mood = app.categoryWindow('Mood');

		// Fixture: output #4 uses '1girl, silver hair' (locked) and 'smiling'; the lock makes the other subjects unreachable.
		await expectRowState(page, subject, '1girl, silver hair', 'current');
		await expectRowState(page, subject, '1boy, short hair', 'indirectlyDisabled');
		await expectRowState(page, outfit, 'armor, cape', 'skipped');
		await expectVisualState(subPromptRow(outfit, 'school uniform'), null);

		// A lock outside the current output shows the locked accent.
		await subPromptRow(mood, 'crying').getByRole('button', { name: 'Lock sub-prompt' }).click();
		await expectRowState(page, mood, 'crying', 'locked');

		// P on 'red dress': the source is associated, 'beach at sunset' is forbidden with it.
		await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
		await expectRowState(page, outfit, 'red dress', 'associated');
		await expectRowState(page, background, 'beach at sunset', 'forbidden');
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'red-dress-source');

		// P on the locked '1girl, silver hair': 'swimsuit' is forbidden by a locked prompt.
		await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
		await promptButton(usedRow(app, 'Subject', '1girl, silver hair')).click();
		await expectRowState(page, outfit, 'swimsuit', 'forbiddenLocked');
		await expectRowState(page, subject, '1girl, silver hair', 'associated');
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'locked-source');
	});

	test('action intents: red Delete, filled amber active Skip, purple Lock', async ({ app, page }, testInfo) => {
		await app.open();
		const outfit = app.categoryWindow('Outfit');
		const deleteButton = subPromptRow(outfit, 'red dress').getByRole('button', { name: 'Delete sub-prompt' });
		await expect.poll(() => iconColor(deleteButton)).toBe(await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
		const categoryDelete = outfit.getByRole('button', { name: 'Delete category' });
		expect(await iconColor(categoryDelete)).toBe(await resolveColor(page, ACTION_COLORS.danger.subtleForeground));

		const activeSkip = subPromptRow(outfit, 'armor, cape').getByRole('button', { name: 'Skip sub-prompt' });
		await expect(activeSkip).toHaveAttribute('aria-pressed', 'true');
		expect(await computedStyle(activeSkip, 'background-color')).toBe(await resolveColor(page, ACTION_COLORS.warning.background));
		expect(await iconColor(activeSkip)).toBe(await resolveColor(page, ACTION_COLORS.warning.foreground));
		expect(contrastRatio(await iconColor(activeSkip), await computedStyle(activeSkip, 'background-color'))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
		const activeSkipBorder = await computedStyle(activeSkip, 'border-top-color');
		expect(activeSkipBorder).toBe(await resolveColor(page, ACTION_COLORS.warning.border));
		expect(contrastRatio(activeSkipBorder, await paintedBackground(subPromptRow(outfit, 'armor, cape')))).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
		const inactiveSkip = subPromptRow(outfit, 'red dress').getByRole('button', { name: 'Skip sub-prompt' });
		expect(await computedStyle(inactiveSkip, 'background-color')).not.toBe(await resolveColor(page, ACTION_COLORS.warning.background));

		const lighting = app.categoryWindow('Lighting');
		const skipCategory = lighting.getByRole('button', { name: 'Skip category' });
		await expect(skipCategory).toHaveAttribute('aria-pressed', 'true');
		expect(await computedStyle(skipCategory, 'background-color')).toBe(await resolveColor(page, ACTION_COLORS.warning.background));

		const lock = subPromptRow(app.categoryWindow('Subject'), '1girl, silver hair').getByRole('button', { name: 'Lock sub-prompt' });
		await expect(lock).toHaveAttribute('aria-pressed', 'true');
		const lockColor = await iconColor(lock);
		expect(lockColor).toBe(await resolveColor(page, STATE_COLORS.locked.accent));
		expect(contrastRatio(lockColor, await paintedBackground(lock))).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
		await app.parkPointer();
		await saveScreenshot(app.categoryWindow('Subject'), testInfo, 'subject-locked');
	});
});

test.describe('category windows', () => {
	test('show every window state with frame, header tint, icon and description; element baselines', async ({ app, page }, testInfo) => {
		await app.open();
		await app.parkPointer();

		// Fixture: Lighting is skipped, Sea creatures unreachable ('underwater' is never selected), the others plain.
		await expectWindowState(page, app, 'Lighting', 'skipped');
		await expectWindowState(page, app, 'Sea creatures', 'indirectlyDisabled');
		await expectWindowState(page, app, 'Weather effects', null);
		await expectBaseline(app.categoryWindow('Lighting'), 'window-skipped.png');
		await expectBaseline(app.categoryWindow('Sea creatures'), 'window-indirectly-disabled.png');
		await expectBaseline(app.categoryWindow('Weather effects'), 'window-plain.png');

		// P on 'red dress': its window is associated, Background (beach at sunset) forbidden.
		await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
		await app.parkPointer();
		await expectWindowState(page, app, 'Outfit', 'associated');
		await expectWindowState(page, app, 'Background', 'forbidden');
		await expectWindowState(page, app, 'Subject', null);
		await assertAppVisible(page);
		await saveScreenshot(app.categoryWindow('Outfit'), testInfo, 'outfit-associated');
		await saveScreenshot(app.categoryWindow('Background'), testInfo, 'background-forbidden');
		await expectBaseline(app.categoryWindow('Outfit'), 'window-associated.png');
		await expectBaseline(app.categoryWindow('Background'), 'window-forbidden.png');

		// P on the locked subject: Outfit (swimsuit) is forbidden by a lock, which wins over Outfit's other rows.
		await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
		await promptButton(usedRow(app, 'Subject', '1girl, silver hair')).click();
		await app.parkPointer();
		await expectWindowState(page, app, 'Outfit', 'forbiddenLocked');
		await expectWindowState(page, app, 'Subject', 'associated');
		await saveScreenshot(app.categoryWindow('Outfit'), testInfo, 'outfit-forbidden-locked');
		await expectBaseline(app.categoryWindow('Outfit'), 'window-forbidden-locked.png');

		// A forbidden highlight wins over the window's own skipped / unreachable state.
		await promptButton(usedRow(app, 'Subject', '1girl, silver hair')).click();
		await categoryButton(usedRow(app, 'Weather effects', 'puddles reflections')).click();
		await expectWindowState(page, app, 'Sea creatures', 'forbidden');
		await expectWindowState(page, app, 'Weather effects', 'associated');
	});
});

test.describe('Used sub-prompts pane', () => {
	test('P, C and tag chips show the source and forbidden endpoints; the Locked badge is purple', async ({ app, page }, testInfo) => {
		await app.open();
		const used = app.pane('Used sub-prompts');
		const outfitRow = usedRow(app, 'Outfit', 'red dress');
		const moodRow = usedRow(app, 'Mood', 'smiling');
		const subjectRow = usedRow(app, 'Subject', '1girl, silver hair');

		// The Locked badge: purple outline and lock icon (3:1), readable text (4.5:1).
		const badge = subjectRow.getByText('Locked', { exact: true });
		await expect(badge).toBeVisible();
		const badgeBackground = await paintedBackground(badge);
		const outline = await computedStyle(badge, 'border-top-color');
		expect(outline).toBe(await resolveColor(page, STATE_COLORS.locked.accent));
		expect(contrastRatio(outline, badgeBackground)).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
		const badgeIcon = await computedStyle(badge.locator('.fui-Badge__icon'), 'color');
		expect(badgeIcon).toBe(await resolveColor(page, STATE_COLORS.locked.accent));
		expect(contrastRatio(await computedStyle(badge, 'color'), badgeBackground)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
		await expectVisualState(outfitRow, null);
		await app.parkPointer();
		await expectBaseline(used, 'used-pane.png');

		// Two picks: a rule 'red dress' x 'smiling' (between two used rows).
		await promptButton(outfitRow).click();
		await promptButton(moodRow).click();
		// The source: associated (pressed), its row too; the endpoint forbidden with it: red. Under the pointer, the
		// clicked chip keeps its state border and icon (only the background shows the hover).
		await promptButton(outfitRow).click();
		await expect(promptButton(outfitRow)).toHaveAttribute('aria-pressed', 'true');
		// (polled: Fluent buttons animate their colors)
		await expect.poll(() => computedStyle(promptButton(outfitRow), 'border-top-color')).toBe(await resolveColor(page, STATE_COLORS.associated.border));
		await expect.poll(() => iconColor(promptButton(outfitRow))).toBe(await resolveColor(page, STATE_COLORS.associated.accent));
		await app.parkPointer();
		await expectEndpointState(page, promptButton(outfitRow), 'associated');
		await expectVisualState(outfitRow, 'associated');
		await expectSurfaceColors(page, outfitRow, 'associated');
		await expectEndpointState(page, promptButton(moodRow), 'forbidden');
		await expect(promptButton(moodRow)).toHaveAttribute('aria-pressed', 'false');
		await expectVisualState(moodRow, 'forbidden');
		await expectSurfaceColors(page, moodRow, 'forbidden');
		await expectVisualState(categoryButton(moodRow), null);
		await app.parkPointer();
		await saveScreenshot(used, testInfo, 'used-forbidden');
		await expectBaseline(outfitRow, 'used-row-associated.png');
		await expectBaseline(moodRow, 'used-row-forbidden.png');

		// A tag source: the chip is associated.
		await promptButton(outfitRow).click();
		const rainRow = usedRow(app, 'Background', 'neon city street, rain');
		await tagButton(rainRow, 'rain').click();
		await app.parkPointer();
		await expectEndpointState(page, tagButton(rainRow, 'rain'), 'associated');
		await expectVisualState(tagButton(rainRow, 'neon city street'), null);
		await tagButton(rainRow, 'rain').click();

		// A rule with the locked subject: forbidden by a lock (purple).
		await promptButton(subjectRow).click();
		await promptButton(moodRow).click();
		await promptButton(subjectRow).click();
		await app.parkPointer();
		await expectEndpointState(page, promptButton(moodRow), 'forbiddenLocked');
		await expectVisualState(moodRow, 'forbiddenLocked');
		await app.parkPointer();
		await saveScreenshot(used, testInfo, 'used-forbidden-locked');
		await expectBaseline(subjectRow, 'used-row-associated-locked.png');
		await expectBaseline(moodRow, 'used-row-forbidden-locked.png');
	});
});
