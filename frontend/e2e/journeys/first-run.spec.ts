// The first run, end to end in the real browser: a data directory with nothing in it yet (no saved state, no model in
// the library, no category, no output, no character; the model folders hold checkpoints already). Each empty region
// says what to do (the generation panel: add a model file or browse models; the board: add a category; the viewer: no
// outputs yet), and following that guidance gets to a first image: Browse models -> 'Use' a checkpoint found on disk
// -> 'Go to Create' -> add a category with a sub-prompt -> Generate -> the output shows.
import { resultCard, resultList } from '../models/modelLibrary';
import { toast } from '../support/app';
import { fixtureStore, storeFile } from '../support/backend';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { expectDockedLayout } from '../support/shell';
import { assertAppVisible, expectOnTop } from '../support/visibility';

/** A checkpoint of the synthetic catalog whose file is already in the model folders (fixtures/models.json). */
const CHECKPOINT_ON_DISK = 'Dreamline 1.5';

// Nothing saved but an empty category list (without any, the first start seeds two example categories): no library,
// settings, layout, board or current output, no output, no character.
test.use({
	e2eOptions: {
		files: storeFile('categorie-store', { categories: [] }, fixtureStore('categorie-store').version),
		remove: [
			'stores/library-store',
			'stores/settings-store',
			'stores/current-image-store',
			'stores/forbidden-associations-store',
			'stores/board-store',
			'stores/layout-store',
			'stores/workspace-store',
			'output',
			'characters',
		],
	},
});

test('a first run guides from an empty app to the first image', async ({ app, backend, page }, testInfo) => {
	await app.open();
	await assertAppVisible(page);
	await expectDockedLayout(app);

	// The empty states say what to do.
	const generation = app.createRegion('generation');
	await expect(generation.getByRole('button', { name: 'Add model file', exact: true })).toBeVisible();
	const browseModels = generation.getByRole('button', { name: 'Browse models', exact: true });
	await expect(browseModels).toBeVisible();
	const board = app.createRegion('board');
	await expect(board.getByRole('button', { name: 'Add category', exact: true }).first()).toBeVisible();
	await expect(board.getByRole('article')).toHaveCount(0);
	await expect(app.createRegion('viewer').getByText('No outputs yet')).toBeVisible();
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'empty-app');

	// Browse models: the Models section; a checkpoint already on disk is used at once (no download).
	await browseModels.click();
	const models = app.section('models');
	await expect(models).toBeVisible();
	await expect(app.navItem('models')).toHaveAttribute('aria-current', 'page');
	await expect(resultList(models)).toBeVisible();
	const card = resultCard(models, CHECKPOINT_ON_DISK);
	await card.getByRole('button', { name: 'Use', exact: true }).click();
	// '<name> is ready and selected for generation.' (a success toast: it closes after a few seconds), then its action.
	const handOff = toast(page, 'selected for generation.');
	await expect(handOff).toBeVisible();
	await saveScreenshot(page, testInfo, 'checkpoint-used');

	// The toast leads back to Create, where the model is now the current one.
	await handOff.getByRole('button', { name: 'Go to Create', exact: true }).click();
	await expect(app.section('create')).toBeVisible();
	await expect(app.commandBar()).toContainText(CHECKPOINT_ON_DISK);
	await expect(generation.getByRole('button', { name: 'Add model file', exact: true })).toBeHidden();

	// Add a category and write its sub-prompt.
	await board.getByRole('button', { name: 'Add category', exact: true }).first().click();
	const category = board.getByRole('article').first();
	await expect(category).toBeVisible();
	const nameEditor = category.getByRole('textbox', { name: 'Category name' });
	if (!(await nameEditor.isVisible())) {
		await category.getByRole('button', { name: /^Category name: / }).click();
	}
	await nameEditor.fill('Scene');
	await nameEditor.press('Enter');
	const scene = app.categoryCard('Scene');
	await expect(scene).toBeVisible();
	await scene.getByRole('button', { name: /^Sub-prompt: / }).first().click();
	const subPrompt = scene.getByRole('textbox', { name: 'Sub-prompt' });
	await subPrompt.fill('a lighthouse at dawn');
	await subPrompt.press('Enter');
	await expect(scene.getByRole('button', { name: 'Sub-prompt: a lighthouse at dawn' })).toBeVisible();

	// Generate: the first output shows in the viewer.
	await expectOnTop(app.generationAction());
	const created = await generateOutput(app, backend);
	await expect(app.createRegion('viewer').getByRole('img', { name: `Output ${created}`, exact: true })).toBeVisible();
	await expect(app.createRegion('viewer').getByText('No outputs yet')).toHaveCount(0);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'first-image');
});
