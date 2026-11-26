// The navigation rail in the real browser: a click shows a section (aria-current, the others hidden) and keeps the
// focus on the rail; Ctrl+1..4 show a section and move the focus into it (its first region, with a visible focus
// ring); the tooltips say what each section is for and its shortcut. Baseline of the rail in both themes.
import { tokens } from '@fluentui/react-theme';
import { SECTION_DESCRIPTIONS, SECTION_IDS, SECTION_LABELS, type SectionId } from '../../src/app/sections';
import { expectBaseline } from '../support/baselines';
import { computedStyle, resolveColor } from '../support/colors';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';

const SHORTCUTS: Readonly<Record<SectionId, string>> = {
	create: 'Control+1',
	models: 'Control+2',
	images: 'Control+3',
	characters: 'Control+4',
};

test('a rail click shows its section, marks it current and keeps the focus on the rail', async ({ app, page }, testInfo) => {
	await app.open();
	await saveScreenshot(app.navigation(), testInfo, 'rail', { allowUniform: true });
	await expectBaseline(app.navigation(), 'rail.png');

	for (const section of [...SECTION_IDS.slice(1), SECTION_IDS[0]]) {
		await app.navItem(section).click();
		await expect(app.section(section)).toBeVisible();
		await expect(app.navItem(section)).toHaveAttribute('aria-current', 'page');
		await expect(app.navItem(section)).toBeFocused();
		for (const other of SECTION_IDS.filter((id) => id !== section)) {
			await expect(app.navItem(other)).toHaveAttribute('aria-current', 'false');
			await expect(app.section(other)).toBeHidden();
		}
		await app.parkPointer({ blur: true });
		await assertAppVisible(page);
	}
});

test('a click on the icon of a rail item shows its section too', async ({ app }) => {
	await app.open();
	const icon = app.navItem('images').locator('.fui-NavItem__icon');
	const box = await icon.boundingBox();
	expect(box).not.toBeNull();
	await app.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
	await expect(app.section('images')).toBeVisible();
	await expect(app.navItem('images')).toHaveAttribute('aria-current', 'page');
});

test('Ctrl+1..4 show the sections and move the focus to their first region, with a visible focus ring', async ({ app, page }, testInfo) => {
	await app.open();
	for (const section of ['models', 'images', 'characters', 'create'] as const) {
		await page.keyboard.press(SHORTCUTS[section]);
		await expect(app.section(section)).toBeVisible();
		await expect(app.navItem(section)).toHaveAttribute('aria-current', 'page');
		const focused = page.locator(':focus');
		await expect(focused).toHaveAttribute('data-f6-region', /.+/);
		expect(await focused.evaluate((element) => element.closest('main')?.getAttribute('aria-label'))).toBe(SECTION_LABELS[section]);
		expect(await computedStyle(focused, 'outline-style')).toBe('solid');
		expect(await computedStyle(focused, 'outline-color')).toBe(await resolveColor(page, tokens.colorStrokeFocus2));
	}
	await expect(page.locator(':focus')).toHaveAttribute('data-f6-region', 'commands');
	await saveScreenshot(page, testInfo, 'create-focused-from-keyboard');
});

test('the arrow keys move between the rail items, never through the outputs; Enter shows the section', async ({ app, page }) => {
	await app.open();
	const current = app.createRegion('viewer').getByRole('img', { name: 'Output 0000000004', exact: true });
	await expect(current).toBeVisible();
	await app.navItem('create').focus();
	await page.keyboard.press('ArrowDown');
	await expect(app.navItem('models')).toBeFocused();
	await page.keyboard.press('ArrowDown');
	await expect(app.navItem('images')).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(app.navItem('models')).toBeFocused();
	// The output history did not move.
	await expect(current).toBeVisible();
	await page.keyboard.press('Enter');
	await expect(app.section('models')).toBeVisible();
	await expect(app.navItem('models')).toBeFocused();
});

test('the tooltip of a rail item says what the section is for and its shortcut', async ({ app, page }, testInfo) => {
	await app.open();
	await app.navItem('models').hover();
	const tooltip = page.getByRole('tooltip');
	await expect(tooltip).toHaveText(`${SECTION_DESCRIPTIONS.models} (Ctrl+2)`);
	await expectOnTop(tooltip);
	await expect(app.navItem('models')).toHaveAttribute('aria-description', SECTION_DESCRIPTIONS.models);
	await expect(app.navItem('models')).toHaveAttribute('aria-keyshortcuts', 'Control+2');
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'rail-tooltip');
});

test('the About popover names the data directory and the backend', async ({ app, backend, page }, testInfo) => {
	await app.open();
	const { data_dir: dataDir } = await backend.state();
	await app.aboutButton().click();
	const about = page.getByRole('group', { name: 'Prompt Weaver' });
	await expect(about).toBeVisible();
	await expect(about.getByText(/^Data directory:/)).toHaveText(`Data directory: ${dataDir}`);
	await expect(about.getByText(/^Backend: http:\/\/127\.0\.0\.1:\d+$/)).toBeVisible();
	await expectOnTop(about);
	await assertAppVisible(page, { allowOverlays: true });
	await saveScreenshot(page, testInfo, 'about');
	await page.keyboard.press('Escape');
	await expect(about).toBeHidden();
});
