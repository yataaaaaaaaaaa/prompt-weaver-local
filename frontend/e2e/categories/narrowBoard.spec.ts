// The prompt board at its narrowest, in the real browser, dark and light: at 1280 x 720 with the image and generation
// regions widened (layout-store), the board region is 320 px wide; its toolbar, every card and every command of the
// card headers and sub-prompt rows stay visible, uncovered and inside the board, and nothing scrolls horizontally.
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { layoutStoreFile } from '../support/shell';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop, type Box } from '../support/visibility';
import { boardCards, boardCommands, boardSearch, boardStateFilter, cardHeader, reorderHandle, subPromptRow } from './categoryDriver';

test.use({
	viewport: SMALL_VIEWPORT,
	e2eOptions: {
		files: layoutStoreFile((layout) => ({ ...layout, widths: { viewer: 900, generation: 640 } })),
	},
});

function inside(inner: Box, outer: Box): boolean {
	return inner.x >= outer.x - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5;
}

test('a 320 px board keeps every control visible and inside, with no horizontal overflow', async ({ app, page }, testInfo) => {
	await app.open();
	const board = app.createRegion('board');
	const region = await boxOf(board);
	expect(region.width, 'the board region at its minimum width').toBeLessThanOrEqual(330);
	expect(region.width).toBeGreaterThanOrEqual(300);
	await expectNoHorizontalOverflow(board);

	// The toolbar wraps: every control is visible, uncovered, inside the board.
	for (const control of [
		boardSearch(app),
		boardStateFilter(app),
		boardCommands(app).getByRole('button', { name: 'Add category' }),
		boardCommands(app).getByRole('button', { name: 'Collapse all' }),
		boardCommands(app).getByRole('button', { name: 'Sort by priority' }),
	]) {
		await expectOnTop(control);
		expect(inside(await boxOf(control), region), 'toolbar control inside the board').toBe(true);
	}

	// One card per row, each as wide as the board allows.
	const cards = await boardCards(app).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON() as Box));
	for (const card of cards) {
		expect(inside(card, region), 'card inside the board').toBe(true);
	}
	expect(new Set(cards.map((card) => Math.round(card.x))).size, 'a single column').toBe(1);

	// Every header command and row command of the Outfit card (the longest rows) is visible and inside its card.
	const outfit = app.categoryCard('Outfit');
	const header = cardHeader(outfit);
	const frame = await boxOf(outfit);
	for (const command of [
		reorderHandle(outfit, 'Outfit'),
		header.getByRole('button', { name: 'Collapse Outfit' }),
		header.getByRole('button', { name: 'Category name: Outfit' }),
		header.getByRole('textbox', { name: 'Priority' }),
		header.getByRole('button', { name: 'Edit all sub-prompts' }),
		header.getByRole('button', { name: 'Add sub-prompt' }),
		header.getByRole('button', { name: 'Skip category' }),
		header.getByRole('button', { name: 'Delete category' }),
	]) {
		await expectOnTop(command);
		expect(inside(await boxOf(command), frame), 'header command inside the card').toBe(true);
	}
	for (const text of ['red dress', 'school uniform', 'armor, cape', 'swimsuit']) {
		for (const name of ['Skip sub-prompt', 'Lock sub-prompt', 'Delete sub-prompt']) {
			const button = subPromptRow(outfit, text).getByRole('button', { name });
			await expectOnTop(button);
			expect(inside(await boxOf(button), frame), `${text}: ${name} inside the card`).toBe(true);
		}
	}
	await expectNoHorizontalOverflow(outfit);

	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'narrow-board-1280x720');
	await saveScreenshot(board, testInfo, 'narrow-board');
	await expectBaseline(board, 'narrow-board.png');
});
