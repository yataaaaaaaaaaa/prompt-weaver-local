// No real network from the browser either: every request to a host other than the local servers (Civitai preview
// images, links, ...) is answered by the e2e backend's synthetic network (GET /__e2e__/remote?url=..., the same
// fake_civitai.py the backend's own requests reach). A URL it has no answer for gets HTTP 599 and is listed in the
// backend's unexpected requests, which fails the test (fixtures.ts).
import type { BrowserContext } from '@playwright/test';
import { BACKEND_URL } from './env';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function isRemote(url: URL): boolean {
	return (url.protocol === 'http:' || url.protocol === 'https:') && !LOCAL_HOSTS.has(url.hostname);
}

/** Routes every remote request of `context` to the synthetic network. Call before the first navigation. */
export async function routeRemoteRequests(context: BrowserContext): Promise<void> {
	await context.route(isRemote, async (route) => {
		const target = `${BACKEND_URL}/__e2e__/remote?url=${encodeURIComponent(route.request().url())}`;
		const response = await route.fetch({ url: target, method: 'GET', headers: {} });
		await route.fulfill({ response });
	});
}
