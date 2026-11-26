// The Models section's online search in the real browser on the synthetic Civitai: the default results as a grid of
// compact cards with readable badges, search as you type, the type / base model / sort / NSFW filters, the detail
// panel of a model (version picker, files, trigger words, page link) next to the grid with its keyboard contract
// (heading focused, Escape / Close back to the card), the status of every kind of result, the loading and error
// states, and the layout in the smallest supported window.
import { expectBaseline } from '../support/baselines';
import { expectPicturesLoaded } from '../support/app';
import { expectReadable } from '../support/colors';
import { SMALL_VIEWPORT } from '../support/env';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, boxOf, expectNoHorizontalOverflow, expectOnTop } from '../support/visibility';
import {
	DEFAULT_RESULTS,
	dropdownOption,
	dropdownPopup,
	expectPreviewFillsCard,
	modelDetail,
	openModel,
	openModels,
	pickOptions,
	resultCard,
	resultList,
	resultNames,
	searchBox,
	searchFor,
	statusBadge,
} from './modelLibrary';

const EMPTY_DETAIL = 'Pick a model to see its versions, files and trigger words';

test('the default search lists the catalog as a grid of compact cards with readable badges, previews and actions', async ({ app, page }, testInfo) => {
	const section = await openModels(app);
	await assertAppVisible(page);
	expect(await resultNames(section)).toEqual(DEFAULT_RESULTS);
	await expect(section.getByRole('heading', { name: 'Models', level: 1 })).toBeVisible();

	const aurora = resultCard(section, 'Aurora XL');
	await expect(aurora.getByText('by aurora-team · 120,400 downloads')).toBeVisible();
	await expect(aurora.getByText('Checkpoint', { exact: true })).toBeVisible();
	await expect(aurora.getByText('SDXL 1.0', { exact: true })).toBeVisible();
	await expectOnTop(aurora.getByRole('button', { name: 'Download and use' }));
	// Compact: the version picker, the files and the trigger words are the detail panel's.
	await expect(aurora.getByRole('combobox', { name: 'Version' })).toHaveCount(0);
	await expectPicturesLoaded(resultList(section));
	await expectPreviewFillsCard(aurora);

	// A grid: the first cards share a row.
	const [first, second] = [await boxOf(aurora), await boxOf(resultCard(section, 'Dreamline 1.5'))];
	expect(Math.abs(first.y - second.y), 'the first two cards on one row').toBeLessThan(1);
	expect(second.x).toBeGreaterThan(first.x + first.width);

	// Nothing picked yet: the detail panel says what it shows.
	await expect(modelDetail(section).getByRole('heading', { name: EMPTY_DETAIL })).toBeVisible();
	await expectReadable(modelDetail(section).getByText(/Download and use/));
	// Every badge (kind, base model, status) reads in this theme.
	await expectReadable(resultList(section).locator('.fui-Badge'));
	await expectReadable(section.getByText(/ downloads$/));

	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'models');
	await expectBaseline(section.getByRole('region', { name: 'Model search results' }), 'model-results.png');
});

test('searches as the user types', async ({ app }) => {
	const section = await openModels(app);
	await searchFor(section, 'pixel', ['Pixel Forge Style']);
	// Tags and creators match too, case-insensitively.
	await searchFor(section, 'LIGHTING', ['Neon Rim Light', 'Flux Glow']);
	await searchFor(section, 'e2e-studio', ['Pixel Forge Style', 'Moonlit Night']);
	await searchFor(section, 'no such model', []);
	await expect(section.getByText('No models match this search.')).toBeVisible();
	await searchBox(section).clear();
	await expect.poll(() => resultNames(section)).toEqual(DEFAULT_RESULTS);
});

test('Ctrl+F focuses the search box of the Models section', async ({ app, page }) => {
	const section = await openModels(app);
	await resultCard(section, 'Aurora XL').getByRole('button', { name: 'Aurora XL' }).focus();
	await page.keyboard.press('Control+f');
	await expect(searchBox(section)).toBeFocused();
});

