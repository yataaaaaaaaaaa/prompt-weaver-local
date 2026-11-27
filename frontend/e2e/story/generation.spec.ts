// Illustrating scenes in the real browser, with the paced fake generator of the e2e backend: one scene (its progress
// on the card, then its picture), every missing scene one after the other (the run's progress, Cancel), a regeneration
// and the choice of a variant, a failing generation, and character consistency: every scene's request carries the
// story character's tags, LoRA and seed lock (read back from the outputs' metadata), plus the scene's own overrides.
import type { OutputRecord, Story } from '../../src/api/types';
import type { E2EBackend } from '../support/backend';
import { STORY_LABELS } from '../../src/features/story/storyLabels';
import { dismissNotifications, expectPicturesLoaded, toast } from '../support/app';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible } from '../support/visibility';
import { backendOutput, backendStory, LIGHTHOUSE, MIRA_ID, MIRA_LORA, MIRA_PROMPT, StoryDriver } from './storyDriver';

/** The outputs the backend lists. */
async function outputIds(backend: E2EBackend): Promise<string[]> {
	return (await backend.get<{ ids: string[] }>('/api/outputs')).ids;
}

/** Every scene's request carried the story's character: Mira's pinned tags first, her LoRA at her weight, her locked
 *  seed (unless the scene fixes its own), and the output names the story scene. */
function expectMiraIn(record: OutputRecord, sceneId: string, seed = 777): void {
	expect(record.prompt).toContain(`${MIRA_PROMPT.identity}, ${MIRA_PROMPT.outfit}`);
	expect(record.selections.slice(0, 2).map((selection) => [selection.category_name, selection.prompt_text])).toEqual([
		['Character', MIRA_PROMPT.identity],
		['Character outfit', MIRA_PROMPT.outfit],
	]);
	expect(record.active_loras).toContainEqual(MIRA_LORA);
	expect(record.character?.id).toBe(MIRA_ID);
	expect(record.seed).toBe(seed);
	expect(record.negative_prompt).toContain('long hair');
	expect(record.story).toMatchObject({ story_id: LIGHTHOUSE.id, scene_id: sceneId });
}

