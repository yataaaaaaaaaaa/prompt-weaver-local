import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client';
import type { IpAdapterInstallResponse, IpAdapterStatus, ModelSpec } from '../api/types';
import { IMAGE_ENCODER_FILE, ipAdapterFile, ipAdapterStatus, ipAdapterVariant, READY_SDXL_FACE, referenceSupport } from '../test/characterData';
import { downloadEvent } from '../test/modelLibraryData';
import { ipAdapterFileStatus, selectIpAdapterVariant, selectIsVariantInstalling, selectReferenceSupport, useIpAdapterStore } from './ipAdapterStore';
import { useLibraryStore } from './libraryStore';
import { useNotificationsStore } from './notificationsStore';
import { useTasksStore } from './tasksStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SDXL_PATH = 'D:/models/checkpoints/janku.safetensors';
const SD15_PATH = 'D:/models/checkpoints/chillout.safetensors';
const ADAPTER_TASK = 'task-adapter';
const ENCODER_TASK = 'task-encoder';

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

const store = () => useIpAdapterStore.getState();
const notifications = () => useNotificationsStore.getState().notifications.map(({ intent, title, message }) => ({ intent, title, message }));

const model = (id: string, path: string): ModelSpec => ({
	id,
	name: id,
	path,
	default_width: 1024,
	default_height: 1024,
	torch_dtype: 'float16',
	source: null,
});

/** The library holds both checkpoints, `selectedModelId` selected ('' = none). */
function selectModel(selectedModelId: 'sdxl' | 'sd15' | ''): void {
	useLibraryStore.setState({ models: [model('sdxl', SDXL_PATH), model('sd15', SD15_PATH)], selectedModelId });
}

/** The SDXL face variant downloading both files. */
const DOWNLOADING = ipAdapterStatus({
	variants: [ipAdapterVariant({ files: [ipAdapterFile({ task_id: ADAPTER_TASK }), { ...IMAGE_ENCODER_FILE, task_id: ENCODER_TASK }] })],
});
const READY = ipAdapterStatus({ variants: [READY_SDXL_FACE], support: [referenceSupport({ ready: true, reason: null })] });

// ---------------------------------------------------------------------------
// refresh
// ---------------------------------------------------------------------------

describe('ipAdapterStore.refresh', () => {
	it('reads the status of the selected model', async () => {
		selectModel('sdxl');
		const status = vi.spyOn(api, 'ipAdapterStatus').mockResolvedValue(READY);

		const refreshing = store().refresh();
		expect(store()).toMatchObject({ modelPath: SDXL_PATH, loadStatus: 'loading', loadError: null });
		await refreshing;

		expect(status).toHaveBeenCalledWith(SDXL_PATH, expect.any(AbortSignal));
		expect(store()).toMatchObject({ status: READY, modelPath: SDXL_PATH, loadStatus: 'ready' });
	});

	it('asks without a model path when no model is selected', async () => {
		selectModel('');
		const status = vi.spyOn(api, 'ipAdapterStatus').mockResolvedValue(ipAdapterStatus({ architecture: null, support: [] }));

		await store().refresh();

		expect(status).toHaveBeenCalledWith(null, expect.any(AbortSignal));
		expect(store()).toMatchObject({ modelPath: null, loadStatus: 'ready' });
	});

	it('does not ask again for the same model (loaded or loading), unless forced', async () => {
		selectModel('sdxl');
		const answer = deferred<IpAdapterStatus>();
		const status = vi.spyOn(api, 'ipAdapterStatus').mockReturnValueOnce(answer.promise).mockResolvedValue(READY);

		const refreshing = store().refresh();
		await store().refresh();
		answer.resolve(ipAdapterStatus());
		await refreshing;
		await store().refresh();
		expect(status).toHaveBeenCalledTimes(1);

		const forcing = store().refresh({ force: true });
		// A forced refresh of the same model keeps the status shown meanwhile.
		expect(store()).toMatchObject({ status: ipAdapterStatus(), loadStatus: 'loading' });
		await forcing;
		expect(status).toHaveBeenCalledTimes(2);
		expect(store().status).toEqual(READY);
	});

	it('asks again when the selected model changes (its previous support is not shown meanwhile)', async () => {
		selectModel('sdxl');
		const sd15Status = ipAdapterStatus({ architecture: 'sd15' });
		const answer = deferred<IpAdapterStatus>();
		const status = vi.spyOn(api, 'ipAdapterStatus').mockResolvedValueOnce(READY).mockReturnValueOnce(answer.promise);
		await store().refresh();

		selectModel('sd15');
		const refreshing = store().refresh();
		expect(store()).toMatchObject({ status: null, modelPath: SD15_PATH, loadStatus: 'loading' });
		expect(selectReferenceSupport('face')(store())).toBeNull();
		answer.resolve(sd15Status);
		await refreshing;

		expect(status).toHaveBeenLastCalledWith(SD15_PATH, expect.any(AbortSignal));
		expect(store()).toMatchObject({ status: sd15Status, modelPath: SD15_PATH, loadStatus: 'ready' });
	});

	it('ignores (and aborts) an older request', async () => {
		selectModel('sdxl');
		const older = deferred<IpAdapterStatus>();
		const signals: AbortSignal[] = [];
		vi.spyOn(api, 'ipAdapterStatus').mockImplementation((_path, signal) => {
			signals.push(signal!);
			return signals.length === 1 ? older.promise : Promise.resolve(READY);
		});

		const first = store().refresh();
		selectModel('sd15');
		await store().refresh();
		older.resolve(ipAdapterStatus({ architecture: 'sd15' }));
		await first;

		expect(signals[0].aborted).toBe(true);
		expect(store()).toMatchObject({ status: READY, modelPath: SD15_PATH, loadStatus: 'ready' });
	});

	it('keeps a failure in the store (no notification), and the next refresh tries again', async () => {
		selectModel('sdxl');
		const status = vi.spyOn(api, 'ipAdapterStatus').mockRejectedValueOnce(new ApiError('backend down', 503, null)).mockResolvedValue(READY);

		await expect(store().refresh()).resolves.toBeUndefined();
		expect(store()).toMatchObject({ loadStatus: 'failed', loadError: 'backend down', status: null });
		expect(notifications()).toEqual([]);

		await store().refresh();
		expect(status).toHaveBeenCalledTimes(2);
		expect(store()).toMatchObject({ loadStatus: 'ready', loadError: null, status: READY });
	});
});

