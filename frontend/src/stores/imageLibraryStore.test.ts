import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client';
import type { FavoriteImage, ImageSearchPage, InstalledModel, InstallResponse, RemoteImage, ResolvedImageResource } from '../api/types';
import { subPromptKeyOf } from '../domain/categories';
import { buildImageSearchQuery, DEFAULT_IMAGE_FILTERS, imageKey, type ImageResolution } from '../domain/imageLibrary';
import { installKey, type InstallOutcome } from '../domain/modelCatalog';
import { clipboard } from '../services/clipboard';
import {
	ADD_DETAIL_RESOURCE,
	CHILLOUT,
	CHILLOUT_RESOURCE,
	DETAIL_IMAGE,
	DETAIL_IMAGE_RESOLUTION,
	favoriteImage,
	imageParams,
	KIM_LORA,
	KIM_RESOURCE,
	remoteImage,
	resolvedResource,
} from '../test/imageLibraryData';
import { DETAIL_TWEAKER, DETAIL_TWEAKER_VERSION, downloadEvent, installedModel, installEntry, JANKU, JANKU_VERSION } from '../test/modelLibraryData';
import { useCategoriesStore } from './categoriesStore';
import {
	selectImage,
	selectIsFavorite,
	selectSelectedImage,
	useImageCheckpointRow,
	useImageLibraryStore,
	useImageLoraRows,
	useImageTags,
} from './imageLibraryStore';
import { useLibraryStore } from './libraryStore';
import { useModelCatalogStore } from './modelCatalogStore';
import { useNotificationsStore } from './notificationsStore';
import { SEARCH_DEBOUNCE_MS } from './pagedSearch';
import { useTasksStore } from './tasksStore';

// ---------------------------------------------------------------------------
// Fixtures: DETAIL_IMAGE (src/test/imageLibraryData.ts) = [CHILLOUT checkpoint, add_detail 1, kim_v_1 0.6, name-only]
// ---------------------------------------------------------------------------

const DETAIL_KEY = imageKey(DETAIL_IMAGE);
const OTHER_IMAGE = remoteImage({ id: '2002' });
const OTHER_KEY = imageKey(OTHER_IMAGE);
const KIM_VERSION = KIM_LORA.versions[0];
const KIM_KEY = installKey('civitai', KIM_VERSION, null);
const CHILLOUT_VERSION = CHILLOUT.versions[0];

const ADD_DETAIL_INSTALLED = installedModel(DETAIL_TWEAKER, DETAIL_TWEAKER_VERSION, 'D:/models/loras/add_detail.safetensors');
const KIM_INSTALLED = installedModel(KIM_LORA, KIM_VERSION, 'D:/models/loras/kim_v_1.safetensors');
const CHILLOUT_INSTALLED = installedModel(CHILLOUT, CHILLOUT_VERSION, 'D:/models/checkpoints/Chilloutmix-Ni-pruned-fp32-fix.safetensors');

const page = (items: RemoteImage[], nextCursor: string | null = null): ImageSearchPage => ({ items, next_cursor: nextCursor });
const ready = (items: ResolvedImageResource[] = DETAIL_IMAGE_RESOLUTION): ImageResolution => ({ status: 'ready', items, error: null });
const installed = (model: InstalledModel, entryId: string | null): InstallOutcome => ({ status: 'installed', installed: model, entryId });

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

const store = () => useImageLibraryStore.getState();
const notifications = () => useNotificationsStore.getState().notifications.map(({ intent, title, message }) => ({ intent, title, message }));

/** The search results hold these images; DETAIL_IMAGE is resolved unless `resolved` is false. */
function seedImages(images: RemoteImage[] = [DETAIL_IMAGE], resolved = true): void {
	useImageLibraryStore.setState({ results: images, searchStatus: 'ready', resolutions: resolved ? { [DETAIL_KEY]: ready() } : {} });
}

/** Spies replacing the library store actions the image library calls (the library store tests own their effect). */
function mockLibraryActions() {
	const actions = { setLoraSelection: vi.fn(), selectModel: vi.fn() };
	useLibraryStore.setState(actions);
	return actions;
}

/** Registers an installed file in the (real) library store without selecting it. */
const register = (model: InstalledModel) => useLibraryStore.getState().registerInstalled(model, { select: false });

function mockInstall(implementation: (...args: Parameters<ReturnType<typeof useModelCatalogStore.getState>['install']>) => Promise<InstallOutcome>) {
	const install = vi.fn(implementation);
	useModelCatalogStore.setState({ install });
	return install;
}

