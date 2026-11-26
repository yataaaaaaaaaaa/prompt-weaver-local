// Helpers of the generation / outputs / LoRA specs and the journeys (one implementation each): the viewer ('Current
// image' region) with its output actions toolbar, current picture, filmstrip and output details, the output list of the
// backend, synthetic extra outputs, the generation progress view and the keyboard surface.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { formatOutputId } from '../../src/domain/outputs';
import { GENERATION_LABELS } from '../../src/features/generation/generationLabels';
import { outputPictureName, VIEWER_LABELS } from '../../src/features/outputs/viewerLabels';
import type { AppDriver } from '../support/app';
import type { E2EBackend } from '../support/backend';
import { BACKEND_DIR } from '../support/env';

/** The output ids the backend lists (ascending). */
export async function backendOutputIds(backend: E2EBackend): Promise<string[]> {
	return (await backend.get<{ ids: string[] }>('/api/outputs')).ids;
}

/** The viewer of the Create section. */
export function viewerRegion(app: AppDriver): Locator {
	return app.createRegion('viewer');
}

/** The output actions toolbar of the viewer. */
export function outputActions(app: AppDriver): Locator {
	return viewerRegion(app).getByRole('toolbar', { name: VIEWER_LABELS.outputActions, exact: true });
}

/** An action of the output toolbar by its exact name ('First output', 'Copy prompt', 'Delete', 'Undo', ...). */
export function navigationButton(app: AppDriver, label: string): Locator {
	return outputActions(app).getByRole('button', { name: label, exact: true });
}

/** The value cell of the details row `term` ('Output', 'Position', 'LoRAs', ...) of the viewer's Details tab. */
export function outputDetail(app: AppDriver, term: string): Locator {
	return viewerRegion(app).locator(
		`xpath=.//dl[@aria-label=${JSON.stringify(VIEWER_LABELS.detailsList)}]/div/dt[normalize-space(.)=${JSON.stringify(term)}]/following-sibling::dd[1]`,
	);
}

/** The viewer shows output `id` at `position` ('4 / 4'): the toolbar's number and position, and its picture. */
export async function expectCurrentOutput(app: AppDriver, id: string, position: string): Promise<void> {
	await expect(outputActions(app).getByText(`#${id}`, { exact: true })).toBeVisible();
	await expect(outputActions(app).getByText(position, { exact: true })).toBeVisible();
	await expect(imageOf(app, id)).toBeVisible();
	await expect(filmstripOption(app, id)).toHaveAttribute('aria-selected', 'true');
}

/** The current picture of output `id` (the only image of that name: thumbnails have an empty alt). */
export function imageOf(app: AppDriver, id: string): Locator {
	return viewerRegion(app).getByRole('img', { name: outputPictureName(id), exact: true });
}

/** The filmstrip listbox of the viewer. */
export function filmstrip(app: AppDriver): Locator {
	return viewerRegion(app).getByRole('listbox', { name: VIEWER_LABELS.filmstrip, exact: true });
}

/** The filmstrip option of output `id`. */
export function filmstripOption(app: AppDriver, id: string): Locator {
	return filmstrip(app).getByRole('option', { name: outputPictureName(id), exact: true });
}

/** The generation progress view inside `scope` (the generation region, or its collapsed strip). */
export function progressOf(scope: Locator): { root: Locator; bar: Locator; fill: Locator } {
	const root = scope.locator('[data-generation-outcome]');
	const bar = root.getByRole('progressbar', { name: GENERATION_LABELS.progress });
	return { root, bar, fill: bar.locator('.fui-ProgressBar__bar') };
}

/** Waits until the progress view inside `scope` shows `outcome` ('idle' | 'running' | 'complete' | 'error' |
 *  'cancelled'). */
export async function expectOutcome(scope: Locator, outcome: string): Promise<void> {
	await expect(progressOf(scope).root).toHaveAttribute('data-generation-outcome', outcome, { timeout: 30_000 });
}

/** Moves the keyboard focus to the page (no control focused): app shortcuts then apply. */
export async function focusSurface(page: Page): Promise<void> {
	await page.evaluate(() => {
		(document.activeElement as HTMLElement | null)?.blur?.();
	});
	await expect.poll(() => page.evaluate(() => document.activeElement === document.body || document.activeElement === null)).toBe(true);
}

/** Same app command twice within this delay is ignored (src/app/commands.ts COMMAND_DEDUPE_MS = 200). */
export const COMMAND_REPEAT_GAP_MS = 250;

/** The newest fixture output (backend/tests/e2e/fixtures/data/output/0000000004.json, with its placeholders). */
function fixtureOutput(): Record<string, unknown> {
	const file = path.join(BACKEND_DIR, 'tests', 'e2e', 'fixtures', 'data', 'output', '0000000004.json');
	return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** E2EResetOptions.files adding `count` synthetic outputs after the fixture's four (ids 5..4+count): copies of the
 *  newest fixture output with their own id and seed; the e2e backend draws a picture for each (its seed's colors). */
export function extraOutputFiles(count: number): Record<string, unknown> {
	const base = fixtureOutput();
	const files: Record<string, unknown> = {};
	for (let index = 0; index < count; index += 1) {
		const id = formatOutputId(5 + index);
		const seed = 2_000_000 + index * 7_919;
		files[`output/${id}.json`] = {
			...base,
			output_id: id,
			generated_at: `2026-11-24T${String(Math.floor(index / 60) % 24).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00+00:00`,
			seed,
			image_seed: seed,
			image_path: `{{DATA_DIR}}/output/${id}.png`,
			metadata_path: `{{DATA_DIR}}/output/${id}.json`,
		};
	}
	return files;
}
