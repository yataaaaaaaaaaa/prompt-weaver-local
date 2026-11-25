// The LoRA library of the Generation pane in the real app: weights (typed, stepped, clamped to -10..10), selecting and
// unselecting LoRAs, the prompt-linked mark, the summary, the generation using the weights (Output browser LoRAs),
// persistence across a reload, aligned columns and truncated long names, the warning Clear action, Clear itself, and
// the desktop-only Add files.
import { ACTION_COLORS } from '../../src/ui/stateColors';
import { scrollSectionIntoView, sectionOf } from '../generation/generationPane';
import { outputDetail } from '../outputs/outputBrowser';
import { notifications } from '../support/app';
import { expectBaseline } from '../support/baselines';
import type { AppDriver } from '../support/app';
import { STORE_NAMES, storeFile, type E2EBackend } from '../support/backend';
import { MIN_TEXT_CONTRAST, resolveColor, textContrast } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';

const WATERCOLOR = 'Watercolor Wash v1.2';
const DETAIL = 'local_detail_tweaker.safetensors';
const LINEART = 'sharp_lineart.safetensors';

type LoraWeight = { id: string; weight: number };
type LibraryEnvelope = { envelope: { state: { selectedLoras: LoraWeight[]; loras: Array<Record<string, unknown>> }; version: number } | null };

async function persistedSelection(backend: E2EBackend): Promise<LoraWeight[]> {
	return (await backend.get<LibraryEnvelope>(`/api/stores/${STORE_NAMES.library}`)).envelope?.state.selectedLoras ?? [];
}

async function openLoras(app: AppDriver) {
	await app.open();
	const loras = await scrollSectionIntoView(app, 'LoRAs');
	return {
		loras,
		row: (name: string) => loras.getByRole('listitem').filter({ has: app.page.getByRole('checkbox', { name, exact: true }) }),
		weight: (name: string) => loras.getByRole('spinbutton', { name: `Weight of ${name}` }),
		checkbox: (name: string) => loras.getByRole('checkbox', { name, exact: true }),
	};
}