afterEach(() => {
	vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Activation and search
// ---------------------------------------------------------------------------

describe('activate', () => {
	it('runs the first search and loads the favorites once', async () => {
		const favorites = [favoriteImage(OTHER_IMAGE)];
		const searchImages = vi.spyOn(api, 'searchImages').mockResolvedValue(page([DETAIL_IMAGE], 'c1'));
		const listFavoriteImages = vi.spyOn(api, 'listFavoriteImages').mockResolvedValue(favorites);

		await Promise.all([store().activate(), store().activate()]);
		await store().activate();

		expect(searchImages).toHaveBeenCalledTimes(1);
		expect(searchImages).toHaveBeenCalledWith(buildImageSearchQuery(DEFAULT_IMAGE_FILTERS, null), expect.any(AbortSignal));
		expect(listFavoriteImages).toHaveBeenCalledTimes(1);
		expect(store()).toMatchObject({
			results: [DETAIL_IMAGE],
			nextCursor: 'c1',
			searchStatus: 'ready',
			favorites,
			favoritesStatus: 'ready',
			favoritesError: null,
		});
	});

	it('keeps failures in the state without notifications; failed favorites load again on the next activation', async () => {
		const searchImages = vi.spyOn(api, 'searchImages').mockRejectedValue(new ApiError('Civitai is not reachable', 502, null));
		const listFavoriteImages = vi.spyOn(api, 'listFavoriteImages').mockRejectedValue(new Error('backend down'));

		await expect(store().activate()).resolves.toBeUndefined();

		expect(store()).toMatchObject({ searchStatus: 'failed', searchError: 'Civitai is not reachable', favoritesStatus: 'failed', favoritesError: 'backend down' });
		expect(notifications()).toEqual([]);

		listFavoriteImages.mockResolvedValue([]);
		await store().activate();
		expect(listFavoriteImages).toHaveBeenCalledTimes(2);
		expect(searchImages).toHaveBeenCalledTimes(1);
		expect(store()).toMatchObject({ favoritesStatus: 'ready', favoritesError: null, searchStatus: 'failed' });
	});
});

describe('search', () => {
	it('debounces the query text', async () => {
		vi.useFakeTimers();
		const searchImages = vi.spyOn(api, 'searchImages').mockResolvedValue(page([DETAIL_IMAGE]));

		store().setQuery('cas');
		store().setQuery(' castle ');
		expect(store().filters.query).toBe(' castle ');
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
		expect(searchImages).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(searchImages).toHaveBeenCalledTimes(1);
		expect(searchImages.mock.calls[0][0]).toMatchObject({ query: 'castle', cursor: null });
		expect(store().results).toEqual([DETAIL_IMAGE]);

		store().setQuery(' castle ');
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(searchImages).toHaveBeenCalledTimes(1);
	});

	it('an explicit search cancels the pending debounced one', async () => {
		vi.useFakeTimers();
		const searchImages = vi.spyOn(api, 'searchImages').mockResolvedValue(page([]));

		store().setQuery('castle');
		await store().search();
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2);

		expect(searchImages).toHaveBeenCalledTimes(1);
		expect(searchImages.mock.calls[0][0].query).toBe('castle');
	});

	it('searches immediately from the first page when another filter changes (not when unchanged)', async () => {
		const searchImages = vi.spyOn(api, 'searchImages').mockResolvedValue(page([OTHER_IMAGE]));
		useImageLibraryStore.setState({ results: [DETAIL_IMAGE], nextCursor: 'c1', searchStatus: 'ready' });

		store().setSort('newest');
		expect(store()).toMatchObject({ searchStatus: 'loading', nextCursor: null, results: [DETAIL_IMAGE] });
		await settle();
		expect(store()).toMatchObject({ searchStatus: 'ready', results: [OTHER_IMAGE], nextCursor: null });

		store().setPeriod('month');
		store().setNsfw(true);
		store().setUsableOnly(false);
		store().setUsableOnly(false);
		store().setSort('newest');
		await settle();

		const base = buildImageSearchQuery(DEFAULT_IMAGE_FILTERS, null);
		expect(searchImages.mock.calls.map(([query]) => query)).toEqual([
			{ ...base, sort: 'newest' },
			{ ...base, sort: 'newest', period: 'month' },
			{ ...base, sort: 'newest', period: 'month', nsfw: true },
			{ ...base, sort: 'newest', period: 'month', nsfw: true, usable_only: false },
		]);
		expect(store().filters).toEqual({ ...DEFAULT_IMAGE_FILTERS, sort: 'newest', period: 'month', nsfw: true, usable_only: false });
	});

	it('a period change does not search while a keyword search ignores the period', () => {
		const searchImages = vi.spyOn(api, 'searchImages').mockResolvedValue(page([]));
		useImageLibraryStore.setState({ filters: { ...DEFAULT_IMAGE_FILTERS, query: 'castle' } });

		store().setPeriod('all_time');

		expect(store().filters.period).toBe('all_time');
		expect(searchImages).not.toHaveBeenCalled();
	});

	it('aborts the request in flight and ignores stale answers and failures', async () => {
		const slow = deferred<ImageSearchPage>();
		const slower = deferred<ImageSearchPage>();
		const searchImages = vi
			.spyOn(api, 'searchImages')
			.mockReturnValueOnce(slow.promise)
			.mockReturnValueOnce(slower.promise)
			.mockResolvedValueOnce(page([OTHER_IMAGE]));

		const first = store().search();
		const second = store().search();
		const third = store().search();
		const signals = searchImages.mock.calls.map(([, signal]) => signal?.aborted);
		expect(signals).toEqual([true, true, false]);
		await third;

		slow.resolve(page([DETAIL_IMAGE]));
		slower.reject(new DOMException('The operation was aborted.', 'AbortError'));
		await Promise.all([first, second]);

		expect(store()).toMatchObject({ results: [OTHER_IMAGE], searchStatus: 'ready', searchError: null });
	});

	it('a failed first page shows no stale results', async () => {
		useImageLibraryStore.setState({ results: [DETAIL_IMAGE], searchStatus: 'ready' });
		vi.spyOn(api, 'searchImages').mockRejectedValue(new Error('timeout'));

		await store().search();

		expect(store()).toMatchObject({ results: [], searchStatus: 'failed', searchError: 'timeout' });
	});

	it('loadMore appends the next page without duplicates; no-op without a cursor or while searching', async () => {
		const searchImages = vi.spyOn(api, 'searchImages').mockResolvedValueOnce(page([DETAIL_IMAGE], 'm:58390|c:2'));
		await store().search();

		const next = deferred<ImageSearchPage>();
		searchImages.mockReturnValueOnce(next.promise);
		const loading = store().loadMore();
		expect(store().searchStatus).toBe('loadingMore');
		await store().loadMore();
		expect(searchImages).toHaveBeenCalledTimes(2);
		expect(searchImages.mock.calls[1][0]).toEqual(buildImageSearchQuery(DEFAULT_IMAGE_FILTERS, 'm:58390|c:2'));

		next.resolve(page([DETAIL_IMAGE, OTHER_IMAGE]));
		await loading;
		expect(store()).toMatchObject({ results: [DETAIL_IMAGE, OTHER_IMAGE], nextCursor: null, searchStatus: 'ready' });

		await store().loadMore();
		expect(searchImages).toHaveBeenCalledTimes(2);
	});

	it('a failed further page keeps the results and the cursor', async () => {
		vi.spyOn(api, 'searchImages').mockResolvedValueOnce(page([DETAIL_IMAGE], 'c1')).mockRejectedValueOnce(new Error('rate limited'));
		await store().search();

		await store().loadMore();

		expect(store()).toMatchObject({ results: [DETAIL_IMAGE], nextCursor: 'c1', searchStatus: 'failed', searchError: 'rate limited' });
	});
});

// ---------------------------------------------------------------------------
// Detail view and resolution
// ---------------------------------------------------------------------------

describe('openImage and resolveResources', () => {
	it('shows the image and resolves its resources once', async () => {
		seedImages([DETAIL_IMAGE], false);
		const answer = deferred<ResolvedImageResource[]>();
		const resolveImageResources = vi.spyOn(api, 'resolveImageResources').mockReturnValue(answer.promise);

		store().openImage(DETAIL_KEY);
		expect(selectSelectedImage(store())).toBe(DETAIL_IMAGE);
		expect(store().resolutions[DETAIL_KEY]).toEqual({ status: 'loading', items: [], error: null });
		store().openImage(DETAIL_KEY);
		const joined = store().resolveResources(DETAIL_KEY);
		expect(resolveImageResources).toHaveBeenCalledTimes(1);
		expect(resolveImageResources).toHaveBeenCalledWith({ provider: 'civitai', resources: DETAIL_IMAGE.resources });

		answer.resolve(DETAIL_IMAGE_RESOLUTION);
		await joined;
		expect(store().resolutions[DETAIL_KEY]).toEqual(ready());

		store().closeImage();
		store().openImage(DETAIL_KEY);
		expect(resolveImageResources).toHaveBeenCalledTimes(1);
		expect(store().selectedImageKey).toBe(DETAIL_KEY);
		store().closeImage();
		expect(selectSelectedImage(store())).toBeNull();
	});

	it('keeps a failed resolution with its error; opening the image again retries', async () => {
		seedImages([DETAIL_IMAGE], false);
		const resolveImageResources = vi.spyOn(api, 'resolveImageResources').mockRejectedValueOnce(new ApiError('Civitai is not reachable', 502, null));

		await store().resolveResources(DETAIL_KEY);
		expect(store().resolutions[DETAIL_KEY]).toEqual({ status: 'failed', items: [], error: 'Civitai is not reachable' });
		expect(notifications()).toEqual([]);

		resolveImageResources.mockResolvedValueOnce(DETAIL_IMAGE_RESOLUTION);
		store().openImage(DETAIL_KEY);
		await settle();
		expect(resolveImageResources).toHaveBeenCalledTimes(2);
		expect(store().resolutions[DETAIL_KEY]).toEqual(ready());
	});

	it('opens favorites too; ignores unknown images; images without resources need no request', async () => {
		const bare = remoteImage({ id: '3003', resources: [] });
		useImageLibraryStore.setState({ favorites: [favoriteImage(bare)] });
		const resolveImageResources = vi.spyOn(api, 'resolveImageResources');

		store().openImage('civitai:unknown');
		expect(store().selectedImageKey).toBeNull();
		await store().resolveResources('civitai:unknown');
		expect(store().resolutions).toEqual({});

		store().openImage(imageKey(bare));
		await settle();
		expect(selectSelectedImage(store())).toBe(bare);
		expect(store().resolutions[imageKey(bare)]).toEqual(ready([]));
		expect(resolveImageResources).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// "Use these LoRAs"
// ---------------------------------------------------------------------------

describe('applyImageLoras', () => {
	it('installs only the missing LoRAs, then sets exactly the image LoRAs with their weights', async () => {
		seedImages();
		register(ADD_DETAIL_INSTALLED);
		const library = mockLibraryActions();
		const install = mockInstall(async () => installed(KIM_INSTALLED, 'kim'));

		await store().applyImageLoras(DETAIL_KEY);

		expect(install).toHaveBeenCalledTimes(1);
		expect(install).toHaveBeenCalledWith(KIM_LORA, KIM_VERSION, null, { select: false, announce: false });
		expect(library.setLoraSelection).toHaveBeenCalledTimes(1);
		expect(library.setLoraSelection).toHaveBeenCalledWith([
			{ id: 'add-detail', weight: 1 },
			{ id: 'kim', weight: 0.6 },
		]);
		expect(notifications()).toEqual([
			{ intent: 'success', title: null, message: 'LoRAs selected for generation: Detail Tweaker LoRA - v1.0 (1), Kim LoRA - v1 (0.6).' },
			{ intent: 'warning', title: 'Some LoRAs of this image were skipped', message: 'realistic filter [IL]: No version id or hash published.' },
		]);
		expect(store().applyingLoras).toEqual({});
	});

	it('resolves the image first, joining a resolution that runs', async () => {
		seedImages([DETAIL_IMAGE], false);
		register(ADD_DETAIL_INSTALLED);
		register(KIM_INSTALLED);
		const library = mockLibraryActions();
		const install = mockInstall(async () => ({ status: 'cancelled' }));
		const answer = deferred<ResolvedImageResource[]>();
		const resolveImageResources = vi.spyOn(api, 'resolveImageResources').mockReturnValue(answer.promise);

		store().openImage(DETAIL_KEY);
		const applying = store().applyImageLoras(DETAIL_KEY);
		await settle();
		expect(library.setLoraSelection).not.toHaveBeenCalled();

		answer.resolve(DETAIL_IMAGE_RESOLUTION);
		await applying;
		expect(resolveImageResources).toHaveBeenCalledTimes(1);
		expect(install).not.toHaveBeenCalled();
		expect(library.setLoraSelection).toHaveBeenCalledWith([
			{ id: 'add-detail', weight: 1 },
			{ id: 'kim-v-1', weight: 0.6 },
		]);
	});

	it('installs the missing LoRAs concurrently and is a no-op for the image meanwhile', async () => {
		seedImages();
		const library = mockLibraryActions();
		const answers = { [DETAIL_TWEAKER.id]: deferred<InstallOutcome>(), [KIM_LORA.id]: deferred<InstallOutcome>() };
		const install = mockInstall((model) => answers[model.id].promise);

		const applying = store().applyImageLoras(DETAIL_KEY);
		await settle();
		expect(install.mock.calls.map(([model]) => model.id)).toEqual([DETAIL_TWEAKER.id, KIM_LORA.id]);
		expect(store().applyingLoras).toEqual({ [DETAIL_KEY]: true });

		await store().applyImageLoras(DETAIL_KEY);
		expect(install).toHaveBeenCalledTimes(2);

		answers[KIM_LORA.id].resolve(installed(KIM_INSTALLED, 'kim'));
		answers[DETAIL_TWEAKER.id].resolve(installed(ADD_DETAIL_INSTALLED, 'add-detail'));
		await applying;
		expect(library.setLoraSelection).toHaveBeenCalledWith([
			{ id: 'add-detail', weight: 1 },
			{ id: 'kim', weight: 0.6 },
		]);
		expect(store().applyingLoras).toEqual({});
	});

	it('joins a LoRA install already running in the model library', async () => {
		seedImages();
		register(ADD_DETAIL_INSTALLED);
		const library = mockLibraryActions();
		const answers: InstallResponse[] = [
			{ state: 'downloading', installed: null, task_id: 'task-kim' },
			{ state: 'installed', installed: KIM_INSTALLED, task_id: null },
		];
		const installModel = vi.spyOn(api, 'installModel').mockImplementation(async () => answers.shift()!);

		const running = useModelCatalogStore.getState().install(KIM_LORA, KIM_VERSION);
		await settle();
		const applying = store().applyImageLoras(DETAIL_KEY);
		await settle();
		expect(installModel).toHaveBeenCalledTimes(1);
		expect(library.setLoraSelection).not.toHaveBeenCalled();

		act(() => useTasksStore.getState().applyEvent(downloadEvent('task-kim', { stage: 'complete' })));
		await Promise.all([running, applying]);

		expect(installModel).toHaveBeenCalledTimes(2);
		expect(library.setLoraSelection).toHaveBeenCalledWith([
			{ id: 'add-detail', weight: 1 },
			{ id: 'kim-v-1', weight: 0.6 },
		]);
	});

	it('skips LoRAs whose install failed, was cancelled, is unavailable or rejected, with their reasons', async () => {
		const unavailable = { ...KIM_LORA, versions: [{ ...KIM_VERSION, unavailable_reason: 'Unsupported base model: Flux.1 D' }] };
		const image = remoteImage({ id: '4004', resources: [ADD_DETAIL_RESOURCE, KIM_RESOURCE, { ...KIM_RESOURCE, name: 'kim_v_2', weight: 0.4 }, { ...ADD_DETAIL_RESOURCE, name: 'other', weight: 0.3 }] });
		const key = imageKey(image);
		const other = { ...DETAIL_TWEAKER, id: '9', name: 'Other' };
		seedImages([image], false);
		useImageLibraryStore.setState({
			resolutions: {
				[key]: ready([
					resolvedResource(ADD_DETAIL_RESOURCE, DETAIL_TWEAKER),
					resolvedResource(KIM_RESOURCE, KIM_LORA),
					resolvedResource(image.resources[2], unavailable),
					resolvedResource(image.resources[3], other),
				]),
			},
		});
		const library = mockLibraryActions();
		const install = mockInstall(async (model) => {
			if (model.id === DETAIL_TWEAKER.id) {
				return { status: 'failed', error: 'Disk full.' };
			}
			if (model.id === other.id) {
				throw new Error('contract breach');
			}
			return { status: 'cancelled' };
		});

		await store().applyImageLoras(key);

		expect(install.mock.calls.map(([model]) => model.id)).toEqual([DETAIL_TWEAKER.id, KIM_LORA.id, other.id]);
		expect(library.setLoraSelection).not.toHaveBeenCalled();
		expect(notifications()).toEqual([
			{
				intent: 'warning',
				title: 'No LoRA of this image can be used: the selection is unchanged',
				message:
					'Detail Tweaker LoRA - v1.0: Disk full; Kim LoRA - v1: The download was cancelled; Kim LoRA - v1: Unsupported base model: Flux.1 D; Other - v1.0: contract breach.',
			},
		]);
	});

	it('uses library LoRAs found by file name when the resolution failed', async () => {
		seedImages([DETAIL_IMAGE], false);
		register({ kind: 'lora', name: 'add_detail', path: 'D:/models/loras/add_detail.safetensors', source: { ...ADD_DETAIL_INSTALLED.source, provider: 'local', sha256: null } });
		const library = mockLibraryActions();
		const install = mockInstall(async () => ({ status: 'cancelled' }));
		vi.spyOn(api, 'resolveImageResources').mockRejectedValue(new Error('timeout'));

		await store().applyImageLoras(DETAIL_KEY);

		expect(install).not.toHaveBeenCalled();
		expect(library.setLoraSelection).toHaveBeenCalledWith([{ id: 'add-detail', weight: 1 }]);
		expect(notifications().at(-1)).toEqual({ intent: 'warning', title: 'Some LoRAs of this image were skipped', message: 'kim_v_1: timeout; realistic filter [IL]: timeout.' });
	});

	it('keeps the first of LoRAs using the same library entry', async () => {
		const image = remoteImage({ id: '5005', resources: [ADD_DETAIL_RESOURCE, { ...ADD_DETAIL_RESOURCE, weight: 0.5 }] });
		seedImages([image], false);
		useImageLibraryStore.setState({ resolutions: { [imageKey(image)]: ready(image.resources.map((resource) => resolvedResource(resource, DETAIL_TWEAKER))) } });
		register(ADD_DETAIL_INSTALLED);
		const library = mockLibraryActions();

		await store().applyImageLoras(imageKey(image));

		expect(library.setLoraSelection).toHaveBeenCalledWith([{ id: 'add-detail', weight: 1 }]);
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'LoRAs selected for generation: Detail Tweaker LoRA - v1.0 (1).' }]);
	});

	it('tells when the image uses no LoRA; ignores unknown images; never rejects', async () => {
		const checkpointOnly = remoteImage({ id: '6006', resources: [CHILLOUT_RESOURCE] });
		seedImages([checkpointOnly, DETAIL_IMAGE]);
		useImageLibraryStore.setState({ resolutions: { [imageKey(checkpointOnly)]: ready([resolvedResource(CHILLOUT_RESOURCE, CHILLOUT)]), [DETAIL_KEY]: ready() } });
		const library = mockLibraryActions();
		register(ADD_DETAIL_INSTALLED);
		mockInstall(async () => installed(KIM_INSTALLED, 'kim'));

		await store().applyImageLoras(imageKey(checkpointOnly));
		await store().applyImageLoras('civitai:unknown');
		expect(library.setLoraSelection).not.toHaveBeenCalled();
		expect(notifications()).toEqual([{ intent: 'info', title: null, message: 'This image publishes no LoRA.' }]);

		library.setLoraSelection.mockImplementation(() => {
			throw new Error('selection failed');
		});
		await expect(store().applyImageLoras(DETAIL_KEY)).resolves.toBeUndefined();
		expect(notifications().at(-1)).toEqual({ intent: 'error', title: 'Could not use the LoRAs', message: 'selection failed' });
		expect(store().applyingLoras).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// Checkpoint, tags, prompt, favorites
// ---------------------------------------------------------------------------

describe('switchToImageCheckpoint', () => {
	it('selects the checkpoint when it is in the library', async () => {
		seedImages();
		register(CHILLOUT_INSTALLED);
		const library = mockLibraryActions();
		const install = mockInstall(async () => ({ status: 'cancelled' }));

		await store().switchToImageCheckpoint(DETAIL_KEY);

		expect(library.selectModel).toHaveBeenCalledWith('chilloutmix-ni-pruned-fp32-fix-safetensors');
		expect(install).not.toHaveBeenCalled();
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'ChilloutMix - NiPrunedFp32Fix is selected for generation.' }]);
	});

	it('installs it through the model library otherwise (which selects and announces it)', async () => {
		seedImages();
		const library = mockLibraryActions();
		const answer = deferred<InstallOutcome>();
		const install = mockInstall(() => answer.promise);

		const switching = store().switchToImageCheckpoint(DETAIL_KEY);
		await settle();
		expect(store().switchingCheckpoint).toEqual({ [DETAIL_KEY]: true });
		await store().switchToImageCheckpoint(DETAIL_KEY);
		expect(install).toHaveBeenCalledTimes(1);
		expect(install.mock.calls[0]).toEqual([CHILLOUT, CHILLOUT_VERSION]);

		answer.resolve(installed(CHILLOUT_INSTALLED, 'chillout'));
		await switching;
		expect(store().switchingCheckpoint).toEqual({});
		expect(library.selectModel).not.toHaveBeenCalled();
		expect(notifications()).toEqual([]);
	});

	it('warns when the checkpoint cannot be used or is not published', async () => {
		const unavailable = { ...CHILLOUT, versions: [{ ...CHILLOUT_VERSION, unavailable_reason: 'Only pickle files: not downloadable.' }] };
		const unresolvedImage = remoteImage({ id: '7007', resources: [CHILLOUT_RESOURCE] });
		const loraImage = remoteImage({ id: '8008', resources: [ADD_DETAIL_RESOURCE] });
		seedImages([DETAIL_IMAGE, unresolvedImage, loraImage]);
		useImageLibraryStore.setState({
			resolutions: {
				[DETAIL_KEY]: ready([resolvedResource(CHILLOUT_RESOURCE, unavailable), ...DETAIL_IMAGE_RESOLUTION.slice(1)]),
				[imageKey(unresolvedImage)]: ready([resolvedResource(CHILLOUT_RESOURCE, null, { error: 'Unknown at Civitai.' })]),
				[imageKey(loraImage)]: ready([resolvedResource(ADD_DETAIL_RESOURCE, DETAIL_TWEAKER)]),
			},
		});
		const library = mockLibraryActions();
		const install = mockInstall(async () => ({ status: 'cancelled' }));

		await store().switchToImageCheckpoint(DETAIL_KEY);
		await store().switchToImageCheckpoint(imageKey(unresolvedImage));
		await store().switchToImageCheckpoint(imageKey(loraImage));

		expect(install).not.toHaveBeenCalled();
		expect(library.selectModel).not.toHaveBeenCalled();
		expect(notifications()).toEqual([
			{ intent: 'warning', title: 'ChilloutMix - NiPrunedFp32Fix cannot be used', message: 'Only pickle files: not downloadable.' },
			{ intent: 'warning', title: 'chilloutmix_NiPrunedFp32Fix cannot be used', message: 'Unknown at Civitai.' },
			{ intent: 'info', title: null, message: 'This image publishes no checkpoint.' },
		]);
	});
});

describe('addTagsToCategory', () => {
	function mockCategories() {
		const actions = { addSubPromptWithText: vi.fn(() => true), addCategory: vi.fn(() => 'new-category'), setSubPromptText: vi.fn(() => true) };
		useCategoriesStore.setState({
			...actions,
			categories: [{ text: 'Scenery', activation_text: '', priority: 1, state: 'normal', subPrompts: [] }],
		});
		return actions;
	}

	it('adds the image tags (or the chosen ones) as a sub-prompt of an existing category', () => {
		seedImages();
		const categories = mockCategories();

		store().addTagsToCategory(DETAIL_KEY, 'scenery');
		store().addTagsToCategory(DETAIL_KEY, 'scenery', ['portrait', 'snowing']);

		expect(categories.addSubPromptWithText.mock.calls).toEqual([
			['scenery', 'masterpiece, best quality, portrait, snowing'],
			['scenery', 'portrait, snowing'],
		]);
		expect(categories.addCategory).not.toHaveBeenCalled();
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: "Tags added to the category 'Scenery'." }]);
	});

	it('creates a category and fills its empty sub-prompt', () => {
		seedImages();
		const categories = mockCategories();

		store().addTagsToCategory(DETAIL_KEY, null);

		expect(categories.addCategory).toHaveBeenCalledTimes(1);
		expect(categories.setSubPromptText).toHaveBeenCalledWith('new-category', subPromptKeyOf(''), 'masterpiece, best quality, portrait, snowing');
		expect(categories.addSubPromptWithText).not.toHaveBeenCalled();
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: "Tags added to the category 'new-category'." }]);
	});

	it('with the real categories store: a new category holding the tags', () => {
		seedImages();

		store().addTagsToCategory(DETAIL_KEY, null, ['castle', 'sky']);

		expect(useCategoriesStore.getState().categories).toEqual([
			{ text: 'new-category', activation_text: '', priority: expect.any(Number), state: 'normal', subPrompts: [{ text: 'castle, sky', state: 'normal', extraLoraIds: [] }] },
		]);
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: "Tags added to the category 'new-category'." }]);
	});

	it('announces nothing when the category rejects the sub-prompt; warns without tags', () => {
		const untagged = remoteImage({ id: '9009', params: null });
		seedImages([DETAIL_IMAGE, untagged]);
		const categories = mockCategories();
		categories.addSubPromptWithText.mockReturnValue(false);

		store().addTagsToCategory(DETAIL_KEY, 'scenery');
		store().addTagsToCategory(imageKey(untagged), 'scenery');
		store().addTagsToCategory('civitai:unknown', 'scenery');

		expect(categories.addSubPromptWithText).toHaveBeenCalledTimes(1);
		expect(notifications()).toEqual([{ intent: 'warning', title: null, message: 'This image has no tags to add.' }]);
	});
});

