// IP-Adapter store: single truth holder, in the frontend, of the IP-Adapter files that character reference images
// need (GET /api/ip-adapters: variants, their files on disk or downloading, and the reference support of the
// selected model per focus) and of their installs. Not persisted. The backend owns every rule (catalog, which variant
// fits a model + focus, why references cannot apply): this store only reads IpAdapterStatus. Cross-store
// coordination in the actions:
// - the model asked for is the selected model of the library store (selectSelectedModel(...).path);
// - downloads are followed with useTasksStore.getState().waitForTask and cancelled with api.cancelDownload; their
//   progress is read by the views from the tasks store (useDownloadProgress of IpAdapterFile.task_id);
// - success / failure notifications through the notifications store.
// Rule: never read another store at module top level or in the initial state.
import { create } from 'zustand';
import { ApiError, api } from '../api/client';
import type { IpAdapterFile, IpAdapterStatus, IpAdapterVariant, ReferenceFocus, ReferenceSupport, TaskEvent } from '../api/types';
import { DOWNLOAD_FAILED, INSTALL_CANCELLED, type VersionStatusKind } from '../domain/modelCatalog';
import { namedProblemsText, uniqueStrings } from '../domain/text';
import { withFlag } from './flags';
import { selectSelectedModel, useLibraryStore } from './libraryStore';
import { describeError, reportError, useNotificationsStore } from './notificationsStore';
import type { LoadStatus } from './pagedSearch';
import { downloadTitleOf, TERMINAL_TASK_STAGES, useTasksStore } from './tasksStore';

export type IpAdapterState = {
	/** The last status read (null before the first answer). */
	status: IpAdapterStatus | null;
	/** Model path `status` was asked for (null: no model selected); a different selected model means stale. */
	modelPath: string | null;
	loadStatus: LoadStatus;
	loadError: string | null;
	/** Variant ids whose install runs (from the install request until every download ended). */
	installing: Record<string, true>;
};

export type IpAdapterActions = {
	/** Reads the status for the selected model (api.ipAdapterStatus), unless it is already loaded or loading for that
	 *  model path (force: always). The answer of an older request is ignored. Failures: loadStatus 'failed' +
	 *  loadError, no notification. Views call it when they show reference support and when the selected model
	 *  changes. Never rejects. */
	refresh: (options?: { force?: boolean }) => Promise<void>;
	/** api.installIpAdapter: 'installed' -> refresh + success notification; 'downloading' -> refresh (files show their
	 *  task_id), waits for every task (waitForTask), refreshes again, then a success notification, or an error one
	 *  naming the failed / cancelled download. No-op while the variant installs. Never rejects. */
	install: (variantId: string) => Promise<void>;
	/** Cancels the running downloads of the variant's files (api.cancelDownload of each task_id). Never rejects. */
	cancelInstall: (variantId: string) => Promise<void>;
};

export type IpAdapterStore = IpAdapterState & IpAdapterActions;

/** Why a download ended without completing (cancelled: INSTALL_CANCELLED; error: the event message). */
function downloadProblem(event: TaskEvent): string {
	return event.stage === 'cancelled' ? INSTALL_CANCELLED : event.message || DOWNLOAD_FAILED;
}

/** The running download task ids of a variant's files (IpAdapterFile.task_id), minus those already ended. */
function runningTaskIds(variant: IpAdapterVariant | null): string[] {
	const events = useTasksStore.getState().events;
	return uniqueStrings(
		(variant?.files ?? []).flatMap((file) => (file.task_id !== null && !TERMINAL_TASK_STAGES.has(events[file.task_id]?.stage) ? [file.task_id] : [])),
	);
}

