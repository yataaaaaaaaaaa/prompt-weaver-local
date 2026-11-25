// Image library search in the real browser, on the synthetic Civitai: the feed grid (safe and locally usable images
// by default) with its thumbnails, focus ring and keyboard navigation, the NSFW and 'Only locally usable models'
// switches, keyword searches (the period disabled), Load more and infinite scroll, the Favorites empty state, and
// the loading and error states.
import { tokens } from '@fluentui/react-theme';
import { expectBaseline } from '../support/baselines';
import { expectPicturesLoaded, waitForPicturesInView } from '../support/app';
import { workspaceLayout } from '../support/backend';
import { expectReadable, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectNoHorizontalOverflow } from '../support/visibility';
import { IMAGE_LIBRARY } from '../models/libraries';
import { AUTHOR, FEED_FIRST_PAGE, FEED_TOTAL, imageSearchBox, openImageLibrary, searchResults, thumbnail, thumbnailNames } from './imageLibrary';

test('the feed shows safe, locally usable images as 3:4 thumbnails in a regular grid', async ({ app, page }, testInfo) => {
	const pane = await openImageLibrary(app);
	await assertAppVisible(page);
	const grid = searchResults(pane);
	// The first page (and, in this tall window, the second one already prefetched by the infinite scroll).
	const names = await thumbnailNames(grid);
	expect(names.length).toBeGreaterThanOrEqual(FEED_FIRST_PAGE);
	expect(names).toContain(`Image by ${AUTHOR.watercolor}`);
	expect(names).not.toContain(`Image by ${AUTHOR.nsfw}`);
	expect(names).not.toContain(`Image by ${AUTHOR.flux}`);
	await expectPicturesLoaded(grid);

	// Thumbnails: 3:4, same size, the grid's columns and rows separated by the same gap.
	const boxes = await grid.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON() as DOMRect));
	for (const box of boxes) {
		expect(Math.abs(box.width / box.height - 3 / 4)).toBeLessThan(0.01);
		expect(Math.abs(box.width - boxes[0].width)).toBeLessThan(1);
	}
	const firstRow = boxes.filter((box) => Math.abs(box.top - boxes[0].top) < 1);
	expect(firstRow.length).toBeGreaterThan(2);
	const columnGap = firstRow[1].left - firstRow[0].right;
	const rowGap = boxes[firstRow.length].top - boxes[0].bottom;
	expect(columnGap).toBeGreaterThan(4);
	expect(Math.abs(columnGap - rowGap)).toBeLessThan(1);

	await expect(pane.getByRole('switch', { name: 'Show NSFW' })).not.toBeChecked();
	await expect(pane.getByRole('switch', { name: 'Only locally usable models' })).toBeChecked();
	await expectReadable(pane.getByText(/^A keyword finds matching LoRAs/));
	// In this tall window the infinite scroll prefetches the second page: the baseline shows both (4 full rows).
	await expect(grid.getByRole('button')).toHaveCount(FEED_TOTAL);
	await expectPicturesLoaded(grid);
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'feed');
	await expectBaseline(grid, 'image-grid.png');
});

test('the thumbnails take the keyboard focus with a visible ring and move with the arrow keys', async ({ app, page }, testInfo) => {
	const pane = await openImageLibrary(app);
	const grid = searchResults(pane);
	const names = await thumbnailNames(grid);

	await pane.getByRole('switch', { name: 'Only locally usable models' }).focus();
	await page.keyboard.press('Tab');
	const first = grid.getByRole('button').first();
	await expect(first).toBeFocused();
	await page.keyboard.press('ArrowRight');
	const second = grid.getByRole('button', { name: names[1], exact: true });
	await expect(second).toBeFocused();

	// The focus ring: Fluent's 2px stroke around the whole thumbnail, not clipped by it.
	const ring = await second.evaluate((button) => {
		const after = getComputedStyle(button, '::after');
		const box = button.getBoundingClientRect();
		return { width: after.borderTopWidth, color: after.borderTopColor, style: after.borderTopStyle, position: getComputedStyle(button).position, overflow: getComputedStyle(button).overflow, box: box.toJSON() as DOMRect, top: after.top, left: after.left };
	});
	expect(ring.style).toBe('solid');
	expect(ring.width).toBe('2px');
	expect(ring.color).toBe(await resolveColor(page, tokens.colorStrokeFocus2));
	expect(ring.position, 'the ring is placed around the thumbnail itself').toBe('relative');
	expect(ring.overflow, 'the ring outside the thumbnail is not clipped').toBe('visible');
	await saveScreenshot(grid, testInfo, 'focus-ring');

	await page.keyboard.press('Enter');
	await expect(pane.getByRole('heading', { name: names[1], exact: true })).toBeVisible();
});

