// Single owner of the e2e environment: ports (from E2E_BACKEND_PORT / E2E_FRONTEND_PORT, so several runs can work
// side by side), URLs, directories, the two servers every run starts, and the Playwright settings shared by the
// browser config (playwright.config.ts) and the Electron config (playwright.electron.config.ts).
//
// The backend is backend/tests/e2e/server.py: the real app on synthetic data with a fake generator and a synthetic
// Civitai (no GPU, no network, never the user's data). The frontend is the Vite dev server pointed at it through
// PROMPT_WEAVER_BACKEND_URL (config/appConfig.cjs), with its own dependency cache per port.
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlaywrightTestConfig } from '@playwright/test';
import appConfig from '../../../config/appConfig.cjs';

export const E2E_HOST = '127.0.0.1';
export const DEFAULT_E2E_BACKEND_PORT = 18100;
export const DEFAULT_E2E_FRONTEND_PORT = 15200;

function portFromEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	const port = raw === undefined || raw.trim() === '' ? fallback : Number(raw);
	if (!Number.isInteger(port) || port < 1024 || port > 65535) {
		throw new Error(`${name} must be a port number between 1024 and 65535 (got ${raw}).`);
	}
	return port;
}

export const E2E_BACKEND_PORT = portFromEnv('E2E_BACKEND_PORT', DEFAULT_E2E_BACKEND_PORT);
export const E2E_FRONTEND_PORT = portFromEnv('E2E_FRONTEND_PORT', DEFAULT_E2E_FRONTEND_PORT);
export const BACKEND_URL = `http://${E2E_HOST}:${E2E_BACKEND_PORT}`;
export const FRONTEND_URL = `http://${E2E_HOST}:${E2E_FRONTEND_PORT}`;

export const FRONTEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BACKEND_DIR = path.resolve(FRONTEND_DIR, '..', 'backend');
export const E2E_DIR = path.join(FRONTEND_DIR, 'e2e');
/** Screenshots the tests save for people and agents to look at (gitignored): e2e/.screens/<project>/<spec>/... */
export const SCREENS_DIR = path.join(E2E_DIR, '.screens');

/** The desktop viewport of the visual baselines (expectation of the suite). */
export const DESKTOP_VIEWPORT = { width: 1920, height: 1080 } as const;
/** The smallest window the app supports (Electron minWidth x a laptop height): layouts must not break there. */
export const SMALL_VIEWPORT = { width: 1280, height: 720 } as const;

/** Report folder of this run (per port: concurrent runs never delete each other's results). */
export const REPORT_DIR = path.join(FRONTEND_DIR, 'playwright-report', `e2e-${E2E_FRONTEND_PORT}`);

/** Playwright settings shared by both configs (one place). */
export const SHARED_CONFIG = {
	// Per port: Playwright empties its output folder when a run starts.
	outputDir: path.join(FRONTEND_DIR, 'test-results', `e2e-${E2E_FRONTEND_PORT}`),
	// Baselines per spec file and project: e2e/__screenshots__/<spec path>/<project>/<name>.png (committed).
	snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{projectName}/{arg}{ext}',
	fullyParallel: false,
	// One backend per run, reset before every test: tests of one run never overlap.
	workers: 1,
	retries: 0,
	forbidOnly: true,
	timeout: 60_000,
	expect: {
		timeout: 10_000,
		toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 },
	},
} satisfies PlaywrightTestConfig;

/** The backend and frontend servers of one run (started before the tests, stopped after). */
export function e2eWebServers(): NonNullable<PlaywrightTestConfig['webServer']> {
	return [
		{
			command: `uv run python tests/e2e/server.py --port ${E2E_BACKEND_PORT}`,
			cwd: BACKEND_DIR,
			url: `${BACKEND_URL}/api/health`,
			reuseExistingServer: false,
			timeout: 180_000,
			stdout: 'pipe',
			stderr: 'pipe',
			env: {
				// Another project's virtual env must not leak into uv (README: unset VIRTUAL_ENV in backend/).
				VIRTUAL_ENV: '',
				// Safety net: the e2e server passes its own temp dirs, nothing may ever fall back to the real data dir.
				PROMPT_WEAVER_DATA_DIR: path.join(tmpdir(), `prompt-weaver-e2e-guard-${E2E_BACKEND_PORT}`),
			},
		},
		{
			command: `npx vite --host ${E2E_HOST} --port ${E2E_FRONTEND_PORT} --strictPort`,
			cwd: FRONTEND_DIR,
			url: FRONTEND_URL,
			reuseExistingServer: false,
			timeout: 180_000,
			stdout: 'pipe',
			stderr: 'pipe',
			env: {
				[appConfig.BACKEND_URL_ENV]: BACKEND_URL,
				[appConfig.VITE_CACHE_DIR_ENV]: path.join('node_modules', `.vite-e2e-${E2E_FRONTEND_PORT}`),
				[appConfig.VITE_HMR_ENV]: 'off',
			},
		},
	];
}
