// The generation panel of the Create section in the real app: Generate (button and Ctrl+G) with the paced fake
// generator and its progress in the sticky action area, the new output in the viewer and its filmstrip, Cancel,
// Continuous (button and Ctrl+T), a failing generation, the model picker, More options and the desktop-only dialogs, the
// no-model call to action, the action intent colors, the sticky actions at 1280 x 720, the narrowest panel, the collapsed
// strip's compact actions, and the visual baselines of the panel. Every state that matters is screenshotted for people
// to look at.
import { tokens } from '@fluentui/react-theme';
import type { Locator } from '@playwright/test';
import { ACTION_COLORS } from '../../src/ui/stateColors';
import {
	backendOutputIds,
	expectCurrentOutput,
	expectOutcome,
	filmstripOption,
	focusSurface,
	imageOf,
	outputDetail,
	progressOf,
} from '../outputs/outputBrowser';
import { notifications, type AppDriver } from '../support/app';
import { fixtureStoreFile, STORE_NAMES } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { MIN_TEXT_CONTRAST, resolveColor, textContrast } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { layoutStoreFile } from '../support/shell';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop } from '../support/visibility';
import {
	generationRegion,
	narrowRegionsLayout,
	openMoreOptions,
	scrollPanelToEnd,
	scrollSectionIntoView,
	sectionOf,
} from './generationPane';

/** The bar colors of Fluent's ProgressBar per validation state (brand while running). */
const PROGRESS_FILL = {
	running: tokens.colorCompoundBrandBackground,
	complete: tokens.colorPaletteGreenBackground3,
	cancelled: tokens.colorPaletteDarkOrangeBackground3,
	error: tokens.colorPaletteRedBackground3,
} as const;

