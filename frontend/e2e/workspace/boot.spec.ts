// The boot screen in the real browser: the spinner while the backend has not answered, the startup error after the
// 15 s retry window (src/stores/sessionStore.ts BOOTSTRAP_TIMEOUT_MS) when it keeps failing, and Retry booting the
// app once the backend answers.
import { expectBaseline } from '../support/baselines';
import { expect, test } from '../support/fixtures';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';

const BOOTSTRAP = '**/api/bootstrap';
/** Past the session store's retry window (15 s). */
const PAST_RETRY_WINDOW_MS = 16_000;

test('a spinner shows until the backend answers, then the workspace', async ({ app, page }, testInfo) => {
	let release: () => void = () => undefined;
	const answered = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route(BOOTSTRAP, async (route) => {
		await answered;
		await route.fallback();
	});
	await page.goto('/');

	const connecting = page.getByRole('main').getByRole('status');
	const spinner = connecting.getByText('Connecting to the backend…');
	await expect(spinner).toBeVisible();
	await expect(connecting.getByRole('heading', { name: 'Prompt Weaver' })).toBeVisible();
	await expectOnTop(connecting);
	await saveScreenshot(page, testInfo, 'boot-spinner', { allowUniform: true });
	// The content, not the (nearly empty) page: the tolerance is relative to the picture's size.
	await expectBaseline(connecting, 'boot-spinner.png');

	release();
	await expect(app.workspace()).toBeVisible({ timeout: 30_000 });
	await expect(spinner).toHaveCount(0);
	await app.settle();
	await assertAppVisible(page);
});

test('a backend that keeps failing shows the startup error, and Retry boots once it answers', async ({ app, page, diagnostics }, testInfo) => {
	diagnostics.allow(/status of 500/);
	// The 15 s retry window passes on the page's clock instead of in real time.
	await page.clock.install();
	await page.route(BOOTSTRAP, (route) =>
		route.fulfill({
			status: 500,
			contentType: 'application/json',
			headers: { 'access-control-allow-origin': '*' },
			body: JSON.stringify({ detail: 'The backend is still starting (e2e).' }),
		}),
	);
	const firstAttempt = page.waitForRequest(BOOTSTRAP);
	await page.goto('/');
	await firstAttempt;
	await page.clock.fastForward(PAST_RETRY_WINDOW_MS);

	const failure = page.getByRole('alert', { name: 'Prompt Weaver could not start' });
	await expect(failure).toBeVisible();
	const details = failure.getByText(/is not reachable: The backend is still starting \(e2e\)\.$/);
	await expect(details).toBeVisible();
	const retry = failure.getByRole('button', { name: 'Retry' });
	await expectOnTop(retry);
	await saveScreenshot(page, testInfo, 'boot-failure', { allowUniform: true });
	// The message names the backend URL, whose port changes with the run: masked.
	await expectBaseline(failure, 'boot-failure.png', { mask: [details] });

	await page.unroute(BOOTSTRAP);
	await retry.click();
	await expect(app.workspace()).toBeVisible({ timeout: 30_000 });
	await app.settle();
	await assertAppVisible(page);
});
