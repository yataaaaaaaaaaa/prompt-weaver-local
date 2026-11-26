// The prompt board in the real browser, dark and light: the responsive card grid (no overlap, cards top-aligned), the
// toolbar, search and state filter, collapse / expand / collapse all (persisted), reorder by pointer drag (insertion
// indicator) and by keyboard (announced, focus kept, global arrows untouched), both persisted in board-store, Sort by
// priority (button and Ctrl+O), the reveal of a new category (scrolled into view inside the board, name editor open),
// and the board order derived from a legacy floating workspace.
import type { Locator } from '@playwright/test';
import { tokens } from '@fluentui/react-theme';
import { FIXTURE_CATEGORIES, STORE_NAMES, storeFile } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { resolveColor } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectOnTop, intersects } from '../support/visibility';
import {
	boardAnnouncer,
	boardCards,
	boardCommands,
	boardScroller,
	boardSearch,
	boardStateFilter,
	boardWritten,
	categoriesWritten,
	reorderHandle,
	shownCategoryNames,
	storedBoard,
	storedCategories,
} from './categoryDriver';

const FIXTURE_KEYS = ['subject', 'outfit', 'background', 'weather-effects', 'lighting', 'mood', 'sea-creatures'];

/** The computed ::after of a grid item (the drag insertion indicator), or null when it has none. */
async function indicatorOf(item: Locator): Promise<{ color: string; width: number; height: number } | null> {
	return item.evaluate((element) => {
		const style = getComputedStyle(element, '::after');
		return style.content === 'none' || style.content === 'normal'
			? null
			: { color: style.backgroundColor, width: parseFloat(style.width), height: parseFloat(style.height) };
	});
}

/** The grid item (<li>) of a card. */
function gridItem(card: Locator): Locator {
	return card.locator('xpath=..');
}

test('the board shows every category as a card in a responsive grid, cards top-aligned, none overlapping', async ({ app, page }, testInfo) => {
	await app.open();
	await app.parkPointer();
	await expect(boardCards(app)).toHaveCount(FIXTURE_CATEGORIES.length);
	expect(await shownCategoryNames(app)).toEqual([...FIXTURE_CATEGORIES]);
	await expect(app.createRegion('board').getByText('7 categories', { exact: true })).toBeVisible();

	const boxes = await Promise.all(FIXTURE_CATEGORIES.map((name) => boxOf(app.categoryCard(name))));
	for (let left = 0; left < boxes.length; left += 1) {
		for (let right = left + 1; right < boxes.length; right += 1) {
			expect(intersects(boxes[left], boxes[right]), `${FIXTURE_CATEGORIES[left]} overlaps ${FIXTURE_CATEGORIES[right]}`).toBe(false);
		}
	}
	// Several columns at 1920 px, cards of one row top-aligned.
	const tops = [...new Set(boxes.map((box) => Math.round(box.y)))];
	expect(tops.length).toBeLessThan(boxes.length);
	expect(boxes[1].y).toBe(boxes[0].y);
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'create-section');
	await expectBaseline(app.createRegion('board'), 'board.png');
});

test('search and state filter narrow the cards; the count and Clear filter follow; Ctrl+F focuses the search', async ({ app, page }, testInfo) => {
	await app.open();
	await page.keyboard.press('Control+F');
	await expect(boardSearch(app)).toBeFocused();

	// Names, activation texts and sub-prompts: Background has 'neon city street, rain', Weather effects 'rain, storm'.
	await boardSearch(app).fill('rain');
	await expect.poll(() => shownCategoryNames(app)).toEqual(['Background', 'Weather effects']);
	await expect(app.createRegion('board').getByText('2 of 7 categories', { exact: true })).toBeVisible();
	await app.parkPointer({ blur: true });
	await saveScreenshot(app.createRegion('board'), testInfo, 'search-rain');

	// Search and state filter combine: nothing rainy is skipped.
	await boardStateFilter(app).click();
	await page.getByRole('option', { name: 'Skipped' }).click();
	await expect(boardStateFilter(app)).toHaveText('Skipped');
	const noMatch = app.createRegion('board').getByRole('heading', { name: 'No category matches' });
	await expect(noMatch).toBeVisible();
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(noMatch.locator('xpath=..'), testInfo, 'no-match');

	await boardSearch(app).fill('');
	await expect.poll(() => shownCategoryNames(app)).toEqual(['Lighting']);

	const options: [string, string[]][] = [
		['Used by the current output', ['Subject', 'Outfit', 'Background', 'Weather effects', 'Mood']],
		['With a locked sub-prompt', ['Subject']],
		['Indirectly disabled', ['Sea creatures']],
	];
	for (const [option, names] of options) {
		await boardStateFilter(app).click();
		await page.getByRole('option', { name: option }).click();
		await expect.poll(() => shownCategoryNames(app), { message: option }).toEqual(names);
	}

	await app.createRegion('board').getByRole('button', { name: 'Clear filter' }).first().click();
	await expect.poll(() => shownCategoryNames(app)).toEqual([...FIXTURE_CATEGORIES]);
	await expect(boardStateFilter(app)).toHaveText('Any state');
	await expect(app.createRegion('board').getByRole('button', { name: 'Clear filter' })).toHaveCount(0);
});