async function expectFill(scope: Locator, outcome: keyof typeof PROGRESS_FILL): Promise<void> {
	const { fill } = progressOf(scope);
	await expect(fill).toHaveCSS('background-color', await resolveColor(scope.page(), PROGRESS_FILL[outcome]));
	expect((await fill.boundingBox())?.height ?? 0, 'the progress fill is painted').toBeGreaterThan(0);
	if (outcome !== 'running') {
		// Terminal states show a full bar in their status color (never an empty, colorless bar); the fill animates its
		// width.
		const barWidth = (await progressOf(scope).bar.boundingBox())?.width ?? Infinity;
		await expect.poll(async () => (await fill.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(barWidth - 4);
	}
}

test.describe('a paced generation', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 300 } } });

	test('Generate shows the progress in the action area, then the new output in the viewer and its filmstrip', async ({ app, page, backend }, testInfo) => {
		await app.open();
		const generation = generationRegion(app);
		const generate = app.generationAction('Generate');
		const cancel = app.generationAction('Cancel');
		await expectCurrentOutput(app, '0000000004', '4 / 4');
		const before = await imageOf(app, '0000000004').screenshot();
		await expect(cancel).toBeDisabled();
		await expect(app.generationActions().getByText('Ready to generate', { exact: true })).toBeVisible();
		// A disabled action keeps Fluent's disabled look, not its intent color.
		await expect(cancel).toHaveCSS('color', await resolveColor(page, tokens.colorNeutralForegroundDisabled));
		await expect(generate).toHaveCSS('background-color', await resolveColor(page, ACTION_COLORS.primary.background));
		expect(await textContrast(generate), 'contrast of the primary Generate').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);

		await generate.click();

		// Mid-run: the progress view follows the sampling steps of the request (12).
		await expect(generation.getByText(/^Sampling step ([3-9]|1[0-2])\/12$/)).toBeVisible({ timeout: 15_000 });
		await expect(app.generationAction('Generating…')).toBeDisabled();
		await expect(app.generationAction('Continuous')).toBeDisabled();
		await expect(cancel).toBeEnabled();
		await app.parkPointer({ blur: true });
		await expect(cancel).toHaveCSS('color', await resolveColor(page, ACTION_COLORS.warning.subtleForeground));
		expect(await textContrast(cancel), 'contrast of the warning Cancel').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
		await expect(progressOf(generation).root).toHaveAttribute('data-generation-outcome', 'running');
		const now = Number(await progressOf(generation).bar.getAttribute('aria-valuenow'));
		expect(now).toBeGreaterThan(0);
		expect(now).toBeLessThan(1);
		await expect(app.generationActions().getByText(/^\d+\/12$/)).toBeVisible();
		expect(await textContrast(generation.getByText(/^Sampling step \d+\/12$/)), 'contrast of the progress message').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
		await expectFill(generation, 'running');
		// The viewer has no second progress bar: the progress lives in the generation panel.
		await expect(app.createRegion('viewer').getByRole('progressbar')).toHaveCount(0);
		await assertAppVisible(page);
		await saveScreenshot(generation, testInfo, 'generation-running');

		// The end: the new output is shown in the viewer and selected in its filmstrip, the image seed followed
		// 'Auto increment', the prompt seed 'Fixed'.
		await expectCurrentOutput(app, '0000000005', '5 / 5');
		await expect(filmstripOption(app, '0000000005')).toHaveAttribute('aria-selected', 'true');
		expect(await backendOutputIds(backend)).toContain('0000000005');
		await app.settle();
		const after = await imageOf(app, '0000000005').screenshot();
		expect(after.equals(before), 'the viewer shows a new picture').toBe(false);
		await expect(generation.getByRole('textbox', { name: 'Image seed' })).toHaveValue('1234568');
		await expect(generation.getByRole('textbox', { name: 'Prompt seed' })).toHaveValue('424242');
		await expect(outputDetail(app, 'Seed')).toHaveText('1234567');
		await expectOutcome(generation, 'complete');
		await expect(app.generationActions().getByText('12/12', { exact: true })).toBeVisible();
		await expectFill(generation, 'complete');
		await expect(cancel).toBeDisabled();
		expect((await backend.state()).generations).toBe(1);
		await app.parkPointer({ blur: true });
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'create-after-generation');
	});

	test('Ctrl+G generates from the page and while typing in a field', async ({ app, page, backend }) => {
		await app.open();
		await focusSurface(page);
		await page.keyboard.press('Control+g');
		await expectCurrentOutput(app, '0000000005', '5 / 5');

		// Ctrl+G is allowed in editable fields (keymap.json); the text is left alone.
		const negative = generationRegion(app).getByRole('textbox', { name: 'Negative prompt' });
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
		const generation = generationRegion(app);
		await app.generationAction('Generate').click();

		// Before the first step: loading, with an indeterminate bar (no value).
		await expect(generation.getByText(/^Loading model and LoRAs for studio_xl_local\.safetensors$/)).toBeVisible();
		await expect(progressOf(generation).bar).not.toHaveAttribute('aria-valuenow');
		await app.parkPointer({ blur: true });
		await saveScreenshot(app.generationActions(), testInfo, 'actions-loading');
		await expect(generation.getByText(/^Sampling step \d+\/12$/)).toBeVisible({ timeout: 15_000 });

		await app.generationAction('Cancel').click();

		await expectOutcome(generation, 'cancelled');
		await expect(progressOf(generation).root.getByText(/cancel/i)).toBeVisible();
		await expectFill(generation, 'cancelled');
		await expect(app.generationAction('Generate')).toBeEnabled();
		await expect(app.generationAction('Cancel')).toBeDisabled();
		await expectCurrentOutput(app, '0000000004', '4 / 4');
		expect(await backendOutputIds(backend)).toEqual(['0000000001', '0000000002', '0000000003', '0000000004']);
		await expect(notifications(page)).toHaveCount(0);
		await app.parkPointer({ blur: true });
		await saveScreenshot(app.generationActions(), testInfo, 'actions-cancelled');
	});
});

