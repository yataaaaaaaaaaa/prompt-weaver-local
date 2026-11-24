// Model library test data, shared by the domain, store and view tests (imported by tests only): builders with
// neutral defaults (override what a test is about) and the real Civitai models of backend/tests/fixtures/civitai
// as the backend maps them.
import type {
	DownloadTaskEvent,
	InstalledModel,
	ModelLibraryInfo,
	ModelProviderInfo,
	ModelSource,
	RemoteFile,
	RemoteModel,
	RemoteModelVersion,
} from '../api/types';
import { installKey } from '../domain/modelCatalog';
import type { InstallEntry, VersionStatus } from '../stores/modelCatalogStore';
import type { DownloadProgress } from '../stores/tasksStore';

export const GB = 1024 ** 3;

export const PROVIDER: ModelProviderInfo = {
	id: 'civitai',
	label: 'Civitai',
	kinds: ['checkpoint', 'lora', 'embedding'],
	base_models: [
		{ id: 'SD 1.5', architecture: 'sd15' },
		{ id: 'Illustrious', architecture: 'sdxl' },
		{ id: 'Flux.1 D', architecture: null },
	],
	sorts: ['most_downloaded', 'highest_rated', 'newest'],
	token_set: false,
	token_supported: true,
};

export const INFO: ModelLibraryInfo = {
	providers: [PROVIDER],
	model_dirs: { checkpoint: 'D:/models/checkpoints', lora: 'D:/models/loras', embedding: 'D:/models/embeddings' },
};

export function remoteFile(overrides: Partial<RemoteFile> = {}): RemoteFile {
	return {
		id: '101',
		name: 'model.safetensors',
		size_bytes: Math.round(6.9 * GB),
		sha256: 'a'.repeat(64),
		format: 'SafeTensor',
		precision: 'fp16',
		variant: 'pruned',
		primary: true,
		downloadable: true,
		local_path: null,
		...overrides,
	};
}

export function remoteVersion(overrides: Partial<RemoteModelVersion> = {}): RemoteModelVersion {
	return {
		id: '11',
		name: 'v1.0',
		base_model: 'Illustrious',
		architecture: 'sdxl',
		default_file_id: '101',
		files: [remoteFile()],
		images: [{ url: 'https://image.example/v1.jpeg', width: 450, height: 600, nsfw: false }],
		page_url: 'https://civitai.com/models/1?modelVersionId=11',
		published_at: '2026-01-01T00:00:00Z',
		trigger_words: [],
		unavailable_reason: null,
		...overrides,
	};
}

export function remoteModel(overrides: Partial<RemoteModel> = {}): RemoteModel {
	return {
		provider: 'civitai',
		id: '1',
		name: 'Model One',
		kind: 'checkpoint',
		creator: 'alice',
		download_count: 1000,
		nsfw: false,
		page_url: 'https://civitai.com/models/1',
		tags: [],
		versions: [remoteVersion()],
		...overrides,
	};
}

export function installEntry(model: RemoteModel, version: RemoteModelVersion, overrides: Partial<InstallEntry> = {}): InstallEntry {
	return {
		key: installKey(model.provider, version, null),
		provider: model.provider,
		modelId: model.id,
		versionId: version.id,
		fileId: null,
		kind: model.kind,
		phase: 'downloading',
		taskId: 'task-1',
		error: null,
		...overrides,
	};
}

export function versionStatus(model: RemoteModel, version: RemoteModelVersion, overrides: Partial<VersionStatus> = {}): VersionStatus {
	return {
		kind: 'remote',
		reason: null,
		installKey: installKey(model.provider, version, null),
		install: null,
		progress: null,
		libraryEntryId: null,
		sizeBytes: version.files[0]?.size_bytes ?? null,
		...overrides,
	};
}

export function downloadProgress(overrides: Partial<DownloadProgress> = {}): DownloadProgress {
	return {
		stage: 'downloading',
		title: 'Model One - v1.0',
		message: '',
		current: Math.round(1.2 * GB),
		total: Math.round(6.9 * GB),
		ratio: 1.2 / 6.9,
		active: true,
		...overrides,
	};
}

export function modelSource(overrides: Partial<ModelSource> = {}): ModelSource {
	return {
		provider: 'civitai',
		model_id: '1',
		version_id: '11',
		file_id: '101',
		model_name: 'Model One',
		version_name: 'v1.0',
		base_model: 'Illustrious',
		sha256: 'a'.repeat(64),
		preview_url: 'https://image.example/v1.jpeg',
		trigger_words: [],
		page_url: 'https://civitai.com/models/1',
		...overrides,
	};
}