test('filters by type, base model, sort and NSFW', async ({ app, page }, testInfo) => {
	const section = await openModels(app);
	const filters = section.getByRole('group', { name: 'Model filters' });

	await pickOptions(page, filters, 'Type', ['Checkpoint']);
	await expect(filters.getByRole('combobox', { name: 'Type' })).toHaveText('Checkpoint');
	await expect.poll(() => resultNames(section)).toEqual(['Aurora XL', 'Dreamline 1.5']);

	await pickOptions(page, filters, 'Type', ['LoRA']);
	await expect(filters.getByRole('combobox', { name: 'Type' })).toHaveText('Checkpoint, LoRA');
	await pickOptions(page, filters, 'Base model', ['SD 1.5']);
	await expect.poll(() => resultNames(section)).toEqual(['Dreamline 1.5', 'Pixel Forge Style', 'Watercolor Wash', 'Legacy Ink Lines']);
	// A model listed for one of its versions shows that version (Pixel Forge v1.0 is the SD 1.5 one).
	await expect(resultCard(section, 'Pixel Forge Style').getByText('SD 1.5', { exact: true })).toBeVisible();
	const detail = await openModel(section, 'Pixel Forge Style');
	await expect(detail.getByRole('combobox', { name: 'Version' })).toHaveText('v1.0');

	// The base models the local runtime cannot load say so in the list.
	const baseModels = filters.getByRole('combobox', { name: 'Base model' });
	await baseModels.click();
	const popup = await dropdownPopup(page, baseModels);
	await expect(dropdownOption(popup, /Flux\.1 D/)).toContainText('Not supported locally');
	await expectReadable(popup.getByText('Not supported locally'));
	await expectOnTop(popup);
	await saveScreenshot(page, testInfo, 'base-model-options');
	await page.keyboard.press('Escape');

	const request = page.waitForRequest((candidate) => candidate.url().includes('/api/models/search') && candidate.url().includes('sort=newest'));
	await pickOptions(page, filters, 'Sort by', ['Newest']);
	await request;
	await expect(filters.getByRole('combobox', { name: 'Sort by' })).toHaveText('Newest');

	await pickOptions(page, filters, 'Type', ['Checkpoint', 'LoRA']);
	await pickOptions(page, filters, 'Base model', ['SD 1.5']);
	await expect.poll(() => resultNames(section)).toEqual(DEFAULT_RESULTS);

	// NSFW models are hidden until asked for, and marked.
	await filters.getByRole('switch', { name: 'Show NSFW' }).check();
	await expect.poll(() => resultNames(section)).toEqual([...DEFAULT_RESULTS, 'Velvet Noir']);
	const noir = resultCard(section, 'Velvet Noir');
	await expect(noir.getByText('NSFW', { exact: true })).toBeVisible();
	await expectReadable(noir.locator('.fui-Badge'));
	await filters.getByRole('switch', { name: 'Show NSFW' }).uncheck();
	await expect.poll(() => resultNames(section)).toEqual(DEFAULT_RESULTS);
});

test('the detail panel shows the picked version, its files and trigger words, and its version picker drives the card', async ({ app, page }, testInfo) => {
	const section = await openModels(app);
	const card = resultCard(section, 'Pixel Forge Style');
	const detail = await openModel(section, 'Pixel Forge Style');
	await assertAppVisible(page);

	// The grid stays next to the panel; the shown card is marked.
	await expect(resultList(section)).toBeVisible();
	await expect(card.getByRole('button', { name: 'Pixel Forge Style' })).toHaveAttribute('aria-current', 'true');

	await expect(detail.getByRole('img', { name: 'Preview of Pixel Forge Style v2.0' })).toBeVisible();
	await expect(detail.getByText('by e2e-studio · 48,210 downloads')).toBeVisible();
	await expect(detail.getByRole('combobox', { name: 'Version' })).toHaveText('v2.0');
	await expect(detail.getByText('Illustrious', { exact: true })).toBeVisible();
	await expect(detail.getByRole('list', { name: 'Trigger words' }).getByRole('listitem')).toHaveText(['pixel art', 'dithering']);
	const files = detail.getByRole('list', { name: 'Files of this version' }).getByRole('listitem');
	await expect(files).toHaveCount(1);
	await expect(files.first()).toContainText('6.0 MB');
	await expect(files.first()).toContainText('Default file');
	await expect(detail.getByRole('link', { name: /Open on civitai\.com/ })).toHaveAttribute('href', /civitai\.com\/models\/910001/);
	await expectOnTop(detail.getByRole('button', { name: 'Download and use' }));
	await expectPicturesLoaded(detail);
	await expectReadable(detail.locator('.fui-Badge'));
	await expectReadable(detail.getByText('by e2e-studio · 48,210 downloads'));

	await app.parkPointer();
	await saveScreenshot(page, testInfo, 'detail');
	await expectBaseline(detail, 'model-detail.png');

	const versions = detail.getByRole('combobox', { name: 'Version' });
	await versions.click();
	const popup = await dropdownPopup(page, versions);
	await expect(popup.getByRole('option')).toHaveText(['v2.0', 'v1.0']);
	await dropdownOption(popup, 'v1.0').click();
	await expect(versions).toHaveText('v1.0');
	await expect(detail.getByText('SD 1.5', { exact: true })).toBeVisible();
	await expect(detail.getByRole('list', { name: 'Trigger words' }).getByRole('listitem')).toHaveText(['pixel art']);
	// The card shows the version picked in the panel.
	await expect(card.getByText('SD 1.5', { exact: true })).toBeVisible();
	await expect(card.getByRole('img', { name: 'Pixel Forge Style' })).toHaveAttribute('src', /940003/);
	await app.parkPointer();
	await saveScreenshot(section, testInfo, 'version-1.0');
});

