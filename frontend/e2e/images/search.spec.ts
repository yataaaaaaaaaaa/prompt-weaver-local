// The Images section's search in the real browser, on the synthetic Civitai: the feed grid (safe and locally usable
// images by default) with its thumbnails, focus ring and keyboard navigation, the empty detail panel's guidance, the
// NSFW and 'Only locally usable models' switches, keyword searches (the period disabled with its hint), Load more and
// infinite scroll, the Favorites empty state, the layout in the smallest supported window, and the loading and error
// states.
import { tokens } from '@fluentui/react-theme';
import { expectBaseline } from '../support/baselines';
import { expectPicturesLoaded, waitForPicturesInView } from '../support/app';
import { expectReadable, resolveColor } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop } from '../support/visibility';
import {
	AUTHOR,
	FEED_FIRST_PAGE,
	FEED_TOTAL,
	imageDetail,
	imageSearchBox,
	openImage,
	openImages,
	searchResults,
	thumbnail,
	thumbnailNames,
} from './imageLibrary';

const EMPTY_DETAIL = 'Pick an image to see its tags, LoRAs and checkpoint';

test('the feed shows safe, locally usable images as 3:4 thumbnails in a regular grid next to the guiding detail panel', async ({ app, page }, testInfo) => {
	const section = await openImages(app);
	await assertAppVisible(page);
	await expect(section.getByRole('heading', { name: 'Images', level: 1 })).toBeVisible();
	const grid = searchResults(section);
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

	const filters = section.getByRole('group', { name: 'Image filters' });
	await expect(filters.getByRole('switch', { name: 'Show NSFW' })).not.toBeChecked();
	await expect(filters.getByRole('switch', { name: 'Only locally usable models' })).toBeChecked();
	// Nothing picked yet: the detail panel says what it shows and how keywords search.
	const detail = imageDetail(section);
	await expect(detail.getByRole('heading', { name: EMPTY_DETAIL })).toBeVisible();
	await expectReadable(detail.getByText(/^A keyword finds matching LoRAs/));
	await expectReadable(filters.getByText('Applies without a keyword.'));
	// In this tall window the infinite scroll prefetches the second page: the baseline shows both.
	await expect(grid.getByRole('button')).toHaveCount(FEED_TOTAL);
	await expectPicturesLoaded(grid);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'feed');
	await expectBaseline(grid, 'image-grid.png');
});

test('the thumbnails take the keyboard focus with a visible ring and move with the arrow keys; Enter opens the detail', async ({ app, page }, testInfo) => {
	const section = await openImages(app);
	const grid = searchResults(section);
	const names = await thumbnailNames(grid);

	await section.getByRole('switch', { name: 'Only locally usable models' }).focus();
	await page.keyboard.press('Tab');
	const first = grid.getByRole('button').first();
	await expect(first).toBeFocused();
	await page.keyboard.press('ArrowRight');
	const second = grid.getByRole('button', { name: names[1], exact: true });
	await expect(second).toBeFocused();

	// The focus ring: Fluent's 2px stroke around the whole thumbnail, not clipped by it.
	const ring = await second.evaluate((button) => {
		const after = getComputedStyle(button, '::after');
		return { width: after.borderTopWidth, color: after.borderTopColor, style: after.borderTopStyle, position: getComputedStyle(button).position, overflow: getComputedStyle(button).overflow };
	});
	expect(ring.style).toBe('solid');
	expect(ring.width).toBe('2px');
	expect(ring.color).toBe(await resolveColor(page, tokens.colorStrokeFocus2));
	expect(ring.position, 'the ring is placed around the thumbnail itself').toBe('relative');
	expect(ring.overflow, 'the ring outside the thumbnail is not clipped').toBe('visible');
	await saveScreenshot(grid, testInfo, 'focus-ring');

	await page.keyboard.press('Enter');
	await expect(imageDetail(section).getByRole('heading', { name: names[1], exact: true, level: 2 })).toBeFocused();
	// The shown image is marked in the grid with a brand ring.
	await expect(second).toHaveAttribute('aria-current', 'true');
	expect(await second.evaluate((button) => getComputedStyle(button).outlineColor)).toBe(await resolveColor(page, tokens.colorBrandStroke1));
});

