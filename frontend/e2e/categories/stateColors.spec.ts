// Semantic state colors in the real browser, dark and light (projects): every visual state of the sub-prompt rows,
// the category cards of the prompt board and the Used sub-prompts list (viewer tab) shows the tokens of
// src/ui/stateColors.ts (browser-computed colors), with readable contrast (text 4.5:1, state borders and icons 3:1), a
// non-color cue (icon, dashed border, italic / line-through, accessible description) and stable element baselines.
import type { Locator, Page } from '@playwright/test';
import { ACTION_COLORS, STATE_COLORS, type VisualState } from '../../src/ui/stateColors';
import type { AppDriver } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { computedStyle, contrastRatio, MIN_GRAPHICS_CONTRAST, MIN_TEXT_CONTRAST, paintedBackground, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import {
	boardScroller,
	cardHeader,
	categoryButton,
	expectFrameColors,
	expectSurfaceColors,
	expectVisualState,
	promptButton,
	subPromptRow,
	subPromptText,
	tagButton,
	usedRow,
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
async function expectRowState(page: Page, card: Locator, text: string, state: VisualState): Promise<void> {
	const row = subPromptRow(card, text);
	await expectVisualState(row, state);
	await expectSurfaceColors(page, row, state);

	const rowBackground = await computedStyle(row, 'background-color');
	const textColor = await computedStyle(subPromptText(card, text), 'color');
	expect(contrastRatio(textColor, rowBackground), `${state} row text contrast`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
	if (BORDER_STATES.includes(state)) {
		const border = await computedStyle(row, 'border-top-color');
		expect(contrastRatio(border, rowBackground), `${state} row border vs its background`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
		expect(contrastRatio(border, await paintedBackground(row.locator('xpath=..'))), `${state} row border vs the card`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
	}

	await expect(subPromptText(card, text)).toHaveAccessibleDescription(STATE_COLORS[state].label);
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
		expect(await computedStyle(subPromptText(card, text), 'font-style')).toBe('italic');
	}
	if (state === 'skipped') {
		expect(await computedStyle(subPromptText(card, text), 'text-decoration-line')).toContain('line-through');
	}
}

/** Every check of one category card in `state`: attribute, frame and header tokens, contrast, icon, description. */
async function expectCardState(page: Page, app: AppDriver, name: string, state: VisualState | null): Promise<void> {
	const card = app.categoryCard(name);
	await expectVisualState(card, state);
	if (state === null) {
		await expect(card).not.toHaveAttribute('aria-description');
		expect(await computedStyle(card, 'border-top-style')).toBe('solid');
		await expect(cardHeader(card).getByRole('img')).toHaveCount(0);
		return;
	}
	await expectFrameColors(page, card, state);
	await expect(card).toHaveAttribute('aria-description', STATE_COLORS[state].label);
	await expect(cardHeader(card).getByRole('img', { name: STATE_COLORS[state].label })).toBeVisible();
	if (BORDER_STATES.includes(state)) {
		const frame = await computedStyle(card, 'border-top-color');
		expect(contrastRatio(frame, await paintedBackground(boardScroller(app))), `${state} frame vs the board`).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
	}
	const header = cardHeader(card);
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
		const subject = app.categoryCard('Subject');
		const outfit = app.categoryCard('Outfit');
		const background = app.categoryCard('Background');
		const mood = app.categoryCard('Mood');

		await app.showViewerTab('Used sub-prompts');
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
		const outfit = app.categoryCard('Outfit');
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

		const lighting = app.categoryCard('Lighting');
		const skipCategory = lighting.getByRole('button', { name: 'Skip category' });
		await expect(skipCategory).toHaveAttribute('aria-pressed', 'true');
		expect(await computedStyle(skipCategory, 'background-color')).toBe(await resolveColor(page, ACTION_COLORS.warning.background));

		const lock = subPromptRow(app.categoryCard('Subject'), '1girl, silver hair').getByRole('button', { name: 'Lock sub-prompt' });
		await expect(lock).toHaveAttribute('aria-pressed', 'true');
		const lockColor = await iconColor(lock);
		expect(lockColor).toBe(await resolveColor(page, STATE_COLORS.locked.accent));
		expect(contrastRatio(lockColor, await paintedBackground(lock))).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
		await app.parkPointer();
		await saveScreenshot(app.categoryCard('Subject'), testInfo, 'subject-locked');
	});
});

test.describe('category cards', () => {
	test('show every card state with frame, header tint, icon and description; element baselines', async ({ app, page }, testInfo) => {
		await app.open();
		await app.showViewerTab('Used sub-prompts');
		await app.parkPointer({ blur: true });

		// Fixture: Lighting is skipped, Sea creatures unreachable ('underwater' is never selected), the others plain.
		await expectCardState(page, app, 'Lighting', 'skipped');
		await expectCardState(page, app, 'Sea creatures', 'indirectlyDisabled');
		await expectCardState(page, app, 'Weather effects', null);
		await expectBaseline(app.categoryCard('Lighting'), 'card-skipped.png');
		await expectBaseline(app.categoryCard('Sea creatures'), 'card-indirectly-disabled.png');
		await expectBaseline(app.categoryCard('Weather effects'), 'card-plain.png');

		// P on 'red dress': its card is associated, Background (beach at sunset) forbidden.
		await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
		await app.parkPointer({ blur: true });
		await expectCardState(page, app, 'Outfit', 'associated');
		await expectCardState(page, app, 'Background', 'forbidden');
		await expectCardState(page, app, 'Subject', null);
		await assertAppVisible(page);
		await saveScreenshot(app.categoryCard('Outfit'), testInfo, 'outfit-associated');
		await saveScreenshot(app.categoryCard('Background'), testInfo, 'background-forbidden');
		await expectBaseline(app.categoryCard('Outfit'), 'card-associated.png');
		await expectBaseline(app.categoryCard('Background'), 'card-forbidden.png');

		// P on the locked subject: Outfit (swimsuit) is forbidden by a lock, which wins over Outfit's other rows.
		await promptButton(usedRow(app, 'Outfit', 'red dress')).click();
		await promptButton(usedRow(app, 'Subject', '1girl, silver hair')).click();
		await app.parkPointer({ blur: true });
		await expectCardState(page, app, 'Outfit', 'forbiddenLocked');
		await expectCardState(page, app, 'Subject', 'associated');
		await saveScreenshot(app.categoryCard('Outfit'), testInfo, 'outfit-forbidden-locked');
		await expectBaseline(app.categoryCard('Outfit'), 'card-forbidden-locked.png');

		// A forbidden highlight wins over the card's own skipped / unreachable state.
		await promptButton(usedRow(app, 'Subject', '1girl, silver hair')).click();
		await categoryButton(usedRow(app, 'Weather effects', 'puddles reflections')).click();
		await expectCardState(page, app, 'Sea creatures', 'forbidden');
		await expectCardState(page, app, 'Weather effects', 'associated');
	});
});

test.describe('Used sub-prompts list', () => {
	test('P, C and tag chips show the source and forbidden endpoints; the Locked badge is purple', async ({ app, page }, testInfo) => {
		await app.open();
		await app.showViewerTab('Used sub-prompts');
		const used = app.usedSubPrompts();
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
		await expectBaseline(used, 'used-list.png');

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
