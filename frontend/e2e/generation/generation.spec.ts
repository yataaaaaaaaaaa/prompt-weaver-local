// The Generation pane in the real app: Generate (button and Ctrl+G) with the paced fake generator and its progress in
// the Generation pane and the Output browser, Cancel, Continuous (button and Ctrl+T), a failing generation, the model
// dropdown, Copy prompt, the desktop-only dialogs, the action intent colors, the data directory line, narrow and small
// windows, and the visual baselines of the pane. Every state that matters is screenshotted for people to look at.
import { tokens } from '@fluentui/react-theme';
import type { Locator } from '@playwright/test';
import { ACTION_COLORS } from '../../src/ui/stateColors';
import {
	backendOutputIds,
	expectCurrentOutput,
	expectOutcome,
	focusSurface,
	imageOf,
	outputDetail,
	progressOf,
} from '../outputs/outputBrowser';
import { notifications } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { computedStyle, MIN_TEXT_CONTRAST, resolveColor, textContrast } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { resizeWindowTo, scrollSectionIntoView, sectionOf } from './generationPane';

/** The bar colors of Fluent's ProgressBar per validation state (brand while running). */
const PROGRESS_FILL = {
	running: tokens.colorCompoundBrandBackground,
	complete: tokens.colorPaletteGreenBackground3,
	cancelled: tokens.colorPaletteDarkOrangeBackground3,
	error: tokens.colorPaletteRedBackground3,
} as const;

async function expectFill(pane: Locator, outcome: keyof typeof PROGRESS_FILL): Promise<void> {
	const { fill } = progressOf(pane);
	await expect(fill).toHaveCSS('background-color', await resolveColor(pane.page(), PROGRESS_FILL[outcome]));
	expect((await fill.boundingBox())?.height ?? 0, 'the progress fill is painted').toBeGreaterThan(0);
	if (outcome !== 'running') {
		// Terminal states show a full bar in their status color (never an empty, colorless bar); the fill animates
		// its width.
		const barWidth = (await progressOf(pane).bar.boundingBox())?.width ?? Infinity;
		await expect.poll(async () => (await fill.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(barWidth - 4);
	}
}

function generateButton(generation: Locator): Locator {
	return generation.getByRole('button', { name: 'Generate', exact: true });
}

test.describe('a paced generation', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 300 } } });

	test('Generate shows the progress in both panes, then the new output with the next image seed', async ({ app, page, backend }, testInfo) => {
		await app.open();
		const generation = app.pane('Generation');
		const browser = app.pane('Output browser');
		const cancel = generation.getByRole('button', { name: 'Cancel' });
		await expectCurrentOutput(app, '0000000004', '4 / 4');
		const before = await imageOf(app, '0000000004').screenshot();
		await expect(cancel).toBeDisabled();
		// A disabled action keeps Fluent's disabled look, not its intent color.
		await expect(cancel).toHaveCSS('color', await resolveColor(page, tokens.colorNeutralForegroundDisabled));
		await expect(generateButton(generation)).toHaveCSS('background-color', await resolveColor(page, ACTION_COLORS.primary.background));
		expect(await textContrast(generateButton(generation)), 'contrast of the primary Generate').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);

		await generateButton(generation).click();

		// Mid-run: both progress views follow the sampling steps of the request (12).
		await expect(generation.getByText(/^Sampling step ([3-9]|1[0-2])\/12$/)).toBeVisible({ timeout: 15_000 });
		await expect(generation.getByRole('button', { name: 'Generating…' })).toBeDisabled();
		await expect(generation.getByRole('button', { name: 'Continuous' })).toBeDisabled();
		await expect(cancel).toBeEnabled();
		await expect(cancel).toHaveCSS('color', await resolveColor(page, ACTION_COLORS.warning.subtleForeground));
		await app.parkPointer();
		expect(await textContrast(cancel), 'contrast of the warning Cancel').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
		for (const pane of [generation, browser]) {
			await expect(progressOf(pane).root).toHaveAttribute('data-generation-outcome', 'running');
			const now = Number(await progressOf(pane).bar.getAttribute('aria-valuenow'));
			expect(now).toBeGreaterThan(0);
			expect(now).toBeLessThan(1);
			await expect(pane.getByText(/^\d+\/12$/)).toBeVisible();
			expect(await textContrast(pane.getByText(/^Sampling step \d+\/12$/)), 'contrast of the progress message').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
			await expectFill(pane, 'running');
		}
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(generation, testInfo, 'generation-pane-running');
		await saveScreenshot(browser, testInfo, 'output-browser-running');

		// The end: the new output is shown everywhere, the image seed followed 'Auto increment', the prompt seed 'Fixed'.
		await expectCurrentOutput(app, '0000000005', '5 / 5');
		expect(await backendOutputIds(backend)).toContain('0000000005');
		await app.settle();
		const after = await imageOf(app, '0000000005').screenshot();
		expect(after.equals(before), 'the Image pane shows a new picture').toBe(false);
		await expect(generation.getByRole('textbox', { name: 'Image seed' })).toHaveValue('1234568');
		await expect(generation.getByRole('textbox', { name: 'Prompt seed' })).toHaveValue('424242');
		await expect(outputDetail(app, 'Seed')).toHaveText('1234567');
		for (const pane of [generation, browser]) {
			await expectOutcome(pane, 'complete');
			await expect(pane.getByText('12/12', { exact: true })).toBeVisible();
			await expectFill(pane, 'complete');
		}
		await expect(cancel).toBeDisabled();
		expect((await backend.state()).generations).toBe(1);
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'workspace-after-generation');
	});

	test('Ctrl+G generates from the surface and while typing in a field', async ({ app, page, backend }) => {
		await app.open();
		await focusSurface(page);
		await page.keyboard.press('Control+g');
		await expectCurrentOutput(app, '0000000005', '5 / 5');

		// Ctrl+G is allowed in editable fields (keymap.json); the text is left alone.
		const negative = app.pane('Generation').getByRole('textbox', { name: 'Negative prompt' });
		await negative.scrollIntoViewIfNeeded();
		await negative.click();
		await page.keyboard.press('Control+g');
		await expectCurrentOutput(app, '0000000006', '6 / 6');
		await expect(negative).toHaveValue('lowres, bad anatomy, watermark');
		expect((await backend.state()).generations).toBe(2);
	});
});