describe('copyPrompt', () => {
	it('copies the published prompt with feedback; nothing without one', async () => {
		const untagged = remoteImage({ id: '9009', params: imageParams({ prompt: null }) });
		seedImages([DETAIL_IMAGE, untagged]);
		const writeText = vi.spyOn(clipboard, 'writeText').mockResolvedValue(undefined);

		await store().copyPrompt(DETAIL_KEY);
		await store().copyPrompt(imageKey(untagged));

		expect(writeText.mock.calls).toEqual([[DETAIL_IMAGE.params?.prompt]]);
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: 'Prompt copied to the clipboard.' }]);
	});
});

describe('favorites', () => {
	it('toggles an image in the backend collection (newest first)', async () => {
		const older = favoriteImage(OTHER_IMAGE, '2026-11-01T10:00:00Z');
		const saved = favoriteImage(DETAIL_IMAGE, '2026-11-24T10:00:00Z');
		seedImages([DETAIL_IMAGE, OTHER_IMAGE]);
		useImageLibraryStore.setState({ favorites: [older] });
		const addFavoriteImage = vi.spyOn(api, 'addFavoriteImage').mockResolvedValue(saved);
		const removeFavoriteImage = vi.spyOn(api, 'removeFavoriteImage').mockResolvedValue(undefined);

		await store().toggleFavorite(DETAIL_KEY);
		expect(addFavoriteImage).toHaveBeenCalledWith(DETAIL_IMAGE);
		expect(store().favorites).toEqual([saved, older]);
		expect(selectIsFavorite(DETAIL_KEY)(store())).toBe(true);

		await store().toggleFavorite(DETAIL_KEY);
		expect(removeFavoriteImage).toHaveBeenCalledWith('civitai', '148522541');
		expect(store().favorites).toEqual([older]);
		expect(selectIsFavorite(DETAIL_KEY)(store())).toBe(false);
	});

	it('a favorite-only image can be removed; a toggle in flight ignores further clicks', async () => {
		useImageLibraryStore.setState({ favorites: [favoriteImage(OTHER_IMAGE)] });
		const answer = deferred<void>();
		const removeFavoriteImage = vi.spyOn(api, 'removeFavoriteImage').mockReturnValue(answer.promise);

		const removing = store().toggleFavorite(OTHER_KEY);
		await store().toggleFavorite(OTHER_KEY);
		answer.resolve();
		await removing;

		expect(removeFavoriteImage).toHaveBeenCalledTimes(1);
		expect(store().favorites).toEqual([]);
		expect(selectImage(OTHER_KEY)(store())).toBeNull();
	});

	it('reports failures and keeps the collection', async () => {
		seedImages();
		vi.spyOn(api, 'addFavoriteImage').mockRejectedValue(new ApiError('Backend unreachable', 503, null));

		await expect(store().toggleFavorite(DETAIL_KEY)).resolves.toBeUndefined();

		expect(store().favorites).toEqual([]);
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not update the favorites', message: 'Backend unreachable' }]);
	});

	it('loadFavorites reloads the collection; a failure keeps it', async () => {
		const favorites: FavoriteImage[] = [favoriteImage(DETAIL_IMAGE)];
		const listFavoriteImages = vi.spyOn(api, 'listFavoriteImages').mockResolvedValueOnce(favorites).mockRejectedValueOnce(new Error('backend down'));

		await store().loadFavorites();
		expect(store()).toMatchObject({ favorites, favoritesStatus: 'ready', favoritesError: null });

		await store().loadFavorites();
		expect(listFavoriteImages).toHaveBeenCalledTimes(2);
		expect(store()).toMatchObject({ favorites, favoritesStatus: 'failed', favoritesError: 'backend down' });
		expect(notifications()).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

describe('hooks', () => {
	it('useImageTags: the image tags, stable while the image is unchanged; [] for null', () => {
		seedImages();
		const { result, rerender } = renderHook(({ key }) => useImageTags(key), { initialProps: { key: DETAIL_KEY as string | null } });
		const tags = result.current;
		expect(tags).toEqual(['masterpiece', 'best quality', 'portrait', 'snowing']);

		act(() => useImageLibraryStore.setState({ searchStatus: 'loading', resolutions: {} }));
		rerender({ key: DETAIL_KEY });
		expect(result.current).toBe(tags);

		rerender({ key: null });
		expect(result.current).toEqual([]);
	});

	it('useImageLoraRows: combines the resolution, the library entries and the installs; memoized', () => {
		seedImages([DETAIL_IMAGE, OTHER_IMAGE], false);
		const statuses = (rows: { status: string }[]) => rows.map((row) => row.status);
		const { result } = renderHook(() => useImageLoraRows(DETAIL_KEY));
		expect(statuses(result.current)).toEqual(['unresolved', 'unresolved', 'unresolved']);

		act(() => useImageLibraryStore.setState({ resolutions: { [DETAIL_KEY]: { status: 'loading', items: [], error: null } } }));
		expect(statuses(result.current)).toEqual(['resolving', 'resolving', 'resolving']);

		act(() => useImageLibraryStore.setState({ resolutions: { [DETAIL_KEY]: ready() } }));
		expect(result.current.map(({ index, name, weight, status }) => ({ index, name, weight, status }))).toEqual([
			{ index: 1, name: 'Detail Tweaker LoRA - v1.0', weight: 1, status: 'remote' },
			{ index: 2, name: 'Kim LoRA - v1', weight: 0.6, status: 'remote' },
			{ index: 3, name: 'realistic filter [IL]', weight: 1, status: 'unresolved' },
		]);
		const resolved = result.current;

		act(() => {
			useModelCatalogStore.setState({ installs: { [installKey('civitai', JANKU_VERSION, null)]: installEntry(JANKU, JANKU_VERSION) } });
			useLibraryStore.setState({ lastLoraDir: 'D:/models/loras' });
			useImageLibraryStore.setState((state) => ({ resolutions: { ...state.resolutions, [OTHER_KEY]: ready([]) }, searchStatus: 'loading' }));
		});
		expect(result.current).toBe(resolved);

		act(() => useModelCatalogStore.setState((state) => ({ installs: { ...state.installs, [KIM_KEY]: installEntry(KIM_LORA, KIM_VERSION) } })));
		expect(statuses(result.current)).toEqual(['remote', 'installing', 'unresolved']);
		expect(result.current[1].installKey).toBe(KIM_KEY);

		act(() => {
			register(ADD_DETAIL_INSTALLED);
		});
		expect(result.current[0]).toMatchObject({ status: 'in_library', libraryEntryId: 'add-detail' });
	});

	it('useImageCheckpointRow: the first checkpoint; null without one or for null', () => {
		const loraImage = remoteImage({ id: '8008', resources: [ADD_DETAIL_RESOURCE] });
		seedImages([DETAIL_IMAGE, loraImage]);
		const { result, rerender } = renderHook(({ key }) => useImageCheckpointRow(key), { initialProps: { key: DETAIL_KEY as string | null } });
		expect(result.current).toMatchObject({ index: 0, name: 'ChilloutMix - NiPrunedFp32Fix', weight: null, status: 'remote', model: CHILLOUT });

		act(() => {
			register(CHILLOUT_INSTALLED);
		});
		expect(result.current).toMatchObject({ status: 'in_library', libraryEntryId: 'chilloutmix-ni-pruned-fp32-fix-safetensors' });

		rerender({ key: imageKey(loraImage) });
		expect(result.current).toBeNull();
		rerender({ key: null });
		expect(result.current).toBeNull();
	});

	it('[] for a null key or an unknown image', () => {
		expect(renderHook(() => useImageLoraRows(null)).result.current).toEqual([]);
		expect(renderHook(() => useImageLoraRows('civitai:unknown')).result.current).toEqual([]);
		expect(renderHook(() => useImageTags('civitai:unknown')).result.current).toEqual([]);
	});
});
