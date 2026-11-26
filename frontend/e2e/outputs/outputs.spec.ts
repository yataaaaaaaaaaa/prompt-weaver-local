// The viewer of the Create section in the real app: navigation (arrow keys on the page, ignored while typing; First /
// Previous / Next / Last and their disabled states), the board cards following the output being viewed, the output
// details (a legacy output, LoRA lines), trash and undo (Ctrl+Z and the toolbar's Undo), undo of a generation, the empty
// history, missing pictures, the red Delete, the picture fit, the narrowest viewer at 1280 x 720, and the visual baselines.
// The filmstrip and the details panel have their own specs (filmstrip.spec.ts, details.spec.ts).
import { realpathSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ACTION_COLORS } from '../../src/ui/stateColors';
import { narrowRegionsLayout } from '../generation/generationPane';
import { expectBaseline } from '../support/baselines';
import { STORE_NAMES, storeFile, type E2EBackend } from '../support/backend';
import { computedStyle, MIN_GRAPHICS_CONTRAST, MIN_TEXT_CONTRAST, paintedBackground, contrastRatio, resolveColor, textContrast } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop } from '../support/visibility';
import {
	backendOutputIds,
	COMMAND_REPEAT_GAP_MS,
	expectCurrentOutput,
	filmstrip,
	focusSurface,
	imageOf,
	navigationButton,
	outputActions,
	outputDetail,
	viewerRegion,
} from './outputBrowser';

const FIXTURE_IDS = ['0000000001', '0000000002', '0000000003', '0000000004'];

test('the arrow keys move through the outputs when the page has the focus', async ({ app, page }) => {
	await app.open();
	await expectCurrentOutput(app, '0000000004', '4 / 4');
	await focusSurface(page);

	await page.keyboard.press('ArrowLeft');
	await expectCurrentOutput(app, '0000000003', '3 / 4');
	await page.waitForTimeout(COMMAND_REPEAT_GAP_MS);
	await page.keyboard.press('ArrowUp');
	await expectCurrentOutput(app, '0000000002', '2 / 4');
	await page.keyboard.press('ArrowRight');
	await expectCurrentOutput(app, '0000000003', '3 / 4');
	await page.waitForTimeout(COMMAND_REPEAT_GAP_MS);
	await page.keyboard.press('ArrowDown');
	await expectCurrentOutput(app, '0000000004', '4 / 4');
	// Already at the newest output: nothing after it.
	await page.waitForTimeout(COMMAND_REPEAT_GAP_MS);
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(COMMAND_REPEAT_GAP_MS);
	await expectCurrentOutput(app, '0000000004', '4 / 4');
});

test('the arrow keys are left to a text field being typed in', async ({ app, page }) => {
	await app.open();
	const seed = app.createRegion('generation').getByRole('textbox', { name: 'Image seed' });
	await seed.click();
	await page.keyboard.press('End');

	for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
		await page.keyboard.press(key);
		await page.waitForTimeout(COMMAND_REPEAT_GAP_MS);
	}
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.type('9');

	await expectCurrentOutput(app, '0000000004', '4 / 4');
	await expect(seed).toHaveValue('12345697');
});

test('First / Previous / Next / Last move through the outputs and are disabled at the ends', async ({ app }, testInfo) => {
	await app.open();
	const first = navigationButton(app, 'First output');
	const previous = navigationButton(app, 'Previous output');
	const next = navigationButton(app, 'Next output');
	const last = navigationButton(app, 'Last output');
	await expect(next).toBeDisabled();
	await expect(last).toBeDisabled();
	await expect(first).toBeEnabled();
	await expect(previous).toBeEnabled();
	await previous.hover();
	await expect(app.page.getByRole('tooltip')).toHaveText('Previous output (← / ↑)');

	await first.click();
	await expectCurrentOutput(app, '0000000001', '1 / 4');
	await expect(first).toBeDisabled();
	await expect(previous).toBeDisabled();
	await expect(next).toBeEnabled();
	await expect(last).toBeEnabled();
	await app.parkPointer({ blur: true });
	await saveScreenshot(viewerRegion(app), testInfo, 'viewer-first');

	await next.click();
	await expectCurrentOutput(app, '0000000002', '2 / 4');
	await last.click();
	await expectCurrentOutput(app, '0000000004', '4 / 4');
	await previous.click();
	await expectCurrentOutput(app, '0000000003', '3 / 4');
});

