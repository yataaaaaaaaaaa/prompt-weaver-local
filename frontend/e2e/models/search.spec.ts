// Model library, Online tab, in the real browser on the synthetic Civitai: the default results with readable badges,
// search as you type, the type / base model / sort / NSFW filters, the version picker, the status of every kind of
// result, and the loading and error states (with Retry).
import { expectBaseline } from '../support/baselines';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import { expectPicturesLoaded } from '../support/app';
import { expectReadable } from '../support/colors';
import { MODEL_LIBRARY } from './libraries';
import {
	DEFAULT_RESULTS,
	dropdownOption,
	dropdownPopup,
	expectPreviewFillsCard,
	openModelLibrary,
	pickOptions,
	resultCard,
	resultList,
	resultNames,
	searchBox,
	searchFor,
	statusBadge,
} from './modelLibrary';

test('the default search lists the catalog with readable badges, previews and actions', async ({ app, page }, testInfo) => {
	const pane = await openModelLibrary(app);
	await assertAppVisible(page);
	expect(await resultNames(pane)).toEqual(DEFAULT_RESULTS);

	const aurora = resultCard(pane, 'Aurora XL');
	await expect(aurora.getByText('by aurora-team · 120,400 downloads')).toBeVisible();
	await expect(aurora.getByText('Checkpoint', { exact: true })).toBeVisible();
	await expect(aurora.getByText('SDXL 1.0', { exact: true })).toBeVisible();
	await expect(aurora.getByText('6.0 MB')).toBeVisible();
	await expect(aurora.getByRole('combobox', { name: 'Version' })).toHaveText('v4.0');
	await expectOnTop(aurora.getByRole('button', { name: 'Download and use' }));
	await expectPicturesLoaded(resultList(pane));
	await expectPreviewFillsCard(aurora);
	// Every badge (kind, base model, status, trigger words) reads in this theme: the 'subtle' outline badge was white
	// on the light card.
	await expectReadable(resultList(pane).locator('.fui-Badge'));
	await expectReadable(pane.getByText(/ downloads$/));

	await app.parkPointer();
	await saveScreenshot(pane, testInfo, 'results');
	await expectBaseline(pane, 'model-results.png');
});

test('searches as the user types', async ({ app }) => {
	const pane = await openModelLibrary(app);
	await searchFor(pane, 'pixel', ['Pixel Forge Style']);
	// Tags and creators match too, case-insensitively.
	await searchFor(pane, 'LIGHTING', ['Neon Rim Light', 'Flux Glow']);
	await searchFor(pane, 'e2e-studio', ['Pixel Forge Style', 'Moonlit Night']);
	await searchFor(pane, 'no such model', []);
	await expect(pane.getByText('No models match this search.')).toBeVisible();
	await searchBox(pane).clear();
	await expect.poll(() => resultNames(pane)).toEqual(DEFAULT_RESULTS);
});

test('filters by type, base model, sort and NSFW', async ({ app, page }, testInfo) => {
	const pane = await openModelLibrary(app);

	await pickOptions(page, pane, 'Type', ['Checkpoint']);
	await expect(pane.getByRole('combobox', { name: 'Type' })).toHaveText('Checkpoint');
	await expect.poll(() => resultNames(pane)).toEqual(['Aurora XL', 'Dreamline 1.5']);

	await pickOptions(page, pane, 'Type', ['LoRA']);
	await expect(pane.getByRole('combobox', { name: 'Type' })).toHaveText('Checkpoint, LoRA');
	await pickOptions(page, pane, 'Base model', ['SD 1.5']);
	await expect.poll(() => resultNames(pane)).toEqual(['Dreamline 1.5', 'Pixel Forge Style', 'Watercolor Wash', 'Legacy Ink Lines']);
	// A model listed for one of its versions shows that version.
	await expect(resultCard(pane, 'Pixel Forge Style').getByRole('combobox', { name: 'Version' })).toHaveText('v1.0');

	// The base models the local runtime cannot load say so in the list.
	const baseModels = pane.getByRole('combobox', { name: 'Base model' });
	await baseModels.click();
	const popup = await dropdownPopup(page, baseModels);
	await expect(dropdownOption(popup, /Flux\.1 D/)).toContainText('Not supported locally');
	await expectReadable(popup.getByText('Not supported locally'));
	await expectOnTop(popup);
	await saveScreenshot(page, testInfo, 'base-model-options');
	await page.keyboard.press('Escape');

	const request = page.waitForRequest((candidate) => candidate.url().includes('/api/models/search') && candidate.url().includes('sort=newest'));
	await pickOptions(page, pane, 'Sort by', ['Newest']);
	await request;
	await expect(pane.getByRole('combobox', { name: 'Sort by' })).toHaveText('Newest');

	await pickOptions(page, pane, 'Type', ['Checkpoint', 'LoRA']);
	await pickOptions(page, pane, 'Base model', ['SD 1.5']);
	await expect.poll(() => resultNames(pane)).toEqual(DEFAULT_RESULTS);

	// NSFW models are hidden until asked for, and marked.
	await pane.getByRole('switch', { name: 'Show NSFW' }).check();
	await expect.poll(() => resultNames(pane)).toEqual([...DEFAULT_RESULTS, 'Velvet Noir']);
	const noir = resultCard(pane, 'Velvet Noir');
	await expect(noir.getByText('NSFW', { exact: true })).toBeVisible();
	await expectReadable(noir.locator('.fui-Badge'));
	await pane.getByRole('switch', { name: 'Show NSFW' }).uncheck();
	await expect.poll(() => resultNames(pane)).toEqual(DEFAULT_RESULTS);
});

