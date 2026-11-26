// Journey at scale, in the real browser, dark and light: a prompt board of 42 synthetic categories (more than a real
// long-used setup) stays usable: the responsive grid never overlaps cards, the search finds one category among all,
// Collapse all fits every header within about two screens of the board, and a card is reordered by keyboard and by a
// pointer drag that auto-scrolls the board, persisted.
import { expect, test } from '../support/fixtures';
import { STORE_NAMES, storeFile } from '../support/backend';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, intersects, type Box } from '../support/visibility';
import {
	boardCards,
	boardCommands,
	boardScroller,
	boardSearch,
	boardWritten,
	reorderHandle,
	scaleCategories,
	shownCategoryNames,
	storedBoard,
} from '../categories/categoryDriver';

const CATEGORIES = scaleCategories(42);
const NAMES = CATEGORIES.map((category) => category.text);

test.use({
	e2eOptions: {
		files: {
			...storeFile(STORE_NAMES.categories, { categories: CATEGORIES }, 0),
			...storeFile(STORE_NAMES.board, { order: [], collapsed: [] }, 0),
		},
	},
});

test('42 categories: a grid without overlap, search, Collapse all within two screens, reorder', async ({ app, page, backend }, testInfo) => {
	await app.open();
	await expect(boardCards(app)).toHaveCount(42);
	await expect(app.createRegion('board').getByText('42 categories', { exact: true })).toBeVisible();
	expect(await shownCategoryNames(app)).toEqual(NAMES);
	await app.parkPointer();
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'board-42');

	// No two cards overlap (scrolled out of view included).
	const boxes = await boardCards(app).evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON() as Box));
	for (let left = 0; left < boxes.length; left += 1) {
		for (let right = left + 1; right < boxes.length; right += 1) {
			expect(intersects(boxes[left], boxes[right]), `${NAMES[left]} overlaps ${NAMES[right]}`).toBe(false);
		}
	}

	// The search finds one category among 42 (by a sub-prompt text).
	await boardSearch(app).fill('science fiction option 2');
	await expect.poll(() => shownCategoryNames(app)).toEqual(['Science fiction']);
	await expect(app.createRegion('board').getByText('1 of 42 categories', { exact: true })).toBeVisible();
	await boardSearch(app).fill('');
	await expect(boardCards(app)).toHaveCount(42);

	// Collapse all: every header within about two screens of the board.
	await boardCommands(app).getByRole('button', { name: 'Collapse all' }).click();
	await expect(app.createRegion('board').getByRole('list', { name: 'Sub-prompts' })).toHaveCount(0);
	const { scrollHeight, clientHeight } = await boardScroller(app).evaluate((element) => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
	expect(scrollHeight, 'collapsed board height').toBeLessThanOrEqual(2 * clientHeight);
	await app.parkPointer({ blur: true });
	await saveScreenshot(app.createRegion('board'), testInfo, 'board-42-collapsed');
	await boardCommands(app).getByRole('button', { name: 'Expand all' }).click();
	await expect(app.createRegion('board').getByRole('list', { name: 'Sub-prompts' })).toHaveCount(42);

	// Keyboard: Quality (40th) to the front.
	const toFront = boardWritten(page, (board) => board.order[0] === 'quality');
	await reorderHandle(app.categoryCard('Quality'), 'Quality').focus();
	await page.keyboard.press('Home');
	await toFront;
	expect((await shownCategoryNames(app)).slice(0, 2)).toEqual(['Quality', 'Subject']);

	// Pointer: Subject dragged to the bottom edge of the board (it scrolls to the end), dropped after the last card.
	await boardScroller(app).evaluate((element) => {
		element.scrollTop = 0;
	});
	const handle = await boxOf(reorderHandle(app.categoryCard('Subject'), 'Subject'));
	const scroller = await boxOf(boardScroller(app));
	await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
	await page.mouse.down();
	await page.mouse.move(handle.x + 40, handle.y + 40);
	await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height - 8);
	await expect
		.poll(() => boardScroller(app).evaluate((element) => Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight - 1), {
			message: 'the board auto-scrolls to its end',
			timeout: 20_000,
		})
		.toBe(true);
	const last = await boxOf(app.categoryCard('Finish'));
	await page.mouse.move(last.x + (last.width * 3) / 4, last.y + last.height / 2);
	await saveScreenshot(app.createRegion('board'), testInfo, 'board-42-dragging-to-end');
	const toEnd = boardWritten(page, (board) => board.order[board.order.length - 1] === 'subject');
	await page.mouse.up();
	await toEnd;
	expect((await shownCategoryNames(app)).slice(-2)).toEqual(['Finish', 'Subject']);
	expect((await storedBoard(backend)).order.slice(0, 2)).toEqual(['quality', 'hair']);
	// The focus stays on the dropped card's handle.
	await expect(reorderHandle(app.categoryCard('Subject'), 'Subject')).toBeFocused();
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
});