// ---------------------------------------------------------------------------
// install / cancelInstall
// ---------------------------------------------------------------------------

describe('ipAdapterStore.install', () => {
	const LABEL = ipAdapterVariant().label;

	it("refreshes and announces a variant already on disk ('installed')", async () => {
		selectModel('sdxl');
		useIpAdapterStore.setState({ status: ipAdapterStatus(), modelPath: SDXL_PATH, loadStatus: 'ready' });
		const answer = deferred<IpAdapterInstallResponse>();
		const install = vi.spyOn(api, 'installIpAdapter').mockReturnValue(answer.promise);
		const status = vi.spyOn(api, 'ipAdapterStatus').mockResolvedValue(READY);

		const installing = store().install('sdxl-face');
		expect(selectIsVariantInstalling('sdxl-face')(store())).toBe(true);
		answer.resolve({ state: 'installed', task_ids: [] });
		await installing;

		expect(install).toHaveBeenCalledWith('sdxl-face');
		expect(status).toHaveBeenCalledTimes(1);
		expect(store()).toMatchObject({ status: READY, installing: {} });
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: `${LABEL} is ready: reference images can be used.` }]);
	});

	it("follows the downloads ('downloading'): refresh, wait for every task, refresh, announce", async () => {
		selectModel('sdxl');
		useIpAdapterStore.setState({ status: ipAdapterStatus(), modelPath: SDXL_PATH, loadStatus: 'ready' });
		vi.spyOn(api, 'installIpAdapter').mockResolvedValue({ state: 'downloading', task_ids: [ADAPTER_TASK, ENCODER_TASK] });
		const status = vi.spyOn(api, 'ipAdapterStatus').mockResolvedValueOnce(DOWNLOADING).mockResolvedValue(READY);

		const installing = store().install('sdxl-face');
		await settle();
		expect(store()).toMatchObject({ status: DOWNLOADING, installing: { 'sdxl-face': true } });

		// A second install of the running variant is ignored.
		await store().install('sdxl-face');
		expect(api.installIpAdapter).toHaveBeenCalledTimes(1);

		useTasksStore.getState().applyEvent(downloadEvent(ADAPTER_TASK, { stage: 'complete' }));
		await settle();
		expect(store().installing).toEqual({ 'sdxl-face': true });
		useTasksStore.getState().applyEvent(downloadEvent(ENCODER_TASK, { stage: 'complete' }));
		await installing;

		expect(status).toHaveBeenCalledTimes(2);
		expect(store()).toMatchObject({ status: READY, installing: {} });
		expect(notifications()).toEqual([{ intent: 'success', title: null, message: `${LABEL} is ready: reference images can be used.` }]);
	});

	it('names the failed and cancelled downloads', async () => {
		selectModel('sdxl');
		vi.spyOn(api, 'installIpAdapter').mockResolvedValue({ state: 'downloading', task_ids: [ADAPTER_TASK, ENCODER_TASK] });
		vi.spyOn(api, 'ipAdapterStatus').mockResolvedValueOnce(DOWNLOADING).mockResolvedValue(ipAdapterStatus());
		useTasksStore.setState({
			events: {
				[ADAPTER_TASK]: downloadEvent(ADAPTER_TASK, { stage: 'error', message: 'HTTP 500 from huggingface.co.' }),
				[ENCODER_TASK]: downloadEvent(ENCODER_TASK, { stage: 'cancelled' }),
			},
		});

		await store().install('sdxl-face');

		expect(store().installing).toEqual({});
		expect(notifications()).toEqual([
			{
				intent: 'error',
				title: `${LABEL} could not be installed`,
				message: `${ipAdapterFile().name}: HTTP 500 from huggingface.co; ${IMAGE_ENCODER_FILE.name}: The download was cancelled.`,
			},
		]);
	});

	it('names a download by its task title when the status does not list it', async () => {
		selectModel('sdxl');
		vi.spyOn(api, 'installIpAdapter').mockResolvedValue({ state: 'downloading', task_ids: [ADAPTER_TASK] });
		vi.spyOn(api, 'ipAdapterStatus').mockResolvedValue(ipAdapterStatus());
		useTasksStore.setState({ events: { [ADAPTER_TASK]: downloadEvent(ADAPTER_TASK, { stage: 'error', title: 'adapter.safetensors', message: '' }) } });

		await store().install('sdxl-face');

		expect(notifications()).toEqual([
			{ intent: 'error', title: `${LABEL} could not be installed`, message: 'adapter.safetensors: The download failed.' },
		]);
	});

	it('reports a refused install', async () => {
		vi.spyOn(api, 'installIpAdapter').mockRejectedValue(new ApiError('Unknown IP-Adapter variant', 404, null));

		await expect(store().install('sdxl-plus')).resolves.toBeUndefined();

		expect(store().installing).toEqual({});
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not install the IP-Adapter', message: 'Unknown IP-Adapter variant' }]);
	});
});