test.describe('continuous generation', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 20 } } });

	async function expectStopped(app: AppDriver, backend: Parameters<typeof backendOutputIds>[0]): Promise<string[]> {
		await expect(app.generationAction('Continuous')).toHaveAttribute('aria-pressed', 'false');
		await expect(app.generationAction('Generate')).toBeEnabled({ timeout: 15_000 });
		const ids = await backendOutputIds(backend);
		await app.page.waitForTimeout(1_000);
		expect(await backendOutputIds(backend), 'no generation after the stop').toEqual(ids);
		return ids;
	}

	test('the Continuous toggle makes outputs until it is toggled off', async ({ app, page, backend }, testInfo) => {
		await app.open();
		const continuous = app.generationAction('Continuous');

		await continuous.click();

		await expect(continuous).toHaveAttribute('aria-pressed', 'true');
		await app.parkPointer({ blur: true });
		await expect(continuous).toHaveCSS('background-color', await resolveColor(page, ACTION_COLORS.primary.background));
		await expect(app.generationAction('Cancel')).toBeEnabled();
		await expect.poll(async () => (await backendOutputIds(backend)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(7);
		await saveScreenshot(app.generationActions(), testInfo, 'actions-continuous');

		await continuous.click();

		const ids = await expectStopped(app, backend);
		// A generation already saving when the loop stops is still saved by the backend; the next move at the end of
		// the list picks it up (the outputs store refreshes its list there).
		await focusSurface(page);
		await page.keyboard.press('ArrowRight');
		await expectCurrentOutput(app, ids[ids.length - 1], `${ids.length} / ${ids.length}`);
	});

	test('Ctrl+T starts and stops continuous generation', async ({ app, page, backend }) => {
		await app.open();
		await focusSurface(page);

		await page.keyboard.press('Control+t');

		await expect(app.generationAction('Continuous')).toHaveAttribute('aria-pressed', 'true');
		await expect.poll(async () => (await backendOutputIds(backend)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(6);

		await page.keyboard.press('Control+t');

		await expectStopped(app, backend);
	});
});

test.describe('a failing generation', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 20, fail_message: 'Synthetic GPU failure: out of memory' } } });

	test('shows the error toast, the error state, and stops continuous generation', async ({ app, page, backend, diagnostics }, testInfo) => {
		// The browser logs the failed request (409) of /api/generate.
		diagnostics.allow(/status of 409/);
		await app.open();
		const generation = generationRegion(app);
		const continuous = app.generationAction('Continuous');

		await continuous.click();

		const toast = notifications(page);
		await expect(toast.getByText('Generation failed')).toBeVisible({ timeout: 15_000 });
		await expect(toast.getByText(/Synthetic GPU failure: out of memory/)).toBeVisible();
		await expect(continuous).toHaveAttribute('aria-pressed', 'false');
		await expect(app.generationAction('Generate')).toBeEnabled();
		await expectOutcome(generation, 'error');
		const progress = progressOf(generation);
		await expect(progress.root.getByText('Generation failed', { exact: true })).toBeVisible();
		await expect(progress.root.getByText(/Synthetic GPU failure: out of memory/)).toBeVisible();
		expect(await textContrast(progress.root.getByText(/Synthetic GPU failure: out of memory/)), 'contrast of the error message').toBeGreaterThanOrEqual(
			MIN_TEXT_CONTRAST,
		);
		await expectFill(generation, 'error');
		expect(await backendOutputIds(backend)).toHaveLength(4);
		expect((await backend.state()).generations).toBe(1);
		await app.parkPointer({ blur: true });
		await assertAppVisible(page, { allowOverlays: true });
		await expectOnTop(toast);
		await saveScreenshot(page, testInfo, 'create-generation-failed');
		await saveScreenshot(app.generationActions(), testInfo, 'actions-failed');
	});
});

test('the checkpoint picker switches the model used by the next generation', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const model = sectionOf(app, 'Model');
	const dropdown = model.getByRole('combobox', { name: 'Checkpoint' });
	await expect(dropdown).toHaveText('studio_xl_local.safetensors');

	await dropdown.click();
	// The dropdown's own listbox (the viewer's filmstrip is a listbox too).
	const listbox = page.locator(`#${await dropdown.getAttribute('aria-controls')}`);
	await expect(listbox.getByRole('option')).toHaveText(['studio_xl_local.safetensors', 'classic_sd15_local.safetensors', 'Dreamline 1.5 v7']);
	await assertAppVisible(page, { allowOverlays: true });
	await expectOnTop(listbox);
	await saveScreenshot(page, testInfo, 'model-dropdown-open');
	await listbox.getByRole('option', { name: 'classic_sd15_local.safetensors' }).click();

	await expect(dropdown).toHaveText('classic_sd15_local.safetensors');
	await expect(app.commandBar().getByRole('button', { name: 'Model: classic_sd15_local.safetensors', exact: true })).toBeVisible();
	await expect
		.poll(async () => (await backend.get<{ envelope: { state: { selectedModelId: string } } | null }>('/api/stores/library-store')).envelope?.state.selectedModelId)
		.toBe('classic-sd15-local-safetensors');
	await generateOutput(app, backend);
	await expect(outputDetail(app, 'Model')).toHaveText('classic_sd15_local.safetensors');
});