test("'Show NSFW' and 'Only locally usable models' change what the feed lists", async ({ app }) => {
	const section = await openImages(app);
	const grid = searchResults(section);

	await section.getByRole('switch', { name: 'Show NSFW' }).check();
	await expect(thumbnail(grid, AUTHOR.nsfw)).toBeVisible();
	await section.getByRole('switch', { name: 'Show NSFW' }).uncheck();
	await expect(thumbnail(grid, AUTHOR.nsfw)).toHaveCount(0);

	await section.getByRole('switch', { name: 'Only locally usable models' }).uncheck();
	await expect(thumbnail(grid, AUTHOR.flux)).toBeVisible();
	await section.getByRole('switch', { name: 'Only locally usable models' }).check();
	await expect(thumbnail(grid, AUTHOR.flux)).toHaveCount(0);
});

test('a keyword shows the galleries of the matching models, and the period is disabled with a hint', async ({ app, page }, testInfo) => {
	const section = await openImages(app);
	const period = section.getByRole('combobox', { name: 'Period' });
	await expect(period).toBeEnabled();
	const filtersBox = await boxOf(section.getByRole('group', { name: 'Image filters' }));

	await imageSearchBox(section).pressSequentially('pixel', { delay: 40 });
	await expect.poll(() => thumbnailNames(searchResults(section))).toEqual([`Image by ${AUTHOR.pixelForge}`]);
	await expect(period).toBeDisabled();
	await expect(section.getByText('Keyword searches ignore the period.')).toBeVisible();
	await expectReadable(section.getByText('Keyword searches ignore the period.'));
	// The hint under Period does not stretch the Sort by dropdown next to it, nor move the filter row.
	const sortBox = await section.getByRole('combobox', { name: 'Sort by' }).boundingBox();
	const periodBox = await period.boundingBox();
	expect(sortBox?.height).toBe(periodBox?.height);
	expect(sortBox?.y).toBe(periodBox?.y);
	expect(await boxOf(section.getByRole('group', { name: 'Image filters' }))).toEqual(filtersBox);
	await waitForPicturesInView(page);
	await saveScreenshot(section, testInfo, 'keyword');

	await imageSearchBox(section).fill('no such model');
	await expect(section.getByText('No images match this search.')).toBeVisible();
	await imageSearchBox(section).clear();
	await expect(period).toBeEnabled();
	await expect.poll(async () => (await thumbnailNames(searchResults(section))).length).toBeGreaterThanOrEqual(FEED_FIRST_PAGE);
});

test('Ctrl+F focuses the search box of the Images section', async ({ app, page }) => {
	const section = await openImages(app);
	await thumbnail(searchResults(section), AUTHOR.watercolor).focus();
	await page.keyboard.press('Control+f');
	await expect(imageSearchBox(section)).toBeFocused();
});

