// @vitest-environment node
// config/appConfig.cjs: the dev host/ports and the env overrides read by Vite, Electron and the e2e suite.
import { describe, expect, it } from 'vitest';
import appConfig from '../../config/appConfig.cjs';

describe('appConfig', () => {
	it('derives the backend URL from the defaults unless overridden', () => {
		expect(appConfig.backendUrl({})).toBe(`http://${appConfig.defaults.host}:${appConfig.defaults.backendPort}`);
		expect(appConfig.backendUrl({ [appConfig.BACKEND_URL_ENV]: ' http://127.0.0.1:18100/ ' })).toBe('http://127.0.0.1:18100');
	});

	it('gives a Vite server its own cache dir only when asked', () => {
		expect(appConfig.viteCacheDir({})).toBeUndefined();
		expect(appConfig.viteCacheDir({ [appConfig.VITE_CACHE_DIR_ENV]: 'node_modules/.vite-e2e-15200' })).toBe('node_modules/.vite-e2e-15200');
	});

	it('turns hot reloading off only when asked', () => {
		expect(appConfig.viteHmr({})).toBeUndefined();
		expect(appConfig.viteHmr({ [appConfig.VITE_HMR_ENV]: 'off' })).toBe(false);
		expect(appConfig.viteHmr({ [appConfig.VITE_HMR_ENV]: 'on' })).toBeUndefined();
	});
});
