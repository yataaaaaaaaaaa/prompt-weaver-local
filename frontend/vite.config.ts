/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import appConfig from '../config/appConfig.cjs';

export default defineConfig({
	plugins: [react()],
	define: {
		// Backend origin, derived once in config/appConfig.cjs (read through src/api/config.ts).
		__BACKEND_URL__: JSON.stringify(appConfig.backendUrl()),
	},
	server: {
		host: appConfig.defaults.host,
		port: appConfig.defaults.frontendPort,
	},
	test: {
		environment: 'jsdom',
		setupFiles: ['./src/test/setup.ts'],
		include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts'],
		restoreMocks: true,
	},
});