test('the LoRA list shows the selection with weights, the prompt link and the summary', async ({ app, page }, testInfo) => {
	const { loras, row, weight, checkbox } = await openLoras(app);

	await expect(checkbox(WATERCOLOR)).toBeChecked();
	await expect(checkbox(DETAIL)).toBeChecked();
	await expect(checkbox(LINEART)).not.toBeChecked();
	await expect(weight(WATERCOLOR)).toHaveValue('0.65');
	await expect(weight(DETAIL)).toHaveValue('-0.5');
	await expect(weight(LINEART)).toHaveCount(0);
	await expect(row(LINEART).getByText('Prompt-linked')).toBeVisible();
	await expect(row(LINEART).getByRole('button', { name: `Remove prompt links to ${LINEART}` })).toBeVisible();
	await expect(row(WATERCOLOR).getByText('Prompt-linked')).toHaveCount(0);
	await expect(loras.getByText('Default selected: 2 · Prompt-linked: 1 · Possible active: 3')).toBeVisible();
	for (const text of [row(LINEART).getByText('Prompt-linked'), loras.getByText(/^Default selected:/)]) {
		expect(await textContrast(text)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
	}

	// One column per kind of control: the weight fields and the delete buttons line up whatever the name lengths.
	const lefts = async (locators: ReturnType<typeof row>[], role: 'spinbutton' | 'button', name: RegExp) =>
		Promise.all(locators.map(async (item) => Math.round((await item.getByRole(role, { name }).boundingBox())?.x ?? -1)));
	const weightLefts = await lefts([row(WATERCOLOR), row(DETAIL)], 'spinbutton', /^Weight of /);
	expect(new Set(weightLefts).size, `weight fields at x = ${weightLefts}`).toBe(1);
	const deleteLefts = await lefts([row(WATERCOLOR), row(DETAIL), row(LINEART)], 'button', /from the library$/);
	expect(new Set(deleteLefts).size, `delete buttons at x = ${deleteLefts}`).toBe(1);
	for (const name of [WATERCOLOR, DETAIL, LINEART]) {
		await expectOnTop(row(name).getByRole('button', { name: /from the library$/ }));
	}

	await app.parkPointer();
	await assertAppVisible(page);
	await saveScreenshot(app.pane('Generation'), testInfo, 'loras');
	await expectBaseline(app.pane('Generation'), 'loras-section.png');
});

test('weights are typed, stepped and clamped to -10..10, and persisted', async ({ app, page, backend }) => {
	const { weight } = await openLoras(app);
	const field = weight(WATERCOLOR);

	await field.fill('0.8');
	await field.press('Enter');
	await expect(field).toHaveValue('0.8');
	await expect.poll(() => persistedSelection(backend)).toContainEqual({ id: 'watercolor-wash-safetensors', weight: 0.8 });

	await field.press('ArrowUp');
	await expect(field).toHaveValue('0.85');
	await field.press('ArrowDown');
	await field.press('ArrowDown');
	await expect(field).toHaveValue('0.75');

	// The stepper buttons of the Fluent SpinButton.
	const stepper = field.locator('xpath=..');
	await stepper.locator('.fui-SpinButton__incrementButton').click();
	await expect(field).toHaveValue('0.8');
	await stepper.locator('.fui-SpinButton__decrementButton').click();
	await expect(field).toHaveValue('0.75');

	await field.fill('25');
	await field.press('Tab');
	await expect(field).toHaveValue('10');
	await field.fill('-30');
	await field.press('Enter');
	await expect(field).toHaveValue('-10');
	await field.fill('heavy');
	await field.press('Enter');
	await expect(field).toHaveValue('-10');
	await expect.poll(() => persistedSelection(backend)).toContainEqual({ id: 'watercolor-wash-safetensors', weight: -10 });
	await expect(page.getByRole('spinbutton', { name: `Weight of ${DETAIL}` })).toHaveValue('-0.5');
});

test('selecting and unselecting LoRAs shows and hides their weight; Clear unselects all', async ({ app, page, backend }, testInfo) => {
	const { loras, weight, checkbox } = await openLoras(app);
	const clear = loras.getByRole('button', { name: 'Clear' });
	await app.parkPointer();
	await expect(clear).toHaveCSS('color', await resolveColor(page, ACTION_COLORS.warning.subtleForeground));
	expect(await textContrast(clear), 'contrast of the warning Clear').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);

	await checkbox(LINEART).check();
	await expect(weight(LINEART)).toHaveValue('1');
	await expect(loras.getByText('Default selected: 3 · Prompt-linked: 1 · Possible active: 3')).toBeVisible();

	await checkbox(WATERCOLOR).uncheck();
	await expect(weight(WATERCOLOR)).toHaveCount(0);
	await expect(loras.getByText('Default selected: 2 · Prompt-linked: 1 · Possible active: 2')).toBeVisible();
	await expect
		.poll(() => persistedSelection(backend))
		.toEqual([
			{ id: 'local-detail-tweaker-safetensors', weight: -0.5 },
			{ id: 'sharp-lineart-safetensors', weight: 1 },
		]);

	await clear.click();

	for (const name of [WATERCOLOR, DETAIL, LINEART]) {
		await expect(checkbox(name)).not.toBeChecked();
	}
	await expect(loras.getByRole('spinbutton')).toHaveCount(0);
	await expect(clear).toBeDisabled();
	await app.parkPointer();
	await expect(clear).not.toHaveCSS('color', await resolveColor(page, ACTION_COLORS.warning.subtleForeground));
	await expect(loras.getByText('Default selected: 0 · Prompt-linked: 1 · Possible active: 1')).toBeVisible();
	await expect.poll(() => persistedSelection(backend)).toEqual([]);
	await saveScreenshot(app.pane('Generation'), testInfo, 'loras-cleared');
});