test('the detail panel opens from the keyboard; Escape and Close return the focus to the card', async ({ app, page }) => {
	const section = await openModels(app);
	const auroraName = resultCard(section, 'Aurora XL').getByRole('button', { name: 'Aurora XL', exact: true });
	await auroraName.focus();
	await page.keyboard.press('Enter');
	const detail = modelDetail(section);
	await expect(detail.getByRole('heading', { name: 'Aurora XL', level: 2 })).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(detail.getByRole('button', { name: 'Close details' })).toBeFocused();
	await page.keyboard.press('Tab');
	await page.keyboard.press('Escape');
	await expect(auroraName).toBeFocused();
	await expect(detail.getByRole('heading', { name: EMPTY_DETAIL })).toBeVisible();

	const opened = await openModel(section, 'Neon Rim Light');
	await opened.getByRole('button', { name: 'Close details' }).click();
	await expect(resultCard(section, 'Neon Rim Light').getByRole('button', { name: 'Neon Rim Light', exact: true })).toBeFocused();
	await assertAppVisible(page);
});

test('each result shows its status and the matching action', async ({ app }, testInfo) => {
	const section = await openModels(app);

	// Nothing local: no status badge, 'Download and use'.
	const aurora = resultCard(section, 'Aurora XL');
	await expect(aurora.getByRole('button', { name: 'Download and use' })).toBeEnabled();
	for (const label of ['In library', 'On disk', 'Selected', 'Not supported', 'Failed', 'Downloading']) {
		await expect(statusBadge(aurora, label)).toHaveCount(0);
	}

	// In the library (not selected): 'In library' + 'Use'.
	const dreamline = resultCard(section, 'Dreamline 1.5');
	await expect(statusBadge(dreamline, 'In library')).toBeVisible();
	await expect(dreamline.getByRole('button', { name: 'Use', exact: true })).toBeVisible();

	// In the library and selected for generation: 'Selected'.
	const watercolor = resultCard(section, 'Watercolor Wash');
	await expect(statusBadge(watercolor, 'Selected')).toBeVisible();

	// On disk, not in the library yet: 'On disk' + 'Use'.
	const neon = resultCard(section, 'Neon Rim Light');
	await expect(statusBadge(neon, 'On disk')).toBeVisible();
	await expect(neon.getByRole('button', { name: 'Use', exact: true })).toBeVisible();

	// A base model the runtime cannot load, and a pickle file: 'Not supported', disabled, with the reason.
	const flux = resultCard(section, 'Flux Glow');
	await expect(statusBadge(flux, 'Not supported')).toBeVisible();
	await expect(flux.getByRole('button', { name: 'Download and use' })).toBeDisabled();
	await expect(flux.getByText("Base model 'Flux.1 D' is not supported by the local runtime.")).toBeVisible();
	const legacy = resultCard(section, 'Legacy Ink Lines');
	await expect(statusBadge(legacy, 'Not supported')).toBeVisible();
	await expect(legacy.getByRole('button', { name: 'Download and use' })).toBeDisabled();
	await expect(legacy.getByText(/only SafeTensors files are downloaded/)).toBeVisible();
	await expectReadable(legacy.getByText(/only SafeTensors files are downloaded/));

	for (const [card, name] of [
		[dreamline, 'in-library'],
		[watercolor, 'selected'],
		[neon, 'on-disk'],
		[flux, 'not-supported'],
		[legacy, 'refused-pickle'],
	] as const) {
		await card.scrollIntoViewIfNeeded();
		await saveScreenshot(card, testInfo, name);
	}

	// The detail panel says the same.
	const detail = await openModel(section, 'Flux Glow');
	await expect(statusBadge(detail, 'Not supported')).toBeVisible();
	await expect(detail.getByRole('button', { name: 'Download and use' })).toBeDisabled();
	await expect(detail.getByText("Base model 'Flux.1 D' is not supported by the local runtime.")).toBeVisible();
});

