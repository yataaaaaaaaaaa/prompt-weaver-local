// Generation panel helpers shared by the generation, outputs and LoRA specs and the journeys: the 'Generation' region
// of the Create section, its titled sections, its "More options" disclosure, and the narrow layout seeded through the
// persisted Create layout (layout-store). The action area is AppDriver.generationActions() / generationAction().
import { expect, type Locator } from '@playwright/test';
import { REGION_MIN_WIDTH } from '../../src/domain/layout';
import { GENERATION_LABELS } from '../../src/features/generation/generationLabels';
import type { AppDriver } from '../support/app';
import { layoutStoreFile } from '../support/shell';

/** The generation region of the Create section. */
export function generationRegion(app: AppDriver): Locator {
	return app.createRegion('generation');
}

/** A titled section of the generation panel ('Model', 'Character', 'LoRAs', 'Image settings', 'Seeds',
 *  'Negative prompt'): a region named by its heading. */
export function sectionOf(app: AppDriver, name: string): Locator {
	return generationRegion(app).getByRole('region', { name, exact: true });
}

/** Scrolls the panel body to the section and returns it. */
export async function scrollSectionIntoView(app: AppDriver, name: string): Promise<Locator> {
	const section = sectionOf(app, name);
	await section.scrollIntoViewIfNeeded();
	return section;
}

/** Opens "More options" (model and LoRA files, prompt link details) and returns the disclosed panel's region. */
export async function openMoreOptions(app: AppDriver): Promise<Locator> {
	const header = generationRegion(app).getByRole('button', { name: GENERATION_LABELS.moreOptions, exact: true });
	await header.scrollIntoViewIfNeeded();
	if ((await header.getAttribute('aria-expanded')) !== 'true') {
		await header.click();
	}
	await expect(header).toHaveAttribute('aria-expanded', 'true');
	return generationRegion(app);
}

/** Scrolls the panel body (the scrolling part above the sticky actions) to its very end, once its content stopped
 *  growing (the More options disclosure animates its height); returns how far it scrolled. */
export async function scrollPanelToEnd(app: AppDriver): Promise<number> {
	const contentHeight = () =>
		sectionOf(app, 'Model').evaluate((section) => section.parentElement?.getBoundingClientRect().height ?? 0);
	let previous = -1;
	await expect
		.poll(async () => {
			const height = await contentHeight();
			const stable = height === previous;
			previous = height;
			return stable;
		}, { intervals: [250] })
		.toBe(true);
	const scrolled = await sectionOf(app, 'Model').evaluate((section) => {
		let scroller: HTMLElement | null = section.parentElement;
		while (scroller && getComputedStyle(scroller).overflowY !== 'auto') {
			scroller = scroller.parentElement;
		}
		if (!scroller) {
			throw new Error('the generation panel body does not scroll');
		}
		scroller.scrollTop = scroller.scrollHeight;
		return { top: scroller.scrollTop, end: scroller.scrollHeight - scroller.clientHeight };
	});
	expect(scrolled.top, 'the panel body is scrolled to its end').toBeGreaterThanOrEqual(scrolled.end - 1);
	return scrolled.top;
}

/** E2EResetOptions.files of a Create layout with the viewer and the generation panel at their narrowest widths. */
export function narrowRegionsLayout(): Record<string, unknown> {
	return layoutStoreFile((layout) => ({ ...layout, widths: { viewer: REGION_MIN_WIDTH.viewer, generation: REGION_MIN_WIDTH.generation } }));
}
