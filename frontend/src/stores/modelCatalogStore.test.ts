import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client';
import type { DownloadTaskEvent, InstalledModel, InstallJob, InstallResponse, ModelSearchPage, RemoteModel, RemoteModelVersion } from '../api/types';
import { buildSearchQuery, DEFAULT_CATALOG_FILTERS, installKey } from '../domain/modelCatalog';
import { clipboard } from '../services/clipboard';
import {
	downloadEvent as buildDownloadEvent,
	DETAIL_TWEAKER,
	EASYNEGATIVE as EMBEDDING_MODEL,
	EASYNEGATIVE_VERSION as EMBEDDING_VERSION,
	INFO,
	installedModel,
	JANKU as CHECKPOINT_MODEL,
	JANKU_VERSION as CHECKPOINT_VERSION,
	PROVIDER as CIVITAI,
	DETAIL_TWEAKER_FILE as LORA_FILE,
	DETAIL_TWEAKER_VERSION as LORA_VERSION,
	remoteFile,
	remoteModel,
	remoteVersion,
} from '../test/modelLibraryData';
import { useLibraryStore } from './libraryStore';
import {
	SEARCH_DEBOUNCE_MS,
	selectActiveProvider,
	selectDetachedInstallKeys,
	useModelCatalogStore,
	usePickedVersion,
	useVersionStatus,
	type InstallEntry,
} from './modelCatalogStore';
import { useNotificationsStore } from './notificationsStore';
import { useTasksStore } from './tasksStore';

// ---------------------------------------------------------------------------
// Fixtures: the real Civitai models of src/test/modelLibraryData.ts
// ---------------------------------------------------------------------------

const LORA_OLD_VERSION = remoteVersion({
	...LORA_VERSION,
	id: '60000',
	name: 'v0.9',
	files: [remoteFile({ ...LORA_FILE, id: '40000', name: 'add_detail_v09.safetensors', sha256: null })],
	default_file_id: '40000',
});
const LORA_MODEL = remoteModel({ ...DETAIL_TWEAKER, versions: [LORA_VERSION, LORA_OLD_VERSION] });

const MODELS_DIR = 'D:\\Anything\\ComfyUI\\ComfyUI\\models';

/** The InstalledModel the backend answers for a version installed in <MODELS_DIR>/<folder>. */
function installed(model: RemoteModel, version: RemoteModelVersion, folder: string): InstalledModel {
	return installedModel(model, version, `${MODELS_DIR}\\${folder}\\${version.files[0].name}`);
}

const INSTALLED_LORA = installed(LORA_MODEL, LORA_VERSION, 'loras');
const INSTALLED_CHECKPOINT = installed(CHECKPOINT_MODEL, CHECKPOINT_VERSION, 'checkpoints');
const INSTALLED_EMBEDDING = installed(EMBEDDING_MODEL, EMBEDDING_VERSION, 'embeddings');

const page = (items: RemoteModel[], nextCursor: string | null = null): ModelSearchPage => ({ items, next_cursor: nextCursor });
const installedAnswer = (model: InstalledModel): InstallResponse => ({ state: 'installed', installed: model, task_id: null });
const downloadingAnswer = (taskId: string): InstallResponse => ({ state: 'downloading', installed: null, task_id: taskId });
const downloadEvent = (taskId: string, overrides: Partial<DownloadTaskEvent> = {}): DownloadTaskEvent =>
	buildDownloadEvent(taskId, { title: 'Detail Tweaker LoRA - v1.0', current: 1024, total: LORA_FILE.size_bytes, ...overrides });

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

