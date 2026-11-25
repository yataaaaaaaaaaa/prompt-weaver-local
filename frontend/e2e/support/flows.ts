// User flows several areas need (one implementation each). Area-specific flows live in the area's spec folder.
import { expect } from '@playwright/test';
import type { AppDriver } from './app';
import type { E2EBackend } from './backend';

type OutputIndex = { ids: string[] };

/** Clicks Generate in the Generation pane, waits until the fake generator saved a new output and the Output browser
 *  shows it; returns its id. The generator is paced (E2EResetOptions.generator.step_delay_ms) and reports one
 *  progress event per step. */
export async function generateOutput(app: AppDriver, backend: E2EBackend): Promise<string> {
	const before = (await backend.get<OutputIndex>('/api/outputs')).ids;
	await app.pane('Generation').getByRole('button', { name: 'Generate', exact: true }).click();
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
	await expect(app.pane('Output browser').getByText(`#${created}`, { exact: true })).toBeVisible();
	return created;
}