test('collapse and expand a card, Collapse all and Expand all; persisted across a reload', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const mood = app.categoryCard('Mood');
	const collapsed = boardWritten(page, (board) => board.collapsed.includes('mood'));
	await mood.getByRole('button', { name: 'Collapse Mood' }).click();
	await collapsed;
	await expect(mood.getByRole('button', { name: 'Expand Mood' })).toHaveAttribute('aria-expanded', 'false');
	await expect(mood.getByRole('list', { name: 'Sub-prompts' })).toHaveCount(0);
	expect((await storedBoard(backend)).collapsed).toEqual(['mood']);

	await page.reload();
	await app.open();
	await expect(app.categoryCard('Mood').getByRole('button', { name: 'Expand Mood' })).toBeVisible();
	await expect(app.categoryCard('Outfit').getByRole('list', { name: 'Sub-prompts' })).toBeVisible();

	const allCollapsed = boardWritten(page, (board) => board.collapsed.length === FIXTURE_KEYS.length);
	await boardCommands(app).getByRole('button', { name: 'Collapse all' }).click();
	await allCollapsed;
	await expect(app.createRegion('board').getByRole('list', { name: 'Sub-prompts' })).toHaveCount(0);
	await expect(boardCommands(app).getByRole('button', { name: 'Collapse all' })).toBeDisabled();
	// Every collapsed card keeps its header: name, count, priority, commands.
	for (const name of FIXTURE_CATEGORIES) {
		await expect(app.categoryCard(name).getByRole('button', { name: `Expand ${name}` })).toBeVisible();
		await expect(app.categoryCard(name).getByRole('textbox', { name: 'Priority' })).toBeVisible();
	}
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(app.createRegion('board'), testInfo, 'all-collapsed');
	await expectBaseline(app.createRegion('board'), 'board-collapsed.png');

	const allExpanded = boardWritten(page, (board) => board.collapsed.length === 0);
	await boardCommands(app).getByRole('button', { name: 'Expand all' }).click();
	await allExpanded;
	await expect(app.createRegion('board').getByRole('list', { name: 'Sub-prompts' })).toHaveCount(FIXTURE_CATEGORIES.length);
});

