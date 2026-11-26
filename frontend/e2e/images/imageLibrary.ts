// Page helpers of the Images section specs (e2e/images, the remix journey): the section, its thumbnail grids, the
// detail panel of an image and its resource rows. Images are the synthetic catalog's
// (backend/tests/e2e/fixtures/civitai_catalog.json): thumbnails are named 'Image by <username>'.
import { expect, type Locator } from '@playwright/test';
import { waitForPicturesInView, type AppDriver } from '../support/app';

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

/** The prompt of the watercolor image (its tags, in order). */
export const WATERCOLOR_PROMPT = 'watercolor, harbor town, boats, soft light';

/** Opens the app, then the Images section, once its first page is shown. Returns the section. */
export async function openImages(app: AppDriver): Promise<Locator> {
	await app.open();
	const section = await app.goTo('images');
	await expect(searchResults(section).getByRole('button').first()).toBeVisible();
	await app.settle();
	return section;
}

export function searchResults(section: Locator): Locator {
	return section.getByRole('list', { name: 'Search results' });
}

/** The detail panel (complementary landmark 'Image details'). */
export function imageDetail(section: Locator): Locator {
	return section.getByRole('complementary', { name: 'Image details', exact: true });
}

/** The thumbnail button of the image by `author` in `grid`. */
export function thumbnail(grid: Locator, author: string): Locator {
	return grid.getByRole('button', { name: `Image by ${author}`, exact: true });
}

/** The thumbnail names of a grid, in order. */
export async function thumbnailNames(grid: Locator): Promise<string[]> {
	return grid.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? ''));
}

export function imageSearchBox(section: Locator): Locator {
	return section.getByRole('searchbox', { name: 'Search images' });
}

/** Opens the image by `author` from the search results and waits for the detail panel to show it, resolved. Returns
 *  the detail panel. */
export async function openImage(section: Locator, author: string): Promise<Locator> {
	await thumbnail(searchResults(section), author).click();
	const detail = imageDetail(section);
	await expect(detail.getByRole('heading', { name: `Image by ${author}`, exact: true, level: 2 })).toBeVisible();
	await expect(detail.getByText('Resolving', { exact: true })).toHaveCount(0);
	await waitForPicturesInView(section.page());
	return detail;
}

/** The Close button of a detail panel. */
export function closeButton(detail: Locator): Locator {
	return detail.getByRole('button', { name: 'Close details', exact: true });
}

/** A section of the detail panel by its heading ('Tags', 'LoRAs', 'Checkpoint', 'Generation parameters'). */
export function detailSection(detail: Locator, title: string): Locator {
	return detail.getByRole('region', { name: title, exact: true });
}

/** The LoRA row of the detail panel whose name starts with `name`. */
export function loraRow(detail: Locator, name: string): Locator {
	return detail.getByRole('list', { name: 'LoRAs of this image' }).getByRole('listitem').filter({ hasText: name });
}

/** The value of a generation parameter of the detail panel ('Sampler', 'Steps', ...). */
export function parameter(detail: Locator, label: string): Locator {
	return detailSection(detail, 'Generation parameters').getByRole('group', { name: label, exact: true }).locator('span').last();
}

/** Adds the image's (picked) tags to `category` (an existing category's name, or 'New category') with the Tags
 *  section's 'Add to category' menu. */
export async function addTagsTo(detail: Locator, category: string): Promise<void> {
	const page = detail.page();
	await detailSection(detail, 'Tags').getByRole('button', { name: /^Add (\d+ )?to category$/ }).click();
	const menu = page.getByRole('menu');
	await expect(menu).toBeVisible();
	await menu.getByRole('menuitem', { name: category, exact: true }).click();
	await expect(menu).toBeHidden();
}

/** The sub-prompt rows of a category card of the board (read-only; the board specs own the cards). */
export function subPrompts(card: Locator): Locator {
	return card.getByRole('list', { name: 'Sub-prompts' }).getByRole('button', { name: /^Sub-prompt: / });
}
