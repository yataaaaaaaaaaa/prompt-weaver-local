// The Reference images (IP-Adapter) section of the Characters pane in the real browser, against the synthetic Hugging
// Face of the e2e backend: the support of the selected SDXL model per focus (Download), a download in progress with
// its named progress bars and Cancel (stalled at 30 %), a download that fails (the synthetic bytes never match the
// pinned SHA-256: Failed, with what failed and Retry), and the support following the model picked in the Generation
// pane.
import type { Locator } from '@playwright/test';
import { expectBaseline } from '../support/baselines';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import { CharactersDriver, IMAGE_ENCODER, MIRA, SD15_MODEL, SDXL_FACE, SDXL_FACE_ADAPTER, SDXL_MODEL } from './characters';

/** The file rows of a variant in the IP-Adapter files list. */
function variantFiles(characters: CharactersDriver, variantLabel: string): Locator {
	return characters.ipAdapter().getByRole('list', { name: `Files of ${variantLabel}` }).getByRole('listitem');
}

test('the selected SDXL model offers Download for Face and Whole subject', async ({ app, page }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	const pane = await characters.open();
	const section = characters.ipAdapter();
	await section.scrollIntoViewIfNeeded();

	await expect(section.getByRole('heading', { name: `With the selected model ${SDXL_MODEL}` })).toBeVisible();
	for (const [focus, variant] of [
		['Face', SDXL_FACE],
		['Whole subject', 'SDXL general (IP-Adapter Plus ViT-H)'],
	] as const) {
		const support = characters.support(focus);
		await expect(support.getByText(`Download the IP-Adapter '${variant}' to use reference images.`)).toBeVisible();
		await expect(support.getByRole('button', { name: 'Download' })).toBeVisible();
	}
	await expect(section.getByRole('list', { name: 'IP-Adapter variants' }).getByRole('listitem', { name: /IP-Adapter/ })).toHaveCount(4);
	for (const file of await variantFiles(characters, SDXL_FACE).all()) {
		await expect(file.getByText('Available to download')).toBeVisible();
	}
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'ip-adapter-section');
	await expectBaseline(section.getByRole('list', { name: 'Reference support' }), 'ip-adapter-support.png');
	await section.getByRole('list', { name: 'IP-Adapter variants' }).scrollIntoViewIfNeeded();
	await expectBaseline(section.getByRole('list', { name: 'IP-Adapter variants' }), 'ip-adapter-files.png');
});

test.describe('a download that stalls', () => {
	test.use({ e2eOptions: { network: { stall_at_percent: 30 } } });

	test('shows named progress bars with Cancel; Cancel returns to Download without an error', async ({ app, page }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		const pane = await characters.open();
		const face = characters.support('Face');
		await face.scrollIntoViewIfNeeded();
		await face.getByRole('button', { name: 'Download' }).click();

		await expect(face.getByText(`Downloading ${SDXL_FACE}: reference images apply once it is installed.`)).toBeVisible();
		const downloads = face.getByRole('list', { name: `Downloads of ${SDXL_FACE}` });
		for (const file of [SDXL_FACE_ADAPTER, IMAGE_ENCODER]) {
			await expect(downloads.getByText(file, { exact: true })).toBeVisible();
			const bar = downloads.getByRole('progressbar', { name: `Downloading ${file}` });
			await expect(bar).toBeVisible();
			await expect.poll(async () => Number((await bar.getAttribute('aria-valuenow')) ?? 0), { message: `${file} progresses` }).toBeGreaterThan(0);
		}
		for (const file of await variantFiles(characters, SDXL_FACE).all()) {
			await expect(file.getByText('Downloading')).toBeVisible();
		}
		const cancel = face.getByRole('button', { name: 'Cancel' });
		await expect(cancel).toBeEnabled();
		await assertAppVisible(page, { allowOverlays: true });
		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'downloading');

		// The Character section of the (narrow) Generation pane shows the same download for Mira's focus (the face).
		await characters.toggleActive(MIRA.name, true);
		const generation = await app.showPane('Generation');
		const section = characters.generationSection();
		await expect(section.getByRole('progressbar', { name: `Downloading ${SDXL_FACE_ADAPTER}` })).toBeVisible();
		await expect(section.getByText(SDXL_FACE_ADAPTER, { exact: true })).toBeVisible();
		await expect(section.getByRole('button', { name: 'Cancel' })).toBeEnabled();
		await app.parkPointer();
		await saveScreenshot(generation, testInfo, 'downloading-generation-pane');
		await app.bringToFront(pane);
		// The bars and their byte counts depend on timing: masked (the file names are not).
		await expectBaseline(face, 'ip-adapter-downloading.png', { mask: [downloads.getByRole('progressbar'), downloads.getByText(/ of |Starting the download/)] });

		await cancel.click();
		await expect(face.getByRole('button', { name: 'Download' })).toBeVisible({ timeout: 20_000 });
		await expect(downloads).toHaveCount(0);
		await expect(face.getByRole('button', { name: 'Retry' })).toHaveCount(0);
		for (const file of await variantFiles(characters, SDXL_FACE).all()) {
			await expect(file.getByText('Available to download')).toBeVisible();
		}
		// A cancel is the user's choice: no error.
		await expect(page.getByText(`${SDXL_FACE} could not be installed`)).toHaveCount(0);
	});
});

