/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import appConfig from '../config/appConfig.cjs';

export default defineConfig({
	plugins: [react()],
	// Own dependency cache per dev server when PROMPT_WEAVER_VITE_CACHE_DIR is set (concurrent e2e runs).
	cacheDir: appConfig.viteCacheDir(),
	define: {
		// Backend origin, derived once in config/appConfig.cjs (read through src/api/config.ts).
		__BACKEND_URL__: JSON.stringify(appConfig.backendUrl()),
	},
	server: {
		host: appConfig.defaults.host,
		port: appConfig.defaults.frontendPort,
		// Off for the e2e servers (PROMPT_WEAVER_VITE_HMR=off): no reload in the middle of a test.
		hmr: appConfig.viteHmr(),
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./src/test/setup.ts'],
		include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
		restoreMocks: true,
		// Fluent components (popovers with focus traps, menus, dialogs) render slowly in jsdom while many test files run
		// in parallel: one generous limit for every test instead of per-file overrides.
		testTimeout: 20_000,
	},
});
