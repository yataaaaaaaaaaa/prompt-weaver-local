// Helpers shared by the Models and Images specs (e2e/models, e2e/images, the remix and download journeys): the
// read-only checks of what these sections change in Create (the Generation region's checkpoint and LoRA selection,
// the command bar's current model; they show Create first). The hand-off toasts: support/app.ts toast and
// support/flows.ts goToCreateFrom.
import { expect, type Locator } from '@playwright/test';
import type { AppDriver } from '../support/app';

/** The checkpoint picker of the Generation region (goes to Create first). */
export async function checkpointPicker(app: AppDriver): Promise<Locator> {
	await app.goTo('create');
	return app.createRegion('generation').getByRole('combobox', { name: 'Checkpoint' });
}

const WEIGHT_LABEL = /^Weight of (.+)$/;

/** The LoRA selection as the Generation region shows it (goes to Create first): LoRA name -> weight (a selected LoRA
 *  has a 'Weight of <name>' field, an unselected one has none). */
export async function selectedLoras(app: AppDriver): Promise<Record<string, string>> {
	await app.goTo('create');
	const list = app.createRegion('generation').getByRole('list', { name: 'LoRA library' });
	await expect(list).toBeVisible();
	const selection: Record<string, string> = {};
	for (const field of await list.getByRole('spinbutton', { name: WEIGHT_LABEL }).all()) {
		const name = WEIGHT_LABEL.exec((await field.getAttribute('aria-label')) ?? '')?.[1] ?? '';
		selection[name] = await field.inputValue();
	}
	return selection;
}
