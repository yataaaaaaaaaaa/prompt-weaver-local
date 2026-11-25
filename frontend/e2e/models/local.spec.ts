// Model library in the real browser, beyond the online search: the Local library tab (provenance or 'Local file',
// paths, Use / Use by default / Remove with its danger color, the model folders), the Civitai token dialog, and the
// pane at its minimum width and in the smallest supported window.
import { ACTION_COLORS } from '../../src/ui/stateColors';
import { expectBaseline } from '../support/baselines';
import { expectPicturesLoaded, notifications, waitForPicturesInView } from '../support/app';
import { workspaceLayout } from '../support/backend';
import { computedStyle, expectReadable, resolveColor } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectNoHorizontalOverflow, expectOnTop } from '../support/visibility';
import { MODEL_LIBRARY, selectedCheckpoint, selectedLoras } from './libraries';
import { expectPreviewFillsCard, openModelLibrary, resultCard } from './modelLibrary';
import type { Locator } from '@playwright/test';

function localEntry(pane: Locator, list: 'Checkpoints' | 'LoRAs', name: string): Locator {
	return pane.getByRole('list', { name: list }).getByRole('group', { name, exact: true });
}

async function openLocalLibrary(pane: Locator): Promise<void> {
	await pane.getByRole('tab', { name: 'Local library' }).click();
	await expect(pane.getByRole('tab', { name: 'Local library' })).toHaveAttribute('aria-selected', 'true');
	await expect(pane.getByRole('list', { name: 'Checkpoints' })).toBeVisible();
	await waitForPicturesInView(pane.page());
}

test.describe('the Local library tab', () => {
	// A wide window: every path holds on one line, so the (masked) temp paths cannot change the baseline's layout.
	test.use({ e2eOptions: { files: workspaceLayout({ 'pane:models': { x: 860, y: 16, width: 1044, height: 1004, z: 30 } }, ['images', 'characters']) } });

	test('lists the entries with their provenance or Local file, readable badges and the model folders', async ({ app, page, backend }, testInfo) => {
		const pane = await openModelLibrary(app);
		await openLocalLibrary(pane);
		await assertAppVisible(page);

		const checkpoints = pane.getByRole('list', { name: 'Checkpoints' }).getByRole('group');
		await expect(checkpoints).toHaveCount(3);
		const dreamline = localEntry(pane, 'Checkpoints', 'Dreamline 1.5 v7');
		await expect(dreamline.getByText('SD 1.5', { exact: true })).toBeVisible();
		await expect(dreamline.getByText('v7', { exact: true })).toBeVisible();
		await expect(dreamline.getByText('Local file')).toHaveCount(0);
		await expect(dreamline.getByRole('img', { name: 'Dreamline 1.5 v7' })).toBeVisible();
		const { models_root: modelsRoot } = await backend.state();
		await expect(dreamline.getByText(`${modelsRoot.replace(/\\/g, '/')}/checkpoints/dreamline_v7.safetensors`)).toBeVisible();

		const studio = localEntry(pane, 'Checkpoints', 'studio_xl_local.safetensors');
		await expect(studio.getByText('Local file')).toBeVisible();
		await expect(studio.getByText('Selected', { exact: true })).toBeVisible();
		await expect(studio.getByRole('img')).toHaveCount(0);
		// No preview: the placeholder icon is centered in the preview, which fills the card.
		await expectPreviewFillsCard(studio);
		const centered = await studio.locator('.fui-CardPreview').evaluate((preview) => {
			const outer = preview.getBoundingClientRect();
			const icon = preview.querySelector('svg')?.getBoundingClientRect();
			return icon ? [Math.abs(icon.left + icon.width / 2 - (outer.left + outer.width / 2)), Math.abs(icon.top + icon.height / 2 - (outer.top + outer.height / 2))] : null;
		});
		expect(centered, 'placeholder icon offset from the preview center (x, y)').not.toBeNull();
		expect(Math.max(...(centered ?? [99]))).toBeLessThanOrEqual(2);

		const watercolor = localEntry(pane, 'LoRAs', 'Watercolor Wash v1.2');
		await expect(watercolor.getByRole('list', { name: 'Trigger words' }).getByRole('listitem')).toHaveText(['watercolor']);
		await expect(watercolor.getByRole('checkbox', { name: 'Use by default' })).toBeChecked();
		await expect(localEntry(pane, 'LoRAs', 'sharp_lineart.safetensors').getByRole('checkbox', { name: 'Use by default' })).not.toBeChecked();

		await expectReadable(pane.getByRole('tabpanel').locator('.fui-Badge'));
		await expectPicturesLoaded(pane.getByRole('list', { name: 'Checkpoints' }));
		const folders = pane.getByRole('definition');
		await expect(folders).toHaveCount(3);
		const slashes = (text: string | null) => (text ?? '').replace(/\\/g, '/');
		expect(slashes(await folders.first().textContent())).toBe(`${slashes(modelsRoot)}/checkpoints`);

		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'local-library');
		const paths = [pane.locator('.fui-CardHeader__description'), folders];
		await expectBaseline(pane, 'local-library.png', { mask: paths });
	});

	test("'Use' selects a checkpoint, 'Use by default' and Remove change the LoRA selection", async ({ app, page }) => {
		const pane = await openModelLibrary(app);
		await openLocalLibrary(pane);

		await localEntry(pane, 'Checkpoints', 'classic_sd15_local.safetensors').getByRole('button', { name: 'Use' }).click();
		await expect(localEntry(pane, 'Checkpoints', 'classic_sd15_local.safetensors').getByText('Selected', { exact: true })).toBeVisible();
		await expect(localEntry(pane, 'Checkpoints', 'studio_xl_local.safetensors').getByRole('button', { name: 'Use' })).toBeVisible();
		await expect(selectedCheckpoint(app)).toHaveText('classic_sd15_local.safetensors');

		await expect.poll(() => selectedLoras(app)).toEqual({ 'Watercolor Wash v1.2': '0.65', 'local_detail_tweaker.safetensors': '-0.5' });
		await localEntry(pane, 'LoRAs', 'sharp_lineart.safetensors').getByRole('checkbox', { name: 'Use by default' }).check();
		await localEntry(pane, 'LoRAs', 'Watercolor Wash v1.2').getByRole('checkbox', { name: 'Use by default' }).uncheck();
		await expect.poll(() => selectedLoras(app)).toEqual({ 'local_detail_tweaker.safetensors': '-0.5', 'sharp_lineart.safetensors': '1' });

		// Remove is a danger action: red, in this theme.
		const remove = localEntry(pane, 'LoRAs', 'local_detail_tweaker.safetensors').getByRole('button', {
			name: 'Remove local_detail_tweaker.safetensors from the library',
		});
		expect(await computedStyle(remove, 'color')).toBe(await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
		await remove.click();
		await expect(localEntry(pane, 'LoRAs', 'local_detail_tweaker.safetensors')).toHaveCount(0);
		await expect.poll(() => selectedLoras(app)).toEqual({ 'sharp_lineart.safetensors': '1' });
		await app.parkPointer();
	});
});