test('Browse models in the Model section opens the Models section', async ({ app }) => {
	await app.open();

	await sectionOf(app, 'Model').getByRole('button', { name: 'Browse models', exact: true }).click();

	await expect(app.section('models')).toBeVisible();
	await expect(app.section('create')).toBeHidden();
});

test('More options discloses the file dialogs, which explain that they need the desktop app', async ({ app, page }, testInfo) => {
	await app.open();
	const generation = generationRegion(app);
	await expect(generation.getByRole('button', { name: 'Add model folder' })).toHaveCount(0);

	await openMoreOptions(app);

	for (const name of ['Add model file', 'Add model folder', 'Add LoRA files', 'Add LoRA folder']) {
		await expect(generation.getByRole('button', { name, exact: true })).toBeVisible();
	}
	const linked = generation.getByRole('group', { name: 'Prompt-linked LoRAs' });
	await expect(linked.getByText('Default selected: 2 · Prompt-linked: 1 · Possible active: 3')).toBeVisible();
	await app.parkPointer({ blur: true });
	await saveScreenshot(generation, testInfo, 'more-options');

	await generation.getByRole('button', { name: 'Add model file', exact: true }).click();

	const toast = notifications(page);
	await expect(toast.getByText(/need the desktop app/)).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await expectOnTop(toast);
	await saveScreenshot(page, testInfo, 'desktop-only-toast');
	await toast.getByRole('button', { name: 'Dismiss' }).click();
	await expect(toast).toHaveCount(0);
});

test.describe('without any model', () => {
	test.use({
		e2eOptions: {
			files: fixtureStoreFile<Record<string, unknown>>(STORE_NAMES.library, (state) => ({ ...state, models: [], selectedModelId: '' })),
		},
	});

	test('the Model section calls to add a model file or browse Models; Generate waits for a model', async ({ app, page }, testInfo) => {
		await app.open();
		const model = sectionOf(app, 'Model');
		await expect(model.getByText('No model yet', { exact: true })).toBeVisible();
		await expect(model.getByRole('combobox', { name: 'Checkpoint' })).toBeDisabled();
		await expect(app.generationAction('Generate')).toBeDisabled();
		await expect(app.generationActions().getByText('Pick a checkpoint to generate', { exact: true })).toBeVisible();
		await expect(app.commandBar().getByRole('button', { name: 'Model: No model', exact: true })).toBeVisible();
		const add = model.getByRole('button', { name: 'Add model file', exact: true });
		await expectOnTop(add);
		await expect(add).toHaveCSS('background-color', await resolveColor(page, tokens.colorBrandBackground));
		await app.parkPointer({ blur: true });
		await assertAppVisible(page);
		await saveScreenshot(model, testInfo, 'no-model-call-to-action');
		await expectBaseline(model, 'no-model-call-to-action.png');

		await add.click();
		await expect(notifications(page).getByText(/need the desktop app/)).toBeVisible();

		await model.getByRole('button', { name: 'Browse models', exact: true }).click();
		await expect(app.section('models')).toBeVisible();
	});
});

test.describe('at the smallest supported window size', () => {
	test.use({ viewport: SMALL_VIEWPORT });

	test('the sticky actions stay on top while the panel body scrolls to its end', async ({ app, page }, testInfo) => {
		await app.open();
		const generate = app.generationAction('Generate');
		await expectOnTop(generate);
		const before = await boxOf(generate);

		const generation = await openMoreOptions(app);
		expect(await scrollPanelToEnd(app), 'the panel body scrolls at 1280 x 720').toBeGreaterThan(0);

		// The last options are drawn above the action area, never under it.
		await expectOnTop(generation.getByRole('button', { name: 'Remove prompt links to sharp_lineart.safetensors', exact: true }));
		await expectOnTop(generate);
		await expectOnTop(app.generationAction('Continuous'));
		await expectOnTop(app.generationAction('Cancel'));
		await expectOnTop(progressOf(generationRegion(app)).bar);
		const after = await boxOf(generate);
		expect(after.y, 'Generate did not move while the body scrolled').toBe(before.y);
		const region = await boxOf(generationRegion(app));
		expect(after.y + after.height, 'Generate inside the window').toBeLessThanOrEqual(region.y + region.height);
		await app.parkPointer({ blur: true });
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'create-1280x720-scrolled');
	});
});

