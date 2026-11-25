// Page helpers of the model library specs (e2e/models): the pane, its result cards by model name, the search box,
// the filters and the toasts the installs announce. The synthetic catalog is backend/tests/e2e/fixtures/
// civitai_catalog.json (fake_civitai.py): the names used here are its models.
import { expect, type Locator, type Page } from '@playwright/test';
import { waitForPicturesInView, type AppDriver } from '../support/app';
import { MODEL_LIBRARY } from './libraries';

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

/** Opens the app, then the Model library pane (fronted), once its first results are shown. */
export async function openModelLibrary(app: AppDriver): Promise<Locator> {
	await app.open();
	const pane = await app.showPane(MODEL_LIBRARY);
	await expect(resultList(pane)).toBeVisible();
	await app.settle();
	return pane;
}

export function resultList(pane: Locator): Locator {
	return pane.getByRole('list', { name: 'Search results' });
}

/** The result card of a model (a Fluent Card: role group named by the model name). */
export function resultCard(pane: Locator, name: string): Locator {
	return resultList(pane).getByRole('group', { name, exact: true });
}

/** The model names of the listed results, in order. */
export async function resultNames(pane: Locator): Promise<string[]> {
	return resultList(pane)
		.getByRole('group')
		.evaluateAll((cards) => cards.map((card) => document.getElementById(card.getAttribute('aria-labelledby') ?? '')?.textContent ?? ''));
}

export function searchBox(pane: Locator): Locator {
	return pane.getByRole('searchbox', { name: 'Search models' });
}

/** Types a query like a user (one key at a time: the store debounces) and waits for exactly `expected`. */
export async function searchFor(pane: Locator, query: string, expected: string[]): Promise<void> {
	await searchBox(pane).fill('');
	await searchBox(pane).pressSequentially(query, { delay: 40 });
	await expect.poll(() => resultNames(pane), { message: `results of '${query}'` }).toEqual(expected);
	await waitForPicturesInView(pane.page());
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

/** Picks (toggles, for a multiselect dropdown) options of a filter dropdown (Type, Base model, Sort by) and closes
 *  its popup. */
export async function pickOptions(page: Page, pane: Locator, filter: string, options: string[]): Promise<void> {
	const combobox = pane.getByRole('combobox', { name: filter });
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

/** The status badge of a card ('In library', 'On disk', 'Downloading', 'Failed', 'Not supported', 'Selected'). */
export function statusBadge(card: Locator, label: string): Locator {
	return card.locator('.fui-Badge').filter({ hasText: new RegExp(`^${label}$`) });
}

/** The install progress bar of a card or download (accessible name 'Installing <title>'). */
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