test("'Show NSFW' and 'Only locally usable models' change what the feed lists", async ({ app }) => {
	const pane = await openImageLibrary(app);
	const grid = searchResults(pane);

	await pane.getByRole('switch', { name: 'Show NSFW' }).check();
	await expect(thumbnail(grid, AUTHOR.nsfw)).toBeVisible();
	await pane.getByRole('switch', { name: 'Show NSFW' }).uncheck();
	await expect(thumbnail(grid, AUTHOR.nsfw)).toHaveCount(0);

	await pane.getByRole('switch', { name: 'Only locally usable models' }).uncheck();
	await expect(thumbnail(grid, AUTHOR.flux)).toBeVisible();
	await pane.getByRole('switch', { name: 'Only locally usable models' }).check();
	await expect(thumbnail(grid, AUTHOR.flux)).toHaveCount(0);
});

test('a keyword shows the galleries of the matching models, and the period is disabled with a hint', async ({ app }, testInfo) => {
	const pane = await openImageLibrary(app);
	const period = pane.getByRole('combobox', { name: 'Period' });
	await expect(period).toBeEnabled();

	await imageSearchBox(pane).pressSequentially('pixel', { delay: 40 });
	await expect.poll(() => thumbnailNames(searchResults(pane))).toEqual([`Image by ${AUTHOR.pixelForge}`]);
	await expect(period).toBeDisabled();
	await expect(pane.getByText('Keyword searches ignore the period.')).toBeVisible();
	await expectReadable(pane.getByText('Keyword searches ignore the period.'));
	// The hint under Period does not stretch the Sort by dropdown next to it.
	const sortBox = await pane.getByRole('combobox', { name: 'Sort by' }).boundingBox();
	const periodBox = await period.boundingBox();
	expect(sortBox?.height).toBe(periodBox?.height);
	expect(sortBox?.y).toBe(periodBox?.y);
	await waitForPicturesInView(pane.page());
	await saveScreenshot(pane, testInfo, 'keyword');

	await imageSearchBox(pane).fill('no such model');
	await expect(pane.getByText('No images match this search.')).toBeVisible();
	await imageSearchBox(pane).clear();
	await expect(period).toBeEnabled();
	await expect.poll(async () => (await thumbnailNames(searchResults(pane))).length).toBeGreaterThanOrEqual(FEED_FIRST_PAGE);
});

