// The docked Create layout in the real browser: the splitters resize the viewer and the generation panel by pointer
// drag and by keyboard (the board pays; min / max; persisted to layout-store), the 'Layout' toolbar toggles and the
// strips collapse and expand regions, Ctrl+H cycles the layout, everything fits a 1280 x 720 window without
// horizontal overflow, and the collapsed generation strip still generates.
import { REGION_MIN_WIDTH } from '../../src/domain/layout';
import { storeFile } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { generateOutput } from '../support/flows';
import { saveScreenshot } from '../support/screenshots';
import { expectDockedLayout, expectNoPageOverflow, savedLayout, splitterValue } from '../support/shell';
import { assertAppVisible, boxOf, expectOnTop } from '../support/visibility';

/** The fixture's current output (the viewer shows it at start). */
const CURRENT_OUTPUT = 'Output 0000000004';

test('dragging a splitter resizes its region live and stores the width on release', async ({ app, page }, testInfo) => {
	await app.open();
	const splitter = app.splitter('viewer');
	const before = await splitterValue(splitter);
	const boardBefore = await boxOf(app.createRegion('board'));
	const handle = await boxOf(splitter);
	const [x, y] = [handle.x + handle.width / 2, handle.y + handle.height / 2];

	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x - 60, y, { steps: 4 });
	await page.mouse.move(x - 120, y, { steps: 4 });
	// Live: the viewer is wider before anything is stored.
	expect(Math.round((await boxOf(app.createRegion('viewer'))).width)).toBe(before + 120);
	await expect(splitter).toHaveAttribute('aria-valuenow', String(before + 120));
	await saveScreenshot(page, testInfo, 'dragging');

	const saved = savedLayout(page, (layout) => layout.widths.viewer === before + 120);
	await page.mouse.up();
	expect((await saved).widths.viewer).toBe(before + 120);

	// The board paid for it; the generation panel kept its width.
	expect(Math.round((await boxOf(app.createRegion('board'))).width)).toBe(Math.round(boardBefore.width) - 120);
	await expectDockedLayout(app);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
});

test('a splitter moves with the keyboard, within its minimum and maximum, without browsing outputs', async ({ app, page }, testInfo) => {
	await app.open();
	const splitter = app.splitter('generation');
	const viewer = app.createRegion('viewer');
	await expect(viewer.getByRole('img', { name: CURRENT_OUTPUT, exact: true })).toBeVisible();
	const start = await splitterValue(splitter);
	await splitter.focus();

	let saved = savedLayout(page, (layout) => layout.widths.generation === start + 16);
	await page.keyboard.press('ArrowLeft');
	await saved;
	await expect(splitter).toHaveAttribute('aria-valuenow', String(start + 16));
	saved = savedLayout(page, (layout) => layout.widths.generation === start + 16 + 64);
	await page.keyboard.press('Shift+ArrowLeft');
	await saved;
	await page.keyboard.press('ArrowRight');
	await expect(splitter).toHaveAttribute('aria-valuenow', String(start + 64));
	// The arrow keys moved the splitter, never the output history.
	await expect(viewer.getByRole('img', { name: CURRENT_OUTPUT, exact: true })).toBeVisible();

	saved = savedLayout(page, (layout) => layout.widths.generation === REGION_MIN_WIDTH.generation);
	await page.keyboard.press('Home');
	await saved;
	await expect(splitter).toHaveAttribute('aria-valuenow', String(REGION_MIN_WIDTH.generation));
	expect(Math.round((await boxOf(app.createRegion('generation'))).width)).toBe(REGION_MIN_WIDTH.generation);

	const max = Number(await splitter.getAttribute('aria-valuemax'));
	await page.keyboard.press('End');
	await expect(splitter).toHaveAttribute('aria-valuenow', String(max));
	await page.keyboard.press('ArrowLeft');
	await expect(splitter).toHaveAttribute('aria-valuenow', String(max));
	await expectDockedLayout(app);
	// The focused splitter shows the Fluent focus ring.
	await saveScreenshot(page, testInfo, 'splitter-focused');
});

