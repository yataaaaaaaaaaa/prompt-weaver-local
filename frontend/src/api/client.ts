// Typed HTTP client of the backend (openapi-fetch over the generated `paths`).
// Stores call these functions as `api.xxx(...)` (never destructured) so tests can
// `vi.spyOn(api, 'xxx')`. Components never call the API directly.
import createClient from 'openapi-fetch';
import { isRecord } from '../domain/guards';
import { BACKEND_URL } from './config';
import type { paths } from './schema.gen';
import type {
	BootstrapResponse,
	Character,
	CharacterCollection,
	CharacterCreateRequest,
	CharacterDraft,
	CharacterImageSource,
	FavoriteImage,
	GenerateRequest,
	ImageSearchPage,
	ImageSearchQuery,
	InstallJob,
	InstallRequest,
	InstallResponse,
	IpAdapterInstallResponse,
	IpAdapterStatus,
	ModelLibraryInfo,
	ModelProviderInfo,
	ModelSearchPage,
	ModelSearchQuery,
	OutputRecord,
	PersistedStoreEnvelope,
	PersistedStoreEnvelopeInput,
	RemoteImage,
	RemoteModel,
	ResolvedImageResource,
	ResolveImageResourcesRequest,
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
const providerPath = (provider: string) => ({ params: { path: { provider } } });
const characterPath = (characterId: string) => ({ params: { path: { character_id: characterId } } });
const characterImagePath = (characterId: string, imageId: string) => ({ params: { path: { character_id: characterId, image_id: imageId } } });

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

	// Model library (backend app/routers/models.py, model_installs.py, downloads.py)
	modelLibraryInfo: (): Promise<ModelLibraryInfo> => unwrap(http.GET('/api/models/info')),
	searchModels: (query: ModelSearchQuery, signal?: AbortSignal): Promise<ModelSearchPage> =>
		unwrap(http.GET('/api/models/search', { params: { query: { ...query, cursor: query.cursor ?? undefined } }, signal })),
	getModelVersion: (provider: string, versionId: string): Promise<RemoteModel> =>
		unwrap(http.GET('/api/models/providers/{provider}/versions/{version_id}', { params: { path: { provider, version_id: versionId } } })),
	findModelByHash: (provider: string, sha256: string): Promise<RemoteModel> =>
		unwrap(http.GET('/api/models/providers/{provider}/by-hash/{sha256}', { params: { path: { provider, sha256 } } })),
	/** null or '' removes the stored token. The backend never sends a token back (only token_set). */
	setProviderToken: (provider: string, token: string | null): Promise<ModelProviderInfo> =>
		unwrap(http.PUT('/api/models/providers/{provider}/token', { ...providerPath(provider), body: { token } })),
	installModel: (request: InstallRequest): Promise<InstallResponse> => unwrap(http.POST('/api/models/install', { body: request })),
	listInstalls: (): Promise<InstallJob[]> => unwrap(http.GET('/api/models/installs')),
	cancelDownload: async (taskId: string): Promise<void> => {
		await unwrap(http.POST('/api/downloads/{task_id}/cancel', { params: { path: { task_id: taskId } } }));
	},

	// Image library (backend app/routers/images.py)
	searchImages: (query: ImageSearchQuery, signal?: AbortSignal): Promise<ImageSearchPage> =>
		unwrap(http.GET('/api/images/search', { params: { query: { ...query, cursor: query.cursor ?? undefined } }, signal })),
	/** The provider model version of each resource, in order (unresolvable ones carry an error). */
	resolveImageResources: (request: ResolveImageResourcesRequest, signal?: AbortSignal): Promise<ResolvedImageResource[]> =>
		unwrap(http.POST('/api/images/resolve', { body: request, signal })),
	listFavoriteImages: (): Promise<FavoriteImage[]> => unwrap(http.GET('/api/images/favorites')),
	/** Saves (or refreshes and moves to the front) an image in the backend favorites collection. */
	addFavoriteImage: (image: RemoteImage): Promise<FavoriteImage> => unwrap(http.PUT('/api/images/favorites', { body: image })),
	removeFavoriteImage: async (provider: string, imageId: string): Promise<void> => {
		await unwrap(http.DELETE('/api/images/favorites/{provider}/{image_id}', { params: { path: { provider, image_id: imageId } } }));
	},

	// Characters (backend app/routers/characters.py). Images are shown with characterImageUrl (src/api/config.ts).
	listCharacters: (): Promise<CharacterCollection> => unwrap(http.GET('/api/characters')),
	/** Creates a character and imports its reference images (all or nothing; the first one is the thumbnail). */
	createCharacter: (request: CharacterCreateRequest): Promise<Character> => unwrap(http.POST('/api/characters', { body: request })),
	updateCharacter: (characterId: string, draft: CharacterDraft): Promise<Character> =>
		unwrap(http.PUT('/api/characters/{character_id}', { ...characterPath(characterId), body: draft })),
	deleteCharacter: async (characterId: string): Promise<void> => {
		await unwrap(http.DELETE('/api/characters/{character_id}', characterPath(characterId)));
	},
	/** null deactivates. Answers the whole collection (active_id updated). */
	setActiveCharacter: (characterId: string | null): Promise<CharacterCollection> =>
		unwrap(http.PUT('/api/characters/active', { body: { id: characterId } })),
	addCharacterReferenceImage: (characterId: string, source: CharacterImageSource): Promise<Character> =>
		unwrap(http.POST('/api/characters/{character_id}/reference-images', { ...characterPath(characterId), body: { source } })),
	removeCharacterReferenceImage: (characterId: string, imageId: string): Promise<Character> =>
		unwrap(http.DELETE('/api/characters/{character_id}/reference-images/{image_id}', characterImagePath(characterId, imageId))),
	setCharacterThumbnail: (characterId: string, source: CharacterImageSource): Promise<Character> =>
		unwrap(http.PUT('/api/characters/{character_id}/thumbnail', { ...characterPath(characterId), body: { source } })),
	clearCharacterThumbnail: (characterId: string): Promise<Character> =>
		unwrap(http.DELETE('/api/characters/{character_id}/thumbnail', characterPath(characterId))),

	// IP-Adapter files of reference images (backend app/routers/ip_adapters.py). Downloads are cancelled with
	// cancelDownload and followed through the tasks store.
	/** Every variant with its files; with a model path, also its family and the reference support per focus. */
	ipAdapterStatus: (modelPath: string | null, signal?: AbortSignal): Promise<IpAdapterStatus> =>
		unwrap(http.GET('/api/ip-adapters', { params: { query: { model_path: modelPath ?? undefined } }, signal })),
	installIpAdapter: (variantId: string): Promise<IpAdapterInstallResponse> =>
		unwrap(http.POST('/api/ip-adapters/{variant_id}/install', { params: { path: { variant_id: variantId } } })),
};

export type Api = typeof api;
