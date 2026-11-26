// Journey "download a model and use it" (Discover -> Collect -> Generate), in the real browser on the synthetic Civitai
// and the fake generator: in Models, search a checkpoint, 'Download and use' (its progress on the card), go to Create
// while it downloads (the Models rail item counts it), and its completion makes it the current model, in the command
// bar and the Checkpoint picker, without leaving Create; then Generate with it.
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import { STORE_NAMES } from '../support/backend';
import { toast } from '../support/app';
import { checkpointPicker } from '../models/libraries';
import { installProgress, openModels, resultCard, searchFor, statusBadge } from '../models/modelLibrary';

type OutputRecord = { model_id: string };
type LibraryEntry = { id: string; name: string };

test.use({ e2eOptions: { network: { chunk_delay_ms: 600 }, generator: { step_delay_ms: 100 } } });

test('download a checkpoint, keep composing in Create meanwhile, then generate with it', async ({ app, page, backend }, testInfo) => {
	// Discover: search the checkpoint.
	const section = await openModels(app);
	await searchFor(section, 'aurora', ['Aurora XL']);
	const card = resultCard(section, 'Aurora XL');
	await assertAppVisible(page);

	// Collect: Download and use, with its progress.
	await card.getByRole('button', { name: 'Download and use' }).click();
	await expect(statusBadge(card, 'Downloading')).toBeVisible();
	await expect(installProgress(card)).toBeVisible();
	await expect(card.getByText(/ of 6\.0 MB$/)).toBeVisible();
	await app.parkPointer();
	await saveScreenshot(page, testInfo, '1-downloading');

	// Create while it downloads: the rail says a download runs; the current model is still the previous one.
	await app.goTo('create');
	const models = app.navItem('models');
	await expect(models).toHaveAccessibleDescription(/1 download running/);
	await expect(models.locator('.fui-CounterBadge')).toHaveText('1');
	await expect(app.commandBar()).toContainText('studio_xl_local.safetensors');
	await saveScreenshot(page, testInfo, '2-create-while-downloading');

	// Done: the checkpoint is the current model, shown in Create at once; the announcement offers no 'Go to Create'
	// (Create is already shown).
	await expect(app.commandBar()).toContainText('Aurora XL - v4.0', { timeout: 20_000 });
	await expect(await checkpointPicker(app)).toHaveText('Aurora XL - v4.0');
	await expect(models.locator('.fui-CounterBadge')).toHaveCount(0);
	const announcement = toast(page, 'Aurora XL - v4.0 is ready and selected for generation.');
	await expect(announcement).toBeVisible();
	await expect(announcement.getByRole('button', { name: 'Go to Create' })).toHaveCount(0);
	await expect(app.section('create')).toBeVisible();
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, '3-current-model');

	// Generate with it.
	const outputId = await generateOutput(app, backend);
	const output = await backend.get<OutputRecord>(`/api/outputs/${outputId}`);
	const library = await backend.storedState<{ models: LibraryEntry[] }>(STORE_NAMES.library);
	expect(library.models.find((model) => model.id === output.model_id)?.name).toBe('Aurora XL - v4.0');
	await app.parkPointer();
	await saveScreenshot(page, testInfo, '4-generated');
});
