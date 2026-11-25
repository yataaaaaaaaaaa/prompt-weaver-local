// Generation pane helpers shared by the generation, outputs and LoRA library specs.
import { expect, type Locator } from '@playwright/test';
import type { AppDriver } from '../support/app';

/** A titled section of the Generation pane ('Current generation', 'Image settings', 'Seeds', 'Model', 'LoRAs',
 *  'Negative prompt'): a region named by its heading. */
export function sectionOf(app: AppDriver, name: string): Locator {
	return app.pane('Generation').getByRole('region', { name, exact: true });
}

/** Brings the Generation pane to the front and scrolls its body to the section. */
export async function scrollSectionIntoView(app: AppDriver, name: string): Promise<Locator> {
	const pane = app.pane('Generation');
	await app.bringToFront(pane);
	const section = sectionOf(app, name);
	await section.scrollIntoViewIfNeeded();
	return section;
}

/** Resizes a workspace window with its resize grip (a real pointer drag) to `size` (never below the window minimum). */
export async function resizeWindowTo(app: AppDriver, window: Locator, size: { width: number; height: number }): Promise<void> {
	const name = await window.getAttribute('aria-label');
	const box = await window.boundingBox();
	const grip = window.getByRole('button', { name: `Resize ${name}` });
	const gripBox = await grip.boundingBox();
	if (!box || !gripBox) {
		throw new Error(`window ${name} is not visible`);
	}
	const startX = gripBox.x + gripBox.width / 2;
	const startY = gripBox.y + gripBox.height / 2;
	await app.page.mouse.move(startX, startY);
	await app.page.mouse.down();
	await app.page.mouse.move(startX + (size.width - box.width) / 2, startY + (size.height - box.height) / 2, { steps: 4 });
	await app.page.mouse.move(startX + size.width - box.width, startY + size.height - box.height, { steps: 4 });
	await app.page.mouse.up();
	await expect.poll(async () => Math.round((await window.boundingBox())?.width ?? 0)).toBe(size.width);
}
