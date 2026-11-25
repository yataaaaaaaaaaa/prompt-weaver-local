// Helpers of the generation / outputs / LoRA library specs (one implementation each): the Output browser details,
// the output list of the backend, the generation progress view and the Generation pane controls.
import { expect, type Locator, type Page } from '@playwright/test';
import type { AppDriver } from '../support/app';
import type { E2EBackend } from '../support/backend';

/** The output ids the backend lists (ascending). */
export async function backendOutputIds(backend: E2EBackend): Promise<string[]> {
	return (await backend.get<{ ids: string[] }>('/api/outputs')).ids;
}

/** The value cell of the Output browser details row `term` ('Output', 'Position', 'LoRAs', ...). */
export function outputDetail(app: AppDriver, term: string): Locator {
	return app.pane('Output browser').locator(`xpath=.//dl//dt[normalize-space(.)=${JSON.stringify(term)}]/following-sibling::dd[1]`);
}

/** The Output browser shows output `id` at `position` ('4 / 4') and the Image pane shows its picture. */
export async function expectCurrentOutput(app: AppDriver, id: string, position: string): Promise<void> {
	await expect(outputDetail(app, 'Output')).toHaveText(`#${id}`);
	await expect(outputDetail(app, 'Position')).toHaveText(position);
	await expect(imageOf(app, id)).toBeVisible();
}

/** The picture of output `id` in the Image pane (loaded: natural size known). */
export function imageOf(app: AppDriver, id: string): Locator {
	return app.pane('Image').getByRole('img', { name: `Output ${id}` });
}

/** An Output browser navigation button ('First output', 'Previous output', 'Next output', 'Last output'); its
 *  accessible name may carry the keyboard shortcut. */
export function navigationButton(app: AppDriver, label: string): Locator {
	return app.pane('Output browser').getByRole('button', { name: new RegExp(`^${label}`) });
}

/** The generation progress view of a pane ('Generation' or 'Output browser'). */
export function progressOf(pane: Locator): { root: Locator; bar: Locator; fill: Locator } {
	const root = pane.locator('[data-generation-outcome]');
	const bar = root.getByRole('progressbar', { name: 'Generation progress' });
	return { root, bar, fill: bar.locator('.fui-ProgressBar__bar') };
}

/** Waits until the progress view of `pane` shows `outcome` ('idle' | 'running' | 'complete' | 'error' | 'cancelled'). */
export async function expectOutcome(pane: Locator, outcome: string): Promise<void> {
	await expect(progressOf(pane).root).toHaveAttribute('data-generation-outcome', outcome, { timeout: 30_000 });
}

/** Moves the keyboard focus to the workspace surface (no control focused): app shortcuts then apply. */
export async function focusSurface(page: Page): Promise<void> {
	await page.evaluate(() => {
		(document.activeElement as HTMLElement | null)?.blur?.();
	});
	await expect.poll(() => page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true);
}

/** Same app command twice within this delay is ignored (src/app/commands.ts COMMAND_DEDUPE_MS = 200). */
export const COMMAND_REPEAT_GAP_MS = 250;
