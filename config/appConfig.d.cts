declare const appConfig: {
	defaults: { host: string; backendPort: number; frontendPort: number };
	backendUrl(env?: Record<string, string | undefined>): string;
	BACKEND_URL_ENV: string;
};
export = appConfig;
