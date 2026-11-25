// The active character in generation, in the real browser: the Character section of the Generation pane, a generation
// with Mira active (her locked seed, her pinned Character / Character outfit categories, the output's Character row)
// and the warning for a character LoRA missing from the library (Nova).
import type { OutputRecord } from '../../src/api/types';
import { expectBaseline } from '../support/baselines';
import { expectPicturesLoaded } from '../support/app';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import { outputDetail } from '../outputs/outputBrowser';
import { CharactersDriver, MIRA, NOVA } from './characters';

test('the Character section shows the active character with its locked seed and reference support', async ({ app, page }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();
	await characters.toggleActive(MIRA.name, true);
	const generation = await app.showPane('Generation');
	const section = characters.generationSection();

	await expect(section.getByText(MIRA.name, { exact: true })).toBeVisible();
	await expect(section.getByText('1girl, short red hair, green eyes, freckles')).toBeVisible();
	await expect(section.getByText('Seed locked to 777')).toBeVisible();
	await expect(section.getByRole('slider', { name: 'Reference strength' })).toHaveAttribute('aria-valuetext', '0.6');
	// Her focus is the face: the support of the selected SDXL model for it.
	await expect(section.getByText("Download the IP-Adapter 'SDXL face (IP-Adapter Plus Face ViT-H)' to use reference images.")).toBeVisible();
	await expect(section.getByRole('button', { name: 'Download' })).toBeVisible();
	await expectPicturesLoaded(section);
	await assertAppVisible(page, { allowOverlays: true });

	// Wait for the activation toast to leave the section alone, then compare.
	await app.parkPointer();
	await saveScreenshot(generation, testInfo, 'generation-mira-active');
	await expectBaseline(section, 'active-character.png');
});

test.describe('generating', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 80 } } });

	test('with Mira active: her locked seed, her pinned categories and the Character row of the output', async ({ app, page, backend }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		await characters.open();
		await characters.toggleActive(MIRA.name, true);
		const generation = await app.showPane('Generation');
		const imageSeed = generation.getByRole('textbox', { name: 'Image seed' });
		await expect(imageSeed).toHaveValue('1234567');

		const outputId = await generateOutput(app, backend);

		const outputBrowser = app.pane('Output browser');
		const details = outputBrowser.getByLabel('Output details');
		await expect(details.getByText(`#${outputId}`, { exact: true })).toBeVisible();
		await expect(outputDetail(app, 'Character')).toHaveText(new RegExp(`^${MIRA.name} · `));
		await expect(outputDetail(app, 'Seed')).toHaveText('777');
		// The locked seed replaced the image seed for this generation only: the field is unchanged.
		await expect(imageSeed).toHaveValue('1234567');

		// The pinned categories are listed like any category (read-only check of the Used sub-prompts pane).
		const used = app.pane('Used sub-prompts');
		await expect(used.getByRole('listitem', { name: 'Character: 1girl, short red hair, green eyes, freckles' })).toBeVisible();
		await expect(used.getByRole('listitem', { name: 'Character outfit: leather jacket, white scarf' })).toBeVisible();

		const record = await backend.get<OutputRecord>(`/api/outputs/${outputId}`);
		expect(record).toMatchObject({ character: { id: MIRA.id, name: MIRA.name }, seed: 777 });
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'generated-with-mira');
	});

	test('with Nova active, her LoRA missing from the library is reported', async ({ app, page, backend }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		await characters.open();
		await characters.toggleActive(NOVA.name, true);
		await app.showPane('Generation');

		await generateOutput(app, backend);

		const warning = page.getByText('LoRAs missing from the library were ignored: missing-lora-safetensors.');
		await expect(warning).toBeVisible();
		await assertAppVisible(page, { allowOverlays: true });
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'missing-lora-warning');
	});
});
