// Single owner of the dev host/ports and of the backend URL derivation for Node consumers
// (frontend/vite.config.ts and frontend/electron/main.cjs). Python consumers (launcher/,
// backend/run_backend.py) read config/defaults.json directly.
//
// PROMPT_WEAVER_BACKEND_URL overrides the derived URL; the launcher sets it so that
// `--host/--backend-port` reach the frontend and Electron.
const defaults = require('./defaults.json');

const BACKEND_URL_ENV = 'PROMPT_WEAVER_BACKEND_URL';

function backendUrl(env = process.env) {
	const override = env[BACKEND_URL_ENV];
	if (override && override.trim()) {
		return override.trim().replace(/\/+$/, '');
	}
	return `http://${defaults.host}:${defaults.backendPort}`;
}

module.exports = { defaults, backendUrl, BACKEND_URL_ENV };
