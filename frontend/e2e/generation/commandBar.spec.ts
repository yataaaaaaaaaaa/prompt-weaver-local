// The Create command bar in the real app: the current model, the active character and the LoRA count on one row, each
// one click from changing it: the model popover (the checkpoint picker, Add model file, Browse models), the character
// menu (activate one, None, New character, Manage characters) and the LoRA popover (the weights of the selected LoRAs,
// Edit LoRAs). Every popup is checked visible and on top, in both themes.
import { SHELL_LABELS } from '../../src/app/sections';
import { STORE_NAMES } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectOnTop } from '../support/visibility';
import { outputDetail } from '../outputs/outputBrowser';
import { generationRegion, sectionOf } from './generationPane';

const MODEL = 'Model: studio_xl_local.safetensors';

test('the bar names the model, the character and the LoRA count on one row, also at 1280 x 720', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	const bar = app.commandBar();
	await expect(bar).toHaveAccessibleName(SHELL_LABELS.createCommandBar);
	const items = bar.getByRole('button');
	await expect(items).toHaveCount(3);
	await expect(bar.getByRole('button', { name: MODEL, exact: true })).toBeVisible();
	await expect(bar.getByRole('button', { name: 'Character: No character', exact: true })).toBeVisible();
	await expect(bar.getByRole('button', { name: 'LoRAs: 2 LoRAs', exact: true })).toBeVisible();
	// One row: every item at the same height, inside the bar.
	const barBox = await boxOf(bar);
	for (const item of await items.all()) {
		await expectOnTop(item);
		const box = await boxOf(item);
		expect(box.y).toBeGreaterThanOrEqual(barBox.y - 0.5);
		expect(box.y + box.height).toBeLessThanOrEqual(barBox.y + barBox.height + 0.5);
	}
	await bar.getByRole('button', { name: MODEL, exact: true }).hover();
	await expect(page.getByRole('tooltip')).toHaveText(`${MODEL}. Change the checkpoint, add one from disk or browse Models.`);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(bar, testInfo, 'command-bar-1280');
	await expectBaseline(bar, 'command-bar.png');
});

test('the model popover changes the checkpoint used by the next generation', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const bar = app.commandBar();

	await bar.getByRole('button', { name: MODEL, exact: true }).click();

	const popover = page.getByRole('dialog', { name: 'Model' });
	await expectOnTop(popover);
	const checkpoint = popover.getByRole('combobox', { name: 'Checkpoint' });
	await expect(checkpoint).toHaveText('studio_xl_local.safetensors');
	for (const name of ['Add model file', 'Browse models']) {
		await expectOnTop(popover.getByRole('button', { name, exact: true }));
	}
	await app.page.mouse.move(1, 1);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'model-popover');

	await checkpoint.click();
	const listbox = page.locator(`#${await checkpoint.getAttribute('aria-controls')}`);
	await expectOnTop(listbox);
	await listbox.getByRole('option', { name: 'Dreamline 1.5 v7', exact: true }).click();

	await expect(checkpoint).toHaveText('Dreamline 1.5 v7');
	await expect
		.poll(async () => (await backend.storedState<{ selectedModelId: string }>(STORE_NAMES.library)).selectedModelId)
		.toBe('dreamline-v7-safetensors');
	// Escape closes the popover (the rest of the app is inert while it is open) and the focus returns to its button.
	await page.keyboard.press('Escape');
	await expect(popover).toHaveCount(0);
	await expect(bar.getByRole('button', { name: 'Model: Dreamline 1.5 v7', exact: true })).toBeFocused();
	await expect(sectionOf(app, 'Model').getByRole('combobox', { name: 'Checkpoint' })).toHaveText('Dreamline 1.5 v7');
	await generateOutput(app, backend);
	await expect(outputDetail(app, 'Model')).toHaveText('Dreamline 1.5 v7');
});

test('Browse models in the model popover opens the Models section', async ({ app, page }) => {
	await app.open();
	await app.commandBar().getByRole('button', { name: MODEL, exact: true }).click();

	await page.getByRole('dialog', { name: 'Model' }).getByRole('button', { name: 'Browse models', exact: true }).click();

	await expect(app.section('models')).toBeVisible();
	await expect(page.getByRole('dialog', { name: 'Model' })).toHaveCount(0);
});

