// Region cycling and search in the real browser: F6 / Shift+F6 move the focus through the regions on screen (the
// rail, the Create header, the prompt board, the viewer, the generation panel; wrapping around), each with the Fluent
// focus ring, also from inside a toolbar or a splitter; Ctrl+F focuses the shown section's search box (the prompt
// board's in Create, expanding a collapsed board first).
import { tokens } from '@fluentui/react-theme';
import { SECTION_SEARCH_ATTRIBUTE } from '../../src/app/sections';
import { computedStyle, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import type { Page } from '@playwright/test';

/** The F6 region id of the focused element (null when the focus is not on a region). */
async function focusedRegion(page: Page): Promise<string | null> {
	return page.evaluate(() => document.activeElement?.getAttribute('data-f6-region') ?? null);
}

const CREATE_CYCLE = ['nav', 'commands', 'board', 'viewer', 'generation'];

test('F6 and Shift+F6 cycle through the regions on screen, each with a visible focus ring', async ({ app, page }, testInfo) => {
	await app.open();
	const focusColor = await resolveColor(page, tokens.colorStrokeFocus2);

	// From nowhere, F6 starts at the rail, then goes through every region on screen until it wraps to the rail again.
	const visited: Array<string | null> = [];
	for (let press = 0; press < 16; press += 1) {
		await page.keyboard.press('F6');
		const region = await focusedRegion(page);
		if (press > 0 && region === 'nav') {
			break;
		}
		visited.push(region);
		const focused = page.locator(':focus');
		expect(await computedStyle(focused, 'outline-style'), `${region} focus ring`).toBe('solid');
		expect(await computedStyle(focused, 'outline-color'), `${region} focus ring color`).toBe(focusColor);
		await saveScreenshot(page, testInfo, `f6-${press}-${region}`);
	}
	// Some areas nest regions of their own (e.g. the viewer's details): the shell's own regions come in this order.
	expect(visited.filter((region) => CREATE_CYCLE.includes(region ?? ''))).toEqual(CREATE_CYCLE);
	expect(await focusedRegion(page)).toBe('nav');

	// Shift+F6 goes back around: from the rail to the last region.
	await page.keyboard.press('Shift+F6');
	expect(await focusedRegion(page)).not.toBe('nav');
	await page.keyboard.press('F6');
	expect(await focusedRegion(page)).toBe('nav');
});

test('F6 leaves a toolbar and a splitter too (they never keep it for themselves)', async ({ app, page }) => {
	await app.open();
	await app.regionToggle('board').focus();
	await page.keyboard.press('F6');
	expect(await focusedRegion(page)).toBe('board');

	await app.splitter('viewer').focus();
	await page.keyboard.press('Shift+F6');
	expect(await focusedRegion(page)).toBe('board');
});

test('F6 skips the regions of the hidden sections', async ({ app, page }) => {
	await app.open();
	await app.goTo('models');
	const regions: Array<string | null> = [];
	for (let press = 0; press < 8; press += 1) {
		await page.keyboard.press('F6');
		regions.push(await focusedRegion(page));
		const inSection = await page.evaluate(() => document.activeElement?.closest('main')?.getAttribute('aria-label') ?? 'rail');
		expect(['Models', 'rail']).toContain(inSection);
	}
	expect(regions).toContain('nav');
	expect(regions).not.toContain('board');
});

test('Ctrl+F focuses the search box of the shown section', async ({ app, page }, testInfo) => {
	await app.open();
	await page.keyboard.press('Control+f');
	const boardSearch = app.createRegion('board').locator(`[${SECTION_SEARCH_ATTRIBUTE}]`);
	await expect(boardSearch).toBeFocused();
	await saveScreenshot(page, testInfo, 'create-search');

	await app.goTo('models');
	await page.keyboard.press('Control+f');
	await expect(app.section('models').locator(`[${SECTION_SEARCH_ATTRIBUTE}]`)).toBeFocused();
	await expect(page.locator(':focus')).toHaveAttribute('type', /search|text/);
});

test('Ctrl+F in Create expands a collapsed prompt board to search it', async ({ app, page }) => {
	await app.open();
	await app.regionToggle('board').click();
	await expect(app.createRegion('board')).toHaveAttribute('data-collapsed', 'true');

	await page.keyboard.press('Control+f');

	await expect(app.createRegion('board')).not.toHaveAttribute('data-collapsed', 'true');
	await expect(app.createRegion('board').locator(`[${SECTION_SEARCH_ATTRIBUTE}]`)).toBeFocused();
});
