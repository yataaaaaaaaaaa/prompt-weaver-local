// Layout of the category windows in the real browser, dark and light: at the minimum window width (280 px) every
// command of the header and of the rows stays visible, inside the window and uncovered; at the smallest supported
// viewport (1280 x 720) the windows still render their states.
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { expectVisualState, subPromptRow, windowHeader } from './categoryDriver';

test('a category window at its minimum width keeps every command visible and inside the window', async ({ app, page }, testInfo) => {
	await app.open();
	const outfit = app.categoryWindow('Outfit');
	await app.bringToFront(outfit);
	// Shrink with the keyboard until the window stops getting narrower (FloatingPane's minimum width).
	const grip = outfit.getByRole('button', { name: 'Resize Outfit category' });
	await grip.focus();
	let width = (await outfit.boundingBox())?.width ?? 0;
	for (let step = 0; step < 20; step += 1) {
		await grip.press('Shift+ArrowLeft');
		const next = (await outfit.boundingBox())?.width ?? 0;
		if (next === width) {
			break;
		}
		width = next;
	}
	// The focused grip shows its tooltip: leave it so the tooltip closes (it would cover the last row).
	await grip.blur();
	await app.parkPointer();
	await expect(page.getByRole('tooltip')).toHaveCount(0);
	const frame = await outfit.boundingBox();
	if (!frame) {
		throw new Error('no Outfit window box');
	}
	expect(frame.width, 'the narrowest category window').toBeLessThanOrEqual(300);

	// The header is one row: every command is on it, inside the window, not covered.
	const header = windowHeader(outfit);
	const headerBox = await header.boundingBox();
	const commands = [
		header.getByRole('button', { name: 'Move Outfit category' }),
		header.getByRole('textbox', { name: 'Priority' }),
		header.getByRole('button', { name: 'Edit all sub-prompts' }),
		header.getByRole('button', { name: 'Add sub-prompt' }),
		header.getByRole('button', { name: 'Skip category' }),
		header.getByRole('button', { name: 'Delete category' }),
		header.getByRole('button', { name: 'Send Outfit category to back' }),
	];
	for (const command of commands) {
		await expectOnTop(command);
		const box = await command.boundingBox();
		expect(box && headerBox && box.y >= headerBox.y && box.y + box.height <= headerBox.y + headerBox.height, 'command on the header row').toBe(true);
		expect(box && box.x >= frame.x && box.x + box.width <= frame.x + frame.width, 'command inside the window').toBe(true);
	}

	// Rows keep their three commands; long texts wrap.
	for (const text of ['red dress', 'school uniform', 'armor, cape', 'swimsuit']) {
		for (const name of ['Skip sub-prompt', 'Lock sub-prompt', 'Delete sub-prompt']) {
			const button = subPromptRow(outfit, text).getByRole('button', { name });
			await expectOnTop(button);
			const box = await button.boundingBox();
			expect(box && box.x + box.width <= frame.x + frame.width, `${text}: ${name} inside the window`).toBe(true);
		}
	}
	await app.parkPointer();
	await saveScreenshot(outfit, testInfo, 'outfit-min-width');
	await expectBaseline(outfit, 'window-min-width.png');
});

test('at 1280 x 720 the category windows render with their states', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	await assertAppVisible(page);
	const subject = app.categoryWindow('Subject');
	await expect(subject).toBeVisible();
	await expectVisualState(subPromptRow(subject, '1girl, silver hair'), 'current');
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'workspace-1280x720');
});
