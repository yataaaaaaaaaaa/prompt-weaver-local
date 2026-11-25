import { describe, expect, it } from 'vitest';
import { MODEL_SEARCH_QUERY_DEFAULTS } from '../api/defaults.gen';
import type { RemoteModel, RemoteModelVersion } from '../api/types';
import { DETAIL_TWEAKER, DETAIL_TWEAKER_FILE as SAFETENSORS, DETAIL_TWEAKER_VERSION, installedModel, remoteFile, remoteModel, remoteVersion } from '../test/modelLibraryData';
import {
	buildSearchQuery,
	DEFAULT_CATALOG_FILTERS,
	embeddingPromptToken,
	INSTALL_ALREADY_RUNNING,
	INSTALL_CANCELLED,
	installFile,
	installKey,
	installOptions,
	installOutcomeEntry,
	isInstallRunning,
	MODEL_KIND_LABELS,
	MODEL_SORT_LABELS,
	modelKey,
	NO_LIBRARY_ENTRY,
	pickedVersion,
	RUNNING_INSTALL_PHASES,
	versionStatusKind,
	withLocalFile,
	type CatalogFilters,
} from './modelCatalog';

// The real Civitai 'Detail Tweaker LoRA' (src/test/modelLibraryData.ts) with a pickle file next to its safetensors.
const PICKLE = remoteFile({ ...SAFETENSORS, id: '44320', name: 'add_detail.pt', format: 'PickleTensor', primary: false, downloadable: false, sha256: null });

function version(overrides: Partial<RemoteModelVersion> = {}): RemoteModelVersion {
	return remoteVersion({ ...DETAIL_TWEAKER_VERSION, files: [SAFETENSORS, PICKLE], ...overrides });
}

function model(id: string, versions: RemoteModelVersion[] = [version()]): RemoteModel {
	return remoteModel({ id, name: `Model ${id}`, kind: 'lora', creator: null, download_count: 0, page_url: null, versions });
}

describe('search queries', () => {
	it('starts from the backend ModelSearchQuery defaults (limit and cursor are not filters)', () => {
		const { provider, query, kinds, base_models, sort, nsfw } = MODEL_SEARCH_QUERY_DEFAULTS;
		expect(DEFAULT_CATALOG_FILTERS).toEqual({ provider, query, kinds, base_models, sort, nsfw });
		expect(DEFAULT_CATALOG_FILTERS.kinds).not.toBe(kinds);
	});

	it('builds a page request: query trimmed, limit from the defaults, cursor, copied lists', () => {
		const filters: CatalogFilters = { ...DEFAULT_CATALOG_FILTERS, query: '  detail tweaker ', kinds: ['lora'], base_models: ['SD 1.5'], sort: 'newest', nsfw: true };
		const query = buildSearchQuery(filters, '17616|457433|376130');
		expect(query).toEqual({
			provider: 'civitai',
			query: 'detail tweaker',
			kinds: ['lora'],
			base_models: ['SD 1.5'],
			sort: 'newest',
			nsfw: true,
			limit: MODEL_SEARCH_QUERY_DEFAULTS.limit,
			cursor: '17616|457433|376130',
		});
		expect(query.kinds).not.toBe(filters.kinds);
		expect(query.base_models).not.toBe(filters.base_models);
		expect(buildSearchQuery(DEFAULT_CATALOG_FILTERS, null)).toMatchObject({ query: '', cursor: null });
	});
});

describe('keys', () => {
	it('keys a model by provider and id', () => {
		expect(modelKey(model('58390'))).toBe('civitai:58390');
		expect(modelKey({ provider: 'huggingface', id: 'a/b' })).toBe('huggingface:a/b');
	});

	it('keys an install by provider, version and file (default file when null, empty without any)', () => {
		expect(installKey('civitai', version(), null)).toBe('civitai:62833:44319');
		expect(installKey('civitai', version(), '44320')).toBe('civitai:62833:44320');
		expect(installKey('civitai', version({ default_file_id: null }), null)).toBe('civitai:62833:');
		// A job (InstallJob) only knows its file: same key as the default install of that file.
		expect(installKey('civitai', { id: '62833', default_file_id: '44319' }, '44319')).toBe(installKey('civitai', version(), null));
	});
});

describe('versions and files', () => {
	const older = version({ id: '1', name: 'v0.9' });
	const newer = version({ id: '2', name: 'v1.0' });

	it('shows the picked version when it still exists, else the first one', () => {
		const item = model('m', [newer, older]);
		expect(pickedVersion(item, '1')).toBe(older);
		expect(pickedVersion(item, undefined)).toBe(newer);
		expect(pickedVersion(item, 'deleted')).toBe(newer);
		expect(pickedVersion(model('m', []), '1')).toBeNull();
	});

	it('finds the install file: the default one, the given one, or none', () => {
		expect(installFile(version())).toBe(SAFETENSORS);
		expect(installFile(version(), '44320')).toBe(PICKLE);
		expect(installFile(version(), 'unknown')).toBeNull();
		expect(installFile(version({ default_file_id: null }))).toBeNull();
	});
});

