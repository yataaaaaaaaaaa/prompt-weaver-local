import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';
import { BACKEND_URL, outputImageUrl, TASKS_WS_URL } from './config';
import { remoteImage } from '../test/imageLibraryData';

function stubFetch(status: number, body: unknown) {
	const fetchMock = vi.fn(async (request: Request) => {
		void request;
		return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('api client', () => {
	it('derives every URL from the single backend origin', () => {
		expect(BACKEND_URL).toMatch(/^https?:\/\//);
		expect(TASKS_WS_URL).toBe(`${BACKEND_URL.replace(/^http/, 'ws')}/ws/tasks`);
		expect(outputImageUrl('0000000042')).toBe(`${BACKEND_URL}/api/outputs/0000000042/image`);
	});

	it('reads a persisted store envelope', async () => {
		const fetchMock = stubFetch(200, { name: 'settings-store', envelope: { state: { width: 768 }, version: 0 } });

		await expect(api.readStore('settings-store')).resolves.toEqual({ state: { width: 768 }, version: 0 });
		const request = fetchMock.mock.calls[0][0];
		expect(request.method).toBe('GET');
		expect(request.url).toBe(`${BACKEND_URL}/api/stores/settings-store`);
	});

	it('maps a missing envelope to null', async () => {
		stubFetch(200, { name: 'library-store', envelope: null });
		await expect(api.readStore('library-store')).resolves.toBeNull();
	});

	it('serializes model searches as repeated query parameters and omits a null cursor', async () => {
		const fetchMock = stubFetch(200, { items: [], next_cursor: null });

		await api.searchModels({
			provider: 'civitai',
			query: 'detail',
			kinds: ['lora', 'checkpoint'],
			base_models: ['SD 1.5', 'Pony'],
			sort: 'most_downloaded',
			nsfw: false,
			limit: 20,
			cursor: null,
		});

		const url = new URL(fetchMock.mock.calls[0][0].url);
		expect(url.pathname).toBe('/api/models/search');
		expect(url.searchParams.getAll('kinds')).toEqual(['lora', 'checkpoint']);
		expect(url.searchParams.getAll('base_models')).toEqual(['SD 1.5', 'Pony']);
		expect(url.searchParams.get('query')).toBe('detail');
		expect(url.searchParams.has('cursor')).toBe(false);
	});

	it('posts installs, provider tokens and download cancellations', async () => {
		const fetchMock = stubFetch(200, { ok: true });

		await api.installModel({ provider: 'civitai', version_id: '62833', file_id: null });
		await api.setProviderToken('civitai', 'secret');
		await api.cancelDownload('download-1');

		const [install, token, cancel] = fetchMock.mock.calls.map((call) => call[0]);
		expect([install.method, new URL(install.url).pathname]).toEqual(['POST', '/api/models/install']);
		expect(await install.json()).toEqual({ provider: 'civitai', version_id: '62833', file_id: null });
		expect([token.method, new URL(token.url).pathname]).toEqual(['PUT', '/api/models/providers/civitai/token']);
		expect(await token.json()).toEqual({ token: 'secret' });
		expect([cancel.method, new URL(cancel.url).pathname]).toEqual(['POST', '/api/downloads/download-1/cancel']);
	});

	it('searches images with the filters as query parameters and omits a null cursor', async () => {
		const fetchMock = stubFetch(200, { items: [], next_cursor: null });
		const query = { provider: 'civitai', query: 'castle', sort: 'newest', period: 'week', nsfw: false, usable_only: true, limit: 20 } as const;

		await expect(api.searchImages({ ...query, cursor: null })).resolves.toEqual({ items: [], next_cursor: null });
		await api.searchImages({ ...query, cursor: 'm:58390|c:2' });

		const [first, next] = fetchMock.mock.calls.map((call) => call[0]);
		const url = new URL(first.url);
		expect([first.method, url.pathname]).toEqual(['GET', '/api/images/search']);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			provider: 'civitai',
			query: 'castle',
			sort: 'newest',
			period: 'week',
			nsfw: 'false',
			usable_only: 'true',
			limit: '20',
		});
		expect(new URL(next.url).searchParams.get('cursor')).toBe('m:58390|c:2');
	});

	it('posts image resources to resolve', async () => {
		const fetchMock = stubFetch(200, []);
		const resources = [{ kind: 'lora', name: 'add_detail', weight: 0.6, version_id: null, hash: '7c6bad76eb54' }] as const;

		await expect(api.resolveImageResources({ provider: 'civitai', resources: [...resources] })).resolves.toEqual([]);

		const request = fetchMock.mock.calls[0][0];
		expect([request.method, new URL(request.url).pathname]).toEqual(['POST', '/api/images/resolve']);
		expect(await request.json()).toEqual({ provider: 'civitai', resources });
	});

	it('lists, saves and removes favorite images', async () => {
		const image = remoteImage({ id: '148522541' });
		const fetchMock = stubFetch(200, []);

		await expect(api.listFavoriteImages()).resolves.toEqual([]);
		await api.addFavoriteImage(image);
		await api.removeFavoriteImage('civitai', '148522541');

		const [list, add, remove] = fetchMock.mock.calls.map((call) => call[0]);
		expect([list.method, new URL(list.url).pathname]).toEqual(['GET', '/api/images/favorites']);
		expect([add.method, new URL(add.url).pathname]).toEqual(['PUT', '/api/images/favorites']);
		expect(await add.json()).toEqual(image);
		expect([remove.method, new URL(remove.url).pathname]).toEqual(['DELETE', '/api/images/favorites/civitai/148522541']);
	});

	it('throws ApiError with the FastAPI detail on failure', async () => {
		stubFetch(409, { detail: 'Generation cancelled' });

		const failure = api.cancelGeneration();

		await expect(failure).rejects.toBeInstanceOf(ApiError);
		await expect(failure).rejects.toMatchObject({ status: 409, message: 'Generation cancelled' });
	});
});