test('reorder by dragging a card handle: insertion indicator, drop, persisted', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const sea = app.categoryCard('Sea creatures');
	const subject = app.categoryCard('Subject');
	const handle = reorderHandle(sea, 'Sea creatures');
	const from = await boxOf(handle);
	const target = await boxOf(subject);

	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	// Through the board to the left quarter of Subject (first card): dropped before it.
	for (const step of [0.25, 0.5, 0.75, 1]) {
		await page.mouse.move(
			from.x + (target.x + target.width / 4 - from.x) * step,
			from.y + (target.y + target.height / 2 - from.y) * step,
		);
	}
	await expect.poll(() => indicatorOf(gridItem(subject))).not.toBeNull();
	const indicator = await indicatorOf(gridItem(subject));
	expect(indicator?.color).toBe(await resolveColor(page, tokens.colorBrandStroke1));
	// Several columns: a vertical bar as tall as the card.
	expect(indicator!.height).toBeGreaterThan(indicator!.width * 10);
	expect(await indicatorOf(gridItem(app.categoryCard('Outfit')))).toBeNull();
	await saveScreenshot(app.createRegion('board'), testInfo, 'dragging');

	const saved = boardWritten(page, (board) => board.order[0] === 'sea-creatures');
	await page.mouse.up();
	await saved;
	await expect.poll(() => shownCategoryNames(app)).toEqual(['Sea creatures', ...FIXTURE_CATEGORIES.filter((name) => name !== 'Sea creatures')]);
	await expect(boardAnnouncer(app)).toHaveText('Sea creatures moved to position 1 of 7');
	expect(await indicatorOf(gridItem(subject))).toBeNull();
	expect((await storedBoard(backend)).order).toEqual(['sea-creatures', ...FIXTURE_KEYS.filter((key) => key !== 'sea-creatures')]);

	// A drag released outside the board moves nothing.
	const outfitHandle = reorderHandle(app.categoryCard('Outfit'), 'Outfit');
	const outfitBox = await boxOf(outfitHandle);
	await page.mouse.move(outfitBox.x + 4, outfitBox.y + 4);
	await page.mouse.down();
	await page.mouse.move(outfitBox.x + 60, outfitBox.y + 40);
	const viewer = await boxOf(app.createRegion('viewer'));
	await page.mouse.move(viewer.x + viewer.width / 2, viewer.y + viewer.height / 2);
	await page.mouse.up();
	expect((await shownCategoryNames(app))[2]).toBe('Outfit');

	await page.reload();
	await app.open();
	expect((await shownCategoryNames(app))[0]).toBe('Sea creatures');
});

test('reorder with the keyboard: arrows, Home and End move the card, announced, the focus stays on the handle', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const currentOutput = app.createRegion('viewer').getByRole('img', { name: 'Output 0000000004', exact: true });
	await expect(currentOutput).toBeVisible();
	const handle = reorderHandle(app.categoryCard('Subject'), 'Subject');
	await handle.focus();

	await page.keyboard.press('ArrowRight');
	await expect.poll(() => shownCategoryNames(app)).toEqual(['Outfit', 'Subject', 'Background', 'Weather effects', 'Lighting', 'Mood', 'Sea creatures']);
	await expect(boardAnnouncer(app)).toHaveText('Subject moved to position 2 of 7');
	await expect(reorderHandle(app.categoryCard('Subject'), 'Subject')).toBeFocused();

	const lastSaved = boardWritten(page, (board) => board.order[board.order.length - 1] === 'subject');
	await page.keyboard.press('End');
	await lastSaved;
	await expect(boardAnnouncer(app)).toHaveText('Subject moved to position 7 of 7');
	await expect(reorderHandle(app.categoryCard('Subject'), 'Subject')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(boardAnnouncer(app)).toHaveText('Subject is at position 7 of 7');
	// The focused handle shows its focus ring and its hint.
	await saveScreenshot(app.createRegion('board'), testInfo, 'subject-last-focused');

	await page.keyboard.press('Home');
	await page.keyboard.press('ArrowUp');
	await page.keyboard.press('ArrowLeft');
	await expect.poll(() => shownCategoryNames(app)).toEqual([...FIXTURE_CATEGORIES]);
	await expect(boardAnnouncer(app)).toHaveText('Subject is at position 1 of 7');
	await expect(reorderHandle(app.categoryCard('Subject'), 'Subject')).toBeFocused();
	// The handle owns the arrows: the viewer still shows the same output.
	await expect(currentOutput).toBeVisible();
	await expect.poll(async () => (await storedBoard(backend)).order).toEqual(FIXTURE_KEYS);
});

