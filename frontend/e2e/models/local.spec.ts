// The Models section in the real browser, beyond the online search: the Local library view (card grids with their
// provenance or 'Local file', paths, 'Use' of a checkpoint announced with 'Go to Create', 'Use by default' and Remove
// with its danger color; the model folders in the detail panel), the Civitai token dialog, and both views in the
// smallest supported window.
import type { Locator } from '@playwright/test';
import { ACTION_COLORS } from '../../src/ui/stateColors';
import { expectBaseline } from '../support/baselines';
import { expectPicturesLoaded, notifications, toast, waitForPicturesInView } from '../support/app';
import { computedStyle, expectReadable, resolveColor } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop } from '../support/visibility';
import { goToCreateFrom } from '../support/flows';
import { checkpointPicker, selectedLoras } from './libraries';
import { expectPreviewFillsCard, openModels, resultCard } from './modelLibrary';

function localEntry(section: Locator, list: 'Checkpoints' | 'LoRAs', name: string): Locator {
	return section.getByRole('list', { name: list }).getByRole('group', { name, exact: true });
}

/** The Local library view's results and its detail panel (the model folders). */
function localRegions(section: Locator): { results: Locator; folders: Locator } {
	return {
		results: section.getByRole('region', { name: 'Local library', exact: true }),
		folders: section.getByRole('complementary', { name: 'Model folders', exact: true }),
	};
}

async function openLocalLibrary(section: Locator): Promise<void> {
	await section.getByRole('tab', { name: 'Local library' }).click();
	await expect(section.getByRole('tab', { name: 'Local library' })).toHaveAttribute('aria-selected', 'true');
	await expect(section.getByRole('list', { name: 'Checkpoints' })).toBeVisible();
	await waitForPicturesInView(section.page());
}

test.describe('the Local library view', () => {
	test('lists the entries in grids with their provenance or Local file, readable badges, and the model folders next to them', async ({ app, page, backend }, testInfo) => {
		const section = await openModels(app);
		await openLocalLibrary(section);
		await assertAppVisible(page);
		const { results, folders } = localRegions(section);
		// No online search controls in this view.
		await expect(section.getByRole('searchbox', { name: 'Search models' })).toHaveCount(0);
		await expect(section.getByRole('group', { name: 'Model filters' })).toHaveCount(0);

		const checkpoints = section.getByRole('list', { name: 'Checkpoints' }).getByRole('group');
		await expect(checkpoints).toHaveCount(3);
		const dreamline = localEntry(section, 'Checkpoints', 'Dreamline 1.5 v7');
		await expect(dreamline.getByText('SD 1.5', { exact: true })).toBeVisible();
		await expect(dreamline.getByText('v7', { exact: true })).toBeVisible();
		await expect(dreamline.getByText('Local file')).toHaveCount(0);
		await expect(dreamline.getByRole('img', { name: 'Dreamline 1.5 v7' })).toBeVisible();
		const { models_root: modelsRoot } = await backend.state();
		await expect(dreamline.getByText(`${modelsRoot.replace(/\\/g, '/')}/checkpoints/dreamline_v7.safetensors`)).toBeVisible();

		// Cards side by side.
		const [first, second] = [await boxOf(checkpoints.nth(0)), await boxOf(checkpoints.nth(1))];
		expect(Math.abs(first.y - second.y), 'two checkpoint cards on a row').toBeLessThan(1);

		const studio = localEntry(section, 'Checkpoints', 'studio_xl_local.safetensors');
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

		const watercolor = localEntry(section, 'LoRAs', 'Watercolor Wash v1.2');
		await expect(watercolor.getByRole('list', { name: 'Trigger words' }).getByRole('listitem')).toHaveText(['watercolor']);
		await expect(watercolor.getByRole('checkbox', { name: 'Use by default' })).toBeChecked();
		await expect(localEntry(section, 'LoRAs', 'sharp_lineart.safetensors').getByRole('checkbox', { name: 'Use by default' })).not.toBeChecked();

		await expectReadable(results.locator('.fui-Badge'));
		await expectPicturesLoaded(section.getByRole('list', { name: 'Checkpoints' }));
		await expect(folders.getByRole('heading', { name: 'Model folders', level: 2 })).toBeVisible();
		const folderPaths = folders.getByRole('definition');
		await expect(folderPaths).toHaveCount(3);
		const slashes = (text: string | null) => (text ?? '').replace(/\\/g, '/');
		expect(slashes(await folderPaths.first().textContent())).toBe(`${slashes(modelsRoot)}/checkpoints`);
		await expectReadable(folders.getByText(/^Downloads are saved in these folders/));

		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'local-library');
		// The temp paths change on every run, and so does their length (the backend's models-<reset count> folder), hence
		// their wrapping: the baseline (the last step: React does not render these nodes again) gets one fixed text, masked.
		const paths = results.locator('.fui-CardHeader__description');
		await paths.evaluateAll((nodes) => nodes.forEach((node) => (node.textContent = 'D:/models/folder/file.safetensors')));
		await expectBaseline(results, 'local-library.png', { mask: [paths] });
	});

	test("'Use' makes a checkpoint the current model (Go to Create shows it); 'Use by default' and Remove change the LoRA selection", async ({ app, page }) => {
		const section = await openModels(app);
		await openLocalLibrary(section);

		await localEntry(section, 'Checkpoints', 'classic_sd15_local.safetensors').getByRole('button', { name: 'Use' }).click();
		await expect(localEntry(section, 'Checkpoints', 'classic_sd15_local.safetensors').getByText('Selected', { exact: true })).toBeVisible();
		await expect(localEntry(section, 'Checkpoints', 'studio_xl_local.safetensors').getByRole('button', { name: 'Use' })).toBeVisible();
		await expect(toast(page, 'classic_sd15_local.safetensors is selected for generation.')).toBeVisible();
		await goToCreateFrom(app, 'classic_sd15_local.safetensors is selected for generation.');
		await expect(app.commandBar()).toContainText('classic_sd15_local.safetensors');
		await expect(await checkpointPicker(app)).toHaveText('classic_sd15_local.safetensors');

		await expect.poll(() => selectedLoras(app)).toEqual({ 'Watercolor Wash v1.2': '0.65', 'local_detail_tweaker.safetensors': '-0.5' });
		const back = await app.goTo('models');
		await expect(back.getByRole('tab', { name: 'Local library' })).toHaveAttribute('aria-selected', 'true');
		await localEntry(back, 'LoRAs', 'sharp_lineart.safetensors').getByRole('checkbox', { name: 'Use by default' }).check();
		await localEntry(back, 'LoRAs', 'Watercolor Wash v1.2').getByRole('checkbox', { name: 'Use by default' }).uncheck();
		await expect.poll(() => selectedLoras(app)).toEqual({ 'local_detail_tweaker.safetensors': '-0.5', 'sharp_lineart.safetensors': '1' });

		// Remove is a danger action: red, in this theme.
		await app.goTo('models');
		const remove = localEntry(back, 'LoRAs', 'local_detail_tweaker.safetensors').getByRole('button', {
			name: 'Remove local_detail_tweaker.safetensors from the library',
		});
		expect(await computedStyle(remove, 'color')).toBe(await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
		await remove.click();
		await expect(localEntry(back, 'LoRAs', 'local_detail_tweaker.safetensors')).toHaveCount(0);
		await expect.poll(() => selectedLoras(app)).toEqual({ 'sharp_lineart.safetensors': '1' });
		await app.parkPointer();
	});
});