test('the board cards highlight the sub-prompts of the output being viewed', async ({ app }) => {
	await app.open();
	const current = (category: string) => app.categoryCard(category).locator('[aria-current="true"]');
	await expect(current('Subject')).toContainText('1girl, silver hair');
	await expect(current('Outfit')).toContainText('red dress');
	await expect(current('Mood')).toContainText('smiling');

	await navigationButton(app, 'First output').click();
	await expectCurrentOutput(app, '0000000001', '1 / 4');

	await expect(current('Subject')).toContainText('1boy, short hair');
	await expect(current('Outfit')).toContainText('armor, cape');
	await expect(current('Background')).toContainText('castle courtyard');
	await expect(current('Mood')).toContainText('serious expression');
	await expect(current('Weather effects')).toHaveCount(0);
});

test('a legacy output (LoRA ids without weights) shows its details with the default weight', async ({ app }, testInfo) => {
	await app.open();
	await navigationButton(app, 'First output').click();
	await expectCurrentOutput(app, '0000000001', '1 / 4');

	await expect(outputDetail(app, 'LoRAs').getByRole('listitem')).toHaveText(['Watercolor Wash v1.2 (1)']);
	await expect(outputDetail(app, 'Model')).toHaveText('classic_sd15_local.safetensors');
	await expect(outputDetail(app, 'Size')).toHaveText('512 × 768');
	await expect(outputDetail(app, 'Seed')).toHaveText('51111');
	await expect(outputDetail(app, 'Prompt seed')).toHaveText('1111');
	await app.parkPointer({ blur: true });
	await saveScreenshot(viewerRegion(app), testInfo, 'viewer-legacy');
});