test.describe('with a slower generator', () => {
	test.use({ e2eOptions: { generator: { step_delay_ms: 150 } } });

	test('generate one scene: its progress on the card, then its picture, an output linked to the scene', async ({ app, page, backend }, testInfo) => {
		const story = new StoryDriver(app);
		await app.open();
		await story.open();
		const calm = story.card(3, LIGHTHOUSE.scenes[2]);
		// The scene chooses its Weather effects sub-prompt (the picker lists every category's sub-prompts).
		const details = await story.openScene(3, LIGHTHOUSE.scenes[2]);
		const picker = details.getByRole('combobox', { name: STORY_LABELS.lockSubPrompt, exact: true });
		await picker.click();
		await picker.fill('lightning');
		const locked = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(LIGHTHOUSE.sceneIds[2]));
		await page.getByRole('option', { name: 'lightning bolts', exact: true }).click();
		expect((await locked).ok()).toBe(true);
		await expect(details.getByText('lightning bolts', { exact: true })).toBeVisible();
		await expect(details.getByRole('button', { name: 'Unlock Weather effects', exact: true })).toBeVisible();

		await calm.getByRole('button', { name: STORY_LABELS.generate, exact: true }).click();
		await expect(story.status(calm)).toHaveText('Generating');
		await expect(calm.getByRole('progressbar', { name: 'Generation progress' })).toBeVisible();
		await expect(story.section().getByRole('status', { name: /^Generating: Scene 1 of 1 · Morning calm$/ })).toBeVisible();
		await expect(story.command(STORY_LABELS.cancelGeneration)).toBeVisible();
		await saveScreenshot(page, testInfo, 'generating-scene');

		await expect(story.status(calm)).toHaveText('Illustrated', { timeout: 30_000 });
		await expect(story.command(STORY_LABELS.cancelGeneration)).toHaveCount(0);
		await expect(story.generateMissing()).toHaveText('Generate missing (0)');
		await expect(story.generateMissing()).toBeDisabled();
		await expectPicturesLoaded(calm);

		const saved = await backendStory(backend, LIGHTHOUSE.id);
		const scene = saved.scenes[2];
		expect(scene.variants).toHaveLength(1);
		expect(scene.chosen_output_id).toBe(scene.variants[0].output_id);
		const record = await backendOutput(backend, scene.chosen_output_id!);
		expectMiraIn(record, LIGHTHOUSE.sceneIds[2]);
		// The scene's lock, then its own tags, after the pinned character; the lock replaced the user category's pick.
		expect(record.selections.slice(2, 4)).toMatchObject([
			{ category_name: 'Weather effects', prompt_text: 'lightning bolts', locked: true },
			{ category_name: 'Scene', prompt_text: 'sunrise, calm sea, small boat', locked: true },
		]);
		expect(record.selections.filter((selection) => selection.category_name === 'Weather effects')).toHaveLength(1);
		// A normal output: in Create's history, the viewer left where it was.
		expect(await outputIds(backend)).toContain(record.output_id);
		await app.goTo('create');
		await expect(app.createRegion('viewer').getByRole('img', { name: 'Output 0000000004', exact: true })).toBeVisible();
		await expect(app.createRegion('viewer').getByRole('option', { name: `Output ${record.output_id}`, exact: true })).toBeVisible();
	});

	test('generate every missing scene one after the other; Cancel stops the run', async ({ app, page, backend }, testInfo) => {
		const story = new StoryDriver(app);
		await app.open();
		await story.open();
		// Three scenes without a picture: two added to the fixture story.
		await story.command(STORY_LABELS.addScene).click();
		await story.command(STORY_LABELS.addScene).click();
		await expect(story.generateMissing()).toHaveText('Generate missing (3)');

		await story.generateMissing().click();
		const run = story.section().getByRole('status', { name: /^Generating: Scene \d of 3/ });
		await expect(run).toBeVisible();
		await expect(story.status(story.card(4, 'Scene 4'))).toHaveText('Queued');
		await saveScreenshot(page, testInfo, 'generating-missing');
		await expect(story.section().getByRole('status', { name: /^Generating: Scene 2 of 3 · Scene 4$/ })).toBeVisible({ timeout: 30_000 });
		await story.command(STORY_LABELS.cancelGeneration).click();

		await expect(run).toHaveCount(0);
		await expect(story.status(story.card(4, 'Scene 4'))).toHaveText('Not illustrated');
		await expect(story.status(story.card(5, 'Scene 5'))).toHaveText('Not illustrated');
		await expect(story.status(story.card(3, LIGHTHOUSE.scenes[2]))).toHaveText('Illustrated');
		await expect(story.generateMissing()).toHaveText('Generate missing (2)');
		await expect(story.generateMissing()).toBeEnabled();
		expect((await backend.state()).generations).toBe(2);
	});
});