test.describe('the narrowest generation panel', () => {
	test.use({ e2eOptions: { files: narrowRegionsLayout() } });

	test('every section fits without clipping, labels on one line, at 1920 x 1080', async ({ app, page }, testInfo) => {
		await app.open();
		const generation = generationRegion(app);
		expect(Math.round((await boxOf(generation)).width)).toBeLessThanOrEqual(310);
		await openMoreOptions(app);
		await app.parkPointer({ blur: true });

		await expectNoHorizontalOverflow(generation);
		// Labels and values stay readable: one line each (no wrapped label pushing its field out of line).
		const wrapped = await generation.evaluate((panel) =>
			Array.from(panel.querySelectorAll('label, [role="combobox"]'))
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
		// Generate, Continuous and Cancel all stay whole in the narrow action area.
		for (const name of ['Generate', 'Continuous', 'Cancel'] as const) {
			await expectOnTop(app.generationAction(name));
		}
		for (const name of ['Model', 'Character', 'LoRAs', 'Image settings', 'Seeds', 'Negative prompt']) {
			await scrollSectionIntoView(app, name);
			await saveScreenshot(generation, testInfo, `narrow-${name}`);
		}
		await expectOnTop(sectionOf(app, 'LoRAs').getByRole('spinbutton', { name: 'Weight of Watercolor Wash v1.2' }));
		await assertAppVisible(page);
	});
});

test.describe('the collapsed generation panel', () => {
	test.use({
		e2eOptions: {
			generator: { step_delay_ms: 150 },
			files: layoutStoreFile((layout) => ({ ...layout, collapsed: { ...layout.collapsed, generation: true } })),
		},
	});

	test('its strip keeps Generate, Continuous and Cancel (icon-only) with a compact progress bar', async ({ app, page, backend }, testInfo) => {
		await app.open();
		const strip = generationRegion(app);
		// The strip's compact actions (the same group name as the panel's action area).
		const compact = app.generationActions();
		await expect(strip.getByRole('region', { name: 'Model' })).toHaveCount(0);
		const generate = compact.getByRole('button', { name: 'Generate', exact: true });
		for (const name of ['Generate', 'Continuous', 'Cancel']) {
			await expectOnTop(compact.getByRole('button', { name, exact: true }));
		}
		await expect(generate).toHaveCSS('background-color', await resolveColor(page, ACTION_COLORS.primary.background));
		await generate.hover();
		await expect(page.getByRole('tooltip')).toHaveText('Generate one image with the current prompt and settings (Ctrl+G)');
		await app.parkPointer({ blur: true });
		await saveScreenshot(strip, testInfo, 'compact-strip-idle');

		await generate.click();

		await expectOutcome(compact, 'running');
		await expect(compact.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
		// The step count next to the bar (the sampling steps of the request: 12).
		await expect(compact.getByText(/^([3-9]|1[0-2])\/12$/)).toBeVisible({ timeout: 15_000 });
		await expectFill(compact, 'running');
		await app.parkPointer({ blur: true });
		await saveScreenshot(strip, testInfo, 'compact-strip-running');
		await expectCurrentOutput(app, '0000000005', '5 / 5');
		await expectOutcome(compact, 'complete');
		await expectFill(compact, 'complete');
		await expect(compact.getByText('12/12', { exact: true })).toBeVisible();
		expect((await backend.state()).generations).toBe(1);
		await assertAppVisible(page);
	});
});

test('visual baselines of the generation panel', async ({ app }) => {
	await app.open();
	const generation = generationRegion(app);
	await app.parkPointer({ blur: true });
	await expectBaseline(generation, 'generation-panel.png');
	await expectBaseline(app.generationActions(), 'generation-actions.png');
	await scrollSectionIntoView(app, 'Seeds');
	await app.parkPointer({ blur: true });
	await expectBaseline(generation, 'generation-panel-seeds.png');
});