describe('ipAdapterStore.cancelInstall', () => {
	it('cancels every running download of the variant (ended ones and 404s skipped)', async () => {
		const third = 'task-ended';
		useIpAdapterStore.setState({
			status: ipAdapterStatus({
				variants: [
					ipAdapterVariant({
						files: [ipAdapterFile({ task_id: ADAPTER_TASK }), { ...IMAGE_ENCODER_FILE, task_id: ENCODER_TASK }, ipAdapterFile({ id: 'x', task_id: third })],
					}),
				],
			}),
		});
		useTasksStore.setState({ events: { [third]: downloadEvent(third, { stage: 'complete' }) } });
		const cancel = vi
			.spyOn(api, 'cancelDownload')
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new ApiError('Unknown download', 404, null));

		await store().cancelInstall('sdxl-face');

		expect(cancel.mock.calls).toEqual([[ADAPTER_TASK], [ENCODER_TASK]]);
		expect(notifications()).toEqual([]);
	});

	it('reports other failures and does nothing for a variant without downloads', async () => {
		useIpAdapterStore.setState({ status: DOWNLOADING });
		const cancel = vi.spyOn(api, 'cancelDownload').mockRejectedValue(new ApiError('backend down', 503, null));

		await expect(store().cancelInstall('sdxl-face')).resolves.toBeUndefined();
		await store().cancelInstall('sd15-face');

		expect(cancel).toHaveBeenCalledTimes(2);
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not cancel the download', message: 'backend down' }]);
	});
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('ipAdapterStore selectors', () => {
	it('read the support per focus and the variants of the status', () => {
		expect(selectReferenceSupport('face')(store())).toBeNull();
		expect(selectIpAdapterVariant('sdxl-face')(store())).toBeNull();

		useIpAdapterStore.setState({ status: READY, installing: { 'sdxl-face': true } });

		expect(selectReferenceSupport('face')(store())).toEqual(referenceSupport({ ready: true, reason: null }));
		expect(selectReferenceSupport('general')(store())).toBeNull();
		expect(selectIpAdapterVariant('sdxl-face')(store())).toEqual(READY_SDXL_FACE);
		expect(selectIpAdapterVariant(null)(store())).toBeNull();
		expect(selectIsVariantInstalling('sdxl-face')(store())).toBe(true);
		expect(selectIsVariantInstalling('sd15-face')(store())).toBe(false);
	});
});

describe('ipAdapterFileStatus', () => {
	it('reads a file as downloading, on disk or to download (a running download wins)', () => {
		expect(ipAdapterFileStatus(ipAdapterFile())).toBe('remote');
		expect(ipAdapterFileStatus(ipAdapterFile({ local_path: 'D:/models/ipadapter/a.safetensors' }))).toBe('on_disk');
		expect(ipAdapterFileStatus(ipAdapterFile({ task_id: 'task-1' }))).toBe('installing');
		expect(ipAdapterFileStatus(ipAdapterFile({ task_id: 'task-1', local_path: 'D:/models/ipadapter/a.safetensors' }))).toBe('installing');
	});
});
