// Typed HTTP client of the backend (openapi-fetch over the generated `paths`).
// Stores call these functions as `api.xxx(...)` (never destructured) so tests can
// `vi.spyOn(api, 'xxx')`. Components never call the API directly.
import createClient from 'openapi-fetch';
import { isRecord } from '../domain/guards';
import { BACKEND_URL } from './config';
import type { paths } from './schema.gen';
import type {
	BootstrapResponse,
	GenerateRequest,
	OutputRecord,
	PersistedStoreEnvelope,
	PersistedStoreEnvelopeInput,
	TaskSnapshot,
} from './types';

export class ApiError extends Error {
	public constructor(
		message: string,
		public readonly status: number,
		public readonly detail: unknown,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

const http = createClient<paths>({
	baseUrl: BACKEND_URL,
	// Late-bound so tests can stub globalThis.fetch.
	fetch: (request) => globalThis.fetch(request),
});

function apiErrorMessage(error: unknown, response: Response): string {
	if (isRecord(error) && 'detail' in error) {
		return typeof error.detail === 'string' ? error.detail : JSON.stringify(error.detail);
	}
	if (typeof error === 'string' && error) {
		return error;
	}
	return `Request failed: ${response.status} ${response.statusText}`.trim();
}

async function unwrap<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
	const { data, error, response } = await request;
	if (error !== undefined || !response.ok) {
		throw new ApiError(apiErrorMessage(error, response), response.status, error);
	}
	return data as T;
}

const outputPath = (outputId: string) => ({ params: { path: { output_id: outputId } } });
const storePath = (name: string) => ({ params: { path: { name } } });

export const api = {
	health: () => unwrap(http.GET('/api/health')),
	bootstrap: (): Promise<BootstrapResponse> => unwrap(http.GET('/api/bootstrap')),
	listOutputIds: async (): Promise<string[]> => (await unwrap(http.GET('/api/outputs'))).ids,
	getOutput: (outputId: string): Promise<OutputRecord> => unwrap(http.GET('/api/outputs/{output_id}', outputPath(outputId))),
	trashOutput: async (outputId: string): Promise<void> => {
		await unwrap(http.POST('/api/outputs/{output_id}/trash', outputPath(outputId)));
	},
	restoreOutput: async (outputId: string): Promise<void> => {
		await unwrap(http.POST('/api/trash/{output_id}/restore', outputPath(outputId)));
	},
	generate: (request: GenerateRequest, signal?: AbortSignal): Promise<OutputRecord> =>
		unwrap(http.POST('/api/generate', { body: request, signal })),
	cancelGeneration: async (): Promise<void> => {
		await unwrap(http.POST('/api/generate/cancel'));
	},
	getTasks: (): Promise<TaskSnapshot> => unwrap(http.GET('/api/tasks')),
	readStore: async (name: string): Promise<PersistedStoreEnvelope | null> =>
		(await unwrap(http.GET('/api/stores/{name}', storePath(name)))).envelope ?? null,
	writeStore: async (name: string, envelope: PersistedStoreEnvelopeInput): Promise<void> => {
		await unwrap(http.PUT('/api/stores/{name}', { ...storePath(name), body: envelope }));
	},
	deleteStore: async (name: string): Promise<void> => {
		await unwrap(http.DELETE('/api/stores/{name}', storePath(name)));
	},
};

export type Api = typeof api;
