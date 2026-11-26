// User flows several areas need (one implementation each). Area-specific flows live in the area's spec folder.
import { expect } from '@playwright/test';
import { GENERATION_ACTION_NAMES } from '../../src/features/generation/generationLabels';
import { outputPictureName } from '../../src/features/outputs/viewerLabels';
import { toast, type AppDriver } from './app';
import type { E2EBackend } from './backend';

type OutputIndex = { ids: string[] };

/** Clicks Generate in the Create section's generation panel, waits until the fake generator saved a new output and the
 *  viewer shows its picture (the current picture is the one image named 'Output <id>' of the 'Current image' region;
 *  filmstrip thumbnails are named otherwise); returns its id. The generator is paced
 *  (E2EResetOptions.generator.step_delay_ms) and reports one progress event per step. */
export async function generateOutput(app: AppDriver, backend: E2EBackend): Promise<string> {
	const before = (await backend.get<OutputIndex>('/api/outputs')).ids;
	await app.goTo('create');
	await app.generationAction(GENERATION_ACTION_NAMES.generate).click();
	let created = '';
	await expect
		.poll(
			async () => {
				const ids = (await backend.get<OutputIndex>('/api/outputs')).ids;
				created = ids.find((id) => !before.includes(id)) ?? '';
				return created;
			},
			{ timeout: 30_000, message: 'a new output saved by the fake generator' },
		)
		.not.toBe('');
	await expect(app.createRegion('viewer').getByRole('img', { name: outputPictureName(created), exact: true })).toBeVisible();
	return created;
}

/** Clicks 'Go to Create' on the hand-off toast matching `text` and waits until Create is shown (the toast is gone). */
export async function goToCreateFrom(app: AppDriver, text: string | RegExp): Promise<void> {
	const handOff = toast(app.page, text);
	await expect(handOff).toBeVisible({ timeout: 20_000 });
	await handOff.getByRole('button', { name: 'Go to Create', exact: true }).click();
	await expect(app.section('create')).toBeVisible();
	await expect(handOff).toHaveCount(0);
	await app.parkPointer();
	await app.settle();
}
