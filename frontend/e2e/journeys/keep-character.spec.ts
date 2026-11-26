// Journey "keep a character", end to end in the real browser: from the output shown in Create, Create character
// (the Characters section opens on the prefilled editor), lock its seed and save it, activate it from its details,
// go back to Create from the notification (the command bar and the generation panel's Character section show it),
// then generate two outputs: both use its locked seed and record it (the Character row of their details).
import type { OutputRecord } from '../../src/api/types';
import { CharactersDriver } from '../characters/characters';
import { outputDetail } from '../outputs/outputBrowser';
import { dismissNotifications } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';

const NAME = 'Character from #0000000004';
/** The image seed of output #4, prefilled as the character's seed. */
const SEED = '1234566';

test.use({ e2eOptions: { generator: { step_delay_ms: 40 } } });

test('keep a character: create it from an output, activate it, generate twice with its locked seed', async ({ app, page, backend }, testInfo) => {
	const characters = new CharactersDriver(app);
	await app.open();

	// Review -> Reuse: the output shown becomes a character.
	await app.createRegion('viewer').getByRole('button', { name: 'Create character' }).click();
	const editor = characters.editor('New character');
	await expect(editor.getByRole('textbox', { name: /^Name/ })).toBeFocused();
	await expect(editor.getByRole('textbox', { name: /^Name/ })).toHaveValue(NAME);
	await expect(editor.getByRole('textbox', { name: 'Seed' })).toHaveValue(SEED);
	await editor.getByRole('switch', { name: 'Lock seed' }).check();
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, '1-prefilled-editor');
	await editor.getByRole('button', { name: 'Save' }).click();

	// Saved and selected: Activate is the next step, then the notification leads back to Create.
	const details = characters.detailsOf(NAME);
	await expect(details.getByText(`${SEED} (locked)`)).toBeVisible();
	await details.getByRole('button', { name: 'Activate' }).click();
	await expect(details.getByRole('button', { name: 'Deactivate' })).toBeVisible();
	const toast = characters.toast(`${NAME} is active for generation.`);
	await expect(toast).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await app.parkPointer();
	await saveScreenshot(page, testInfo, '2-activated');
	await toast.getByRole('button', { name: 'Go to Create' }).click();

	// Create shows the active character in the command bar and in the generation panel.
	await expect(app.section('create')).toBeVisible();
	await expect(app.commandBar()).toContainText(NAME);
	const section = characters.generationSection();
	await expect(section.getByText(NAME, { exact: true })).toBeVisible();
	await expect(section.getByText(`Seed locked to ${SEED}`)).toBeVisible();
	await dismissNotifications(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, '3-create-with-character');
	await expectBaseline(section, 'character-section.png', { mask: [section.getByRole('img')] });

	// Generate twice: the same locked seed, the character recorded in both outputs.
	const imageSeed = app.createRegion('generation').getByRole('textbox', { name: 'Image seed' });
	const seedField = await imageSeed.inputValue();
	const outputs: string[] = [];
	for (const _ of [1, 2]) {
		const outputId = await generateOutput(app, backend);
		outputs.push(outputId);
		await app.showViewerTab('Details');
		await expect(outputDetail(app, 'Output')).toHaveText(`#${outputId}`);
		await expect(outputDetail(app, 'Character')).toHaveText(new RegExp(`^${NAME} · `));
		await expect(outputDetail(app, 'Seed')).toHaveText(SEED);
	}
	expect(new Set(outputs).size).toBe(2);
	// The locked seed replaced the image seed for these generations only: the field is unchanged.
	await expect(imageSeed).toHaveValue(seedField);
	for (const outputId of outputs) {
		const record = await backend.get<OutputRecord>(`/api/outputs/${outputId}`);
		expect(record).toMatchObject({ seed: Number(SEED), character: { name: NAME } });
	}
	await assertAppVisible(page, { allowOverlays: true });
	await app.parkPointer();
	await saveScreenshot(page, testInfo, '4-generated-twice');
});