/** Lets pending promise callbacks run (real timers). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const catalog = () => useModelCatalogStore.getState();
const notifications = () => useNotificationsStore.getState().notifications.map(({ intent, title, message }) => ({ intent, title, message }));
const LORA_KEY = installKey('civitai', LORA_VERSION, null);

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Info and search
// ---------------------------------------------------------------------------

describe('activate', () => {
	it('loads the info once and runs the first search once', async () => {
		const modelLibraryInfo = vi.spyOn(api, 'modelLibraryInfo').mockResolvedValue(INFO);
		const searchModels = vi.spyOn(api, 'searchModels').mockResolvedValue(page([LORA_MODEL], 'c1'));

		await Promise.all([catalog().activate(), catalog().activate()]);
		await catalog().activate();

		expect(modelLibraryInfo).toHaveBeenCalledTimes(1);
		expect(searchModels).toHaveBeenCalledTimes(1);
		expect(searchModels).toHaveBeenCalledWith(buildSearchQuery(DEFAULT_CATALOG_FILTERS, null), expect.any(AbortSignal));
		expect(searchModels.mock.calls[0][0]).toEqual({
			provider: 'civitai',
			query: '',
			kinds: [],
			base_models: [],
			sort: 'most_downloaded',
			nsfw: false,
			limit: 20,
			cursor: null,
		});
		expect(catalog()).toMatchObject({ info: INFO, infoStatus: 'ready', infoError: null, results: [LORA_MODEL], nextCursor: 'c1', searchStatus: 'ready' });
		expect(selectActiveProvider(catalog())).toBe(CIVITAI);
	});

	it('keeps failures in the state without notifications; a failed info loads again on the next activation', async () => {
		const modelLibraryInfo = vi.spyOn(api, 'modelLibraryInfo').mockRejectedValue(new Error('backend down'));
		const searchModels = vi.spyOn(api, 'searchModels').mockRejectedValue(new ApiError('Civitai is not reachable', 502, null));

		await catalog().activate();

		expect(catalog()).toMatchObject({
			info: null,
			infoStatus: 'failed',
			infoError: 'backend down',
			results: [],
			searchStatus: 'failed',
			searchError: 'Civitai is not reachable',
		});
		expect(selectActiveProvider(catalog())).toBeNull();
		expect(notifications()).toEqual([]);

		modelLibraryInfo.mockResolvedValue(INFO);
		await catalog().activate();
		expect(modelLibraryInfo).toHaveBeenCalledTimes(2);
		expect(searchModels).toHaveBeenCalledTimes(1);
		expect(catalog()).toMatchObject({ infoStatus: 'ready', infoError: null, searchStatus: 'failed' });
	});
});

describe('search', () => {
	it('debounces the query text', async () => {
		vi.useFakeTimers();
		const searchModels = vi.spyOn(api, 'searchModels').mockResolvedValue(page([LORA_MODEL]));

		catalog().setQuery('det');
		catalog().setQuery(' detail ');
		expect(catalog().filters.query).toBe(' detail ');
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
		expect(searchModels).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(searchModels).toHaveBeenCalledTimes(1);
		expect(searchModels.mock.calls[0][0]).toMatchObject({ query: 'detail', cursor: null });
		expect(catalog().results).toEqual([LORA_MODEL]);

		catalog().setQuery(' detail ');
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(searchModels).toHaveBeenCalledTimes(1);
	});

	it('an explicit search cancels the pending debounced one', async () => {
		vi.useFakeTimers();
		const searchModels = vi.spyOn(api, 'searchModels').mockResolvedValue(page([]));

		catalog().setQuery('pony');
		await catalog().search();
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2);

		expect(searchModels).toHaveBeenCalledTimes(1);
		expect(searchModels.mock.calls[0][0].query).toBe('pony');
	});

	it('searches immediately when another filter changes, from the first page', async () => {
		const searchModels = vi.spyOn(api, 'searchModels').mockResolvedValue(page([CHECKPOINT_MODEL]));
		useModelCatalogStore.setState({ results: [LORA_MODEL], nextCursor: 'c1', searchStatus: 'ready' });

		catalog().setKinds(['checkpoint', 'lora']);
		expect(catalog()).toMatchObject({ searchStatus: 'loading', nextCursor: null, results: [LORA_MODEL] });
		await settle();
		expect(catalog()).toMatchObject({ searchStatus: 'ready', results: [CHECKPOINT_MODEL], nextCursor: null });

		catalog().setBaseModels(['Illustrious']);
		catalog().setSort('newest');
		catalog().setNsfw(true);
		await settle();

		expect(searchModels.mock.calls.map(([query]) => query)).toEqual([
			{ ...buildSearchQuery(DEFAULT_CATALOG_FILTERS, null), kinds: ['checkpoint', 'lora'] },
			{ ...buildSearchQuery(DEFAULT_CATALOG_FILTERS, null), kinds: ['checkpoint', 'lora'], base_models: ['Illustrious'] },
			{ ...buildSearchQuery(DEFAULT_CATALOG_FILTERS, null), kinds: ['checkpoint', 'lora'], base_models: ['Illustrious'], sort: 'newest' },
			{ ...buildSearchQuery(DEFAULT_CATALOG_FILTERS, null), kinds: ['checkpoint', 'lora'], base_models: ['Illustrious'], sort: 'newest', nsfw: true },
		]);
		expect(catalog().filters).toEqual({ ...DEFAULT_CATALOG_FILTERS, kinds: ['checkpoint', 'lora'], base_models: ['Illustrious'], sort: 'newest', nsfw: true });
	});

	it('aborts the request in flight and ignores stale answers and failures', async () => {
		const slow = deferred<ModelSearchPage>();
		const slower = deferred<ModelSearchPage>();
		const searchModels = vi
			.spyOn(api, 'searchModels')
			.mockReturnValueOnce(slow.promise)
			.mockReturnValueOnce(slower.promise)
			.mockResolvedValueOnce(page([CHECKPOINT_MODEL]));

		const first = catalog().search();
		const second = catalog().search();
		const third = catalog().search();
		const [firstSignal, secondSignal, thirdSignal] = searchModels.mock.calls.map(([, signal]) => signal);
		expect([firstSignal?.aborted, secondSignal?.aborted, thirdSignal?.aborted]).toEqual([true, true, false]);
		await third;

		slow.resolve(page([LORA_MODEL]));
		slower.reject(new DOMException('The operation was aborted.', 'AbortError'));
		await Promise.all([first, second]);

		expect(catalog()).toMatchObject({ results: [CHECKPOINT_MODEL], searchStatus: 'ready', searchError: null });
	});

	it('a failed first page shows no stale results', async () => {
		useModelCatalogStore.setState({ results: [LORA_MODEL], searchStatus: 'ready' });
		vi.spyOn(api, 'searchModels').mockRejectedValue(new Error('timeout'));

		await catalog().search();

		expect(catalog()).toMatchObject({ results: [], searchStatus: 'failed', searchError: 'timeout' });
	});

	it('loadMore appends the next page without duplicates; no-op without a cursor or while searching', async () => {
		const searchModels = vi.spyOn(api, 'searchModels').mockResolvedValueOnce(page([LORA_MODEL], 'c1'));
		await catalog().search();

		const next = deferred<ModelSearchPage>();
		searchModels.mockReturnValueOnce(next.promise);
		const loading = catalog().loadMore();
		expect(catalog().searchStatus).toBe('loadingMore');
		await catalog().loadMore();
		expect(searchModels).toHaveBeenCalledTimes(2);
		expect(searchModels.mock.calls[1][0]).toEqual(buildSearchQuery(DEFAULT_CATALOG_FILTERS, 'c1'));

		next.resolve(page([LORA_MODEL, CHECKPOINT_MODEL]));
		await loading;
		expect(catalog()).toMatchObject({ results: [LORA_MODEL, CHECKPOINT_MODEL], nextCursor: null, searchStatus: 'ready' });

		await catalog().loadMore();
		expect(searchModels).toHaveBeenCalledTimes(2);
	});

	it('a failed further page keeps the results and the cursor', async () => {
		vi.spyOn(api, 'searchModels').mockResolvedValueOnce(page([LORA_MODEL], 'c1')).mockRejectedValueOnce(new Error('rate limited'));
		await catalog().search();

		await catalog().loadMore();

		expect(catalog()).toMatchObject({ results: [LORA_MODEL], nextCursor: 'c1', searchStatus: 'failed', searchError: 'rate limited' });
	});
});

// ---------------------------------------------------------------------------
// Installs
// ---------------------------------------------------------------------------

describe('install', () => {
	it('registers and selects a LoRA that is already on disk', async () => {
		const answer = deferred<InstallResponse>();
		const installModel = vi.spyOn(api, 'installModel').mockReturnValue(answer.promise);

		const installing = catalog().install(LORA_MODEL, LORA_VERSION);
		expect(catalog().installs[LORA_KEY]).toEqual({
			key: 'civitai:62833:44319',
			provider: 'civitai',
			modelId: '58390',
			versionId: '62833',
			fileId: null,
			kind: 'lora',
			phase: 'checking',
			taskId: null,
			error: null,
		});
		answer.resolve(installedAnswer(INSTALLED_LORA));
		await installing;

		expect(installModel).toHaveBeenCalledWith({ provider: 'civitai', version_id: '62833', file_id: null });
		expect(catalog().installs).toEqual({});
		expect(useLibraryStore.getState().loras).toEqual([{ id: 'add-detail', name: INSTALLED_LORA.name, path: INSTALLED_LORA.path, source: INSTALLED_LORA.source }]);
		expect(useLibraryStore.getState().selectedLoraIds).toEqual(['add-detail']);
		expect(notifications()).toEqual([
			{ intent: 'success', title: null, message: 'Detail Tweaker LoRA - v1.0 is ready and selected for generation.' },
		]);
	});

	it('selects an installed checkpoint as the model', async () => {
		vi.spyOn(api, 'installModel').mockResolvedValue(installedAnswer(INSTALLED_CHECKPOINT));

		await catalog().install(CHECKPOINT_MODEL, CHECKPOINT_VERSION);

		expect(useLibraryStore.getState().selectedModelId).toBe('janku-v7-777-safetensors');
		expect(useLibraryStore.getState().models[0]).toMatchObject({ name: INSTALLED_CHECKPOINT.name, source: INSTALLED_CHECKPOINT.source });
	});

	it('tells how to use an installed embedding (no library entry)', async () => {
		vi.spyOn(api, 'installModel').mockResolvedValue(installedAnswer(INSTALLED_EMBEDDING));

		await catalog().install(EMBEDDING_MODEL, EMBEDDING_VERSION);

		expect(useLibraryStore.getState()).toMatchObject({ models: [], loras: [] });
		expect(catalog().installs).toEqual({});
		expect(notifications()).toEqual([
			{ intent: 'info', title: null, message: 'EasyNegative - EasyNegative is ready: write embedding:easynegative in a prompt to use it.' },
		]);
	});

	it('downloads, follows the task, then installs again and registers', async () => {
		const registering = deferred<InstallResponse>();
		const installModel = vi
			.spyOn(api, 'installModel')
			.mockResolvedValueOnce(downloadingAnswer('task-download'))
			.mockReturnValueOnce(registering.promise);

		const installing = catalog().install(LORA_MODEL, LORA_VERSION);
		await settle();
		expect(catalog().installs[LORA_KEY]).toMatchObject({ phase: 'downloading', taskId: 'task-download' });

		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-download')));
		await settle();
		expect(catalog().installs[LORA_KEY].phase).toBe('downloading');
		expect(installModel).toHaveBeenCalledTimes(1);

		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-download', { stage: 'complete', current: LORA_FILE.size_bytes })));
		await settle();
		expect(catalog().installs[LORA_KEY]).toMatchObject({ phase: 'registering', taskId: 'task-download' });

		registering.resolve(installedAnswer(INSTALLED_LORA));
		await installing;
		expect(installModel.mock.calls).toEqual([
			[{ provider: 'civitai', version_id: '62833', file_id: null }],
			[{ provider: 'civitai', version_id: '62833', file_id: null }],
		]);
		expect(catalog().installs).toEqual({});
		expect(useLibraryStore.getState().selectedLoraIds).toEqual(['add-detail']);
	});

	it('keeps a failed download with the event message until dismissed', async () => {
		const installModel = vi.spyOn(api, 'installModel').mockResolvedValue(downloadingAnswer('task-error'));

		const installing = catalog().install(LORA_MODEL, LORA_VERSION);
		await settle();
		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-error', { stage: 'error', message: 'SHA-256 mismatch' })));
		await installing;

		expect(installModel).toHaveBeenCalledTimes(1);
		expect(catalog().installs[LORA_KEY]).toMatchObject({ phase: 'failed', error: 'SHA-256 mismatch', taskId: 'task-error' });
		expect(notifications()).toEqual([{ intent: 'error', title: 'Download failed', message: 'Detail Tweaker LoRA - v1.0: SHA-256 mismatch' }]);
		expect(useLibraryStore.getState().loras).toEqual([]);

		catalog().dismissInstallError(LORA_KEY);
		expect(catalog().installs).toEqual({});
	});

	it('cancels a download: the cancelled task removes the install', async () => {
		vi.spyOn(api, 'installModel').mockResolvedValue(downloadingAnswer('task-cancel'));
		const cancelDownload = vi.spyOn(api, 'cancelDownload').mockImplementation(async (taskId) => {
			useTasksStore.getState().applyEvent(downloadEvent(taskId, { stage: 'cancelled', message: 'Cancelled' }));
		});

		const installing = catalog().install(LORA_MODEL, LORA_VERSION);
		await settle();
		await catalog().cancelInstall(LORA_KEY);
		await installing;

		expect(cancelDownload).toHaveBeenCalledWith('task-cancel');
		expect(catalog().installs).toEqual({});
		expect(notifications()).toEqual([]);
	});

	it('cancelInstall reports failures and ignores installs that are not downloading', async () => {
		const cancelDownload = vi.spyOn(api, 'cancelDownload').mockRejectedValue(new ApiError('Backend unreachable', 503, null));
		const entry: InstallEntry = { key: LORA_KEY, provider: 'civitai', modelId: '58390', versionId: '62833', fileId: null, kind: 'lora', phase: 'checking', taskId: null, error: null };
		useModelCatalogStore.setState({ installs: { [LORA_KEY]: entry } });

		await catalog().cancelInstall(LORA_KEY);
		await catalog().cancelInstall('unknown');
		expect(cancelDownload).not.toHaveBeenCalled();

		const downloading = { ...entry, phase: 'downloading' as const, taskId: 'task-1' };
		useModelCatalogStore.setState({ installs: { [LORA_KEY]: downloading } });
		await catalog().cancelInstall(LORA_KEY);
		expect(cancelDownload).toHaveBeenCalledWith('task-1');
		expect(catalog().installs[LORA_KEY]).toBe(downloading);
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not cancel the download', message: 'Backend unreachable' }]);
	});

	it('cancelInstall drops an install whose download the backend no longer runs (404)', async () => {
		vi.spyOn(api, 'cancelDownload').mockRejectedValue(new ApiError("No running download 'lost'.", 404, null));
		const lost: InstallEntry = { key: LORA_KEY, provider: 'civitai', modelId: '58390', versionId: '62833', fileId: null, kind: 'lora', phase: 'downloading', taskId: 'lost', error: null };
		useModelCatalogStore.setState({ installs: { [LORA_KEY]: lost } });

		await catalog().cancelInstall(LORA_KEY);

		expect(catalog().installs).toEqual({});
		expect(notifications()).toEqual([]);
	});

	it('a download that just finished (cancel answers 404 before its complete event) is still registered', async () => {
		vi.spyOn(api, 'installModel').mockResolvedValueOnce(downloadingAnswer('task-race')).mockResolvedValueOnce(installedAnswer(INSTALLED_LORA));
		vi.spyOn(api, 'cancelDownload').mockRejectedValue(new ApiError("No running download 'task-race'.", 404, null));

		const installing = catalog().install(LORA_MODEL, LORA_VERSION);
		await settle();
		await catalog().cancelInstall(LORA_KEY);
		expect(catalog().installs).toEqual({});

		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-race', { stage: 'complete' })));
		await installing;

		expect(catalog().installs).toEqual({});
		expect(useLibraryStore.getState().selectedLoraIds).toEqual(['add-detail']);
	});

	it('API errors fail the install and are reported; a retry runs again', async () => {
		const installModel = vi.spyOn(api, 'installModel').mockRejectedValueOnce(new ApiError('This file needs a Civitai API token', 403, null));

		await catalog().install(LORA_MODEL, LORA_VERSION);

		expect(catalog().installs[LORA_KEY]).toMatchObject({ phase: 'failed', error: 'This file needs a Civitai API token' });
		expect(notifications()).toEqual([{ intent: 'error', title: 'Install failed', message: 'This file needs a Civitai API token' }]);

		installModel.mockResolvedValueOnce(installedAnswer(INSTALLED_LORA));
		await catalog().install(LORA_MODEL, LORA_VERSION);
		expect(installModel).toHaveBeenCalledTimes(2);
		expect(catalog().installs).toEqual({});
	});

	it('fails when a completed download is not installed by the backend', async () => {
		vi.spyOn(api, 'installModel').mockResolvedValueOnce(downloadingAnswer('task-again')).mockResolvedValueOnce(downloadingAnswer('task-again-2'));

		const installing = catalog().install(LORA_MODEL, LORA_VERSION);
		await settle();
		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-again', { stage: 'complete' })));
		await installing;

		expect(catalog().installs[LORA_KEY]).toMatchObject({ phase: 'failed', error: 'The download completed but the backend did not install the file.' });
	});

	it('is a no-op while the same install runs', async () => {
		const answer = deferred<InstallResponse>();
		const installModel = vi.spyOn(api, 'installModel').mockReturnValue(answer.promise);

		const first = catalog().install(LORA_MODEL, LORA_VERSION);
		await catalog().install(LORA_MODEL, LORA_VERSION, LORA_FILE.id);
		answer.resolve(installedAnswer(INSTALLED_LORA));
		await first;

		expect(installModel).toHaveBeenCalledTimes(1);
	});

	it('installs an explicitly chosen file under its own key', async () => {
		const installModel = vi.spyOn(api, 'installModel').mockResolvedValue(downloadingAnswer('task-file'));
		const version = { ...LORA_VERSION, files: [LORA_FILE, { ...LORA_FILE, id: '50000', name: 'add_detail_full.safetensors' }] };

		const installing = catalog().install(LORA_MODEL, version, '50000');
		await settle();

		expect(installModel).toHaveBeenCalledWith({ provider: 'civitai', version_id: '62833', file_id: '50000' });
		expect(Object.keys(catalog().installs)).toEqual(['civitai:62833:50000']);
		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-file', { stage: 'cancelled' })));
		await installing;
	});

	it('refuses an unavailable version upfront', async () => {
		const installModel = vi.spyOn(api, 'installModel');
		const version = { ...LORA_VERSION, default_file_id: null, unavailable_reason: 'Only pickle files: not downloadable.' };

		await catalog().install(LORA_MODEL, version);

		expect(installModel).not.toHaveBeenCalled();
		expect(catalog().installs['civitai:62833:']).toMatchObject({ phase: 'failed', error: 'Only pickle files: not downloadable.' });
		expect(notifications()).toEqual([{ intent: 'warning', title: 'Detail Tweaker LoRA cannot be installed', message: 'Only pickle files: not downloadable.' }]);
	});
});

describe('resumeInstalls', () => {
	const JOB: InstallJob = {
		task_id: 'task-resumed',
		provider: 'civitai',
		model_id: '58390',
		version_id: '62833',
		file_id: '44319',
		kind: 'lora',
		title: 'Detail Tweaker LoRA - v1.0',
	};

	it('follows each running install like install() (same key as the result card)', async () => {
		vi.spyOn(api, 'listInstalls').mockResolvedValue([JOB]);
		const installModel = vi.spyOn(api, 'installModel').mockResolvedValue(installedAnswer(INSTALLED_LORA));

		const resuming = catalog().resumeInstalls();
		await settle();
		expect(catalog().installs[LORA_KEY]).toEqual({
			key: LORA_KEY,
			provider: 'civitai',
			modelId: '58390',
			versionId: '62833',
			fileId: '44319',
			kind: 'lora',
			phase: 'downloading',
			taskId: 'task-resumed',
			error: null,
		});
		expect(installModel).not.toHaveBeenCalled();

		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-resumed', { stage: 'complete' })));
		await resuming;

		expect(installModel).toHaveBeenCalledWith({ provider: 'civitai', version_id: '62833', file_id: '44319' });
		expect(catalog().installs).toEqual({});
		expect(useLibraryStore.getState().selectedLoraIds).toEqual(['add-detail']);
	});

	it('does not follow an install twice', async () => {
		vi.spyOn(api, 'listInstalls').mockResolvedValue([JOB]);
		const running: InstallEntry = { key: LORA_KEY, provider: 'civitai', modelId: '58390', versionId: '62833', fileId: null, kind: 'lora', phase: 'downloading', taskId: JOB.task_id, error: null };
		useModelCatalogStore.setState({ installs: { [LORA_KEY]: running } });

		await catalog().resumeInstalls();

		expect(catalog().installs[LORA_KEY]).toBe(running);
	});

	it('ignores failures', async () => {
		vi.spyOn(api, 'listInstalls').mockRejectedValue(new Error('backend down'));
		await expect(catalog().resumeInstalls()).resolves.toBeUndefined();
		expect(catalog().installs).toEqual({});
		expect(notifications()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Token, clipboard
// ---------------------------------------------------------------------------

describe('setProviderToken', () => {
	it('replaces the provider info with the answer and never keeps the token', async () => {
		useModelCatalogStore.setState({ info: INFO, infoStatus: 'ready' });
		const setProviderToken = vi.spyOn(api, 'setProviderToken').mockResolvedValueOnce({ ...CIVITAI, token_set: true });

		await catalog().setProviderToken('civitai', 'secret-token-123');

		expect(setProviderToken).toHaveBeenCalledWith('civitai', 'secret-token-123');
		expect(selectActiveProvider(catalog())).toEqual({ ...CIVITAI, token_set: true });
		expect(JSON.stringify(catalog())).not.toContain('secret-token-123');
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Civitai API token saved.' }]);

		setProviderToken.mockResolvedValueOnce(CIVITAI);
		await catalog().setProviderToken('civitai', null);
		expect(setProviderToken).toHaveBeenLastCalledWith('civitai', null);
		expect(selectActiveProvider(catalog())?.token_set).toBe(false);
		expect(notifications().at(-1)).toEqual({ intent: 'success', title: null, message: 'Civitai API token removed.' });
	});

	it('reports failures and keeps the info', async () => {
		useModelCatalogStore.setState({ info: INFO, infoStatus: 'ready' });
		vi.spyOn(api, 'setProviderToken').mockRejectedValue(new ApiError('Token rejected', 400, null));

		await catalog().setProviderToken('civitai', 'bad');

		expect(catalog().info).toBe(INFO);
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not save the API token', message: 'Token rejected' }]);
	});
});

describe('copy actions', () => {
	it('copies trigger words and embedding tokens with feedback', async () => {
		const writeText = vi.spyOn(clipboard, 'writeText').mockResolvedValue(undefined);

		await catalog().copyTriggerWords([' detailed ', '', 'sharp focus']);
		await catalog().copyEmbeddingToken(INSTALLED_EMBEDDING.path);
		await catalog().copyTriggerWords([]);

		expect(writeText.mock.calls).toEqual([['detailed, sharp focus'], ['embedding:easynegative']]);
		expect(notifications()).toEqual([
			{ intent: 'success', title: null, message: 'Trigger words copied to the clipboard.' },
			{ intent: 'success', title: null, message: 'Embedding token copied to the clipboard.' },
		]);
	});
});

// ---------------------------------------------------------------------------
// Selectors and hooks
// ---------------------------------------------------------------------------

describe('usePickedVersion', () => {
	it('shows the first version until another one is picked', () => {
		const { result } = renderHook(() => usePickedVersion(LORA_MODEL));
		expect(result.current).toBe(LORA_VERSION);

		act(() => catalog().pickVersion('civitai:58390', LORA_OLD_VERSION.id));
		expect(result.current).toBe(LORA_OLD_VERSION);

		const state = catalog();
		catalog().pickVersion('civitai:58390', LORA_OLD_VERSION.id);
		expect(catalog()).toBe(state);
	});
});

describe('selectDetachedInstallKeys', () => {
	it('lists the installs no result card shows', () => {
		const entry = (key: string): InstallEntry => ({ key, provider: 'civitai', modelId: '1', versionId: '1', fileId: null, kind: 'lora', phase: 'downloading', taskId: 't', error: null });
		const oldKey = installKey('civitai', LORA_OLD_VERSION, null);
		const installs = { [LORA_KEY]: entry(LORA_KEY), [oldKey]: entry(oldKey), 'civitai:1:2': entry('civitai:1:2') };
		useModelCatalogStore.setState({ results: [LORA_MODEL], installs });

		expect(selectDetachedInstallKeys(catalog())).toEqual([oldKey, 'civitai:1:2']);
		catalog().pickVersion('civitai:58390', LORA_OLD_VERSION.id);
		expect(selectDetachedInstallKeys(catalog())).toEqual([LORA_KEY, 'civitai:1:2']);
	});
});

describe('useVersionStatus', () => {
	const renderStatus = (model: RemoteModel, version: RemoteModelVersion) =>
		renderHook(({ item, shown }) => useVersionStatus(item, shown), { initialProps: { item: model, shown: version } });
	const runningEntry: InstallEntry = {
		key: LORA_KEY,
		provider: 'civitai',
		modelId: '58390',
		versionId: '62833',
		fileId: null,
		kind: 'lora',
		phase: 'downloading',
		taskId: 'task-status',
		error: null,
	};

	it('remote: nothing local', () => {
		const { result } = renderStatus(LORA_MODEL, LORA_VERSION);
		expect(result.current).toEqual({
			kind: 'remote',
			reason: null,
			installKey: LORA_KEY,
			install: null,
			progress: null,
			libraryEntryId: null,
			sizeBytes: LORA_FILE.size_bytes,
		});
	});

	it('on_disk: the backend knows a local copy of the install file', () => {
		const version = { ...LORA_VERSION, files: [{ ...LORA_FILE, local_path: INSTALLED_LORA.path }] };
		expect(renderStatus(LORA_MODEL, version).result.current.kind).toBe('on_disk');
	});

	it('in_library: a library entry has this provenance (by hash or by version)', () => {
		useLibraryStore.getState().registerInstalled(INSTALLED_LORA);
		const { result } = renderStatus(LORA_MODEL, LORA_VERSION);
		expect(result.current).toMatchObject({ kind: 'in_library', libraryEntryId: 'add-detail' });

		// The old version has no hash: matched by provider + version id only.
		expect(renderStatus(LORA_MODEL, LORA_OLD_VERSION).result.current.kind).toBe('remote');
		useLibraryStore.getState().registerInstalled(installed(LORA_MODEL, LORA_OLD_VERSION, 'loras'));
		expect(renderStatus(LORA_MODEL, LORA_OLD_VERSION).result.current).toMatchObject({ kind: 'in_library', libraryEntryId: 'add-detail-v09' });
	});

	it('installing: with the download progress of its task', () => {
		useModelCatalogStore.setState({ installs: { [LORA_KEY]: runningEntry } });
		const { result } = renderStatus(LORA_MODEL, LORA_VERSION);
		expect(result.current).toMatchObject({ kind: 'installing', install: runningEntry, progress: null, reason: null });

		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-status', { current: LORA_FILE.size_bytes / 2 })));
		expect(result.current.progress).toMatchObject({ stage: 'downloading', ratio: 0.5, active: true, title: 'Detail Tweaker LoRA - v1.0' });
	});

	it('failed: with the install error and without progress', () => {
		useTasksStore.getState().applyEvent(downloadEvent('task-status', { stage: 'error', message: 'Disk full' }));
		useModelCatalogStore.setState({ installs: { [LORA_KEY]: { ...runningEntry, phase: 'failed', error: 'Disk full' } } });
		useLibraryStore.getState().registerInstalled(INSTALLED_LORA);
		expect(renderStatus(LORA_MODEL, LORA_VERSION).result.current).toMatchObject({ kind: 'failed', reason: 'Disk full', progress: null, libraryEntryId: 'add-detail' });
	});

	it('unavailable: with the reason, first of all', () => {
		const version = { ...LORA_VERSION, default_file_id: null, unavailable_reason: 'Unsupported base model: Flux.1 D' };
		useModelCatalogStore.setState({ installs: { 'civitai:62833:': { ...runningEntry, key: 'civitai:62833:' } } });
		expect(renderStatus(LORA_MODEL, version).result.current).toMatchObject({
			kind: 'unavailable',
			reason: 'Unsupported base model: Flux.1 D',
			installKey: 'civitai:62833:',
			sizeBytes: null,
		});
	});

	it('returns the same object while its inputs do not change', () => {
		useModelCatalogStore.setState({ installs: { [LORA_KEY]: runningEntry } });
		useTasksStore.getState().applyEvent(downloadEvent('task-status'));
		let renders = 0;
		const { result, rerender } = renderHook(
			({ item, shown }) => {
				renders += 1;
				return useVersionStatus(item, shown);
			},
			{ initialProps: { item: LORA_MODEL, shown: LORA_VERSION } },
		);
		const first = result.current;

		rerender({ item: LORA_MODEL, shown: LORA_VERSION });
		act(() => {
			useTasksStore.getState().applyEvent(downloadEvent('another-task'));
			useModelCatalogStore.setState({ installs: { ...catalog().installs, 'civitai:1:2': { ...runningEntry, key: 'civitai:1:2' } } });
			useLibraryStore.getState().registerInstalled(INSTALLED_CHECKPOINT);
			catalog().pickVersion('civitai:58390', LORA_OLD_VERSION.id);
		});
		expect(result.current).toBe(first);
		expect(renders).toBeLessThan(10);

		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-status', { current: 2048 })));
		expect(result.current).not.toBe(first);
		expect(result.current.progress?.current).toBe(2048);
	});
});