test('the details of a recent output list one LoRA per line, aligned with their terms', async ({ app }) => {
	await app.open();
	const loras = outputDetail(app, 'LoRAs').getByRole('listitem');
	await expect(loras).toHaveText(['Watercolor Wash v1.2 (0.65)', 'local_detail_tweaker.safetensors (-0.5)']);
	await expect(outputDetail(app, 'Output')).toHaveText('#0000000004');
	await expect(outputDetail(app, 'Position')).toHaveText('4 / 4');
	await expect(outputDetail(app, 'Prompt')).toHaveText('1girl, silver hair, red dress, neon city street, rain, puddles reflections, smiling');

	// Every value starts in the same column; every term is on the line of its value.
	const list = viewerRegion(app).locator('dl[aria-label="Output details"]');
	const rows = await list.locator('dt').evaluateAll((terms) =>
		terms.map((term) => {
			const value = term.nextElementSibling as HTMLElement;
			return { termTop: term.getBoundingClientRect().top, valueTop: value.getBoundingClientRect().top, valueLeft: value.getBoundingClientRect().left };
		}),
	);
	expect(new Set(rows.map((row) => Math.round(row.valueLeft))).size).toBe(1);
	for (const term of ['Output', 'LoRAs']) {
		const cell = list.locator('dt', { hasText: term }).first();
		expect(await textContrast(cell), `contrast of the term ${term}`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
	}
	for (const row of rows) {
		expect(Math.abs(row.termTop - row.valueTop)).toBeLessThanOrEqual(3);
	}
	const [firstLine, secondLine] = await loras.evaluateAll((items) => items.map((item) => item.getBoundingClientRect()));
	expect(secondLine.top, 'each LoRA starts a new line').toBeGreaterThanOrEqual(firstLine.bottom - 1);
});

test('Delete moves the output to the trash; Ctrl+Z and the toolbar Undo restore it', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const deleteButton = navigationButton(app, 'Delete');
	const undo = navigationButton(app, 'Undo');
	await expect(undo).toBeDisabled();
	await app.parkPointer({ blur: true });
	// The red danger action: its trash icon in the danger color, readable on the toolbar.
	await expect(deleteButton).toHaveCSS('color', await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
	const icon = deleteButton.locator('.fui-Button__icon');
	await expect(icon).toHaveCSS('color', await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
	expect(contrastRatio(await computedStyle(icon, 'color'), await paintedBackground(deleteButton)), 'contrast of the red trash icon').toBeGreaterThanOrEqual(
		MIN_GRAPHICS_CONTRAST,
	);
	await deleteButton.hover();
	await expect(page.getByRole('tooltip')).toHaveText('Move to the app trash (Undo restores it)');

	await deleteButton.click();

	await expect.poll(() => backendOutputIds(backend)).toEqual(FIXTURE_IDS.slice(0, 3));
	await expectCurrentOutput(app, '0000000003', '3 / 3');
	await expect(navigationButton(app, 'Next output')).toBeDisabled();
	await expect(undo).toBeEnabled();

	await focusSurface(page);
	await page.keyboard.press('Control+z');

	await expect.poll(() => backendOutputIds(backend)).toEqual(FIXTURE_IDS);
	await expectCurrentOutput(app, '0000000004', '4 / 4');

	await deleteButton.click();
	await expect.poll(() => backendOutputIds(backend)).toEqual(FIXTURE_IDS.slice(0, 3));
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'create-after-delete');
	await expect(undo).toBeEnabled();
	await undo.hover();
	await expect(page.getByRole('tooltip')).toHaveText('Undo (Ctrl+Z)');

	await undo.click();

	await expect.poll(() => backendOutputIds(backend)).toEqual(FIXTURE_IDS);
	await expectCurrentOutput(app, '0000000004', '4 / 4');
	await expect(undo).toBeDisabled();
});

test('undoing a generation goes back to the previous output and restores the seeds', async ({ app, page, backend }) => {
	await app.open();
	const generation = app.createRegion('generation');
	const imageSeed = generation.getByRole('textbox', { name: 'Image seed' });
	await expect(imageSeed).toHaveValue('1234567');

	const created = await generateOutput(app, backend);
	expect(created).toBe('0000000005');
	await expect(imageSeed).toHaveValue('1234568');

	await focusSurface(page);
	await page.keyboard.press('Control+z');

	await expectCurrentOutput(app, '0000000004', '4 / 5');
	await expect(imageSeed).toHaveValue('1234567');
	await expect(generation.getByRole('textbox', { name: 'Prompt seed' })).toHaveValue('424242');
	// The new output itself is kept (only the step is undone).
	expect(await backendOutputIds(backend)).toEqual([...FIXTURE_IDS, '0000000005']);
});

test.describe('without outputs', () => {
	test.use({ e2eOptions: { remove: ['output'], files: storeFile(STORE_NAMES.outputs, { currentId: null }, 1) } });

	test('the viewer says there is nothing yet and how to start; the first generation fills it', async ({ app, page, backend }, testInfo) => {
		await app.open();
		const viewer = viewerRegion(app);
		await expect(viewer.getByText('No outputs yet', { exact: true })).toBeVisible();
		await expect(viewer.getByText('Press Generate (Ctrl+G) in the Generation panel', { exact: false })).toBeVisible();
		await expect(viewer.getByText('No details yet', { exact: true })).toBeVisible();
		await expect(filmstrip(app)).toHaveCount(0);
		for (const label of ['First output', 'Previous output', 'Next output', 'Last output', 'Delete', 'Copy prompt', 'Create character', 'Undo']) {
			await expect(navigationButton(app, label)).toBeDisabled();
		}
		await expect(outputActions(app).getByText('— / 0', { exact: true })).toBeVisible();
		await app.parkPointer({ blur: true });
		await assertAppVisible(page);
		await saveScreenshot(viewer, testInfo, 'viewer-empty');
		await expectBaseline(viewer, 'viewer-empty.png');

		const created = await generateOutput(app, backend);

		expect(created).toBe('0000000001');
		await expectCurrentOutput(app, '0000000001', '1 / 1');
		await expect(navigationButton(app, 'Delete')).toBeEnabled();
		await expect(viewer.getByText('No outputs yet', { exact: true })).toHaveCount(0);
	});
});

/** Deletes the picture of an output from the e2e backend's data dir while the app runs, as a user would in the file
 *  explorer (the metadata stays): a file operation of the test itself, guarded to the e2e backend's temp dir. (A
 *  picture missing before the app starts is E2EResetOptions.remove.) */
async function deletePictureOutsideTheApp(backend: E2EBackend, outputId: string): Promise<void> {
	const { data_dir: dataDir } = await backend.state();
	const insideTemp = realpathSync.native(dataDir).toLowerCase().startsWith(realpathSync.native(tmpdir()).toLowerCase() + path.sep);
	expect(insideTemp, `the e2e data dir ${dataDir} is a temp dir`).toBe(true);
	unlinkSync(path.join(dataDir, 'output', `${outputId}.png`));
}

test.describe('an output whose picture is gone at startup', () => {
	test.use({ e2eOptions: { remove: ['output/0000000004.png'] } });

	test('is not listed: the newest complete output is shown', async ({ app }) => {
		await app.open();

		await expectCurrentOutput(app, '0000000003', '3 / 3');
		await expect(navigationButton(app, 'Next output')).toBeDisabled();
		await expect(filmstrip(app).getByRole('option')).toHaveCount(3);
	});
});

test('a picture deleted while the app runs: the viewer explains it instead of a broken picture', async ({ app, page, backend, diagnostics }, testInfo) => {
	// The browser logs the failed image (and thumbnail) requests.
	diagnostics.allow(/Failed to load resource.*404/);
	await app.open();
	await deletePictureOutsideTheApp(backend, '0000000003');
	const viewer = viewerRegion(app);

	await navigationButton(app, 'Previous output').click();

	await expect(viewer.getByText('The image of output #0000000003 could not be loaded.')).toBeVisible();
	await expect(viewer.getByText('Its file may have been moved or deleted outside the app.')).toBeVisible();
	await expect(imageOf(app, '0000000003')).toHaveCount(0);
	// The details are still there (the metadata exists).
	await expect(outputDetail(app, 'Output')).toHaveText('#0000000003');
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(viewer, testInfo, 'viewer-missing-file');

	await navigationButton(app, 'Previous output').click();
	await expectCurrentOutput(app, '0000000002', '2 / 4');
});

test('the picture fits the space left without distortion, centered', async ({ app }, testInfo) => {
	await app.open();
	const picture = imageOf(app, '0000000004');
	await app.settle();

	const fit = await picture.evaluate((element) => {
		const img = element as HTMLImageElement;
		const box = img.getBoundingClientRect();
		const container = img.parentElement!.getBoundingClientRect();
		// object-fit: contain: the painted picture is the largest box of the natural ratio inside the element.
		const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
		const painted = { width: img.naturalWidth * scale, height: img.naturalHeight * scale };
		return {
			objectFit: getComputedStyle(img).objectFit,
			paintedRatio: painted.width / painted.height,
			naturalRatio: img.naturalWidth / img.naturalHeight,
			centerDx: Math.abs(box.left + box.width / 2 - (container.left + container.width / 2)),
			centerDy: Math.abs(box.top + box.height / 2 - (container.top + container.height / 2)),
			inside: box.left >= container.left - 0.5 && box.right <= container.right + 0.5 && box.top >= container.top - 0.5 && box.bottom <= container.bottom + 0.5,
			painted,
		};
	});
	expect(fit.objectFit).toBe('contain');
	expect(fit.paintedRatio).toBeCloseTo(fit.naturalRatio, 3);
	expect(fit.centerDx).toBeLessThanOrEqual(1);
	expect(fit.centerDy).toBeLessThanOrEqual(1);
	expect(fit.inside).toBe(true);
	expect(fit.painted.height, 'the picture is drawn big enough to see').toBeGreaterThan(300);
	await app.parkPointer({ blur: true });
	await saveScreenshot(viewerRegion(app), testInfo, 'viewer');
});

test.describe('the narrowest viewer at the smallest supported window size', () => {
	test.use({ viewport: SMALL_VIEWPORT, e2eOptions: { files: narrowRegionsLayout() } });

	test('the toolbar wraps, nothing is cut, the picture and the filmstrip stay visible', async ({ app, page }, testInfo) => {
		await app.open();
		const viewer = viewerRegion(app);
		expect(Math.round((await boxOf(viewer)).width)).toBeLessThanOrEqual(330);
		await app.parkPointer({ blur: true });

		await expectNoHorizontalOverflow(viewer);
		for (const label of ['First output', 'Previous output', 'Next output', 'Last output', 'Copy prompt', 'Create character', 'Undo', 'Delete', 'Output details']) {
			await expectOnTop(navigationButton(app, label));
		}
		await expect(imageOf(app, '0000000004')).toBeVisible();
		expect((await boxOf(imageOf(app, '0000000004'))).height, 'the picture keeps a usable height').toBeGreaterThan(120);
		await expectOnTop(filmstrip(app).getByRole('option', { name: 'Output 0000000004' }));
		// One line per LoRA: a long name is truncated, its weight stays whole and visible.
		const loraLines = outputDetail(app, 'LoRAs').getByRole('listitem');
		await expect(loraLines).toHaveCount(2);
		for (const line of await loraLines.all()) {
			const lineHeight = Number.parseFloat(await computedStyle(line, 'line-height'));
			expect((await line.boundingBox())?.height ?? Infinity).toBeLessThanOrEqual(lineHeight + 2);
		}
		await viewer.getByRole('tabpanel').evaluate((panel) => panel.scrollTo(0, 400));
		for (const weight of ['(0.65)', '(-0.5)']) {
			await expectOnTop(outputDetail(app, 'LoRAs').getByText(weight, { exact: true }));
		}
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'create-1280x720-narrow-viewer');
		await saveScreenshot(viewer, testInfo, 'viewer-narrow');
	});
});

test('visual baselines of the viewer', async ({ app }) => {
	await app.open();
	await app.parkPointer({ blur: true });
	await expectBaseline(outputActions(app), 'output-actions.png');
	await expectBaseline(viewerRegion(app), 'viewer.png');
});
