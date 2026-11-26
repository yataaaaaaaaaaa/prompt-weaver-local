// The output filmstrip of the viewer in the real app: the thumbnails (the backend's small WebP copies) load and are
// drawn, clicking one shows its output, the arrow keys / Home / End inside the listbox move the current output with the
// focus, 'Jump to latest' comes back to the newest output, the current thumbnail is scrolled into view, and a long
// history only renders a window of thumbnails. 40 synthetic outputs follow the fixture's four (extraOutputFiles).
import { FILMSTRIP_RADIUS } from '../../src/domain/outputs';
import { STATE_COLORS } from '../../src/ui/stateColors';
import { expectPicturesLoaded } from '../support/app';
import { STORE_NAMES, storeFile } from '../support/backend';
import { expectBaseline } from '../support/baselines';
import { computedStyle, contrastRatio, MIN_GRAPHICS_CONTRAST, paintedBackground, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectOnTop } from '../support/visibility';
import { expectCurrentOutput, extraOutputFiles, filmstrip, filmstripOption, imageOf, navigationButton, viewerRegion } from './outputBrowser';

const id = (value: number) => String(value).padStart(10, '0');

test('the thumbnails load and show the outputs; a click shows its output', async ({ app, page }, testInfo) => {
	await app.open();
	const strip = filmstrip(app);
	await expect(strip).toHaveAttribute('aria-orientation', 'horizontal');
	await expect(strip.getByRole('option')).toHaveCount(4);
	await expectPicturesLoaded(strip);
	// Each thumbnail is a real, drawn picture (the WebP thumbnail of its output), never a second 'Output <id>' image.
	const thumbnails = await strip.locator('img').evaluateAll((images) =>
		images.map((image) => ({
			src: (image as HTMLImageElement).currentSrc,
			alt: image.getAttribute('alt'),
			natural: (image as HTMLImageElement).naturalWidth,
			drawn: image.getBoundingClientRect().width,
		})),
	);
	expect(thumbnails).toHaveLength(4);
	for (const thumbnail of thumbnails) {
		expect(thumbnail.src).toMatch(/\/api\/outputs\/\d{10}\/thumbnail$/);
		expect(thumbnail.alt).toBe('');
		expect(thumbnail.natural).toBeGreaterThan(0);
		expect(thumbnail.natural).toBeLessThanOrEqual(256);
		expect(thumbnail.drawn).toBeGreaterThan(40);
	}
	await expect(viewerRegion(app).getByRole('img', { name: /^Output / })).toHaveCount(1);
	// The current thumbnail: the 'current' frame of the state colors, a visible boundary.
	const current = filmstripOption(app, '0000000004');
	await expect(current).toHaveAttribute('aria-selected', 'true');
	await expect(current).toHaveCSS('border-top-color', await resolveColor(page, STATE_COLORS.current.border));
	expect(contrastRatio(await computedStyle(current, 'border-top-color'), await paintedBackground(strip)), 'contrast of the current frame').toBeGreaterThanOrEqual(
		MIN_GRAPHICS_CONTRAST,
	);
	await app.parkPointer({ blur: true });
	await saveScreenshot(strip, testInfo, 'filmstrip');
	await expectBaseline(strip, 'filmstrip.png');

	await filmstripOption(app, '0000000002').click();

	await expectCurrentOutput(app, '0000000002', '2 / 4');
	await expect(current).toHaveAttribute('aria-selected', 'false');
	await assertAppVisible(page);
});

test('inside the filmstrip the arrow keys, Home and End move the current output and the focus follows', async ({ app, page }, testInfo) => {
	await app.open();
	await filmstripOption(app, '0000000004').focus();

	await page.keyboard.press('ArrowLeft');
	await expectCurrentOutput(app, '0000000003', '3 / 4');
	await expect(filmstripOption(app, '0000000003')).toBeFocused();
	await page.keyboard.press('Home');
	await expectCurrentOutput(app, '0000000001', '1 / 4');
	await expect(filmstripOption(app, '0000000001')).toBeFocused();
	await page.keyboard.press('ArrowRight');
	await expectCurrentOutput(app, '0000000002', '2 / 4');
	await expect(filmstripOption(app, '0000000002')).toBeFocused();
	// The focus ring of the focused thumbnail is visible.
	await expect(filmstripOption(app, '0000000002')).not.toHaveCSS('outline-style', 'none');
	await saveScreenshot(filmstrip(app), testInfo, 'filmstrip-focus');
	await page.keyboard.press('End');
	await expectCurrentOutput(app, '0000000004', '4 / 4');
	await expect(filmstripOption(app, '0000000004')).toBeFocused();
	// Tab leaves the listbox in one press (roving tabindex: one tab stop).
	await page.keyboard.press('Shift+Tab');
	await expect(filmstrip(app).getByRole('option').filter({ has: page.locator(':focus') })).toHaveCount(0);
});

test.describe('a long history', () => {
	// The newest output is the one shown at startup (the persisted current output).
	test.use({ e2eOptions: { files: { ...extraOutputFiles(40), ...storeFile(STORE_NAMES.outputs, { currentId: id(44) }, 1) } } });

	test('renders a window of thumbnails around the current output, scrolled into view; Jump to latest comes back', async ({ app, page }, testInfo) => {
		await app.open();
		const strip = filmstrip(app);
		await expectCurrentOutput(app, id(44), '44 / 44');
		await expect(strip.getByRole('option')).toHaveCount(2 * FILMSTRIP_RADIUS + 1);
		await expect(viewerRegion(app).getByRole('button', { name: 'Jump to latest' })).toHaveCount(0);
		await expectOnTop(filmstripOption(app, id(44)));
		await expectPicturesLoaded(strip);

		await navigationButton(app, 'First output').click();

		await expectCurrentOutput(app, id(1), '1 / 44');
		await expect(strip.getByRole('option').first()).toHaveAccessibleName(`Output ${id(1)}`);
		await expect(strip.getByRole('option')).toHaveCount(2 * FILMSTRIP_RADIUS + 1);
		await expectOnTop(filmstripOption(app, id(1)));
		await expect(filmstripOption(app, id(44))).toHaveCount(0);

		// A thumbnail in the middle of the history: centered in the strip, the window around it.
		await filmstripOption(app, id(10)).click();
		await expectCurrentOutput(app, id(10), '10 / 44');
		await expect(filmstripOption(app, id(25))).toHaveCount(1);
		await filmstripOption(app, id(20)).click();
		await expectCurrentOutput(app, id(20), '20 / 44');
		const stripBox = await boxOf(strip);
		const currentBox = await boxOf(filmstripOption(app, id(20)));
		expect(Math.abs(currentBox.x + currentBox.width / 2 - (stripBox.x + stripBox.width / 2)), 'the current thumbnail is centered').toBeLessThan(40);
		await expectOnTop(filmstripOption(app, id(20)));
		const jump = viewerRegion(app).getByRole('button', { name: 'Jump to latest', exact: true });
		await expectOnTop(jump);
		await app.parkPointer({ blur: true });
		await saveScreenshot(viewerRegion(app), testInfo, 'filmstrip-long-history');

		await jump.click();

		await expectCurrentOutput(app, id(44), '44 / 44');
		await expect(jump).toHaveCount(0);
		await expectOnTop(filmstripOption(app, id(44)));
		await expect(imageOf(app, id(44))).toBeVisible();
		await assertAppVisible(page);
	});
});