test('the character menu activates a character, checked in the menu, and None deactivates it', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const bar = app.commandBar();

	await bar.getByRole('button', { name: 'Character: No character', exact: true }).click();

	const menu = page.getByRole('menu');
	await expectOnTop(menu);
	await expect(menu.getByRole('menuitemradio')).toHaveText(['None', 'Bram the knight', 'Mira', 'Nova']);
	await expect(menu.getByRole('menuitemradio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
	for (const name of ['New character', 'Manage characters']) {
		await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
	}
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'character-menu');

	await menu.getByRole('menuitemradio', { name: 'Mira' }).click();

	await expect(bar.getByRole('button', { name: 'Character: Mira', exact: true })).toBeVisible();
	await expect.poll(async () => (await backend.get<{ active_id: string | null }>('/api/characters')).active_id).toBe('chr-aaaaaaaaaaa1');
	// The generation panel's Character section shows her too.
	await expect(generationRegion(app).getByRole('region', { name: 'Character' }).getByText('Mira', { exact: true })).toBeVisible();

	await bar.getByRole('button', { name: 'Character: Mira', exact: true }).click();
	await expect(page.getByRole('menu').getByRole('menuitemradio', { name: 'Mira' })).toHaveAttribute('aria-checked', 'true');
	await page.getByRole('menu').getByRole('menuitemradio', { name: 'None' }).click();

	await expect(bar.getByRole('button', { name: 'Character: No character', exact: true })).toBeVisible();
	await expect.poll(async () => (await backend.get<{ active_id: string | null }>('/api/characters')).active_id).toBeNull();
});

test('the character menu leads to a new character and to the Characters section', async ({ app, page }) => {
	await app.open();
	const bar = app.commandBar();

	await bar.getByRole('button', { name: 'Character: No character', exact: true }).click();
	await page.getByRole('menu').getByRole('menuitem', { name: 'Manage characters', exact: true }).click();
	await expect(app.section('characters')).toBeVisible();

	await app.goTo('create');
	await bar.getByRole('button', { name: 'Character: No character', exact: true }).click();
	await page.getByRole('menu').getByRole('menuitem', { name: 'New character', exact: true }).click();
	await expect(app.section('characters')).toBeVisible();
	await expect(app.section('characters').getByRole('textbox', { name: /^Name/ })).toBeVisible();
});

test('the LoRA popover adjusts a weight used by the next generation; Edit LoRAs shows the LoRA list', async ({ app, page, backend }, testInfo) => {
	await app.open();
	const bar = app.commandBar();

	await bar.getByRole('button', { name: 'LoRAs: 2 LoRAs', exact: true }).click();

	const popover = page.getByRole('dialog', { name: 'LoRAs' });
	await expectOnTop(popover);
	const weight = popover.getByRole('spinbutton', { name: 'Weight of Watercolor Wash v1.2', exact: true });
	await expect(weight).toHaveValue('0.65');
	await expect(popover.getByRole('spinbutton', { name: 'Weight of local_detail_tweaker.safetensors', exact: true })).toHaveValue('-0.5');
	await app.page.mouse.move(1, 1);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'lora-popover');

	await weight.fill('0.9');
	await weight.press('Enter');

	await expect(weight).toHaveValue('0.9');
	await expect
		.poll(async () => (await backend.storedState<{ selectedLoras: Array<{ id: string; weight: number }> }>(STORE_NAMES.library)).selectedLoras)
		.toContainEqual({ id: 'watercolor-wash-safetensors', weight: 0.9 });

	await popover.getByRole('button', { name: 'Edit LoRAs', exact: true }).click();

	await expect(popover).toHaveCount(0);
	await expectOnTop(sectionOf(app, 'LoRAs').getByRole('list', { name: 'LoRA library' }));
	await expect(sectionOf(app, 'LoRAs').getByRole('spinbutton', { name: 'Weight of Watercolor Wash v1.2', exact: true })).toHaveValue('0.9');
	await generateOutput(app, backend);
	await expect(outputDetail(app, 'LoRAs').getByRole('listitem').first()).toHaveText('Watercolor Wash v1.2 (0.9)');
});
