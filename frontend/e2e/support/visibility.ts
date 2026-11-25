// What a user sees, checked in the real browser (jsdom does no layout or painting and cannot prove any of this):
//
// - assertAppVisible(page): samples a grid of points with document.elementFromPoint and fails when the topmost
//   element is a Fluent portal mount node (the full-screen opaque overlay of ead54a3), nothing, or (unless overlays
//   are expected) anything outside the app root; then fails when a screenshot of the viewport is (nearly) uniform
//   (a blank, monochrome or covered window).
// - expectOnTop(locator): the element is visible and not covered by another element (window, overlay, portal) at its
//   center and corners.
// - expectNotUniform(png): the picture has real content.
// - expectNoHorizontalOverflow(window): nothing sticks out of a window at its right edge.
// - boxOf / intersects: the geometry of what is drawn.
import { expect, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

export type VisibilityOptions = {
	/** Points whose topmost element is inside a Fluent portal (an open menu, dialog, tooltip or toast) are accepted. */
	allowOverlays?: boolean;
	/** Sample grid (columns x rows), default 16 x 9. */
	grid?: readonly [number, number];
};

export type UniformityReport = {
	/** Share of sampled pixels close to the most frequent color (0..1). */
	dominantShare: number;
	/** Distinct colors among the sampled pixels (quantized to 32 levels per channel). */
	distinctColors: number;
};

/** Above this dominant-color share (or under MIN_DISTINCT_COLORS) a screenshot counts as uniform. */
export const MAX_DOMINANT_SHARE = 0.97;
export const MIN_DISTINCT_COLORS = 8;

type PointProblem = { x: number; y: number; problem: string };

/** Fails when the app is not what the user sees across the viewport (see the module comment). */
export async function assertAppVisible(page: Page, options: VisibilityOptions = {}): Promise<void> {
	const [columns, rows] = options.grid ?? [16, 9];
	const problems = await page.evaluate(
		({ columns, rows, allowOverlays }): PointProblem[] => {
			const describe = (element: Element): string => {
				const html = element as HTMLElement;
				const classes = typeof html.className === 'string' ? html.className.split(/\s+/).slice(0, 3).join('.') : '';
				const label = html.getAttribute?.('aria-label');
				return `<${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}${label ? ` aria-label="${label}"` : ''}>`;
			};
			const root = document.getElementById('root');
			const found: PointProblem[] = [];
			const width = window.innerWidth;
			const height = window.innerHeight;
			for (let column = 0; column < columns; column += 1) {
				for (let row = 0; row < rows; row += 1) {
					const x = Math.round(((column + 0.5) * width) / columns);
					const y = Math.round(((row + 0.5) * height) / rows);
					const element = document.elementFromPoint(x, y);
					if (!element) {
						found.push({ x, y, problem: 'no element' });
					} else if (element.matches('[data-portal-node]')) {
						found.push({ x, y, problem: `a Fluent portal mount node covers the app: ${describe(element)}` });
					} else if (!root || !root.contains(element)) {
						const inPortal = element.closest('[data-portal-node]') !== null;
						if (!(allowOverlays && inPortal)) {
							found.push({ x, y, problem: `${inPortal ? 'an overlay' : 'a non-app element'} covers the app: ${describe(element)}` });
						}
					} else if (element === root || element === root.firstElementChild) {
						found.push({ x, y, problem: `only the bare app root is there (nothing rendered): ${describe(element)}` });
					}
				}
			}
			return found;
		},
		{ columns, rows, allowOverlays: options.allowOverlays ?? false },
	);
	expect(problems, 'points of the viewport where the app is not visible').toEqual([]);
	expectNotUniform(await page.screenshot({ animations: 'disabled', caret: 'hide' }), 'viewport screenshot');
}

/** Dominant color share and color count of a PNG (sampled on a grid of about 40 000 pixels). */
export function uniformity(png: Buffer): UniformityReport {
	const image = PNG.sync.read(png);
	const step = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 40_000)));
	const counts = new Map<number, number>();
	let samples = 0;
	for (let y = 0; y < image.height; y += step) {
		for (let x = 0; x < image.width; x += step) {
			const offset = (y * image.width + x) * 4;
			const key = ((image.data[offset] >> 3) << 10) | ((image.data[offset + 1] >> 3) << 5) | (image.data[offset + 2] >> 3);
			counts.set(key, (counts.get(key) ?? 0) + 1);
			samples += 1;
		}
	}
	const dominant = Math.max(0, ...counts.values());
	return { dominantShare: samples === 0 ? 1 : dominant / samples, distinctColors: counts.size };
}

