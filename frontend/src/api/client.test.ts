import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './client';
import { BACKEND_URL, outputImageUrl, TASKS_WS_URL } from './config';

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

	it('throws ApiError with the FastAPI detail on failure', async () => {
		stubFetch(409, { detail: 'Generation cancelled' });

		const failure = api.cancelGeneration();

		await expect(failure).rejects.toBeInstanceOf(ApiError);
		await expect(failure).rejects.toMatchObject({ status: 409, message: 'Generation cancelled' });
	});
});
