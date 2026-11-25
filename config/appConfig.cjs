// Single owner of the dev host/ports and of the backend URL derivation for Node consumers
// (frontend/vite.config.ts, frontend/electron/main.cjs and the e2e suite, frontend/e2e). Python consumers
// (launcher/, backend/run_backend.py) read config/defaults.json directly.
//
// PROMPT_WEAVER_BACKEND_URL overrides the derived URL; the launcher sets it so that
// `--host/--backend-port` reach the frontend and Electron, and the e2e suite points Vite and Electron at the e2e
// backend with it. PROMPT_WEAVER_VITE_CACHE_DIR gives a Vite dev server its own dependency cache, so that several
// servers (concurrent e2e runs) never re-optimize each other's cache, and PROMPT_WEAVER_VITE_HMR=off turns hot
// reloading off (an e2e page only picks up source changes when it loads, never in the middle of a test).
const defaults = require('./defaults.json');

const BACKEND_URL_ENV = 'PROMPT_WEAVER_BACKEND_URL';
const VITE_CACHE_DIR_ENV = 'PROMPT_WEAVER_VITE_CACHE_DIR';
const VITE_HMR_ENV = 'PROMPT_WEAVER_VITE_HMR';

function backendUrl(env = process.env) {
	const override = env[BACKEND_URL_ENV];
	if (override && override.trim()) {
		return override.trim().replace(/\/+$/, '');
	}
	return `http://${defaults.host}:${defaults.backendPort}`;
}

/** The Vite cache dir override, or undefined (Vite's default, node_modules/.vite). */
function viteCacheDir(env = process.env) {
	const override = env[VITE_CACHE_DIR_ENV];
	return override && override.trim() ? override.trim() : undefined;
}

/** false when hot reloading is turned off (PROMPT_WEAVER_VITE_HMR=off), else undefined (Vite's default). */
function viteHmr(env = process.env) {
	return (env[VITE_HMR_ENV] || '').trim().toLowerCase() === 'off' ? false : undefined;
}

module.exports = { defaults, backendUrl, viteCacheDir, viteHmr, BACKEND_URL_ENV, VITE_CACHE_DIR_ENV, VITE_HMR_ENV };