test.describe('a slow generation', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 1_000 } } });

	test('Cancel stops it: the cancelled state, no new output, Generate available again', async ({ app, page, backend }, testInfo) => {
		await app.open();
		const generation = app.pane('Generation');
		await generateButton(generation).click();

		// Before the first step: loading, with an indeterminate bar (no value).
		await expect(generation.getByText(/^Loading model and LoRAs for studio_xl_local\.safetensors$/)).toBeVisible();
		await expect(progressOf(generation).bar).not.toHaveAttribute('aria-valuenow');
		await app.parkPointer();
		await saveScreenshot(generation, testInfo, 'generation-pane-loading');
		await expect(generation.getByText(/^Sampling step \d+\/12$/)).toBeVisible({ timeout: 15_000 });

		await generation.getByRole('button', { name: 'Cancel' }).click();

		await expectOutcome(generation, 'cancelled');
		await expectOutcome(app.pane('Output browser'), 'cancelled');
		await expect(progressOf(generation).root.getByText(/cancel/i)).toBeVisible();
		await expectFill(generation, 'cancelled');
		await expect(generateButton(generation)).toBeEnabled();
		await expect(generation.getByRole('button', { name: 'Cancel' })).toBeDisabled();
		await expectCurrentOutput(app, '0000000004', '4 / 4');
		expect(await backendOutputIds(backend)).toEqual(['0000000001', '0000000002', '0000000003', '0000000004']);
		await expect(notifications(page)).toHaveCount(0);
		await app.parkPointer();
		await saveScreenshot(generation, testInfo, 'generation-pane-cancelled');
	});
});