export function downloadEvent(taskId: string, overrides: Partial<DownloadTaskEvent> = {}): DownloadTaskEvent {
	return {
		type: 'download',
		task_id: taskId,
		stage: 'downloading',
		title: 'Model One - v1.0',
		message: '',
		current: 0,
		total: 0,
		...overrides,
	};
}

/** The InstalledModel the backend answers for the default file of `version` at `path` (its display name is
 *  '<model> - <version>', its provenance mirrors the version). */
export function installedModel(model: RemoteModel, version: RemoteModelVersion, path: string): InstalledModel {
	const file = version.files.find((item) => item.id === version.default_file_id) ?? version.files[0];
	return {
		kind: model.kind,
		name: `${model.name} - ${version.name}`,
		path,
		source: modelSource({
			provider: model.provider,
			model_id: model.id,
			version_id: version.id,
			file_id: file.id,
			model_name: model.name,
			version_name: version.name,
			base_model: version.base_model,
			sha256: file.sha256,
			preview_url: null,
			trigger_words: version.trigger_words,
			page_url: version.page_url,
		}),
	};
}

// ---------------------------------------------------------------------------
// Real Civitai models (backend/tests/fixtures/civitai) as mapped by the backend
// ---------------------------------------------------------------------------

/** 'Detail Tweaker LoRA' v1.0 (search_loras.json / model_version.json): an SD 1.5 LoRA. */
export const DETAIL_TWEAKER_FILE = remoteFile({
	id: '44319',
	name: 'add_detail.safetensors',
	size_bytes: 37_861_176,
	sha256: '47aaaf0d2945ca937151d61304946dd229b3f072140b85484bc93e38f2a6e2f7',
	precision: null,
	variant: null,
});
export const DETAIL_TWEAKER_VERSION = remoteVersion({
	id: '62833',
	name: 'v1.0',
	base_model: 'SD 1.5',
	architecture: 'sd15',
	published_at: '2023-05-04T00:00:00.000Z',
	files: [DETAIL_TWEAKER_FILE],
	images: [],
	default_file_id: DETAIL_TWEAKER_FILE.id,
	page_url: 'https://civitai.com/models/58390?modelVersionId=62833',
});
export const DETAIL_TWEAKER = remoteModel({
	id: '58390',
	name: 'Detail Tweaker LoRA',
	kind: 'lora',
	creator: null,
	tags: ['concept', 'detail'],
	download_count: 1_000_000,
	page_url: 'https://civitai.com/models/58390',
	versions: [DETAIL_TWEAKER_VERSION],
});
export const DETAIL_TWEAKER_SOURCE = installedModel(DETAIL_TWEAKER, DETAIL_TWEAKER_VERSION, 'add_detail.safetensors').source;

/** 'JANKU ... Illustrious XL' v7.77 (search_checkpoints.json): an SDXL checkpoint. */
export const JANKU_FILE = remoteFile({
	id: '2672243',
	name: 'JANKU v7.777.safetensors',
	size_bytes: 6_938_040_674,
	sha256: '88177d224ce97f60cf3e908f87902f913ed4562bd79d237f84238a4354601efb',
	precision: 'fp16',
	variant: 'pruned',
});
export const JANKU_VERSION = remoteVersion({
	...DETAIL_TWEAKER_VERSION,
	id: '2786084',
	name: 'v7.77',
	base_model: 'Illustrious',
	architecture: 'sdxl',
	files: [JANKU_FILE],
	default_file_id: JANKU_FILE.id,
	page_url: null,
});
export const JANKU = remoteModel({
	...DETAIL_TWEAKER,
	id: '1277670',
	name: 'JANKU Trained + Chenkin & NoobAI + RouWei Illustrious XL',
	kind: 'checkpoint',
	versions: [JANKU_VERSION],
});

/** 'EasyNegative' (search_embeddings.json): an SD 1.5 embedding. */
export const EASYNEGATIVE_FILE = remoteFile({
	...DETAIL_TWEAKER_FILE,
	id: '8955',
	name: 'easynegative.safetensors',
	size_bytes: 24_655,
	sha256: 'c74b4e810b030f6b75fde959e2db678c268d07115b85356d3c0138ba5eb42340',
});
export const EASYNEGATIVE_VERSION = remoteVersion({
	...DETAIL_TWEAKER_VERSION,
	id: '9208',
	name: 'EasyNegative',
	trigger_words: ['easynegative'],
	files: [EASYNEGATIVE_FILE],
	default_file_id: EASYNEGATIVE_FILE.id,
});
export const EASYNEGATIVE = remoteModel({ ...DETAIL_TWEAKER, id: '7808', name: 'EasyNegative', kind: 'embedding', versions: [EASYNEGATIVE_VERSION] });