test('the Layout toggles and the strips collapse and expand the regions; Enter on a splitter collapses', async ({ app, page }, testInfo) => {
	await app.open();
	for (const region of ['board', 'viewer', 'generation'] as const) {
		await expect(app.regionToggle(region)).toHaveAttribute('aria-pressed', 'true');
	}

	const collapsed = savedLayout(page, (layout) => layout.collapsed.viewer);
	await app.regionToggle('viewer').click();
	await collapsed;
	await expect(app.regionToggle('viewer')).toHaveAttribute('aria-pressed', 'false');
	await expect(app.createRegion('viewer')).toHaveAttribute('data-collapsed', 'true');
	await expect(app.splitter('viewer')).toHaveCount(0);
	await expectOnTop(app.expandButton('viewer'));
	expect(Math.round((await boxOf(app.createRegion('viewer'))).width)).toBe(56);
	await expectDockedLayout(app);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'viewer-collapsed');
	await expectBaseline(app.createRegion('viewer'), 'viewer-strip.png');

	await app.expandButton('viewer').click();
	await expect(app.createRegion('viewer')).not.toHaveAttribute('data-collapsed', 'true');
	await expect(app.createRegion('viewer')).toBeFocused();

	// Enter on the generation splitter collapses the panel and puts the focus on its Expand button.
	await app.splitter('generation').focus();
	await page.keyboard.press('Enter');
	await expect(app.createRegion('generation')).toHaveAttribute('data-collapsed', 'true');
	await expect(app.expandButton('generation')).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(app.createRegion('generation')).not.toHaveAttribute('data-collapsed', 'true');
});

test('Ctrl+H cycles the Create layout: the board alone, then the image and the panel, then everything', async ({ app, page }, testInfo) => {
	await app.open();
	await page.keyboard.press('Control+h');
	await expect(app.createRegion('viewer')).toHaveAttribute('data-collapsed', 'true');
	await expect(app.createRegion('generation')).toHaveAttribute('data-collapsed', 'true');
	await expect(app.createRegion('board')).not.toHaveAttribute('data-collapsed', 'true');
	// The last region shown cannot be hidden.
	await expect(app.regionToggle('board')).toHaveAttribute('aria-disabled', 'true');
	await expectDockedLayout(app);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'board-alone');

	await page.keyboard.press('Control+h');
	await expect(app.createRegion('board')).toHaveAttribute('data-collapsed', 'true');
	await expect(app.createRegion('viewer')).not.toHaveAttribute('data-collapsed', 'true');
	await expect(app.createRegion('generation')).not.toHaveAttribute('data-collapsed', 'true');
	await expectDockedLayout(app);
	await app.parkPointer({ blur: true });
	await assertAppVisible(page);
	await saveScreenshot(page, testInfo, 'image-and-panel');

	const restored = savedLayout(page, (layout) => !layout.collapsed.board && !layout.collapsed.viewer && !layout.collapsed.generation);
	await app.layoutToolbar().getByRole('button', { name: 'Cycle the Create layout', exact: true }).click();
	await restored;
	await expect(app.createRegion('board')).not.toHaveAttribute('data-collapsed', 'true');
});

test.describe('the widest stored widths', () => {
	test.use({
		e2eOptions: {
			files: storeFile(
				'layout-store',
				{
					widths: { viewer: 1400, generation: 640 },
					collapsed: { board: false, viewer: false, generation: false },
					details: { open: true, tab: 'details' },
				},
				0,
			),
		},
	});

	test('still fit a 1280 x 720 window: no horizontal overflow, the board keeps its minimum', async ({ app, page }, testInfo) => {
		await page.setViewportSize(SMALL_VIEWPORT);
		await app.open();
		const boxes = await expectDockedLayout(app);
		await expectNoPageOverflow(page);
		expect(Math.round(boxes.board.width)).toBe(REGION_MIN_WIDTH.board);
		expect(Math.round(boxes.viewer.width)).toBeGreaterThanOrEqual(REGION_MIN_WIDTH.viewer);
		expect(Math.round(boxes.generation.width)).toBeGreaterThanOrEqual(REGION_MIN_WIDTH.generation);
		await app.parkPointer();
		await assertAppVisible(page);
		await saveScreenshot(page, testInfo, 'widest-at-1280x720');
	});
});

test('the collapsed generation panel still generates from its strip', async ({ app, backend, page }, testInfo) => {
	await app.open();
	await app.regionToggle('generation').click();
	const strip = app.createRegion('generation');
	await expect(strip).toHaveAttribute('data-collapsed', 'true');
	await expectOnTop(app.expandButton('generation'));
	const generate = strip.getByRole('button', { name: 'Generate', exact: true });
	await expectOnTop(generate);
	await app.parkPointer({ blur: true });
	await saveScreenshot(page, testInfo, 'generation-strip');

	const created = await generateOutput(app, backend);
	await expect(app.createRegion('viewer').getByRole('img', { name: `Output ${created}`, exact: true })).toBeVisible();
	await expect(strip).toHaveAttribute('data-collapsed', 'true');
});