test.describe('continuous generation', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 20 } } });

	async function expectStopped(generation: Locator, backend: Parameters<typeof backendOutputIds>[0]): Promise<string[]> {
		await expect(generation.getByRole('button', { name: 'Continuous' })).toHaveAttribute('aria-pressed', 'false');
		await expect(generateButton(generation)).toBeEnabled({ timeout: 15_000 });
		const ids = await backendOutputIds(backend);
		await generation.page().waitForTimeout(1_000);
		expect(await backendOutputIds(backend), 'no generation after the stop').toEqual(ids);
		return ids;
	}

	test('the Continuous toggle makes outputs until it is toggled off', async ({ app, page, backend }, testInfo) => {
		await app.open();
		const generation = app.pane('Generation');
		const continuous = generation.getByRole('button', { name: 'Continuous' });

		await continuous.click();

		await expect(continuous).toHaveAttribute('aria-pressed', 'true');
		await app.parkPointer();
		await expect(continuous).toHaveCSS('background-color', await resolveColor(page, ACTION_COLORS.primary.background));
		await expect(generation.getByRole('button', { name: 'Cancel' })).toBeEnabled();
		await expect.poll(async () => (await backendOutputIds(backend)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(7);
		await app.parkPointer();
		await saveScreenshot(generation, testInfo, 'generation-pane-continuous');

		await continuous.click();

		const ids = await expectStopped(generation, backend);
		// A generation already saving when the loop stops is still saved by the backend; the next move at the end of
		// the list picks it up (the outputs store refreshes its list there).
		await focusSurface(page);
		await page.keyboard.press('ArrowRight');
		await expectCurrentOutput(app, ids[ids.length - 1], `${ids.length} / ${ids.length}`);
	});

	test('Ctrl+T starts and stops continuous generation', async ({ app, page, backend }) => {
		await app.open();
		const generation = app.pane('Generation');
		await focusSurface(page);

		await page.keyboard.press('Control+t');

		await expect(generation.getByRole('button', { name: 'Continuous' })).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(async () => (await backendOutputIds(backend)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(6);

		await page.keyboard.press('Control+t');

		await expectStopped(generation, backend);
	});
});

test.describe('a failing generation', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 20, fail_message: 'Synthetic GPU failure: out of memory' } } });

	test('shows the error toast, the error state, and stops continuous generation', async ({ app, page, backend, diagnostics }, testInfo) => {
		// The browser logs the failed request (409) of /api/generate.
		diagnostics.allow(/status of 409/);
		await app.open();
		const generation = app.pane('Generation');
		const continuous = generation.getByRole('button', { name: 'Continuous' });

		await continuous.click();

		const toast = notifications(page);
		await expect(toast.getByText('Generation failed')).toBeVisible({ timeout: 15_000 });
		await expect(toast.getByText(/Synthetic GPU failure: out of memory/)).toBeVisible();
		await expect(continuous).toHaveAttribute('aria-pressed', 'false');
		await expect(generateButton(generation)).toBeEnabled();
		for (const pane of [generation, app.pane('Output browser')]) {
			await expectOutcome(pane, 'error');
			const progress = progressOf(pane);
			await expect(progress.root.getByText('Generation failed', { exact: true })).toBeVisible();
			await expect(progress.root.getByText(/Synthetic GPU failure: out of memory/)).toBeVisible();
			expect(await textContrast(progress.root.getByText(/Synthetic GPU failure: out of memory/)), 'contrast of the error message').toBeGreaterThanOrEqual(
				MIN_TEXT_CONTRAST,
			);
			await expectFill(pane, 'error');
		}
		expect(await backendOutputIds(backend)).toHaveLength(4);
		expect((await backend.state()).generations).toBe(1);
		await app.parkPointer();
		await assertAppVisible(page, { allowOverlays: true });
		await expectOnTop(toast);
		await saveScreenshot(page, testInfo, 'workspace-generation-failed');
		await saveScreenshot(generation, testInfo, 'generation-pane-failed');
	});
});

test('the model dropdown switches the checkpoint used by the next generation', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const model = await scrollSectionIntoView(app, 'Model');
	const dropdown = model.getByRole('combobox', { name: 'Checkpoint' });
	await expect(dropdown).toHaveText('studio_xl_local.safetensors');

	await dropdown.click();
	const listbox = page.getByRole('listbox');
	await expect(listbox.getByRole('option')).toHaveText(['studio_xl_local.safetensors', 'classic_sd15_local.safetensors', 'Dreamline 1.5 v7']);
	await assertAppVisible(page, { allowOverlays: true });
	await expectOnTop(listbox);
	await saveScreenshot(page, testInfo, 'model-dropdown-open');
	await listbox.getByRole('option', { name: 'classic_sd15_local.safetensors' }).click();

	await expect(dropdown).toHaveText('classic_sd15_local.safetensors');
	await expect
		.poll(async () => (await backend.get<{ envelope: { state: { selectedModelId: string } } | null }>('/api/stores/library-store')).envelope?.state.selectedModelId)
		.toBe('classic-sd15-local-safetensors');
	await generateOutput(app, backend);
	await expect(outputDetail(app, 'Model')).toHaveText('classic_sd15_local.safetensors');
});

test('Copy prompt copies the prompt of the output being viewed and says so', async ({ app, page }) => {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await app.open();
	const prompt = '1girl, silver hair, red dress, neon city street, rain, puddles reflections, smiling';

	await app.pane('Output browser').getByRole('button', { name: 'Copy prompt' }).click();

	await expect(notifications(page).getByText('Prompt copied to the clipboard.')).toBeVisible();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);

	await page.evaluate(() => navigator.clipboard.writeText(''));
	await app.pane('Generation').getByRole('button', { name: 'Copy prompt' }).click();
	await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
});

