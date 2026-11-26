// The real Electron app (electron/main.cjs) against the e2e backend and the e2e Vite server: its window shows the
// app (not a blank, monochrome or covered window) with the navigation rail and the Create section. Run with
// `npm run test:e2e:electron` (opens a desktop window).
import { _electron as electron } from '@playwright/test';
import { AppDriver } from '../support/app';
import { PageDiagnostics } from '../support/diagnostics';
import { BACKEND_URL, FRONTEND_DIR, FRONTEND_URL } from '../support/env';
import { expect, test } from '../support/fixtures';
import { routeRemoteRequests } from '../support/network';
import { saveScreenshot } from '../support/screenshots';
import { assertAppVisible, expectOnTop } from '../support/visibility';
import appConfig from '../../../config/appConfig.cjs';

/** The environment of the launched app: this process's, minus what would turn electron.exe into plain Node (editor
 *  and agent hosts set ELECTRON_RUN_AS_NODE), plus the e2e servers. */
function electronEnv(): Record<string, string> {
	const inherited = Object.entries(process.env).filter(
		(entry): entry is [string, string] => entry[1] !== undefined && !entry[0].toUpperCase().startsWith('ELECTRON_'),
	);
	return Object.fromEntries(inherited);
}

test('the Electron window shows the app', async ({}, testInfo) => {
	const electronApp = await electron.launch({
		args: ['.'],
		cwd: FRONTEND_DIR,
		env: {
			...electronEnv(),
			[appConfig.BACKEND_URL_ENV]: BACKEND_URL,
			VITE_DEV_SERVER_URL: FRONTEND_URL,
			// The e2e backend is already running: main.cjs reuses a healthy backend and never starts its own.
			VIRTUAL_ENV: '',
		},
	});
	try {
		await routeRemoteRequests(electronApp.context());
		const window = await electronApp.firstWindow();
		const diagnostics = new PageDiagnostics(window);
		const app = new AppDriver(window);
		await expect(app.navigation()).toBeVisible({ timeout: 60_000 });
		await app.settle();
		await assertAppVisible(window);
		await expect(app.createRegion('generation')).toBeVisible();
		await expectOnTop(app.navigation());
		await expectOnTop(app.commandBar());
		await saveScreenshot(window, testInfo, 'electron-window');
		diagnostics.expectClean();
	} finally {
		await electronApp.close();
	}
});