describe('withLocalFile', () => {
	const older = version({ id: '1', name: 'v0.9' });
	const newer = version({ id: '2', name: 'v1.0' });
	const results = [model('a', [newer, older]), model('b')];
	const PATH = 'D:/models/loras/add_detail.safetensors';

	it("marks the target's default file local, keeping everything else (same objects)", () => {
		const next = withLocalFile(results, { provider: 'civitai', modelId: 'a', versionId: '1', fileId: null }, PATH);
		expect(next).not.toBe(results);
		expect(installFile(next[0].versions[1])?.local_path).toBe(PATH);
		expect(next[0].versions[1].files.find((file) => file.id === PICKLE.id)?.local_path).toBeNull();
		expect(next[0].versions[0]).toBe(newer);
		expect(next[1]).toBe(results[1]);
		expect(installFile(older)?.local_path).toBeNull();
	});

	it('marks an explicitly chosen file', () => {
		const next = withLocalFile(results, { provider: 'civitai', modelId: 'b', versionId: DETAIL_TWEAKER_VERSION.id, fileId: PICKLE.id }, PATH);
		expect(next[1].versions[0].files.map((file) => file.local_path)).toEqual([null, PATH]);
	});

	it('returns the same results when nothing matches or the file is already local there', () => {
		expect(withLocalFile(results, { provider: 'civitai', modelId: 'unknown', versionId: '1', fileId: null }, PATH)).toBe(results);
		expect(withLocalFile(results, { provider: 'other', modelId: 'a', versionId: '1', fileId: null }, PATH)).toBe(results);
		expect(withLocalFile(results, { provider: 'civitai', modelId: 'a', versionId: 'deleted', fileId: null }, PATH)).toBe(results);
		const local = withLocalFile(results, { provider: 'civitai', modelId: 'a', versionId: '1', fileId: null }, PATH);
		expect(withLocalFile(local, { provider: 'civitai', modelId: 'a', versionId: '1', fileId: null }, PATH)).toBe(local);
	});
});

describe('prompt helpers', () => {
	it('builds the embedding token from the file name (Windows and POSIX paths)', () => {
		expect(embeddingPromptToken('D:\\Anything\\ComfyUI\\ComfyUI\\models\\embeddings\\easynegative.safetensors')).toBe('embedding:easynegative');
		expect(embeddingPromptToken('/home/me/models/embeddings/bad.prompt.v2.pt')).toBe('embedding:bad.prompt.v2');
	});
});

describe('install phases and version status', () => {
	it('tells running phases from a failed or absent install', () => {
		expect([...RUNNING_INSTALL_PHASES]).toEqual(['checking', 'downloading', 'registering']);
		expect(isInstallRunning('downloading')).toBe(true);
		expect(isInstallRunning('failed')).toBe(false);
		expect(isInstallRunning(null)).toBe(false);
		expect(isInstallRunning(undefined)).toBe(false);
	});

	it('applies the documented precedence', () => {
		const unavailable = version({ unavailable_reason: 'No SafeTensors file' });
		const onDisk = version({ files: [{ ...SAFETENSORS, local_path: 'D:\\models\\loras\\add_detail.safetensors' }] });
		expect(versionStatusKind(unavailable, 'downloading', true)).toBe('unavailable');
		expect(versionStatusKind(onDisk, 'checking', true)).toBe('installing');
		expect(versionStatusKind(onDisk, 'registering', true)).toBe('installing');
		expect(versionStatusKind(onDisk, 'failed', true)).toBe('failed');
		expect(versionStatusKind(onDisk, null, true)).toBe('in_library');
		expect(versionStatusKind(onDisk, null, false)).toBe('on_disk');
		expect(versionStatusKind(version(), null, false)).toBe('remote');
		// Only the install file counts as a local copy.
		expect(versionStatusKind(version({ files: [SAFETENSORS, { ...PICKLE, local_path: 'D:\\x.pt' }] }), null, false)).toBe('remote');
	});
});

describe('install options and outcomes', () => {
	it('applies the defaults: select and announce', () => {
		expect(installOptions()).toEqual({ select: true, announce: true });
		expect(installOptions({})).toEqual({ select: true, announce: true });
		expect(installOptions({ select: false })).toEqual({ select: false, announce: true });
		expect(installOptions({ select: undefined, announce: false })).toEqual({ select: true, announce: false });
	});

	it('tells the library entry an outcome provides, or why it provides none', () => {
		const installed = installedModel(DETAIL_TWEAKER, DETAIL_TWEAKER_VERSION, 'D:/models/loras/add_detail.safetensors');
		expect(installOutcomeEntry({ status: 'installed', installed, entryId: 'add-detail' })).toEqual({ entryId: 'add-detail' });
		expect(installOutcomeEntry({ status: 'installed', installed: { ...installed, kind: 'embedding' }, entryId: null })).toEqual({ problem: NO_LIBRARY_ENTRY });
		expect(installOutcomeEntry({ status: 'failed', error: 'SHA-256 mismatch' })).toEqual({ problem: 'SHA-256 mismatch' });
		expect(installOutcomeEntry({ status: 'cancelled' })).toEqual({ problem: INSTALL_CANCELLED });
		expect(installOutcomeEntry({ status: 'refused', reason: INSTALL_ALREADY_RUNNING })).toEqual({ problem: INSTALL_ALREADY_RUNNING });
	});
});

describe('labels', () => {
	it('labels every kind and sort', () => {
		expect(MODEL_KIND_LABELS).toEqual({ checkpoint: 'Checkpoint', lora: 'LoRA', embedding: 'Embedding' });
		expect(MODEL_SORT_LABELS).toEqual({ most_downloaded: 'Most downloaded', highest_rated: 'Highest rated', newest: 'Newest' });
	});
});
