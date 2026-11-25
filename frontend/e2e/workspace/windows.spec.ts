// Workspace windows (FloatingPane) in the real browser: z-order (click to front, Send to back, overlays above every
// window), moving and resizing with the mouse and the keyboard, the persisted layout surviving a reload, the resize
// grip never covering content, and the window chrome baseline.
import { ACTION_COLORS } from '../../src/ui/stateColors';
import { expectBaseline } from '../support/baselines';
import { computedStyle, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectOnTop, intersects } from '../support/visibility';
import {
	drawnRect,
	hasRect,
	savedWorkspace,
	storedWorkspace,
	windowHandles,
	windowOnTopAt,
	windowParts,
} from './workspace';

// FloatingPane keyboard steps (src/workspace/FloatingPane.tsx KEYBOARD_STEP / KEYBOARD_STEP_LARGE).
const STEP = 8;
const LARGE_STEP = 40;

test('a clicked window comes to the front and "Send to back" puts it behind the others', async ({ app, page }, testInfo) => {
	await app.open();
	const generation = app.pane('Generation');
	const used = app.pane('Used sub-prompts');
	// Move the Used sub-prompts pane (drawn above) up over the bottom of the Generation pane.
	await windowHandles(used, 'Used sub-prompts').move.focus();
	await page.keyboard.press('Shift+ArrowUp');
	await page.keyboard.press('Shift+ArrowUp');
	const [generationBox, usedBox] = [await boxOf(generation), await boxOf(used)];
	const top = Math.max(generationBox.y, usedBox.y);
	const overlap = { x: usedBox.x, y: top, width: usedBox.width, height: generationBox.y + generationBox.height - top };
	expect(overlap.height).toBeGreaterThan(40);
	expect(await windowOnTopAt(page, overlap)).toBe('Used sub-prompts');

	// A click on a window brings it to the front (here its move handle: a click without a drag moves nothing).
	await windowHandles(generation, 'Generation').move.click();
	await expect.poll(() => windowOnTopAt(page, overlap)).toBe('Generation');
	await expectOnTop(generation);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'generation-in-front');

	await generation.getByRole('button', { name: 'Send Generation to back', exact: true }).click();
	await expect.poll(() => windowOnTopAt(page, overlap)).toBe('Used sub-prompts');
	await expectOnTop(used);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'generation-sent-back');
});

test('a pane shown from the app bar opens in front of the windows it overlaps', async ({ app, page }) => {
	await app.open();
	const subject = app.categoryWindow('Subject');
	const subjectBox = await boxOf(subject);
	expect(await windowOnTopAt(page, subjectBox)).toBe('Subject category');
	await app.paneToggle('Characters').click();
	await app.parkPointer({ blur: true });
	await expectOnTop(app.pane('Characters'));
	expect(await windowOnTopAt(page, subjectBox)).toBe('Characters');
});

test('tooltips, menus and dialogs show above every window', async ({ app, page }, testInfo) => {
	await app.open();
	// The top window's header tooltip.
	const generation = app.pane('Generation');
	await generation.getByRole('button', { name: 'Close Generation', exact: true }).hover();
	await expectOnTop(page.getByRole('tooltip', { name: 'Close Generation' }));
	await assertAppVisible(page, { allowOverlays: true });

	// A dropdown list of a window opened over the windows below it.
	await app.parkPointer({ blur: true });
	const character = generation.getByRole('combobox', { name: 'Active character' });
	await character.click();
	const listbox = page.getByRole('listbox');
	await expectOnTop(listbox);
	await assertAppVisible(page, { allowOverlays: true });
	await page.keyboard.press('Escape');
	await expect(listbox).toHaveCount(0);

	// A modal dialog over every window (the category deletion confirmation), cancelled.
	await app.categoryWindow('Sea creatures').getByRole('button', { name: 'Delete category', exact: true }).click();
	const dialog = page.getByRole('alertdialog');
	await expectOnTop(dialog);
	await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
	// The destructive confirmation is the filled danger action (red), never the brand color.
	const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
	expect(await computedStyle(confirm, 'background-color')).toBe(await resolveColor(page, ACTION_COLORS.danger.background));
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'delete-category-dialog');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
	await expect(app.categoryWindow('Sea creatures')).toBeVisible();
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
});

