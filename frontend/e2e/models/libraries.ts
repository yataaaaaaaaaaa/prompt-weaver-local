// Helpers shared by the model library and image library specs (e2e/models, e2e/images): the pane titles and the
// read-only checks of what the libraries change elsewhere (the Generation pane's checkpoint and LoRA selection).
import { expect, type Locator } from '@playwright/test';
import type { AppDriver } from '../support/app';

export const MODEL_LIBRARY = 'Model library';
export const IMAGE_LIBRARY = 'Image library';

/** The Generation pane (read-only checks of what the libraries select). */
export function generationPane(app: AppDriver): Locator {
	return app.pane('Generation');
}

/** The checkpoint selected for generation (the Generation pane's Checkpoint picker). */
export function selectedCheckpoint(app: AppDriver): Locator {
	return generationPane(app).getByRole('combobox', { name: 'Checkpoint' });
}

const WEIGHT_LABEL = /^Weight of (.+)$/;

/** The LoRA selection as the Generation pane shows it: LoRA name -> weight (a selected LoRA has a 'Weight of <name>'
 *  field, an unselected one has none). */
export async function selectedLoras(app: AppDriver): Promise<Record<string, string>> {
	const list = generationPane(app).getByRole('list', { name: 'LoRA library' });
	await expect(list).toBeVisible();
	const selection: Record<string, string> = {};
	for (const field of await list.getByRole('spinbutton', { name: WEIGHT_LABEL }).all()) {
		const name = WEIGHT_LABEL.exec((await field.getAttribute('aria-label')) ?? '')?.[1] ?? '';
		selection[name] = await field.inputValue();
	}
	return selection;
}