test.describe('in a window shorter than the first page', () => {
	// The end of the first page stays farther than the infinite scroll's prefetch margin: the next page waits.
	test.use({ e2eOptions: { files: workspaceLayout({ 'pane:images': { x: 880, y: 16, width: 1024, height: 640, z: 30 } }, ['models', 'characters']) } });

	test.describe('with a slow Civitai', () => {
		test.use({ e2eOptions: { network: { civitai_delay_ms: 1500 } } });

		test("'Load more' is reached with the keyboard and keeps the focus while the next page loads", async ({ app, page }, testInfo) => {
			const pane = await openImageLibrary(app);
			const grid = searchResults(pane);
			await expect(grid.getByRole('button')).toHaveCount(FEED_FIRST_PAGE);
			await grid.getByRole('button').first().focus();
			// Tab leaves the grid (one Tab stop, arrows inside) for the Load more button: the focus scrolls it into view,
			// where the infinite scroll may already start loading the page; Enter otherwise.
			await page.keyboard.press('Tab');
			await expect(pane.getByRole('button', { name: /^(Load more|Loading more images…)$/ })).toBeFocused();
			await page.keyboard.press('Enter');
			const busy = pane.getByRole('button', { name: 'Loading more images…' });
			await expect(busy).toBeFocused();
			await expect(busy).toHaveAttribute('aria-disabled', 'true');
			await saveScreenshot(pane, testInfo, 'loading-more');
			await expect(grid.getByRole('button')).toHaveCount(FEED_TOTAL);
			await expect(pane.getByRole('button', { name: /^(Load more|Loading more images…)$/ })).toHaveCount(0);
			expect(new Set(await thumbnailNames(grid)).size).toBe(FEED_TOTAL);
		});
	});

	test('scrolling to the end of the results loads the next page', async ({ app }) => {
		const pane = await openImageLibrary(app);
		const grid = searchResults(pane);
		await expect(grid.getByRole('button')).toHaveCount(FEED_FIRST_PAGE);
		await grid.getByRole('button').last().scrollIntoViewIfNeeded();
		await expect(grid.getByRole('button')).toHaveCount(FEED_TOTAL);
		await expect(pane.getByRole('button', { name: 'Load more' })).toHaveCount(0);
		await expectPicturesLoaded(grid);
	});
});

test('the Favorites tab explains how to add favorites while there is none', async ({ app }, testInfo) => {
	const pane = await openImageLibrary(app);
	await pane.getByRole('tab', { name: 'Favorites' }).click();
	const empty = pane.getByText('No favorites yet. Open an image and select Favorite to keep it here.');
	await expect(empty).toBeVisible();
	await expectReadable(empty);
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'favorites-empty');
});

test.describe('at its minimum width', () => {
	test.use({ e2eOptions: { files: workspaceLayout({ 'pane:images': { x: 16, y: 16, width: 420, height: 1004, z: 30 } }, ['models', 'characters']) } });

	test('the grid and the filters fit the window', async ({ app, page }, testInfo) => {
		await app.open();
		const pane = app.pane(IMAGE_LIBRARY);
		await app.bringToFront(pane);
		await expect(searchResults(pane).getByRole('button').first()).toBeVisible();
		await waitForPicturesInView(page);
		expect((await pane.boundingBox())?.width).toBe(420);
		await expectNoHorizontalOverflow(pane);
		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'grid-420');
	});
});

test.describe('while Civitai answers slowly', () => {
	test.use({ e2eOptions: { network: { civitai_delay_ms: 2500 } } });

	test('a spinner shows the search running', async ({ app, page }, testInfo) => {
		await app.open();
		const pane = await app.showPane(IMAGE_LIBRARY);
		const spinner = pane.getByText('Searching images…');
		await expect(spinner).toBeVisible();
		await saveScreenshot(pane, testInfo, 'loading');
		await expect(searchResults(pane)).toBeVisible({ timeout: 15_000 });
		await expect(spinner).toBeHidden();
		await assertAppVisible(page);
	});
});

test.describe('when Civitai fails', () => {
	test.use({ e2eOptions: { network: { civitai_error_status: 503 } } });

	test('the error says why, and Retry searches again once Civitai answers', async ({ app, page, backend, diagnostics }, testInfo) => {
		diagnostics.allow(/Failed to load resource/);
		await app.open();
		const pane = await app.showPane(IMAGE_LIBRARY);
		await expect(pane.getByText('Search failed')).toBeVisible();
		await expect(pane.getByText(/HTTP 503/)).toBeVisible();
		await expectReadable(pane.getByText(/HTTP 503/));
		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'error');

		await backend.reset();
		await pane.getByRole('button', { name: 'Retry' }).click();
		await expect(pane.getByText('Search failed')).toBeHidden();
		await expect.poll(() => searchResults(pane).getByRole('button').count()).toBeGreaterThanOrEqual(FEED_FIRST_PAGE);
		await assertAppVisible(page);
	});
});