test('windows move with the mouse, resize with the grip, and the layout survives a reload', async ({ app, page, backend }) => {
	await app.open();
	const generation = app.pane('Generation');
	const { move, resize } = windowHandles(generation, 'Generation');
	const before = await drawnRect(generation);
	const screenBefore = await boxOf(generation);

	// Drag the header's move handle.
	const moved = { ...before, x: before.x + 120, y: before.y + 48 };
	const movedSaved = savedWorkspace(page, (state) => hasRect(state, 'pane:controls', moved));
	const handle = await boxOf(move);
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 30, { steps: 6 });
	await page.mouse.move(handle.x + handle.width / 2 + 120, handle.y + handle.height / 2 + 48, { steps: 6 });
	await page.mouse.up();
	await expect.poll(() => drawnRect(generation)).toEqual(moved);
	const screenMoved = await boxOf(generation);
	expect(screenMoved.x - screenBefore.x).toBeCloseTo(120, 0);
	expect(screenMoved.y - screenBefore.y).toBeCloseTo(48, 0);
	await movedSaved;

	// Drag the resize grip (bottom-right corner).
	const resized = { ...moved, width: moved.width + 80, height: moved.height + 40 };
	const resizedSaved = savedWorkspace(page, (state) => hasRect(state, 'pane:controls', resized));
	const grip = await boxOf(resize);
	await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
	await page.mouse.down();
	await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2 + 40, { steps: 8 });
	await page.mouse.up();
	await expect.poll(() => drawnRect(generation)).toEqual(resized);
	await resizedSaved;
	expect((await storedWorkspace(backend)).windows['pane:controls']).toMatchObject(resized);
	await expectOnTop(generation);

	// A reload restores the stored layout.
	await page.reload();
	await expect(app.workspace()).toBeVisible();
	await expect.poll(() => drawnRect(generation)).toEqual(resized);
	await app.settle();
	await assertAppVisible(page);
});

test('windows move and resize with the arrow keys (Shift for larger steps)', async ({ app, page, backend }) => {
	await app.open();
	const used = app.pane('Used sub-prompts');
	const { move, resize } = windowHandles(used, 'Used sub-prompts');
	const start = await drawnRect(used);

	await move.focus();
	await page.keyboard.press('ArrowRight');
	await page.keyboard.press('Shift+ArrowUp');
	const moved = { ...start, x: start.x + STEP, y: start.y - LARGE_STEP };
	await expect.poll(() => drawnRect(used)).toEqual(moved);
	await expect(move).toBeFocused();

	const resized = { ...moved, width: moved.width - STEP, height: moved.height + LARGE_STEP };
	const saved = savedWorkspace(page, (state) => hasRect(state, 'pane:used', resized));
	await resize.focus();
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('Shift+ArrowDown');
	await expect.poll(() => drawnRect(used)).toEqual(resized);
	await expect(resize).toBeFocused();
	await saved;
	expect((await storedWorkspace(backend)).windows['pane:used']).toMatchObject(resized);

	// The arrow keys moved the window, not the current output (global ← → shortcuts leave the handles alone).
	await expect(app.pane('Output browser').getByText('4 / 4', { exact: true })).toBeVisible();
});

test('the resize grip has its own row and never covers window content', async ({ app, page }, testInfo) => {
	await app.open();
	const windows = app.workspace().locator(':scope > section');
	const count = await windows.count();
	expect(count).toBeGreaterThan(0);
	for (let index = 0; index < count; index += 1) {
		const window = windows.nth(index);
		const name = (await window.getAttribute('aria-label')) ?? '';
		const { body, footer } = windowParts(window);
		const grip = await boxOf(windowHandles(window, name).resize);
		const content = await boxOf(body);
		expect(intersects(grip, content), `the resize grip of '${name}' overlaps its content`).toBe(false);
		const footerBox = await boxOf(footer);
		expect(grip.y, `the grip of '${name}' sits in the footer row`).toBeGreaterThanOrEqual(footerBox.y - 0.5);
	}

	// The cases the user saw: the CFG spin button of the Generation pane and the last row's Delete of a category
	// window, scrolled to the window's bottom edge, are fully visible and clickable.
	const cfg = app.pane('Generation').locator('.fui-SpinButton', { has: page.getByRole('spinbutton', { name: 'CFG' }) });
	await expectOnTop(cfg);
	const lastDelete = app.categoryWindow('Outfit').getByRole('button', { name: 'Delete sub-prompt' }).last();
	await expectOnTop(lastDelete);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'grips');
});

test('the window chrome: header, title, commands and resize grip (baseline)', async ({ app, page }, testInfo) => {
	await app.open();
	const image = app.pane('Image');
	const { header, footer } = windowParts(image);
	await app.parkPointer({ blur: true });
	await saveScreenshot(image, testInfo, 'image-window');
	await expectBaseline(header, 'window-header.png');
	await expectBaseline(footer, 'window-footer.png');

	// Keyboard focus is visible on the header commands.
	await image.getByRole('button', { name: 'Move Image', exact: true }).focus();
	await page.keyboard.press('Tab');
	await expect(image.getByRole('button', { name: 'Send Image to back', exact: true })).toBeFocused();
	await saveScreenshot(header, testInfo, 'header-focus', { allowUniform: true });
	await expectBaseline(header, 'window-header-focus.png');
});