test('generate all missing scenes: every picture keeps the story character (character consistency)', async ({ app, page, backend }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	await story.command(STORY_LABELS.addScene).click();
	await expect(story.generateMissing()).toHaveText('Generate missing (2)');

	await story.generateMissing().click();
	await expect(story.generateMissing()).toHaveText('Generate missing (0)', { timeout: 30_000 });
	await expect(story.status(story.card(3, LIGHTHOUSE.scenes[2]))).toHaveText('Illustrated');
	await expect(story.status(story.card(4, 'Scene 4'))).toHaveText('Illustrated');
	// Announced, without 'Go to Story' (the Story section is shown).
	const done = toast(page, '2 scenes of The lighthouse keeper were illustrated.');
	await expect(done).toBeVisible();
	await expect(done.getByRole('button', { name: 'Go to Story' })).toHaveCount(0);
	await expect(story.storyItem(LIGHTHOUSE.title)).toContainText('4 scenes · all illustrated');
	await expectPicturesLoaded(story.scenes());
	await assertAppVisible(page);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'all-illustrated');

	const saved: Story = await backendStory(backend, LIGHTHOUSE.id);
	const records = await Promise.all(saved.scenes.slice(2).map((scene) => backendOutput(backend, scene.chosen_output_id!)));
	expectMiraIn(records[0], saved.scenes[2].id);
	expectMiraIn(records[1], saved.scenes[3].id);
	// Every scene of the story now has a picture made with Mira: the fixture ones too (output 0000000002 is hers).
	expect((await backendOutput(backend, saved.scenes[0].chosen_output_id!)).character?.id).toBe(MIRA_ID);

	// A scene can override the story's character: Bram only, for the next picture of scene 4.
	const details = await story.openScene(4, 'Scene 4');
	await details.getByRole('switch', { name: STORY_LABELS.sameCharacters }).click();
	await details.getByRole('combobox', { name: STORY_LABELS.sceneCharacters, exact: true }).click();
	await page.getByRole('menuitemcheckbox', { name: 'Mira', exact: true }).click();
	await page.getByRole('menuitemcheckbox', { name: 'Bram the knight', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect.poll(async () => (await backendStory(backend, LIGHTHOUSE.id)).scenes[3].character_ids).toEqual(['chr-bbbbbbbbbbb1']);
	await details.getByRole('button', { name: STORY_LABELS.regenerate, exact: true }).click();
	await expect.poll(async () => (await backendStory(backend, LIGHTHOUSE.id)).scenes[3].variants.length, { timeout: 30_000 }).toBe(2);
	const bram = await backendOutput(backend, (await backendStory(backend, LIGHTHOUSE.id)).scenes[3].chosen_output_id!);
	expect(bram.character?.id).toBe('chr-bbbbbbbbbbb1');
	expect(bram.prompt).toContain('1boy, short brown hair, beard');
	expect(bram.prompt).not.toContain(MIRA_PROMPT.identity);
	await dismissNotifications(page);
});

test('regenerate a scene, then pick the earlier variant back', async ({ app, page, backend }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	const details = await story.openScene(1, LIGHTHOUSE.scenes[0]);
	await expect(details.getByRole('img', { name: `Illustration of ${LIGHTHOUSE.scenes[0]}`, exact: true })).toHaveAttribute('src', /0000000002\/image$/);

	await details.getByRole('button', { name: STORY_LABELS.regenerate, exact: true }).click();
	await expect(details.getByText('Variants (2)')).toBeVisible({ timeout: 30_000 });
	const scene = (await backendStory(backend, LIGHTHOUSE.id)).scenes[0];
	const generated = scene.chosen_output_id!;
	expect(scene.variants.map((variant) => variant.output_id)).toEqual(['0000000002', generated]);
	await expect(details.getByRole('button', { name: `Variant ${generated}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(details.getByRole('img', { name: `Illustration of ${LIGHTHOUSE.scenes[0]}`, exact: true })).toHaveAttribute('src', new RegExp(`${generated}/image$`));
	// The scene's lock went into the request (Mood: smiling).
	expect((await backendOutput(backend, generated)).selections.find((selection) => selection.category_name === 'Mood')).toMatchObject({ prompt_text: 'smiling', locked: true });
	await expectPicturesLoaded(details);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'two-variants');

	await details.getByRole('button', { name: 'Variant 0000000002', exact: true }).click();
	await expect(details.getByRole('button', { name: 'Variant 0000000002', exact: true })).toHaveAttribute('aria-pressed', 'true');
	await expect(details.getByRole('img', { name: `Illustration of ${LIGHTHOUSE.scenes[0]}`, exact: true })).toHaveAttribute('src', /0000000002\/image$/);
	await expect.poll(async () => (await backendStory(backend, LIGHTHOUSE.id)).scenes[0].chosen_output_id).toBe('0000000002');
});

test.describe('with a failing generator', () => {
	test.use({ e2eOptions: { generator: { fail_message: 'CUDA out of memory (synthetic)' } } });

	test('a failed scene generation says which scene failed and why, and leaves the scene as it was', async ({ app, page, backend, diagnostics }) => {
		diagnostics.allow(/status of 409/);
		const story = new StoryDriver(app);
		await app.open();
		await story.open();

		await story.card(3, LIGHTHOUSE.scenes[2]).getByRole('button', { name: STORY_LABELS.generate, exact: true }).click();

		const failure = toast(page, 'CUDA out of memory (synthetic)');
		await expect(failure).toBeVisible({ timeout: 20_000 });
		await expect(failure).toContainText(`Could not illustrate the scene: ${LIGHTHOUSE.scenes[2]}`);
		await expect(story.status(story.card(3, LIGHTHOUSE.scenes[2]))).toHaveText('Not illustrated');
		expect((await backendStory(backend, LIGHTHOUSE.id)).scenes[2].variants).toEqual([]);
	});
});
