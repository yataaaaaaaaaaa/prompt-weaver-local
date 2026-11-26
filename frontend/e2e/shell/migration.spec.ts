// The layout migration in the real browser: a data directory of the floating-window version (the fixture's legacy
// 'workspace-store' v0, without 'layout-store' and 'board-store') opens docked. The Image and Generation pane widths
// (420 px each) become the viewer and generation panel widths; the category windows, read top-to-bottom then
// left-to-right, give the board order; the closed Model library / Image library / Characters panes change nothing in
// Create. The legacy file is only read: the next layout change writes 'layout-store' and leaves it untouched.
import { LEGACY_STORE_NAMES } from '../../src/persistence/storeNames';
import { fixtureStore } from '../support/backend';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { expectDockedLayout, savedLayout, splitterValue } from '../support/shell';
import { assertAppVisible } from '../support/visibility';

/** The fixture's category windows by position: (16: subject, background), (284: outfit, weather effects),
 *  (512: lighting), (592: mood), (740: sea creatures). */
const MIGRATED_ORDER = ['Subject', 'Background', 'Outfit', 'Weather effects', 'Lighting', 'Mood', 'Sea creatures'];

test.use({ e2eOptions: { remove: ['stores/board-store', 'stores/layout-store'] } });

test('a legacy floating workspace opens docked, with its pane widths and its windows in reading order', async ({ app, backend, page }, testInfo) => {
	const legacy = fixtureStore<Record<string, unknown>>(LEGACY_STORE_NAMES.workspace);
	await app.open();
	await assertAppVisible(page);

	await expect(app.splitter('viewer')).toHaveAttribute('aria-valuenow', '420');
	await expect(app.splitter('generation')).toHaveAttribute('aria-valuenow', '420');
	for (const region of ['board', 'viewer', 'generation'] as const) {
		await expect(app.createRegion(region)).not.toHaveAttribute('data-collapsed', 'true');
	}
	await expectDockedLayout(app);

	const cards = app.createRegion('board').getByRole('article');
	await expect(cards).toHaveCount(MIGRATED_ORDER.length);
	const names = await cards.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? ''));
	expect(names).toEqual(MIGRATED_ORDER.map((name) => `${name} category`));
	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'migrated');

	// The first layout change is saved as layout-store; the legacy workspace-store stays as it was.
	const start = await splitterValue(app.splitter('viewer'));
	const saved = savedLayout(page, (layout) => layout.widths.viewer === start + 16);
	await app.splitter('viewer').focus();
	await page.keyboard.press('ArrowLeft');
	expect(await saved).toMatchObject({ widths: { viewer: 436, generation: 420 } });
	const { envelope } = await backend.get<{ envelope: unknown }>(`/api/stores/${LEGACY_STORE_NAMES.workspace}`);
	expect(envelope).toEqual(legacy);
});