test('the version picker switches the version a card shows and installs', async ({ app, page }, testInfo) => {
	const pane = await openModelLibrary(app);
	await searchFor(pane, 'pixel', ['Pixel Forge Style']);
	const card = resultCard(pane, 'Pixel Forge Style');
	await expect(card.getByRole('combobox', { name: 'Version' })).toHaveText('v2.0');
	await expect(card.getByText('Illustrious', { exact: true })).toBeVisible();
	await expect(card.getByRole('list', { name: 'Trigger words' }).getByRole('listitem')).toHaveText(['pixel art', 'dithering']);

	const versions = card.getByRole('combobox', { name: 'Version' });
	await versions.click();
	const popup = await dropdownPopup(page, versions);
	await expect(popup.getByRole('option')).toHaveText(['v2.0', 'v1.0']);
	await dropdownOption(popup, 'v1.0').click();
	await expect(card.getByRole('combobox', { name: 'Version' })).toHaveText('v1.0');
	await expect(card.getByText('SD 1.5', { exact: true })).toBeVisible();
	await expect(card.getByRole('list', { name: 'Trigger words' }).getByRole('listitem')).toHaveText(['pixel art']);
	await expect(card.getByRole('img', { name: 'Pixel Forge Style' })).toHaveAttribute('src', /940003/);
	await app.parkPointer();
	await saveScreenshot(card, testInfo, 'version-1.0');
});

test('each result shows its status and the matching action', async ({ app }, testInfo) => {
	const pane = await openModelLibrary(app);

	// Nothing local: no status badge, 'Download and use'.
	const aurora = resultCard(pane, 'Aurora XL');
	await expect(aurora.getByRole('button', { name: 'Download and use' })).toBeEnabled();
	for (const label of ['In library', 'On disk', 'Selected', 'Not supported', 'Failed', 'Downloading']) {
		await expect(statusBadge(aurora, label)).toHaveCount(0);
	}

	// In the library (not selected): 'In library' + 'Use'.
	const dreamline = resultCard(pane, 'Dreamline 1.5');
	await expect(statusBadge(dreamline, 'In library')).toBeVisible();
	await expect(dreamline.getByRole('button', { name: 'Use', exact: true })).toBeVisible();

	// In the library and selected for generation: 'Selected'.
	const watercolor = resultCard(pane, 'Watercolor Wash');
	await expect(statusBadge(watercolor, 'Selected')).toBeVisible();

	// On disk, not in the library yet: 'On disk' + 'Use'.
	const neon = resultCard(pane, 'Neon Rim Light');
	await expect(statusBadge(neon, 'On disk')).toBeVisible();
	await expect(neon.getByRole('button', { name: 'Use', exact: true })).toBeVisible();

	// A base model the runtime cannot load, and a pickle file: 'Not supported', disabled, with the reason.
	const flux = resultCard(pane, 'Flux Glow');
	await expect(statusBadge(flux, 'Not supported')).toBeVisible();
	await expect(flux.getByRole('button', { name: 'Download and use' })).toBeDisabled();
	await expect(flux.getByText("Base model 'Flux.1 D' is not supported by the local runtime.")).toBeVisible();
	const legacy = resultCard(pane, 'Legacy Ink Lines');
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
});

test.describe('while Civitai answers slowly', () => {
	test.use({ e2eOptions: { network: { civitai_delay_ms: 2500 } } });

	test('a spinner shows the search running, then the results replace it', async ({ app, page }, testInfo) => {
		await app.open();
		const pane = await app.showPane(MODEL_LIBRARY);
		const spinner = pane.getByText('Searching models…');
		await expect(spinner).toBeVisible();
		await expect(pane.getByText('Loading providers…')).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
		await saveScreenshot(pane, testInfo, 'loading');
		await expect(resultList(pane)).toBeVisible({ timeout: 15_000 });
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
		const pane = await app.showPane(MODEL_LIBRARY);
		const error = pane.getByText('Search failed');
		await expect(error).toBeVisible();
		await expect(pane.getByText(/HTTP 503/)).toBeVisible();
		await expectReadable(pane.getByText(/HTTP 503/));
		await assertAppVisible(page);
		await app.parkPointer();
		await saveScreenshot(pane, testInfo, 'error');

		// Civitai answers again (a fresh backend on the same port): Retry lists the results.
		await backend.reset();
		await pane.getByRole('button', { name: 'Retry' }).click();
		await expect(error).toBeHidden();
		await expect.poll(() => resultNames(pane)).toEqual(DEFAULT_RESULTS);
	});
});
