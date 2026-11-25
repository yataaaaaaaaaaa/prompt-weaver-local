// THE test object of every e2e spec: `import { test, expect } from '../support/fixtures'` (never from
// '@playwright/test' directly). Before each test the e2e backend is reset to fresh synthetic data (with the
// `e2eOptions` of test.use(), see backend.ts); every page gets the synthetic network (network.ts) and console /
// page error checks (diagnostics.ts); after each test the backend must not have seen a request it could not answer.
//
//   test.use({ e2eOptions: { generator: { step_delay_ms: 400 } } });
//   test('...', async ({ app, page, backend, diagnostics }, testInfo) => {
//     await app.open();
//     await assertAppVisible(page);
//     await saveScreenshot(page, testInfo, 'workspace');   // then LOOK at it
//   });
import { test as base, expect } from '@playwright/test';
import { AppDriver } from './app';
import { E2EBackend, type E2EResetOptions } from './backend';
import { PageDiagnostics } from './diagnostics';
import { BACKEND_URL } from './env';
import { routeRemoteRequests } from './network';

export type E2EFixtures = {
	/** Reset options of this test (test.use({ e2eOptions })); the reset happens before the test starts. */
	e2eOptions: E2EResetOptions;
	/** The e2e backend: reset again with other options, read its state, call its API. */
	backend: E2EBackend;
	/** Console / page errors of `page`; allow(pattern) for errors the test provokes. */
	diagnostics: PageDiagnostics;
	/** Shared page helpers (open the app, find windows). */
	app: AppDriver;
};

const diagnosticsByPage = new WeakMap<object, PageDiagnostics>();

export const test = base.extend<E2EFixtures & { resetBackend: void }>({
	e2eOptions: [{}, { option: true }],

	backend: async ({ playwright }, use) => {
		const request = await playwright.request.newContext({ baseURL: BACKEND_URL });
		await use(new E2EBackend(request));
		await request.dispose();
	},

	resetBackend: [
		async ({ backend, e2eOptions }, use) => {
			await backend.reset(e2eOptions);
			await use();
			const state = await backend.state();
			expect(state.unexpected_requests, 'requests the synthetic network could not answer').toEqual([]);
		},
		{ auto: true },
	],

	page: async ({ page }, use) => {
		const diagnostics = new PageDiagnostics(page);
		diagnosticsByPage.set(page, diagnostics);
		await routeRemoteRequests(page.context());
		await use(page);
		diagnostics.expectClean();
	},

	diagnostics: async ({ page }, use) => {
		const diagnostics = diagnosticsByPage.get(page);
		if (!diagnostics) {
			throw new Error('The page fixture did not attach its diagnostics');
		}
		await use(diagnostics);
	},

	app: async ({ page }, use) => {
		await use(new AppDriver(page));
	},
});

export { expect };