test.describe('in the smallest supported window', () => {
	// The end of the first page stays farther than the infinite scroll's prefetch margin: the next page waits.
	test.use({ viewport: SMALL_VIEWPORT });

	test.describe('with a slow Civitai', () => {
		test.use({ e2eOptions: { network: { civitai_delay_ms: 1500 } } });

		test("'Load more' is reached with the keyboard and keeps the focus while the next page loads", async ({ app, page }, testInfo) => {
			const section = await openImages(app);
			const grid = searchResults(section);
			await expect(grid.getByRole('button')).toHaveCount(FEED_FIRST_PAGE);
			await grid.getByRole('button').first().focus();
			// Tab leaves the grid (one Tab stop, arrows inside) for the Load more button: the focus scrolls it into view,
			// where the infinite scroll may already start loading the page; Enter otherwise.
			await page.keyboard.press('Tab');
			await expect(section.getByRole('button', { name: /^(Load more|Loading more images…)$/ })).toBeFocused();
			await page.keyboard.press('Enter');
			const busy = section.getByRole('button', { name: 'Loading more images…' });
			await expect(busy).toBeFocused();
			await expect(busy).toHaveAttribute('aria-disabled', 'true');
			await saveScreenshot(page, testInfo, 'loading-more');
			await expect(grid.getByRole('button')).toHaveCount(FEED_TOTAL);
			await expect(section.getByRole('button', { name: /^(Load more|Loading more images…)$/ })).toHaveCount(0);
			expect(new Set(await thumbnailNames(grid)).size).toBe(FEED_TOTAL);
		});
	});

	test('scrolling to the end of the results loads the next page', async ({ app }) => {
		const section = await openImages(app);
		const grid = searchResults(section);
		await expect(grid.getByRole('button')).toHaveCount(FEED_FIRST_PAGE);
		await grid.getByRole('button').last().scrollIntoViewIfNeeded();
		await expect(grid.getByRole('button')).toHaveCount(FEED_TOTAL);
		await expect(section.getByRole('button', { name: 'Load more' })).toHaveCount(0);
		await expectPicturesLoaded(grid);
	});

	test('the grid keeps at least 600 px next to a 360-560 px detail panel, the filters fit', async ({ app, page }, testInfo) => {
		const section = await openImages(app);
		const detail = await openImage(section, AUTHOR.watercolor);
		await assertAppVisible(page);
		const results = section.getByRole('region', { name: 'Image search results' });
		expect((await boxOf(results)).width).toBeGreaterThanOrEqual(600);
		const detailWidth = (await boxOf(detail)).width;
		expect(detailWidth).toBeGreaterThanOrEqual(360);
		expect(detailWidth).toBeLessThanOrEqual(560);
		await expectNoHorizontalOverflow(results);
		await expectNoHorizontalOverflow(detail);
		const filters = section.getByRole('group', { name: 'Image filters' });
		await expectOnTop(filters.getByRole('switch', { name: 'Only locally usable models' }));
		await expectOnTop(detail.getByRole('button', { name: 'Create character' }));
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'small-window');
	});
});

test('the Favorites view explains how to add favorites while there is none', async ({ app }, testInfo) => {
	const section = await openImages(app);
	await section.getByRole('tab', { name: 'Favorites' }).click();
	const empty = section.getByText('No favorites yet. Open an image and select Favorite to keep it here.');
	await expect(empty).toBeVisible();
	await expectReadable(empty);
	// The search controls belong to the search view.
	await expect(imageSearchBox(section)).toHaveCount(0);
	await app.parkPointer();
	// A deliberately plain state (one line of text): nearly one color in the light theme.
	await saveScreenshot(section, testInfo, 'favorites-empty', { allowUniform: true });
});

test.describe('while Civitai answers slowly', () => {
	test.use({ e2eOptions: { network: { civitai_delay_ms: 2500 } } });

	test('a spinner shows the search running', async ({ app, page }, testInfo) => {
		await app.open();
		const section = await app.goTo('images');
		const spinner = section.getByText('Searching images…');
		await expect(spinner).toBeVisible();
		// A deliberately plain state (a spinner on an empty grid): nearly one color in the light theme.
		await saveScreenshot(section, testInfo, 'loading', { allowUniform: true });
		await expect(searchResults(section)).toBeVisible({ timeout: 15_000 });
		await expect(spinner).toBeHidden();
		await assertAppVisible(page);
	});
});

test.describe('when Civitai fails', () => {
	test.use({ e2eOptions: { network: { civitai_error_status: 503 } } });

	test('the error says why, and Retry searches again once Civitai answers', async ({ app, page, backend, diagnostics }, testInfo) => {
		diagnostics.allow(/Failed to load resource/);
		await app.open();
		const section = await app.goTo('images');
		await expect(section.getByText('Search failed')).toBeVisible();
		await expect(section.getByText(/HTTP 503/)).toBeVisible();
		await expectReadable(section.getByText(/HTTP 503/));
		await app.parkPointer();
		await saveScreenshot(section, testInfo, 'error');

		await backend.reset();
		await section.getByRole('button', { name: 'Retry' }).click();
		await expect(section.getByText('Search failed')).toBeHidden();
		await expect.poll(() => searchResults(section).getByRole('button').count()).toBeGreaterThanOrEqual(FEED_FIRST_PAGE);
		await assertAppVisible(page);
	});
});
