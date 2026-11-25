// Colors the real browser computes, compared with the token table of src/ui/stateColors.ts, and their contrast
// (WCAG 2): the one implementation every area's specs use.
//
//   const expected = await resolveColor(page, STATE_COLORS.forbidden.border);   // 'rgb(227, 125, 128)' in dark
//   expect(await computedStyle(window, 'border-top-color')).toBe(expected);
//   expect(await textContrast(button)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
//   expect(contrastRatio(border, await paintedBackground(row))).toBeGreaterThanOrEqual(MIN_GRAPHICS_CONTRAST);
//   await expectReadable(card.locator('.fui-Badge'));
import { expect, type Locator, type Page } from '@playwright/test';

/** WCAG AA contrast of normal-size text. */
export const MIN_TEXT_CONTRAST = 4.5;
/** WCAG AA contrast of graphics and UI component boundaries (borders, icons, focus rings). */
export const MIN_GRAPHICS_CONTRAST = 3;

/** The computed rgb()/rgba() string of a CSS color value (e.g. a token `var(--colorPaletteRedBorder2)`) inside the
 *  app's Fluent provider, where the theme variables are defined. */
export async function resolveColor(page: Page, cssColor: string): Promise<string> {
	return page.evaluate((value) => {
		const host = document.querySelector('#root > .fui-FluentProvider') ?? document.body;
		const probe = document.createElement('span');
		probe.style.color = value;
		probe.style.display = 'none';
		host.appendChild(probe);
		const resolved = getComputedStyle(probe).color;
		probe.remove();
		return resolved;
	}, cssColor);
}

/** getComputedStyle(element)[property] (kebab-case property, e.g. 'border-top-color', 'background-color'). */
export async function computedStyle(locator: Locator, property: string): Promise<string> {
	return locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);
}

type Rgba = [number, number, number, number];

/** The channels of a computed `rgb()` / `rgba()` color. */
export function parseColor(value: string): Rgba {
	const match = /rgba?\(([^)]+)\)/.exec(value);
	if (!match) {
		throw new Error(`not an rgb() color: ${value}`);
	}
	const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
	return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function luminance([red, green, blue]: Rgba): number {
	const channel = (value: number) => {
		const ratio = value / 255;
		return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/** WCAG contrast ratio (1..21) of two opaque computed colors. */
export function contrastRatio(first: string, second: string): number {
	const [light, dark] = [luminance(parseColor(first)), luminance(parseColor(second))].sort((left, right) => right - left);
	return (light + 0.05) / (dark + 0.05);
}

export type ContrastSample = {
	text: string;
	/** The text color as painted (composited over the background). */
	color: string;
	/** The background the element is painted on: the background colors of the element and its ancestors, composited
	 *  over white. */
	background: string;
	ratio: number;
};

/** Text color and painted background of every element of `elements`, and their contrast ratio. */
export async function contrastOf(elements: Locator): Promise<ContrastSample[]> {
	const painted = await elements.evaluateAll((nodes) => {
		type Color = [number, number, number, number];
		const parse = (value: string): Color => {
			const parts = /rgba?\(([^)]+)\)/.exec(value)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number) ?? [0, 0, 0, 0];
			return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
		};
		const over = (top: Color, bottom: Color): Color => [
			top[0] * top[3] + bottom[0] * (1 - top[3]),
			top[1] * top[3] + bottom[1] * (1 - top[3]),
			top[2] * top[3] + bottom[2] * (1 - top[3]),
			1,
		];
		const css = (color: Color) => `rgb(${color.slice(0, 3).map(Math.round).join(', ')})`;
		return nodes.map((node) => {
			const layers: Color[] = [];
			for (let element: Element | null = node; element; element = element.parentElement) {
				const layer = parse(getComputedStyle(element).backgroundColor);
				if (layer[3] > 0) {
					layers.push(layer);
				}
			}
			const background = layers.reverse().reduce<Color>((below, layer) => over(layer, below), [255, 255, 255, 1]);
			const color = over(parse(getComputedStyle(node).color), background);
			return { text: (node.textContent ?? '').trim(), color: css(color), background: css(background) };
		});
	});
	return painted.map((sample) => ({ ...sample, ratio: contrastRatio(sample.color, sample.background) }));
}

/** The contrast ratio of one element's text against the background it is painted on. */
export async function textContrast(locator: Locator): Promise<number> {
	await expect(locator).toHaveCount(1);
	return (await contrastOf(locator))[0].ratio;
}

/** The color the element is painted on (its own and its ancestors' backgrounds, composited). */
export async function paintedBackground(locator: Locator): Promise<string> {
	await expect(locator).toHaveCount(1);
	return (await contrastOf(locator))[0].background;
}

/** Every element of `elements` (at least one) has readable text: contrast ratio >= `minimum` (WCAG AA). */
export async function expectReadable(elements: Locator, minimum = MIN_TEXT_CONTRAST): Promise<void> {
	const samples = await contrastOf(elements);
	expect(samples.length, 'elements to check').toBeGreaterThan(0);
	expect(samples.filter((sample) => sample.ratio < minimum), `text with a contrast under ${minimum}:1`).toEqual([]);
}