/** Fails when the PNG is (nearly) one color: blank, monochrome or fully covered. */
export function expectNotUniform(png: Buffer, what = 'screenshot'): void {
	const report = uniformity(png);
	expect(
		report.dominantShare < MAX_DOMINANT_SHARE && report.distinctColors >= MIN_DISTINCT_COLORS,
		`${what} is (nearly) uniform: ${Math.round(report.dominantShare * 100)}% one color, ${report.distinctColors} colors`,
	).toBe(true);
}

/** The element is visible, inside the viewport and the topmost element at its center and near its corners. */
export async function expectOnTop(locator: Locator): Promise<void> {
	await expect(locator).toBeVisible();
	await locator.scrollIntoViewIfNeeded();
	const covered = await locator.evaluate((element): string[] => {
		const rect = element.getBoundingClientRect();
		const inset = Math.min(4, rect.width / 4, rect.height / 4);
		const points: Array<[string, number, number]> = [
			['center', rect.left + rect.width / 2, rect.top + rect.height / 2],
			['top-left', rect.left + inset, rect.top + inset],
			['top-right', rect.right - inset, rect.top + inset],
			['bottom-left', rect.left + inset, rect.bottom - inset],
			['bottom-right', rect.right - inset, rect.bottom - inset],
		];
		const problems: string[] = [];
		for (const [name, x, y] of points) {
			if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
				problems.push(`${name} is outside the viewport`);
				continue;
			}
			const top = document.elementFromPoint(x, y);
			if (!top || !(element === top || element.contains(top))) {
				const html = top as HTMLElement | null;
				problems.push(`${name} is covered by <${top?.tagName.toLowerCase() ?? 'nothing'}${html?.getAttribute?.('aria-label') ? ` aria-label="${html.getAttribute('aria-label')}"` : ''}>`);
			}
		}
		return problems;
	});
	expect(covered, 'parts of the element hidden by something else').toEqual([]);
}

/** A layout box in page coordinates (Playwright's boundingBox). */
export type Box = { x: number; y: number; width: number; height: number };

/** The on-screen box of a visible element. */
export async function boxOf(locator: Locator): Promise<Box> {
	await expect(locator).toBeVisible();
	const box = await locator.boundingBox();
	expect(box, 'bounding box of a visible element').not.toBeNull();
	return box as Box;
}

/** The two boxes overlap. */
export function intersects(a: Box, b: Box): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Nothing inside the window `pane` is wider than its scrolling body (no horizontal scrollbar, no control cut off at
 *  the right edge): every button, input and card ends inside the body. */
export async function expectNoHorizontalOverflow(pane: Locator): Promise<void> {
	const problems = await pane.evaluate((window) => {
		const found: string[] = [];
		const scrollers = Array.from(window.querySelectorAll<HTMLElement>('*')).filter((element) => {
			const style = getComputedStyle(element);
			return style.overflowX === 'auto' || style.overflowX === 'scroll';
		});
		for (const scroller of scrollers) {
			if (scroller.scrollWidth > scroller.clientWidth + 1) {
				found.push(`<${scroller.tagName.toLowerCase()} class="${scroller.className}"> scrolls horizontally (${scroller.scrollWidth} > ${scroller.clientWidth})`);
			}
		}
		const bounds = window.getBoundingClientRect();
		for (const control of Array.from(window.querySelectorAll<HTMLElement>('button, input, [role="combobox"], [role="group"]'))) {
			const rect = control.getBoundingClientRect();
			if (rect.width > 0 && rect.right > bounds.right + 1) {
				found.push(`${control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 40)} ends ${Math.round(rect.right - bounds.right)}px past the window`);
			}
		}
		return found;
	});
	expect(problems, 'content wider than the window').toEqual([]);
}
