// IP-Adapter store: single truth holder, in the frontend, of the IP-Adapter files that character reference images
// need (GET /api/ip-adapters: variants, their files on disk or downloading, and the reference support of the
// selected model per focus) and of their installs. Not persisted. The backend owns every rule (catalog, which variant
// fits a model + focus, why references cannot apply): this store only reads IpAdapterStatus. Cross-store
// coordination in the actions:
// - the model asked for is the selected model of the library store (selectSelectedModel(...).path);
// - downloads are followed with useTasksStore.getState().waitForTask and cancelled with api.cancelDownload; their
//   progress is read by the views from the tasks store (useDownloadProgress of IpAdapterFile.task_id);
// - success / failure notifications through the notifications store.
// The failed downloads of an install are kept here (installFailures, per variant installed) after their tasks ended,
// so the views keep showing them (file status 'failed', the support hint's error with Retry) once the toast is gone;
// a cancelled download is no failure (the user asked for it): its file is simply to download again. Kept per variant
// because variants share files (the image encoder): only the variant whose install failed shows the failure.
// Rule: never read another store at module top level or in the initial state.
import { create } from 'zustand';
import { ApiError, api } from '../api/client';
import type { IpAdapterFile, IpAdapterStatus, IpAdapterVariant, ReferenceFocus, ReferenceSupport, TaskEvent } from '../api/types';
import { DOWNLOAD_FAILED, type VersionStatusKind } from '../domain/modelCatalog';
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
	/** Variant id -> file id -> why that file's download failed (the error event's message), for the last install of
	 *  the variant that ended with failed downloads; removed when an install of the variant starts again. A cancelled
	 *  download leaves no failure. A file on disk or downloading reads as such whatever its failure
	 *  (ipAdapterFileStatus). */
	installFailures: Record<string, Record<string, string>>;
};

export type IpAdapterActions = {
	/** Reads the status for the selected model (api.ipAdapterStatus), unless it is already loaded or loading for that
	 *  model path (force: always). The answer of an older request is ignored. Failures: loadStatus 'failed' +
	 *  loadError, no notification. Views call it when they show reference support and when the selected model
	 *  changes. Never rejects. */
	refresh: (options?: { force?: boolean }) => Promise<void>;
	/** api.installIpAdapter (the variant's previous failures are removed first): 'installed' -> refresh + success
	 *  notification; 'downloading' -> refresh (files show their task_id), waits for every task (waitForTask), keeps
	 *  the failed downloads in installFailures, refreshes again, then a success notification when every download
	 *  completed, an error one naming the failed downloads, or nothing when downloads were only cancelled (the user
	 *  cancelled). No-op while the variant installs. Never rejects. */
	install: (variantId: string) => Promise<void>;
	/** Cancels the running downloads of the variant's files (api.cancelDownload of each task_id). Never rejects. */
	cancelInstall: (variantId: string) => Promise<void>;
};

export type IpAdapterStore = IpAdapterState & IpAdapterActions;

/** Why a download failed (its error event's message; DOWNLOAD_FAILED without one). */
function downloadProblem(event: TaskEvent): string {
	return event.message || DOWNLOAD_FAILED;
}

/** `failures` with the entry of `variantId` replaced by `files`, or removed when null (the same object when
 *  nothing changes). */
function withVariantFailures(
	failures: IpAdapterState['installFailures'],
	variantId: string,
	files: Record<string, string> | null,
): IpAdapterState['installFailures'] {
	if (files === null) {
		if (!(variantId in failures)) {
			return failures;
		}
		const next = { ...failures };
		delete next[variantId];
		return next;
	}
	return { ...failures, [variantId]: files };
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

	/** Task id -> the variant's file it downloads (IpAdapterFile.task_id of the current status). */
	const filesByTask = (variantId: string): Map<string, IpAdapterFile> =>
		new Map(
			(selectIpAdapterVariant(variantId)(get())?.files ?? []).flatMap((file) => (file.task_id !== null ? [[file.task_id, file] as const] : [])),
		);

	return {
		status: null,
		modelPath: null,
		loadStatus: 'idle',
		loadError: null,
		installing: {},
		installFailures: {},

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
			set((state) => ({ installFailures: withVariantFailures(state.installFailures, variantId, null) }));
			const { notify } = useNotificationsStore.getState();
			// Read when notifying: the status (refreshed by the install) names the variant.
			const labelOf = () => selectIpAdapterVariant(variantId)(get())?.label ?? variantId;
			try {
				const response = await api.installIpAdapter(variantId);
				// Files on disk, or files showing their task_id (download progress).
				await get().refresh({ force: true });
				if (response.state === 'downloading') {
					const files = filesByTask(variantId);
					const { waitForTask } = useTasksStore.getState();
					const events = await Promise.all(response.task_ids.map((taskId) => waitForTask(taskId)));
					const failed = events.filter((event) => event.stage === 'error');
					const failures = failed.flatMap((event) => {
						const file = files.get(event.task_id);
						return file ? [[file.id, downloadProblem(event)] as const] : [];
					});
					if (failures.length) {
						set((state) => ({ installFailures: withVariantFailures(state.installFailures, variantId, Object.fromEntries(failures)) }));
					}
					await get().refresh({ force: true });
					if (failed.length) {
						const problems = failed.map((event) => ({
							name: files.get(event.task_id)?.name ?? (downloadTitleOf(event) || event.task_id),
							problem: downloadProblem(event),
						}));
						notify('error', namedProblemsText(problems), { title: `${labelOf()} could not be installed` });
						return;
					}
					if (events.some((event) => event.stage === 'cancelled')) {
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
 *  features/models/VersionStatusBadge), first match wins: downloading (a task_id), on disk (a local_path), failed (its
 *  last download failed: `failure`, see selectFileFailure), or to download. */
export function ipAdapterFileStatus(
	file: IpAdapterFile,
	failure: string | null = null,
): Extract<VersionStatusKind, 'installing' | 'on_disk' | 'failed' | 'remote'> {
	if (file.task_id !== null) {
		return 'installing';
	}
	if (file.local_path !== null) {
		return 'on_disk';
	}
	return failure !== null ? 'failed' : 'remote';
}

/** Why the last failed download of the file failed (installFailures of any variant); null when none did. */
export const selectFileFailure =
	(fileId: string) =>
	(state: IpAdapterState): string | null => {
		for (const files of Object.values(state.installFailures)) {
			if (fileId in files) {
				return files[fileId];
			}
		}
		return null;
	};

/** The failed downloads of the variant's last install whose files are still failed (ipAdapterFileStatus: not on disk
 *  or downloading since), as one text naming each file (namedProblemsText); null when none is. A string, so a stable
 *  zustand selector result. */
export const selectVariantFailure =
	(variantId: string | null) =>
	(state: IpAdapterState): string | null => {
		const failures = variantId === null ? undefined : state.installFailures[variantId];
		if (!failures) {
			return null;
		}
		const problems = (selectIpAdapterVariant(variantId)(state)?.files ?? []).flatMap((file) => {
			const failure = failures[file.id];
			return failure !== undefined && ipAdapterFileStatus(file, failure) === 'failed' ? [{ name: file.name, problem: failure }] : [];
		});
		return problems.length > 0 ? namedProblemsText(problems) : null;
	};

export const selectIsVariantInstalling =
	(variantId: string) =>
	(state: IpAdapterState): boolean =>
		state.installing[variantId] === true;