test('the Civitai token dialog opens, cancels, saves and removes the token', async ({ app, page }, testInfo) => {
	const section = await openModels(app);
	const trigger = section.getByRole('button', { name: 'Civitai token' });
	await expect(section.getByText('Token set')).toHaveCount(0);

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
	await expect(section.getByText('Token set')).toBeVisible();
	await expectReadable(section.getByText('Token set'));

	await trigger.click();
	await expect(dialog.getByText('A token is currently stored.')).toBeVisible();
	await expect(dialog.getByText('Saving replaces the stored token.')).toBeVisible();
	const remove = dialog.getByRole('button', { name: 'Remove token' });
	expect(await computedStyle(remove, 'color')).toBe(await resolveColor(page, ACTION_COLORS.danger.subtleForeground));
	await saveScreenshot(dialog, testInfo, 'token-dialog-token-set');
	await remove.click();
	await expect(dialog).toBeHidden();
	await expect(notifications(page)).toContainText('Civitai API token removed.');
	await expect(section.getByText('Token set')).toHaveCount(0);

	// Escape closes it too.
	await trigger.click();
	await expect(dialog).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});

test.describe('in the smallest supported window', () => {
	test.use({ viewport: SMALL_VIEWPORT });

	test('both views fit: every card, control and path stays inside its region', async ({ app, page }, testInfo) => {
		const section = await openModels(app);
		await expect(resultCard(section, 'Aurora XL')).toBeVisible();
		await assertAppVisible(page);
		const online = section.getByRole('region', { name: 'Model search results' });
		await expectNoHorizontalOverflow(online);
		await expectNoHorizontalOverflow(section.getByRole('complementary', { name: 'Model details' }));
		await expectOnTop(section.getByRole('button', { name: 'Civitai token' }));
		await expectReadable(section.getByRole('list', { name: 'Search results' }).locator('.fui-Badge'));
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'online-1280');

		await openLocalLibrary(section);
		const { results, folders } = localRegions(section);
		expect((await boxOf(results)).width).toBeGreaterThanOrEqual(600);
		await expectNoHorizontalOverflow(results);
		await expectNoHorizontalOverflow(folders);
		await expectOnTop(localEntry(section, 'Checkpoints', 'classic_sd15_local.safetensors').getByRole('button', { name: 'Use' }));
		await assertAppVisible(page);
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'local-1280');
	});
});