test('Sort by priority (button and Ctrl+O) renumbers the priorities and makes them the board order', async ({ app, page, backend }) => {
	await app.open();
	// Mood first by priority, Subject moved last on the board.
	await app.categoryCard('Mood').getByRole('textbox', { name: 'Priority' }).fill('0.5');
	await reorderHandle(app.categoryCard('Subject'), 'Subject').focus();
	await page.keyboard.press('End');
	await expect.poll(async () => (await shownCategoryNames(app)).at(-1)).toBe('Subject');

	const sorted = categoriesWritten(page, (categories) => categories.find((category) => category.text === 'Mood')?.priority === 1);
	await boardCommands(app).getByRole('button', { name: 'Sort by priority' }).click();
	await sorted;
	const byPriority = ['Mood', 'Subject', 'Outfit', 'Background', 'Weather effects', 'Lighting', 'Sea creatures'];
	await expect.poll(() => shownCategoryNames(app)).toEqual(byPriority);
	await expect(boardAnnouncer(app)).toHaveText('Categories sorted by priority');
	expect((await storedCategories(backend)).map((category) => [category.text, category.priority])).toEqual(byPriority.map((name, index) => [name, index + 1]));
	await expect.poll(async () => (await storedBoard(backend)).order[0]).toBe('mood');
	await expect(app.categoryCard('Subject').getByRole('textbox', { name: 'Priority' })).toHaveValue('2');

	// Ctrl+O, from anywhere but a text field.
	await reorderHandle(app.categoryCard('Mood'), 'Mood').focus();
	await page.keyboard.press('End');
	await expect.poll(async () => (await shownCategoryNames(app)).at(-1)).toBe('Mood');
	await app.parkPointer({ blur: true });
	await page.keyboard.press('Control+O');
	await expect.poll(() => shownCategoryNames(app)).toEqual(byPriority);
});

test.describe('at 1280 x 720', () => {
	test.use({ viewport: SMALL_VIEWPORT });

	test('Add category reveals the new card: scrolled into view inside the board, its name editor open', async ({ app, page }, testInfo) => {
		await app.open();
		// A search that would hide the new card is cleared.
		await boardSearch(app).fill('zzz');
		await expect(app.createRegion('board').getByRole('heading', { name: 'No category matches' })).toBeVisible();

		await boardCommands(app).getByRole('button', { name: 'Add category' }).click();
		const created = app.categoryCard('new-category');
		const editor = created.getByRole('textbox', { name: 'Category name' });
		await expect(editor).toBeFocused();
		await expect(boardSearch(app)).toHaveValue('');
		await expectOnTop(editor);
		expect(await boardScroller(app).evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
		// Only the board scrolled: the page and the section stay put.
		expect(await page.evaluate(() => [document.scrollingElement?.scrollTop ?? 0, document.querySelector('main')?.scrollTop ?? 0])).toEqual([0, 0]);
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'revealed-new-category');

		await page.keyboard.type('Accessories');
		await page.keyboard.press('Enter');
		await expect(app.categoryCard('Accessories')).toBeVisible();
		await expect.poll(async () => (await shownCategoryNames(app)).at(-1)).toBe('Accessories');
	});
});

test.describe('without any category', () => {
	test.use({ e2eOptions: { files: storeFile(STORE_NAMES.categories, { categories: [] }, 0) } });

	test('the board explains itself and offers to add the first category or browse images', async ({ app, page }, testInfo) => {
		await app.open();
		const board = app.createRegion('board');
		await expect(board.getByRole('heading', { name: 'No categories yet' })).toBeVisible();
		await expect(board.getByText('0 categories', { exact: true })).toBeVisible();
		await expectOnTop(board.getByRole('button', { name: 'Add your first category' }));
		await expectOnTop(board.getByRole('button', { name: 'Browse images' }));
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'no-categories');

		await board.getByRole('button', { name: 'Browse images' }).click();
		await expect(app.section('images')).toBeVisible();
		await app.goTo('create');
		await board.getByRole('button', { name: 'Add your first category' }).click();
		await expect(app.categoryCard('new-category').getByRole('textbox', { name: 'Category name' })).toBeFocused();
		await expect(board.getByRole('heading', { name: 'No categories yet' })).toHaveCount(0);
	});
});

test.describe('a board migrated from the legacy floating workspace', () => {
	test.use({ e2eOptions: { remove: ['stores/board-store', 'stores/layout-store'] } });

	test('takes the order of the old category windows: top to bottom, then left to right', async ({ app, page }, testInfo) => {
		await app.open();
		await expect
			.poll(() => shownCategoryNames(app))
			.toEqual(['Subject', 'Background', 'Outfit', 'Weather effects', 'Lighting', 'Mood', 'Sea creatures']);
		// Every card expanded.
		await expect(app.createRegion('board').getByRole('list', { name: 'Sub-prompts' })).toHaveCount(FIXTURE_CATEGORIES.length);
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(app.createRegion('board'), testInfo, 'migrated-order');

		// The derived order is the board's own from then on.
		const saved = boardWritten(page, (board) => board.order[0] === 'background');
		await reorderHandle(app.categoryCard('Background'), 'Background').focus();
		await page.keyboard.press('Home');
		await saved;
	});
});
