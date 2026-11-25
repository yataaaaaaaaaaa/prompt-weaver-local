// End-to-end suite in the real browser: the installed Microsoft Edge (channel 'msedge', no browser download),
// headless, 1920 x 1080, one project per color scheme. Servers, ports and shared settings: e2e/support/env.ts.
//
//   npm run test:e2e                   every spec, dark and light (E2E_BACKEND_PORT / E2E_FRONTEND_PORT pick the ports)
//   npm run test:e2e -- e2e/categories one folder
//   npm run test:e2e:update            rewrite the visual baselines (e2e/__screenshots__), then look at the diff
//   npm run test:e2e:electron          the Electron smoke test (opens a desktop window: own config)
import { defineConfig } from '@playwright/test';
import { DESKTOP_VIEWPORT, e2eWebServers, FRONTEND_URL, REPORT_DIR, SHARED_CONFIG } from './e2e/support/env';

export default defineConfig({
	...SHARED_CONFIG,
	testDir: './e2e',
	testIgnore: ['electron/**'],
	reporter: [['list'], ['html', { open: 'never', outputFolder: REPORT_DIR }]],
	use: {
		baseURL: FRONTEND_URL,
		channel: 'msedge',
		headless: true,
		viewport: DESKTOP_VIEWPORT,
		deviceScaleFactor: 1,
		locale: 'en-US',
		timezoneId: 'UTC',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'dark', use: { colorScheme: 'dark' } },
		{ name: 'light', use: { colorScheme: 'light' } },
	],
	webServer: e2eWebServers(),
});
