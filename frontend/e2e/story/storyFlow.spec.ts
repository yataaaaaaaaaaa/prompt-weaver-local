// The flow and per-frame fields of the Story section in the real browser: the story's logline, synopsis and style notes
// (their disclosure), a scene's flow notes (beat, shot, setting, mood), its LoRAs with their weights (added from the
// library, stepped, removed) and the removal of a variant (the output is kept). Every edit is saved in the backend and
// shows in both themes; the scene details stay readable at 1280 x 720.
import type { Story } from '../../src/api/types';
import { removeVariantName, sceneVariantName, STORY_LABELS } from '../../src/features/story/storyLabels';
import { expectPicturesLoaded } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { expectNoPageOverflow } from '../support/shell';
import { expectNoHorizontalOverflow } from '../support/visibility';
import { backendOutput, backendStory, LIGHTHOUSE, StoryDriver } from './storyDriver';

test("the story's flow: the logline, then the synopsis and style notes in their disclosure", async ({ app, page, backend }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	const header = story.scenes().getByRole('region', { name: `${LIGHTHOUSE.title} settings`, exact: true });

	const logline = header.getByRole('textbox', { name: STORY_LABELS.logline, exact: true });
	const saved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith(`/api/stories/${LIGHTHOUSE.id}`));
	await logline.fill('  A keeper guides a lost boat home through the storm.  ');
	await logline.press('Enter');
	expect((await saved).ok()).toBe(true);
	await logline.press('Tab');
	await expect(logline).toHaveValue('A keeper guides a lost boat home through the storm.');

	const disclosure = header.getByRole('button', { name: STORY_LABELS.storyFlow, exact: true });
	await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
	await disclosure.click();
	const synopsis = header.getByRole('textbox', { name: STORY_LABELS.synopsis, exact: true });
	await synopsis.fill('Mira takes over the lighthouse.\nA storm comes; a boat is lost.\nAt dawn it reaches the harbor.');
	await synopsis.press('Control+Enter');
	const style = header.getByRole('textbox', { name: STORY_LABELS.styleNotes, exact: true });
	const savedStyle = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith(`/api/stories/${LIGHTHOUSE.id}`));
	await style.fill('soft watercolor, muted blues');
	await style.press('Tab');
	expect((await savedStyle).ok()).toBe(true);
	await expect(header.getByRole('button', { name: `${STORY_LABELS.storyFlow} (2 of 2)`, exact: true })).toBeVisible();

	const stored: Story = await backendStory(backend, LIGHTHOUSE.id);
	expect(stored).toMatchObject({
		logline: 'A keeper guides a lost boat home through the storm.',
		synopsis: 'Mira takes over the lighthouse.\nA storm comes; a boat is lost.\nAt dawn it reaches the harbor.',
		style_notes: 'soft watercolor, muted blues',
	});
	await expectNoHorizontalOverflow(header);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'story-flow');
	await expectBaseline(header, 'story-flow.png');
});

test("a scene's flow notes and LoRAs with their weights are saved", async ({ app, page, backend }, testInfo) => {
	const story = new StoryDriver(app);
	await app.open();
	await story.open();
	const details = await story.openScene(3, LIGHTHOUSE.scenes[2]);

	await expect(details.getByRole('heading', { level: 3, name: STORY_LABELS.flow, exact: true })).toBeVisible();
	await story.editField(STORY_LABELS.beat, 'The boat comes home');
	await story.editField(STORY_LABELS.shot, 'wide shot, from above');
	await story.editField(STORY_LABELS.setting, 'harbor at sunrise');
	await story.editField(STORY_LABELS.mood, 'relief');

	const loras = details.getByRole('group', { name: STORY_LABELS.sceneLoras, exact: true });
	const added = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/scenes/${LIGHTHOUSE.sceneIds[2]}`));
	await loras.getByRole('combobox', { name: 'Add a LoRA', exact: true }).click();
	await page.getByRole('option', { name: 'sharp_lineart.safetensors', exact: true }).click();
	expect((await added).ok()).toBe(true);
	const weight = loras.getByRole('spinbutton', { name: 'Weight of sharp_lineart.safetensors', exact: true });
	await expect(weight).toHaveValue('1');
	const stepped = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/scenes/${LIGHTHOUSE.sceneIds[2]}`));
	await weight.press('ArrowDown');
	expect((await stepped).ok()).toBe(true);
	await expect(weight).toHaveValue('0.95');

	const scene = (await backendStory(backend, LIGHTHOUSE.id)).scenes[2];
	expect(scene).toMatchObject({ beat: 'The boat comes home', shot: 'wide shot, from above', setting: 'harbor at sunrise', mood: 'relief', loras: [{ id: 'sharp-lineart-safetensors', weight: 0.95 }] });
	await expectNoHorizontalOverflow(details);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'scene-flow-and-loras');

	const removed = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/scenes/${LIGHTHOUSE.sceneIds[2]}`));
	await loras.getByRole('button', { name: 'Remove sharp_lineart.safetensors', exact: true }).click();
	expect((await removed).ok()).toBe(true);
	expect((await backendStory(backend, LIGHTHOUSE.id)).scenes[2].loras).toEqual([]);
});

test.describe('in the smallest window', () => {
	test.use({ viewport: SMALL_VIEWPORT });

	test('removes a variant from a scene: the picture falls back to another, the output is kept', async ({ app, page, backend }, testInfo) => {
		const story = new StoryDriver(app);
		await app.open();
		await story.open();
		const details = await story.openScene(2, LIGHTHOUSE.scenes[1]);
		const before = (await backendStory(backend, LIGHTHOUSE.id)).scenes[1];
		const chosen = before.chosen_output_id!;
		await expect(details.getByRole('button', { name: sceneVariantName(chosen), exact: true })).toHaveAttribute('aria-pressed', 'true');
		await expectPicturesLoaded(details);
		await expectNoPageOverflow(page);
		await app.parkPointer({ blur: true });
		await saveScreenshot(page, testInfo, 'scene-variants-1280x720');

		const removed = page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().includes(`/variants/${chosen}`));
		await details.getByRole('button', { name: removeVariantName(chosen), exact: true }).click();
		expect((await removed).ok()).toBe(true);

		const after = (await backendStory(backend, LIGHTHOUSE.id)).scenes[1];
		expect(after.variants.map((variant) => variant.output_id)).toEqual(before.variants.map((variant) => variant.output_id).filter((id) => id !== chosen));
		expect(after.chosen_output_id).toBe(after.variants.at(-1)?.output_id ?? null);
		expect((await backendOutput(backend, chosen)).output_id).toBe(chosen);
		await expect(details.getByRole('button', { name: sceneVariantName(chosen), exact: true })).toHaveCount(0);
		await expect(details.getByRole('group', { name: new RegExp(`^${STORY_LABELS.variants}`) })).toBeFocused();
	});
});