test('a download that fails shows Failed with what failed, and Retry', async ({ app, page }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	const pane = await characters.open();
	const face = characters.support('Face');
	await face.scrollIntoViewIfNeeded();
	await face.getByRole('button', { name: 'Download' }).click();
	await expect(face.getByRole('list', { name: `Downloads of ${SDXL_FACE}` })).toBeVisible();

	// The synthetic Hugging Face bytes never match the catalog's size and SHA-256.
	const failure = face.getByText(`${SDXL_FACE} could not be downloaded`);
	await expect(failure).toBeVisible({ timeout: 30_000 });
	await expect(face.getByText(new RegExp(`${SDXL_FACE_ADAPTER.replace(/[.]/g, '\\.')}: `))).toBeVisible();
	const retry = face.getByRole('button', { name: 'Retry' });
	await expect(retry).toBeVisible();
	await expect(face.getByRole('button', { name: 'Download' })).toHaveCount(0);
	for (const file of await variantFiles(characters, SDXL_FACE).all()) {
		await expect(file.getByText('Failed')).toBeVisible();
	}
	// The toast says so too (the section may be closed).
	await expect(page.getByText(`${SDXL_FACE} could not be installed`)).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'download-failed');
	await expectBaseline(face, 'ip-adapter-failed.png');

	// Retry downloads again (and fails again with the synthetic bytes).
	await retry.click();
	await expect(face.getByRole('button', { name: 'Cancel' })).toBeVisible();
	await expect(failure).toBeVisible({ timeout: 30_000 });
});

test('picking another model in the Generation pane updates the support', async ({ app, page }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	const pane = await characters.open();
	await expect(characters.support('Face').getByText(`Download the IP-Adapter '${SDXL_FACE}' to use reference images.`)).toBeVisible();

	const generation = await app.showPane('Generation');
	const checkpoint = generation.getByRole('combobox', { name: 'Checkpoint' });
	await checkpoint.scrollIntoViewIfNeeded();
	await checkpoint.click();
	await page.getByRole('option', { name: SD15_MODEL, exact: true }).click();

	await app.bringToFront(pane);
	const section = characters.ipAdapter();
	await expect(section.getByRole('heading', { name: `With the selected model ${SD15_MODEL}` })).toBeVisible();
	await expect(characters.support('Face').getByText("Download the IP-Adapter 'SD 1.5 face (IP-Adapter Plus Face)' to use reference images.")).toBeVisible();
	await expect(characters.support('Whole subject').getByText("Download the IP-Adapter 'SD 1.5 general (IP-Adapter Plus)' to use reference images.")).toBeVisible();
	await section.scrollIntoViewIfNeeded();
	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'sd15-support');
});
