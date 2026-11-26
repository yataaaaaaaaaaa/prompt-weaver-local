// Journey "remix an online image" (Discover -> Collect -> Compose -> Generate), in the real browser on the synthetic
// Civitai and the fake generator: in Images, open an image, 'Use these LoRAs' (its missing LoRA downloads, visible from
// the rail), 'Go to Create' shows the LoRA with the image's weight; back in Images (the image is still shown), add its
// tags to a new category, whose card 'Go to Create' reveals; then Generate: the output uses the image's LoRA at its
// weight and the tags.
import { STORE_NAMES } from '../support/backend';
import { expectReadable } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { toast } from '../support/app';
import { generateOutput, goToCreateFrom } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import { addTagsTo, AUTHOR, imageDetail, loraRow, openImage, openImages, subPrompts } from '../images/imageLibrary';
import { selectedLoras } from '../models/libraries';
import { installProgress, statusBadge } from '../models/modelLibrary';

type OutputRecord = { prompt: string; active_loras: { id: string; weight: number }[] };
type LibraryEntry = { id: string; name: string };

/** The tags of the e2e-painter image (its prompt without the inline LoRA tag). */
const PAINTER_TAGS = 'masterpiece, 1girl, pixel art, castle, sunset sky';

test.use({ e2eOptions: { network: { chunk_delay_ms: 250 }, generator: { step_delay_ms: 100 } } });

test('remix an online image: its LoRA at its weight and its tags, then generate', async ({ app, page, backend }, testInfo) => {
	// Discover: the image and what it was made with.
	const section = await openImages(app);
	const detail = await openImage(section, AUTHOR.pixelForge);
	const lora = loraRow(detail, 'Pixel Forge Style');
	await expect(lora.getByText('Weight 0.8')).toBeVisible();
	await expect(statusBadge(lora, 'Available to download')).toBeVisible();
	await assertAppVisible(page);
	await app.parkPointer();
	await saveScreenshot(page, testInfo, '1-image');

	// Collect: one click downloads the missing LoRA (progress in the row and on the Models rail item) and selects it.
	await detail.getByRole('button', { name: 'Use these LoRAs' }).click();
	await expect(installProgress(lora)).toBeVisible();
	await expect(app.navItem('models').locator('.fui-CounterBadge')).toHaveText('1');
	await saveScreenshot(page, testInfo, '2-downloading');
	await expect(statusBadge(lora, 'In library')).toBeVisible({ timeout: 20_000 });
	const handOff = toast(page, 'LoRAs selected for generation');
	await expect(handOff).toBeVisible();
	await expectReadable(handOff.getByText(/LoRAs selected for generation/));

	// Compose: Create shows the LoRA with the image's weight.
	await goToCreateFrom(app, 'LoRAs selected for generation');
	await expect.poll(() => selectedLoras(app)).toEqual({ 'Pixel Forge Style - v2.0': '0.8' });
	await saveScreenshot(page, testInfo, '3-create-with-the-lora');

	// Back in Images, the image is still shown: its tags go to a new category, whose card Create reveals.
	await app.goTo('images');
	await expect(imageDetail(section).getByRole('heading', { name: `Image by ${AUTHOR.pixelForge}`, level: 2 })).toBeVisible();
	await addTagsTo(detail, 'New category');
	const tagsToast = toast(page, /Tags added to the category '.+'\./);
	await expect(tagsToast).toBeVisible();
	const category = /Tags added to the category '(.+)'\./.exec((await tagsToast.textContent()) ?? '')?.[1] ?? '';
	await goToCreateFrom(app, `Tags added to the category '${category}'.`);
	const card = app.categoryCard(category);
	await expect(card).toBeInViewport();
	await expect(subPrompts(card)).toHaveText([PAINTER_TAGS]);
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, '4-category-revealed');

	// Generate: the output uses the LoRA at the image's weight and the tags.
	const outputId = await generateOutput(app, backend);
	const output = await backend.get<OutputRecord>(`/api/outputs/${outputId}`);
	expect(output.prompt).toContain(PAINTER_TAGS);
	// The image's LoRA at its weight (a LoRA some fixture sub-prompt links may join it at the default weight).
	const library = await backend.storedState<{ loras: LibraryEntry[] }>(STORE_NAMES.library);
	const pixelForge = library.loras.find((entry) => entry.name === 'Pixel Forge Style - v2.0');
	expect(pixelForge).toBeDefined();
	expect(output.active_loras).toContainEqual({ id: pixelForge?.id, weight: 0.8 });
	await app.parkPointer();
	await saveScreenshot(page, testInfo, '5-generated');
});
