// Journey: compose, generate, review, in the real app. On the board, the user rewrites a sub-prompt of the Mood card
// and locks it, sets an image seed in the generation panel, presses Generate, then reviews the new output: the picture
// in the viewer and the filmstrip, its Details (seed), its Used sub-prompts (the rewritten Mood), the board row it used
// (highlighted), Copy prompt, and Delete then Undo. Each step is checked visible in the real browser and screenshotted.
import { ACTION_COLORS, STATE_COLORS } from '../../src/ui/stateColors';
import { scrollSectionIntoView } from '../generation/generationPane';
import {
	backendOutputIds,
	expectCurrentOutput,
	filmstripOption,
	imageOf,
	navigationButton,
	outputDetail,
	viewerRegion,
} from '../outputs/outputBrowser';
import { notifications } from '../support/app';
import { expectBaseline } from '../support/baselines';
import { computedStyle, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';

const MOOD = 'smiling, looking at viewer';
const FIXTURE_IDS = ['0000000001', '0000000002', '0000000003', '0000000004'];

test('compose on the board, generate with a seed, review the output, copy its prompt, delete and undo', async ({ app, page, backend }, testInfo) => {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await app.open();
	await assertAppVisible(page);

	// Compose: rewrite the Mood card's 'smiling' and lock it, so the next generation uses it.
	const mood = app.categoryCard('Mood');
	await mood.scrollIntoViewIfNeeded();
	await mood.getByRole('button', { name: 'Sub-prompt: smiling', exact: true }).click();
	const editor = mood.getByRole('textbox', { name: 'Sub-prompt', exact: true });
	await editor.fill(MOOD);
	await editor.press('Enter');
	const row = mood.getByRole('listitem').filter({ has: page.getByRole('button', { name: `Sub-prompt: ${MOOD}`, exact: true }) });
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Lock sub-prompt' }).click();
	await expect(row.getByRole('button', { name: 'Lock sub-prompt' })).toHaveAttribute('aria-pressed', 'true');

	// Set the image seed.
	const seeds = await scrollSectionIntoView(app, 'Seeds');
	const imageSeed = seeds.getByRole('textbox', { name: 'Image seed' });
	await imageSeed.fill('777000');
	await app.parkPointer({ blur: true });
	await expectOnTop(app.generationAction('Generate'));
	await expect(app.generationAction('Generate')).toHaveCSS('background-color', await resolveColor(page, ACTION_COLORS.primary.background));
	await saveScreenshot(page, testInfo, '1-composed');

	// Generate: the new output is shown in the viewer and selected in the filmstrip.
	const created = await generateOutput(app, backend);
	expect(created).toBe('0000000005');
	await expectCurrentOutput(app, created, '5 / 5');
	await expect(filmstripOption(app, created)).toHaveAttribute('aria-selected', 'true');
	await expectOnTop(filmstripOption(app, created));
	await expect(imageSeed).toHaveValue('777001');
	await app.settle();
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, '2-generated');

	// Review: the details of the output...
	await app.showViewerTab('Details');
	await expect(outputDetail(app, 'Output')).toHaveText(`#${created}`);
	await expect(outputDetail(app, 'Seed')).toHaveText('777000');
	await expect(outputDetail(app, 'Prompt')).toContainText(MOOD);
	await app.parkPointer({ blur: true });
	await expectBaseline(viewerRegion(app), 'reviewed-output.png');

	// ...what each category contributed (the rewritten Mood), and the board row it used.
	await app.showViewerTab('Used sub-prompts');
	const used = app.usedSubPrompts();
	const usedMood = used.getByRole('listitem', { name: `Mood: ${MOOD}`, exact: true });
	await expect(usedMood).toBeVisible();
	await expect(used.getByRole('listitem', { name: 'Subject: 1girl, silver hair', exact: true })).toBeVisible();
	await expectOnTop(usedMood.getByRole('button', { name: 'Copy sub-prompt' }));
	const current = mood.locator('[aria-current="true"]');
	await expect(current).toHaveCount(1);
	await expect(current).toContainText(MOOD);
	// The highlighted row is drawn in the 'current' state color (or its stronger lock state: the row is locked).
	const border = await computedStyle(current, 'border-top-color');
	expect([await resolveColor(page, STATE_COLORS.current.border), await resolveColor(page, STATE_COLORS.locked.border)]).toContain(border);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, '3-reviewed');

	// Copy prompt: the full prompt of the output.
	await navigationButton(app, 'Copy prompt').click();
	await expect(notifications(page).getByText('Prompt copied to the clipboard.')).toBeVisible();
	const record = await backend.get<{ prompt: string }>(`/api/outputs/${created}`);
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(record.prompt);
	expect(record.prompt).toContain(MOOD);
	await notifications(page).getByRole('button', { name: 'Dismiss' }).click();

	// Delete, then Undo: the output goes to the trash and comes back.
	await navigationButton(app, 'Delete').click();
	await expect.poll(() => backendOutputIds(backend)).toEqual(FIXTURE_IDS);
	await expectCurrentOutput(app, '0000000004', '4 / 4');
	await expect(filmstripOption(app, created)).toHaveCount(0);
	await app.parkPointer({ blur: true });
	await saveScreenshot(viewerRegion(app), testInfo, '4-deleted');

	await navigationButton(app, 'Undo').click();

	await expect.poll(() => backendOutputIds(backend)).toEqual([...FIXTURE_IDS, created]);
	await expectCurrentOutput(app, created, '5 / 5');
	await expect(imageOf(app, created)).toBeVisible();
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, '5-restored');
});
