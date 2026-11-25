declare const appConfig: {
	defaults: { host: string; backendPort: number; frontendPort: number };
	backendUrl(env?: Record<string, string | undefined>): string;
	viteCacheDir(env?: Record<string, string | undefined>): string | undefined;
	viteHmr(env?: Record<string, string | undefined>): false | undefined;
	BACKEND_URL_ENV: string;
	VITE_CACHE_DIR_ENV: string;
	VITE_HMR_ENV: string;
};
export = appConfig;