test('the Civitai token dialog opens, cancels, saves and removes the token', async ({ app, page }, testInfo) => {
	const pane = await openModelLibrary(app);
	const trigger = pane.getByRole('button', { name: 'Civitai token' });
	await expect(pane.getByText('Token set')).toHaveCount(0);

	await trigger.click();
	const dialog = page.getByRole('dialog', { name: 'Civitai API token' });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByText('No token is stored.')).toBeVisible();
	await expect(dialog.getByLabel('API token')).toBeFocused();
	await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Remove token' })).toHaveCount(0);
	await expectOnTop(dialog);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'token-dialog');
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();

	await trigger.click();
	await dialog.getByLabel('API token').fill('e2e-secret-token');
	await expect(dialog.getByLabel('API token')).toHaveAttribute('type', 'password');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toBeHidden();
	await expect(notifications(page)).toContainText('Civitai API token saved.');
	await expect(pane.getByText('Token set')).toBeVisible();
	await expectReadable(pane.getByText('Token set'));

	await trigger.click();
	await expect(dialog.getByText('A token is currently stored.')).toBeVisible();
	await expect(dialog.getByText('Saving replaces the stored token.')).toBeVisible();
	const remove = dialog.getByRole('button', { name: 'Remove token' });
	expect(await computedStyle(remove, 'color')).toBe(await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
	await saveScreenshot(dialog, testInfo, 'token-dialog-token-set');
	await remove.click();
	await expect(dialog).toBeHidden();
	await expect(notifications(page)).toContainText('Civitai API token removed.');
	await expect(pane.getByText('Token set')).toHaveCount(0);

	// Escape closes it too.
	await trigger.click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});

test.describe('at its minimum width', () => {
	test.use({ e2eOptions: { files: workspaceLayout({ 'pane:models': { x: 16, y: 16, width: 360, height: 1004, z: 30 } }, ['images', 'characters']) } });

	test('every card, control and path fits the window', async ({ app, page }, testInfo) => {
		await app.open();
		const pane = app.pane(MODEL_LIBRARY);
		await app.bringToFront(pane);
		await expect(resultCard(pane, 'Aurora XL')).toBeVisible();
		await waitForPicturesInView(page);
		expect((await pane.boundingBox())?.width).toBe(360);
		await expectNoHorizontalOverflow(pane);
		await expectReadable(pane.getByRole('list', { name: 'Search results' }).locator('.fui-Badge'));
		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'online-360');

		await openLocalLibrary(pane);
		await expectNoHorizontalOverflow(pane);
		await saveScreenshot(pane, testInfo, 'local-360');
	});
});

test('the pane stays usable in the smallest supported window', async ({ app, page }, testInfo) => {
	await page.setViewportSize(SMALL_VIEWPORT);
	await app.open();
	const pane = await app.showPane(MODEL_LIBRARY);
	await expect(resultCard(pane, 'Aurora XL')).toBeVisible();
	await assertAppVisible(page);
	await expectOnTop(pane.getByRole('searchbox', { name: 'Search models' }));
	await expectOnTop(resultCard(pane, 'Aurora XL').getByRole('button', { name: 'Download and use' }));
	await expectNoHorizontalOverflow(pane);
	await saveScreenshot(page, testInfo, 'small-window');
});