test.describe('in the smallest supported window', () => {
	test.use({ viewport: SMALL_VIEWPORT });

	test('the results keep two card columns next to a 360-560 px detail panel, nothing cut off', async ({ app, page }, testInfo) => {
		const section = await openModels(app);
		await openModel(section, 'Aurora XL');
		await assertAppVisible(page);

		const results = section.getByRole('region', { name: 'Model search results' });
		const detail = modelDetail(section);
		expect((await boxOf(results)).width).toBeGreaterThanOrEqual(600);
		const detailWidth = (await boxOf(detail)).width;
		expect(detailWidth).toBeGreaterThanOrEqual(360);
		expect(detailWidth).toBeLessThanOrEqual(560);
		const [first, second] = [await boxOf(resultCard(section, 'Aurora XL')), await boxOf(resultCard(section, 'Dreamline 1.5'))];
		expect(Math.abs(first.y - second.y), 'two cards on a row').toBeLessThan(1);

		await expectOnTop(section.getByRole('searchbox', { name: 'Search models' }));
		await expectOnTop(section.getByRole('group', { name: 'Model filters' }).getByRole('switch', { name: 'Show NSFW' }));
		await expectOnTop(resultCard(section, 'Aurora XL').getByRole('button', { name: 'Download and use' }));
		await expectOnTop(detail.getByRole('button', { name: 'Download and use' }));
		await expectNoHorizontalOverflow(results);
		await expectNoHorizontalOverflow(detail);
		await expectReadable(resultList(section).locator('.fui-Badge'));
		await app.parkPointer();
		await saveScreenshot(page, testInfo, 'small-window');
	});
});

test.describe('while Civitai answers slowly', () => {
	test.use({ e2eOptions: { network: { civitai_delay_ms: 2500 } } });

	test('a spinner shows the search running, then the results replace it', async ({ app, page }, testInfo) => {
		await app.open();
		const section = await app.goTo('models');
		const spinner = section.getByText('Searching models…');
		await expect(spinner).toBeVisible();
		// A deliberately plain state (a spinner on an empty grid): nearly one color in the light theme.
		await saveScreenshot(section, testInfo, 'loading', { allowUniform: true });
		await expect(resultList(section)).toBeVisible({ timeout: 15_000 });
		await expect(spinner).toBeHidden();
		await assertAppVisible(page);
	});
});

test.describe('when Civitai fails', () => {
	test.use({ e2eOptions: { network: { civitai_error_status: 503 } } });

	test('the search error says why and Retry searches again once Civitai answers', async ({ app, page, backend, diagnostics }, testInfo) => {
		// The browser logs the failed API answers of this test.
		diagnostics.allow(/Failed to load resource/);
		await app.open();
		const section = await app.goTo('models');
		const error = section.getByText('Search failed');
		await expect(error).toBeVisible();
		await expect(section.getByText(/HTTP 503/)).toBeVisible();
		await expectReadable(section.getByText(/HTTP 503/));
		await assertAppVisible(page);
		await app.parkPointer();
		await saveScreenshot(section, testInfo, 'error');

		// Civitai answers again (a fresh backend on the same port): Retry lists the results.
		await backend.reset();
		await section.getByRole('button', { name: 'Retry' }).click();
		await expect(error).toBeHidden();
		await expect.poll(() => resultNames(section)).toEqual(DEFAULT_RESULTS);
	});
});
