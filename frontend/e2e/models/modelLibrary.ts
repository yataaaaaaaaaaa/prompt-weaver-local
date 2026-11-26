// Page helpers of the Models section specs (e2e/models): the section, its result cards by model name, the detail
// panel, the search box, the filters and the install statuses. The synthetic catalog is
// backend/tests/e2e/fixtures/civitai_catalog.json (fake_civitai.py): the names used here are its models.
import { expect, type Locator, type Page } from '@playwright/test';
import { waitForPicturesInView, type AppDriver } from '../support/app';

/** Every model of the default search (no filter, NSFW hidden), most downloaded first. */
export const DEFAULT_RESULTS = [
	'Aurora XL',
	'Dreamline 1.5',
	'Easy Negative Lite',
	'Pixel Forge Style',
	'Watercolor Wash',
	'Neon Rim Light',
	'Moonlit Night',
	'Flux Glow',
	'Legacy Ink Lines',
];

/** Opens the app, then the Models section, once its first results are shown. Returns the section. */
export async function openModels(app: AppDriver): Promise<Locator> {
	await app.open();
	const section = await app.goTo('models');
	await expect(resultList(section)).toBeVisible();
	await app.settle();
	return section;
}

export function resultList(section: Locator): Locator {
	return section.getByRole('list', { name: 'Search results' });
}

/** The result card of a model (a Fluent Card: role group named by the model name). */
export function resultCard(section: Locator, name: string): Locator {
	return resultList(section).getByRole('group', { name, exact: true });
}

/** The model names of the listed results, in order. */
export async function resultNames(section: Locator): Promise<string[]> {
	return resultList(section)
		.getByRole('group')
		.evaluateAll((cards) => cards.map((card) => document.getElementById(card.getAttribute('aria-labelledby') ?? '')?.textContent ?? ''));
}

/** The detail panel of the section (complementary landmark 'Model details'). */
export function modelDetail(section: Locator): Locator {
	return section.getByRole('complementary', { name: 'Model details', exact: true });
}

/** Opens a result in the detail panel with its name (a link button) and waits for the panel to show it. */
export async function openModel(section: Locator, name: string): Promise<Locator> {
	await resultCard(section, name).getByRole('button', { name, exact: true }).click();
	const detail = modelDetail(section);
	await expect(detail.getByRole('heading', { name, exact: true, level: 2 })).toBeVisible();
	await waitForPicturesInView(section.page());
	return detail;
}

export function searchBox(section: Locator): Locator {
	return section.getByRole('searchbox', { name: 'Search models' });
}

/** Types a query like a user (one key at a time: the store debounces) and waits for exactly `expected`. */
export async function searchFor(section: Locator, query: string, expected: string[]): Promise<void> {
	await searchBox(section).fill('');
	await searchBox(section).pressSequentially(query, { delay: 40 });
	await expect.poll(() => resultNames(section), { message: `results of '${query}'` }).toEqual(expected);
	await waitForPicturesInView(section.page());
}

/** The open popup of a Fluent Dropdown (aria-controls of its combobox): a listbox of options, or for a multiselect
 *  dropdown a menu of menuitemcheckbox items. */
export async function dropdownPopup(page: Page, combobox: Locator): Promise<Locator> {
	await expect(combobox).toHaveAttribute('aria-expanded', 'true');
	const id = await combobox.getAttribute('aria-controls');
	expect(id, 'the open dropdown names its popup (aria-controls)').toBeTruthy();
	const popup = page.locator(`[id="${id}"]`);
	await expect(popup).toBeVisible();
	return popup;
}

/** An option of a dropdown popup (single or multiple selection) by its accessible name. */
export function dropdownOption(popup: Locator, name: string | RegExp): Locator {
	const exact = typeof name === 'string';
	return popup.getByRole('option', { name, exact }).or(popup.getByRole('menuitemcheckbox', { name, exact }));
}

/** Picks (toggles, for a multiselect dropdown) options of a filter dropdown (Type, Base model, Sort by, Version) and
 *  closes its popup. */
export async function pickOptions(page: Page, scope: Locator, filter: string, options: string[]): Promise<void> {
	const combobox = scope.getByRole('combobox', { name: filter });
	await combobox.click();
	const popup = await dropdownPopup(page, combobox);
	for (const option of options) {
		await dropdownOption(popup, option).click();
	}
	if (await popup.isVisible()) {
		await page.keyboard.press('Escape');
	}
	await expect(popup).toBeHidden();
}

/** The status badge of a card or detail panel ('In library', 'On disk', 'Downloading', 'Failed', 'Not supported',
 *  'Selected'). */
export function statusBadge(scope: Locator, label: string): Locator {
	return scope.locator('.fui-Badge').filter({ hasText: new RegExp(`^${label}$`) });
}

/** The install progress bar of a card, detail panel or download (accessible name 'Installing <title>'). */
export function installProgress(scope: Locator): Locator {
	return scope.getByRole('progressbar', { name: /^Installing / });
}

/** The preview of a card (picture or placeholder) fills the card's height and its picture covers the preview,
 *  whatever the card's content height (Fluent's horizontal Card centers its children). */
export async function expectPreviewFillsCard(card: Locator): Promise<void> {
	await card.scrollIntoViewIfNeeded();
	const boxes = await card.evaluate((element) => {
		const preview = element.querySelector('.fui-CardPreview');
		const picture = preview?.querySelector('img') ?? null;
		const rect = (node: Element | null) => (node ? node.getBoundingClientRect().toJSON() : null) as DOMRect | null;
		return { card: rect(element), preview: rect(preview), picture: rect(picture) };
	});
	expect(boxes.preview, 'the card has a preview').not.toBeNull();
	const { card: cardBox, preview, picture } = boxes as { card: DOMRect; preview: DOMRect; picture: DOMRect | null };
	expect(Math.abs(preview.top - cardBox.top), 'preview top at the card top').toBeLessThanOrEqual(1.5);
	expect(Math.abs(preview.bottom - cardBox.bottom), 'preview bottom at the card bottom').toBeLessThanOrEqual(1.5);
	expect(Math.abs(preview.left - cardBox.left), 'preview at the card left edge').toBeLessThanOrEqual(1.5);
	if (picture) {
		expect([picture.top, picture.bottom, picture.left, picture.right].map(Math.round)).toEqual(
			[preview.top, preview.bottom, preview.left, preview.right].map(Math.round),
		);
	}
}
