// Page helpers of the image library specs (e2e/images): the pane, its thumbnail grids, the detail view of an image
// and its resource rows. Images are the synthetic catalog's (backend/tests/e2e/fixtures/civitai_catalog.json):
// thumbnails are named 'Image by <username>'.
import { expect, type Locator } from '@playwright/test';
import { waitForPicturesInView, type AppDriver } from '../support/app';
import { IMAGE_LIBRARY } from '../models/libraries';

/** Authors of the catalog images used by the specs. */
export const AUTHOR = {
	pixelForge: 'e2e-painter', // 950001: Pixel Forge v2.0 at 0.8 (to download) + Aurora XL (to download)
	watercolor: 'aquarelle', // 950002: Watercolor Wash 0.65 (in library) + Neon Rim Light 1.2 (on disk) + Dreamline
	mystery: 'mystery-user', // 950003: a name-only LoRA and checkpoint (not identified)
	flux: 'fluxer', // 950004: Flux.1 D (not locally usable)
	noMeta: 'no-meta', // 950005: no generation data
	nsfw: 'after-dark', // 950006: nsfwLevel 4
} as const;

/** Images of the default feed (safe, locally usable): two pages of 20 + 4. */
export const FEED_FIRST_PAGE = 20;
export const FEED_TOTAL = 24;

/** Opens the app, then the Image library pane (fronted), once its first page is shown. */
export async function openImageLibrary(app: AppDriver): Promise<Locator> {
	await app.open();
	const pane = await app.showPane(IMAGE_LIBRARY);
	await expect(searchResults(pane).getByRole('button').first()).toBeVisible();
	await app.settle();
	return pane;
}

export function searchResults(pane: Locator): Locator {
	return pane.getByRole('list', { name: 'Search results' });
}

/** The thumbnail button of the image by `author` in `grid`. */
export function thumbnail(grid: Locator, author: string): Locator {
	return grid.getByRole('button', { name: `Image by ${author}`, exact: true });
}

/** The thumbnail names of a grid, in order. */
export async function thumbnailNames(grid: Locator): Promise<string[]> {
	return grid.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));
}

export function imageSearchBox(pane: Locator): Locator {
	return pane.getByRole('searchbox', { name: 'Search images' });
}

/** Opens the image by `author` from the search results and waits for its resolved resources. */
export async function openImage(pane: Locator, author: string): Promise<void> {
	await thumbnail(searchResults(pane), author).click();
	await expect(pane.getByRole('heading', { name: `Image by ${author}`, exact: true })).toBeVisible();
	await expect(pane.getByText('Resolving', { exact: true })).toHaveCount(0);
	await waitForPicturesInView(pane.page());
}

export function backButton(pane: Locator): Locator {
	return pane.getByRole('button', { name: 'Back', exact: true });
}

/** A section of the detail view by its heading ('Tags', 'LoRAs', 'Checkpoint', 'Generation parameters'). */
export function detailSection(pane: Locator, title: string): Locator {
	return pane.getByRole('region', { name: title, exact: true });
}

/** The LoRA row of the detail view whose name starts with `name`. */
export function loraRow(pane: Locator, name: string): Locator {
	return pane.getByRole('list', { name: 'LoRAs of this image' }).getByRole('listitem').filter({ hasText: name });
}

/** The value of a generation parameter of the detail view ('Sampler', 'Steps', ...). */
export function parameter(pane: Locator, label: string): Locator {
	return detailSection(pane, 'Generation parameters').getByRole('group', { name: label, exact: true }).locator('span').last();
}