test('a generation uses the weights: the Output browser lists them, and a reload keeps them', async ({ app, page, backend }) => {
	const { weight } = await openLoras(app);
	await weight(WATERCOLOR).fill('0.8');
	await weight(WATERCOLOR).press('Enter');
	await expect.poll(() => persistedSelection(backend)).toContainEqual({ id: 'watercolor-wash-safetensors', weight: 0.8 });

	const created = await generateOutput(app, backend);

	const listed = outputDetail(app, 'LoRAs').getByRole('listitem');
	await expect(listed.first()).toHaveText(`${WATERCOLOR} (0.8)`);
	await expect(listed.nth(1)).toHaveText(`${DETAIL} (-0.5)`);
	const record = await backend.get<{ active_loras: LoraWeight[] }>(`/api/outputs/${created}`);
	expect(record.active_loras.slice(0, 2)).toEqual([
		{ id: 'watercolor-wash-safetensors', weight: 0.8 },
		{ id: 'local-detail-tweaker-safetensors', weight: -0.5 },
	]);

	await page.reload();
	await expect(app.workspace()).toBeVisible({ timeout: 30_000 });
	await scrollSectionIntoView(app, 'LoRAs');
	await expect(sectionOf(app, 'LoRAs').getByRole('spinbutton', { name: `Weight of ${WATERCOLOR}` })).toHaveValue('0.8');
	await expect(sectionOf(app, 'LoRAs').getByRole('spinbutton', { name: `Weight of ${DETAIL}` })).toHaveValue('-0.5');
});

test('removing the prompt link of sharp_lineart drops its mark', async ({ app }) => {
	const { loras, row } = await openLoras(app);

	await row(LINEART).getByRole('button', { name: `Remove prompt links to ${LINEART}` }).click();

	await expect(row(LINEART).getByText('Prompt-linked')).toHaveCount(0);
	await expect(loras.getByText('Default selected: 2 · Prompt-linked: 0 · Possible active: 2')).toBeVisible();
});

test('Add files in a browser explains that it needs the desktop app', async ({ app, page }) => {
	const { loras } = await openLoras(app);

	await loras.getByRole('button', { name: 'Add files' }).click();

	await expect(notifications(page).getByText(/need the desktop app/)).toBeVisible();
});

test('a long LoRA name is truncated with an ellipsis and shown in full in a tooltip', async ({ app, page, backend }, testInfo) => {
	// The fixture library plus a LoRA with a long name (written back with the data dir placeholders).
	const { models_root: modelsRoot } = await backend.state();
	const library = (await backend.get<LibraryEnvelope>(`/api/stores/${STORE_NAMES.library}`)).envelope;
	if (!library) {
		throw new Error('the fixture library store is missing');
	}
	const longName = 'Ultra detailed cinematic watercolor illustration style with soft lighting v3.5 final';
	const state = JSON.parse(JSON.stringify(library.state).split(modelsRoot.replaceAll('\\', '/')).join('{{MODELS_ROOT}}'));
	state.loras.push({ id: 'long-name', name: longName, path: '{{MODELS_ROOT}}/loras/long_name.safetensors', source: null });
	state.selectedLoras.push({ id: 'long-name', weight: 1.25 });
	await backend.reset({ files: storeFile(STORE_NAMES.library, state, library.version) });

	const { row, weight } = await openLoras(app);
	const label = row(longName).getByText(longName, { exact: true });
	const truncated = await label.evaluate((element) => element.scrollWidth > element.clientWidth);
	expect(truncated, 'the long name is truncated').toBe(true);
	await expect(label).toHaveCSS('text-overflow', 'ellipsis');
	await expectOnTop(weight(longName));
	await expect(weight(longName)).toHaveValue('1.25');

	await label.hover();
	await expect(page.getByRole('tooltip')).toHaveText(longName);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(app.pane('Generation'), testInfo, 'loras-long-name');
});
