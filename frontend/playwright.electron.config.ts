// The Electron smoke test (e2e/electron): launches the real Electron app (Playwright _electron) against the e2e
// backend and the e2e Vite server. It opens a desktop window, so it only runs through `npm run test:e2e:electron`.
import { defineConfig } from '@playwright/test';
import { e2eWebServers, SHARED_CONFIG } from './e2e/support/env';

export default defineConfig({
	...SHARED_CONFIG,
	testDir: './e2e/electron',
	reporter: [['list']],
	projects: [{ name: 'electron' }],
	webServer: e2eWebServers(),
});
