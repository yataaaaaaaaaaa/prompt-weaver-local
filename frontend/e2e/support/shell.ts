// The docked shell as drawn in the real browser: the boxes of the rail, the Create header and the three Create
// regions, the checks that they tile the window without overlapping or sticking out, and the persisted Create layout
// (layout-store). Shared by the smoke spec, the shell specs and the journeys.
import { expect, type Locator, type Page } from '@playwright/test';
import { CREATE_REGION_IDS, type CreateRegionId } from '../../src/app/sections';
import type { CreateLayout } from '../../src/domain/layout';
import type { AppDriver } from './app';
import { fixtureStoreFile, savedStore, STORE_NAMES } from './backend';
import { boxOf, expectOnTop, intersects, type Box } from './visibility';

/** The drawn boxes of the three Create regions. */
export async function regionBoxes(app: AppDriver): Promise<Record<CreateRegionId, Box>> {
	const entries = await Promise.all(CREATE_REGION_IDS.map(async (region) => [region, await boxOf(app.createRegion(region))] as const));
	return Object.fromEntries(entries) as Record<CreateRegionId, Box>;
}

/** The rail, the Create header and the three regions tile the window: side by side left to right, nothing overlaps,
 *  nothing sticks out of the viewport, the regions fill the height under the header, and Generate is on top (no
 *  region covers it). */
export async function expectDockedLayout(app: AppDriver): Promise<Record<CreateRegionId, Box>> {
	const viewport = app.page.viewportSize()!;
	const rail = await boxOf(app.navigation());
	const header = await boxOf(app.commandBar());
	const boxes = await regionBoxes(app);
	const all: Array<[string, Box]> = [['rail', rail], ...CREATE_REGION_IDS.map((region) => [region, boxes[region]] as [string, Box])];
	for (const [name, box] of all) {
		expect(box.x, `${name} starts inside the window`).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width, `${name} ends inside the window`).toBeLessThanOrEqual(viewport.width + 0.5);
		expect(box.y + box.height, `${name} ends above the bottom edge`).toBeLessThanOrEqual(viewport.height + 0.5);
	}
	for (let first = 0; first < all.length; first += 1) {
		for (let second = first + 1; second < all.length; second += 1) {
			expect(intersects(all[first][1], all[second][1]), `${all[first][0]} overlaps ${all[second][0]}`).toBe(false);
		}
	}
	expect(boxes.board.x).toBeGreaterThanOrEqual(rail.x + rail.width - 0.5);
	expect(boxes.viewer.x).toBeGreaterThanOrEqual(boxes.board.x + boxes.board.width - 0.5);
	expect(boxes.generation.x).toBeGreaterThanOrEqual(boxes.viewer.x + boxes.viewer.width - 0.5);
	// The regions fill the row: from the rail to the right edge, from under the header to the bottom.
	expect(Math.abs(boxes.generation.x + boxes.generation.width - viewport.width), 'the regions reach the right edge').toBeLessThanOrEqual(1);
	for (const region of CREATE_REGION_IDS) {
		expect(boxes[region].y, `${region} starts under the header`).toBeGreaterThanOrEqual(header.y + header.height - 0.5);
		expect(Math.abs(boxes[region].y + boxes[region].height - viewport.height), `${region} reaches the bottom`).toBeLessThanOrEqual(1);
	}
	const generate = app.generationAction();
	await expectOnTop(generate);
	expect(intersects(await boxOf(generate), boxes.board), 'the board covers Generate').toBe(false);
	return boxes;
}

/** Nothing in the page scrolls horizontally and nothing sticks out at the right edge of the window. */
export async function expectNoPageOverflow(page: Page): Promise<void> {
	const problems = await page.evaluate(() => {
		const found: string[] = [];
		const width = document.documentElement.clientWidth;
		if (document.documentElement.scrollWidth > width + 1) {
			found.push(`the page scrolls horizontally (${document.documentElement.scrollWidth} > ${width})`);
		}
		const shell = document.querySelector('[data-app-shell]');
		for (const element of Array.from(shell?.querySelectorAll<HTMLElement>('*') ?? [])) {
			const style = getComputedStyle(element);
			if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && element.scrollWidth > element.clientWidth + 1) {
				found.push(`<${element.tagName.toLowerCase()} aria-label="${element.getAttribute('aria-label') ?? ''}"> scrolls horizontally (${element.scrollWidth} > ${element.clientWidth})`);
			}
		}
		return found;
	});
	expect(problems, 'horizontal overflow').toEqual([]);
}

/** E2EResetOptions.files with the fixture Create layout (layout-store) changed by `change` (e.g. other widths). */
export function layoutStoreFile(change: (layout: CreateLayout) => CreateLayout): Record<string, unknown> {
	return fixtureStoreFile<CreateLayout>(STORE_NAMES.layout, change);
}

/** Resolves with the next saved Create layout accepted by `accepts` (call before the action that saves it). */
export function savedLayout(page: Page, accepts: (layout: CreateLayout) => boolean): Promise<CreateLayout> {
	return savedStore<CreateLayout>(page, STORE_NAMES.layout, accepts);
}

/** The width of a region as its splitter reports it (aria-valuenow). */
export async function splitterValue(splitter: Locator): Promise<number> {
	return Number(await splitter.getAttribute('aria-valuenow'));
}
