import { describe, expect, it } from 'vitest';
import { MODEL_SEARCH_QUERY_DEFAULTS } from '../api/defaults.gen';
import type { RemoteModel, RemoteModelVersion } from '../api/types';
import { DETAIL_TWEAKER_FILE as SAFETENSORS, DETAIL_TWEAKER_VERSION, remoteFile, remoteModel, remoteVersion } from '../test/modelLibraryData';
import {
	appendResults,
	buildSearchQuery,
	DEFAULT_CATALOG_FILTERS,
	embeddingPromptToken,
	installFile,
	installKey,
	isInstallRunning,
	MODEL_KIND_LABELS,
	MODEL_SORT_LABELS,
	modelKey,
	pickedVersion,
	RUNNING_INSTALL_PHASES,
	triggerWordsText,
	versionStatusKind,
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

describe('appendResults', () => {
	it('appends a page in order and drops models already listed', () => {
		const first = [model('1'), model('2')];
		const merged = appendResults(first, [model('2'), model('3'), model('3'), { ...model('1'), provider: 'huggingface' }]);
		expect(merged.map(modelKey)).toEqual(['civitai:1', 'civitai:2', 'civitai:3', 'huggingface:1']);
		expect(merged[0]).toBe(first[0]);
		expect(appendResults([], first)).toEqual(first);
	});
});

describe('prompt helpers', () => {
	it('joins trigger words for a prompt', () => {
		expect(triggerWordsText([' easynegative ', '', 'detailed', '   '])).toBe('easynegative, detailed');
		expect(triggerWordsText([])).toBe('');
	});

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

describe('labels', () => {
	it('labels every kind and sort', () => {
		expect(MODEL_KIND_LABELS).toEqual({ checkpoint: 'Checkpoint', lora: 'LoRA', embedding: 'Embedding' });
		expect(MODEL_SORT_LABELS).toEqual({ most_downloaded: 'Most downloaded', highest_rated: 'Highest rated', newest: 'Newest' });
	});
});
