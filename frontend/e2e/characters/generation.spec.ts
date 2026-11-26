// The active character in generation, in the real browser: the Character section of the Create section's generation
// panel (readable at its width: thumbnail, name, tags, seed lock, Deactivate, Edit, reference strength and support),
// a generation with Mira active (her locked seed, her pinned Character / Character outfit categories in Used
// sub-prompts, the Character row of the output details) and the warning for a character LoRA missing from the
// library (Nova).
import type { OutputRecord } from '../../src/api/types';
import { REGION_MIN_WIDTH } from '../../src/domain/layout';
import { dismissNotifications, expectPicturesLoaded } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { layoutStoreFile } from '../support/shell';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop } from '../support/visibility';
import { outputDetail } from '../outputs/outputBrowser';
import { CharactersDriver, MIRA, NOVA } from './characters';

test('the Character section shows the active character with its locked seed and reference support', async ({ app, page }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();
	await characters.open();
	await characters.toggleActive(MIRA.name, true);
	await app.goTo('create');
	const section = characters.generationSection();

	await expect(section.getByText(MIRA.name, { exact: true })).toBeVisible();
	await expect(section.getByText('1girl, short red hair, green eyes, freckles')).toBeVisible();
	await expect(section.getByText('Seed locked to 777')).toBeVisible();
	await expect(section.getByRole('slider', { name: 'Reference strength' })).toHaveAttribute('aria-valuetext', '0.6');
	// Her focus is the face: the support of the selected SDXL model for it.
	await expect(section.getByText("Download the IP-Adapter 'SDXL face (IP-Adapter Plus Face ViT-H)' to use reference images.")).toBeVisible();
	await expect(section.getByRole('button', { name: 'Download' })).toBeVisible();
	await expectPicturesLoaded(section);
	// Readable at the panel's width: nothing cut off, the actions in view.
	await expectNoHorizontalOverflow(section);
	await section.scrollIntoViewIfNeeded();
	for (const name of ['Deactivate', `Edit ${MIRA.name}`]) {
		await expectOnTop(section.getByRole('button', { name, exact: true }));
	}
	const [panel, box] = [await boxOf(app.createRegion('generation')), await boxOf(section)];
	expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
	await assertAppVisible(page, { allowOverlays: true });

	// Wait for the activation toast to leave the section alone, then compare.
	await dismissNotifications(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'generation-mira-active');
	await expectBaseline(section, 'active-character.png');

	// Edit hands off to the Characters section; Cancel comes back here.
	await section.getByRole('button', { name: `Edit ${MIRA.name}` }).click();
	await expect(characters.editor(`Edit ${MIRA.name}`)).toBeVisible();
	await characters.editor(`Edit ${MIRA.name}`).getByRole('button', { name: 'Cancel' }).click();
	await expect(app.section('create')).toBeVisible();
	await expect(section.getByRole('button', { name: `Edit ${MIRA.name}` })).toBeFocused();
});

test.describe('in the narrowest generation panel of the smallest window', () => {
	test.use({
		viewport: SMALL_VIEWPORT,
		e2eOptions: {
			files: layoutStoreFile((layout) => ({ ...layout, widths: { ...layout.widths, generation: REGION_MIN_WIDTH.generation } })),
		},
	});

	test('the Character section stays readable, with or without an active character', async ({ app, page }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		const panel = app.createRegion('generation');
		expect((await boxOf(panel)).width).toBeLessThanOrEqual(REGION_MIN_WIDTH.generation + 1);
		const section = characters.generationSection();
		await section.scrollIntoViewIfNeeded();
		await expectOnTop(section.getByRole('combobox', { name: 'Active character' }));
		await expectOnTop(section.getByRole('button', { name: 'New character' }));
		await expectNoHorizontalOverflow(section);
		await app.parkPointer();
		await saveScreenshot(section, testInfo, 'narrow-no-character');

		await section.getByRole('combobox', { name: 'Active character' }).click();
		await page.getByRole('option', { name: MIRA.name, exact: true }).click();
		await expect(section.getByText('Seed locked to 777')).toBeVisible();
		await dismissNotifications(page);
		await section.scrollIntoViewIfNeeded();
		for (const name of ['Deactivate', `Edit ${MIRA.name}`]) {
			await expectOnTop(section.getByRole('button', { name, exact: true }));
		}
		await expect(section.getByRole('slider', { name: 'Reference strength' })).toBeVisible();
		await expectOnTop(section.getByRole('button', { name: 'Download' }));
		await expectNoHorizontalOverflow(section);
		const [panelBox, box] = [await boxOf(panel), await boxOf(section)];
		expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
		await assertAppVisible(page);
		await app.parkPointer();
		await saveScreenshot(section, testInfo, 'narrow-mira-active');
		await saveScreenshot(page, testInfo, 'narrow-create');
	});
});

test.describe('generating', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 80 } } });

	test('with Mira active: her locked seed, her pinned categories and the Character row of the output', async ({ app, page, backend }, testInfo) => {
		const characters = new CharactersDriver(app);
		await app.open();
		await characters.open();
		await characters.toggleActive(MIRA.name, true);
		await app.goTo('create');
		const imageSeed = app.createRegion('generation').getByRole('textbox', { name: 'Image seed' });
		await expect(imageSeed).toHaveValue('1234567');

		const outputId = await generateOutput(app, backend);

		await app.showViewerTab('Details');
		await expect(outputDetail(app, 'Output')).toHaveText(`#${outputId}`);
		await expect(outputDetail(app, 'Character')).toHaveText(new RegExp(`^${MIRA.name} · `));
		await expect(outputDetail(app, 'Seed')).toHaveText('777');
		// The locked seed replaced the image seed for this generation only: the field is unchanged.
		await expect(imageSeed).toHaveValue('1234567');

		// The pinned categories are listed like any category (read-only check of Used sub-prompts).
		await app.showViewerTab('Used sub-prompts');
		const used = app.usedSubPrompts();
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

		await generateOutput(app, backend);

		const warning = page.getByText('LoRAs missing from the library were ignored: missing-lora-safetensors.');
		await expect(warning).toBeVisible();
		await assertAppVisible(page, { allowOverlays: true });
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'missing-lora-warning');
	});
});