export const useIpAdapterStore = create<IpAdapterStore>()((set, get) => {
	/** Identifies the latest status request (an older answer is ignored); its abort controller. */
	let requestToken = 0;
	let runningRequest: AbortController | null = null;

	const setInstalling = (variantId: string, on: boolean) => set((state) => ({ installing: withFlag(state.installing, variantId, on) }));

	/** Task id -> file name of the variant's files being downloaded (IpAdapterFile.task_id of the current status). */
	const fileNamesByTask = (variantId: string): Map<string, string> =>
		new Map(
			(selectIpAdapterVariant(variantId)(get())?.files ?? []).flatMap((file) => (file.task_id !== null ? [[file.task_id, file.name] as const] : [])),
		);

	return {
		status: null,
		modelPath: null,
		loadStatus: 'idle',
		loadError: null,
		installing: {},

		refresh: async ({ force = false } = {}) => {
			const modelPath = selectSelectedModel(useLibraryStore.getState())?.path ?? null;
			const { modelPath: knownPath, loadStatus } = get();
			if (!force && modelPath === knownPath && (loadStatus === 'ready' || loadStatus === 'loading')) {
				return;
			}
			const token = ++requestToken;
			runningRequest?.abort();
			const controller = new AbortController();
			runningRequest = controller;
			// Another model: its support is unknown until the answer (the previous one must not show meanwhile).
			set(modelPath === knownPath ? { loadStatus: 'loading', loadError: null } : { modelPath, status: null, loadStatus: 'loading', loadError: null });
			try {
				const status = await api.ipAdapterStatus(modelPath, controller.signal);
				if (token === requestToken) {
					set({ status, loadStatus: 'ready' });
				}
			} catch (error) {
				if (token === requestToken) {
					set({ loadStatus: 'failed', loadError: describeError(error) });
				}
			} finally {
				if (runningRequest === controller) {
					runningRequest = null;
				}
			}
		},

		install: async (variantId) => {
			if (get().installing[variantId]) {
				return;
			}
			setInstalling(variantId, true);
			const { notify } = useNotificationsStore.getState();
			// Read when notifying: the status (refreshed by the install) names the variant.
			const labelOf = () => selectIpAdapterVariant(variantId)(get())?.label ?? variantId;
			try {
				const response = await api.installIpAdapter(variantId);
				// Files on disk, or files showing their task_id (download progress).
				await get().refresh({ force: true });
				if (response.state === 'downloading') {
					const fileNames = fileNamesByTask(variantId);
					const { waitForTask } = useTasksStore.getState();
					const events = await Promise.all(response.task_ids.map((taskId) => waitForTask(taskId)));
					await get().refresh({ force: true });
					const failed = events.filter((event) => event.stage !== 'complete');
					if (failed.length) {
						const problems = failed.map((event) => ({
							name: fileNames.get(event.task_id) ?? (downloadTitleOf(event) || event.task_id),
							problem: downloadProblem(event),
						}));
						notify('error', namedProblemsText(problems), { title: `${labelOf()} could not be installed` });
						return;
					}
				}
				notify('success', `${labelOf()} is ready: reference images can be used.`);
			} catch (error) {
				reportError(error, 'Could not install the IP-Adapter');
			} finally {
				setInstalling(variantId, false);
			}
		},

		cancelInstall: async (variantId) => {
			const taskIds = runningTaskIds(selectIpAdapterVariant(variantId)(get()));
			await Promise.all(
				taskIds.map(async (taskId) => {
					try {
						await api.cancelDownload(taskId);
					} catch (error) {
						// 404: the backend runs no such download any more (just ended): nothing is left to cancel.
						if (!(error instanceof ApiError && error.status === 404)) {
							reportError(error, 'Could not cancel the download');
						}
					}
				}),
			);
		},
	};
});

// ---------------------------------------------------------------------------
// Selectors (views read through these; nothing derived is stored)
// ---------------------------------------------------------------------------

/** Reference support of the selected model for `focus` (null before the status is known or without a model). */
export const selectReferenceSupport =
	(focus: ReferenceFocus) =>
	(state: IpAdapterState): ReferenceSupport | null =>
		state.status?.support.find((support) => support.focus === focus) ?? null;

export const selectIpAdapterVariant =
	(variantId: string | null) =>
	(state: IpAdapterState): IpAdapterVariant | null =>
		variantId === null ? null : (state.status?.variants.find((variant) => variant.id === variantId) ?? null);

/** The status of an IP-Adapter file in the shared file status terms (VersionStatusKind, labelled by
 *  features/models/VersionStatusBadge): downloading (a task_id), on disk (a local_path), or to download. */
export function ipAdapterFileStatus(file: IpAdapterFile): Extract<VersionStatusKind, 'installing' | 'on_disk' | 'remote'> {
	if (file.task_id !== null) {
		return 'installing';
	}
	return file.local_path !== null ? 'on_disk' : 'remote';
}

export const selectIsVariantInstalling =
	(variantId: string) =>
	(state: IpAdapterState): boolean =>
		state.installing[variantId] === true;