test('the desktop-only file dialogs explain that they need the desktop app', async ({ app, page }, testInfo) => {
	await app.open();
	const model = await scrollSectionIntoView(app, 'Model');

	await model.getByRole('button', { name: 'Add model file' }).click();

	const toast = notifications(page);
	await expect(toast.getByText(/need the desktop app/)).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await expectOnTop(toast);
	await saveScreenshot(page, testInfo, 'desktop-only-toast');
	await toast.getByRole('button', { name: 'Dismiss' }).click();
	await expect(toast).toHaveCount(0);
});

test('the data directory stays on one line and shows the full path in a tooltip', async ({ app, page, backend }) => {
	await app.open();
	const { data_dir: dataDir } = await backend.state();
	const caption = app.pane('Generation').getByText(/^Data directory:/);
	await expect(caption).toHaveText(`Data directory: ${dataDir}`);
	expect(await computedStyle(caption, 'white-space')).toBe('nowrap');
	const box = await caption.boundingBox();
	const lineHeight = Number.parseFloat(await computedStyle(caption, 'line-height'));
	expect(box?.height ?? 0).toBeLessThanOrEqual(lineHeight + 1);

	await caption.hover();
	await expect(page.getByRole('tooltip')).toHaveText(`Data directory: ${dataDir}`);
});

test('every section of the Generation pane fits a narrow window (280 px) without clipping', async ({ app, page }, testInfo) => {
	await app.open();
	const generation = app.pane('Generation');
	await resizeWindowTo(app, generation, { width: 280, height: 1_000 });
	await app.parkPointer();

	// Nothing wider than the pane: no horizontal scrolling, no control cut at the right edge.
	const overflow = await generation.evaluate((pane) => {
		const paneRight = pane.getBoundingClientRect().right;
		return Array.from(pane.querySelectorAll('button, input, textarea, [role="combobox"], [role="spinbutton"], h3'))
			.filter((element) => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().right > paneRight + 0.5)
			.map((element) => element.getAttribute('aria-label') ?? element.textContent ?? element.tagName);
	});
	expect(overflow, 'controls sticking out of the narrow pane').toEqual([]);

	// Labels and values stay readable: one line each (no wrapped label pushing its field out of line), and no LoRA name
	// squeezed to nothing by its prompt link mark.
	const wrapped = await generation.evaluate((pane) =>
		Array.from(pane.querySelectorAll('label, [role="combobox"]'))
			.filter((element) => {
				const style = getComputedStyle(element);
				const lineHeight = Number.parseFloat(style.lineHeight);
				const text = element.textContent ?? '';
				return text.trim() !== '' && Number.isFinite(lineHeight) && element.getBoundingClientRect().height > 2 * lineHeight + 2;
			})
			.map((element) => element.textContent),
	);
	expect(wrapped, 'labels or values wrapped over several lines').toEqual([]);
	const loras = sectionOf(app, 'LoRAs');
	for (const name of ['Watercolor Wash v1.2', 'local_detail_tweaker.safetensors', 'sharp_lineart.safetensors']) {
		const label = loras.getByText(name, { exact: true });
		expect((await label.boundingBox())?.width ?? 0, `visible width of the LoRA name ${name}`).toBeGreaterThan(60);
	}
	for (const name of ['Current generation', 'Image settings', 'Seeds', 'Model', 'LoRAs', 'Negative prompt']) {
		await scrollSectionIntoView(app, name);
		await saveScreenshot(generation, testInfo, `narrow-${name}`);
	}
	await expectOnTop(sectionOf(app, 'LoRAs').getByRole('spinbutton', { name: 'Weight of Watercolor Wash v1.2' }));
	await assertAppVisible(page);
});

test('the Generation pane stays usable at the smallest supported window size', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	const generation = await app.showPane('Generation');
	await expectOnTop(generateButton(generation));
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'workspace-1280x720');
});

test('visual baselines of the Generation pane', async ({ app }) => {
	await app.open();
	const generation = app.pane('Generation');
	await app.bringToFront(generation);
	await app.parkPointer();
	await expectBaseline(generation, 'generation-pane.png');
	await scrollSectionIntoView(app, 'Seeds');
	await app.parkPointer();
	await expectBaseline(generation, 'generation-pane-seeds-model.png');
});
