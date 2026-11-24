// Model catalog store (online model library): single truth holder of the provider info, the search filters and
// results, the version picked in each result, and the installs in progress. Not persisted.
// Pure logic lives in src/domain/modelCatalog.ts; library entries stay in the library store (registerInstalled);
// download progress stays in the tasks store (useDownloadProgress) and is never copied here.
import { useMemo } from 'react';
import { create } from 'zustand';
import { ApiError, api } from '../api/client';
import type {
	InstalledModel,
	InstallJob,
	InstallRequest,
	InstallResponse,
	ModelKind,
	ModelLibraryInfo,
	ModelProviderInfo,
	ModelSort,
	RemoteModel,
	RemoteModelVersion,
	TaskEvent,
} from '../api/types';
import { findEntryBySource } from '../domain/library';
import {
	appendResults,
	buildSearchQuery,
	DEFAULT_CATALOG_FILTERS,
	embeddingPromptToken,
	installFile,
	installKey,
	isInstallRunning,
	modelKey,
	pickedVersion,
	triggerWordsText,
	versionStatusKind,
	type CatalogFilters,
	type InstallPhase,
	type VersionStatusKind,
} from '../domain/modelCatalog';
import { copyTextWithFeedback } from './clipboardActions';
import { useLibraryStore } from './libraryStore';
import { describeError, reportError, useNotificationsStore } from './notificationsStore';
import { useDownloadProgress, useTasksStore, type DownloadProgress } from './tasksStore';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'failed';
export type SearchStatus = 'idle' | 'loading' | 'loadingMore' | 'ready' | 'failed';

/** Defined in src/domain/modelCatalog.ts (with RUNNING_INSTALL_PHASES / isInstallRunning). */
export type { InstallPhase } from '../domain/modelCatalog';

export type InstallEntry = {
	key: string;
	provider: string;
	modelId: string;
	versionId: string;
	/** Requested file (null = the version's default file). */
	fileId: string | null;
	kind: ModelKind;
	phase: InstallPhase;
	/** Download task (phase 'downloading'; also kept while registering). */
	taskId: string | null;
	error: string | null;
};

export type ModelCatalogState = {
	info: ModelLibraryInfo | null;
	infoStatus: LoadStatus;
	/** Why the info could not be loaded (infoStatus 'failed'). */
	infoError: string | null;
	filters: CatalogFilters;
	results: RemoteModel[];
	nextCursor: string | null;
	searchStatus: SearchStatus;
	searchError: string | null;
	/** Version picked in each result's version picker, by modelKey; absent = the first version. */
	pickedVersionIds: Record<string, string>;
	/** Running or failed installs by installKey; a successful install is removed (the library store then has it). */
	installs: Record<string, InstallEntry>;
};

export type ModelCatalogActions = {
	/** Idempotent first use of the pane: loads the info (api.modelLibraryInfo) once (again only after a failure)
	 *  and runs the first search when none ran yet. Failures -> infoStatus 'failed' / searchStatus 'failed'
	 *  (+ infoError / searchError), no throw. */
	activate: () => Promise<void>;
	/** Reloads the provider info (token state). */
	loadInfo: () => Promise<void>;
	/** Updates the query text and searches again after SEARCH_DEBOUNCE_MS of inactivity (timer owned here). */
	setQuery: (query: string) => void;
	/** The other filters search again immediately. */
	setKinds: (kinds: ModelKind[]) => void;
	setBaseModels: (baseModels: string[]) => void;
	setSort: (sort: ModelSort) => void;
	setNsfw: (nsfw: boolean) => void;
	/** Searches from the first page (aborting the request in flight; stale answers are ignored). The current
	 *  results stay visible while it loads; a failure clears them (searchError set, no notification). */
	search: () => Promise<void>;
	/** Appends the next page (no-op without nextCursor or while a search runs). A failure keeps the results. */
	loadMore: () => Promise<void>;
	pickVersion: (modelKey: string, versionId: string) => void;
	/** Select -> use: api.installModel({provider, version_id, file_id}); 'installed' -> useLibraryStore.registerInstalled
	 *  (selects it; embeddings: info notification with embeddingPromptToken) + success notification naming
	 *  InstalledModel.name (display names come from the backend: InstalledModel.name, DownloadTaskEvent.title);
	 *  'downloading' -> phase 'downloading' + taskId, useTasksStore.waitForTask(taskId): complete -> phase
	 *  'registering', api.installModel again, register; error -> phase 'failed' with the event message (+ an error
	 *  notification: the pane may be closed); cancelled -> entry removed. API errors -> phase 'failed' + reportError.
	 *  No-op while the same installKey runs. Refused upfront (failed entry + warning) when version.unavailable_reason
	 *  is set. Resolves when the install ended; never rejects. */
	install: (model: RemoteModel, version: RemoteModelVersion, fileId?: string | null) => Promise<void>;
	/** api.cancelDownload(taskId) of a downloading install (the task then ends 'cancelled'). A 404 (the backend runs
	 *  no such download any more, e.g. after a backend restart) removes the install; other errors are reported. */
	cancelInstall: (key: string) => Promise<void>;
	dismissInstallError: (key: string) => void;
	/** Boot (session store): api.listInstalls() and follow each running install as install() would (kind and ids
	 *  come from the InstallJob). Failures are ignored (the backend may not know any install); never rejects. */
	resumeInstalls: () => Promise<void>;
	/** api.setProviderToken(provider, token) (null/'' removes it), then the info's provider entry is replaced
	 *  by the answer. Success/failure notifications; the token itself is never kept in any store. */
	setProviderToken: (provider: string, token: string | null) => Promise<void>;
	/** Copies trigger words (joined by triggerWordsText of src/domain/modelCatalog.ts) through
	 *  copyTextWithFeedback (src/stores/clipboardActions.ts). Used by result cards and local library entries. */
	copyTriggerWords: (words: readonly string[]) => Promise<void>;
	/** Copies the prompt text using an installed embedding (embeddingPromptToken(path)). */
	copyEmbeddingToken: (path: string) => Promise<void>;
};

export type ModelCatalogStore = ModelCatalogState & ModelCatalogActions;

export const SEARCH_DEBOUNCE_MS = 350;

/** The search request in flight (aborted by the next one) and the sequence number of the latest request:
 *  an answer is applied only while its request is still the latest (stale answers are ignored). */
let searchController: AbortController | null = null;
let searchSequence = 0;
/** Pending debounced search of setQuery (cleared by every search). */
let queryTimer: ReturnType<typeof setTimeout> | null = null;

function clearQueryTimer(): void {
	if (queryTimer !== null) {
		clearTimeout(queryTimer);
		queryTimer = null;
	}
}

const DOWNLOAD_FAILED = 'The download failed.';

/** The InstalledModel of an 'installed' answer (after a completed download the file must be installed). */
function installedOf(response: InstallResponse): InstalledModel {
	if (response.state !== 'installed' || !response.installed) {
		throw new Error('The download completed but the backend did not install the file.');
	}
	return response.installed;
}

/** Display name of a download task (DownloadTaskEvent.title, from the backend). */
function downloadTitle(event: TaskEvent): string {
	return event.type === 'download' ? event.title : '';
}

export const useModelCatalogStore = create<ModelCatalogStore>()((set, get) => {
	/** Searches one page: cursor null = the first page (replaces the results), else the next one (appended). */
	const fetchPage = async (cursor: string | null): Promise<void> => {
		searchController?.abort();
		const controller = new AbortController();
		searchController = controller;
		const sequence = ++searchSequence;
		set(cursor === null ? { searchStatus: 'loading', searchError: null, nextCursor: null } : { searchStatus: 'loadingMore', searchError: null });
		try {
			const page = await api.searchModels(buildSearchQuery(get().filters, cursor), controller.signal);
			if (sequence === searchSequence) {
				set((state) => ({
					results: appendResults(cursor === null ? [] : state.results, page.items),
					nextCursor: page.next_cursor,
					searchStatus: 'ready',
				}));
			}
		} catch (error) {
			if (sequence === searchSequence) {
				set({ searchStatus: 'failed', searchError: describeError(error), ...(cursor === null ? { results: [] } : {}) });
			}
		} finally {
			if (searchController === controller) {
				searchController = null;
			}
		}
	};

	const updateFilters = (patch: Partial<CatalogFilters>) => {
		set((state) => ({ filters: { ...state.filters, ...patch } }));
		void get().search();
	};

	const putInstall = (entry: InstallEntry) => set((state) => ({ installs: { ...state.installs, [entry.key]: entry } }));

	const patchInstall = (key: string, patch: Partial<InstallEntry>) =>
		set((state) => {
			const entry = state.installs[key];
			return entry ? { installs: { ...state.installs, [key]: { ...entry, ...patch } } } : state;
		});

	const removeInstall = (key: string) =>
		set((state) => {
			if (!(key in state.installs)) {
				return state;
			}
			const installs = { ...state.installs };
			delete installs[key];
			return { installs };
		});

	/** The file is local: registered (and selected) in the library, announced, and its install entry removed. */
	const completeInstall = (key: string, installed: InstalledModel) => {
		useLibraryStore.getState().registerInstalled(installed);
		removeInstall(key);
		const { notify } = useNotificationsStore.getState();
		if (installed.kind === 'embedding') {
			notify('info', `${installed.name} is ready: write ${embeddingPromptToken(installed.path)} in a prompt to use it.`);
		} else {
			notify('success', `${installed.name} is ready and selected for generation.`);
		}
	};

	/** Drives an install entry to its end (shared by install and resumeInstalls): phase 'checking' asks the backend
	 *  (api.installModel), phase 'downloading' follows the download task (useTasksStore.waitForTask), then the
	 *  install is requested again to get the InstalledModel. Never throws. */
	const runInstall = async (entry: InstallEntry): Promise<void> => {
		const { key } = entry;
		const request: InstallRequest = { provider: entry.provider, version_id: entry.versionId, file_id: entry.fileId };
		try {
			let taskId = entry.taskId;
			if (entry.phase === 'checking') {
				const response = await api.installModel(request);
				if (response.state === 'installed') {
					completeInstall(key, installedOf(response));
					return;
				}
				taskId = response.task_id;
				patchInstall(key, { phase: 'downloading', taskId });
			}
			if (!taskId) {
				throw new Error('The backend started a download without a task id.');
			}
			const event = await useTasksStore.getState().waitForTask(taskId);
			if (event.stage === 'cancelled') {
				removeInstall(key);
				return;
			}
			if (event.stage === 'error') {
				const message = event.message || DOWNLOAD_FAILED;
				const title = downloadTitle(event);
				patchInstall(key, { phase: 'failed', error: message });
				useNotificationsStore.getState().notify('error', title ? `${title}: ${message}` : message, { title: 'Download failed' });
				return;
			}
			patchInstall(key, { phase: 'registering' });
			completeInstall(key, installedOf(await api.installModel(request)));
		} catch (error) {
			patchInstall(key, { phase: 'failed', error: describeError(error) });
			reportError(error, 'Install failed');
		}
	};

	return {
		info: null,
		infoStatus: 'idle',
		infoError: null,
		filters: DEFAULT_CATALOG_FILTERS,
		results: [],
		nextCursor: null,
		searchStatus: 'idle',
		searchError: null,
		pickedVersionIds: {},
		installs: {},

		activate: async () => {
			const { infoStatus, searchStatus } = get();
			await Promise.all([
				infoStatus === 'idle' || infoStatus === 'failed' ? get().loadInfo() : undefined,
				searchStatus === 'idle' ? get().search() : undefined,
			]);
		},

		loadInfo: async () => {
			set({ infoStatus: 'loading', infoError: null });
			try {
				const info = await api.modelLibraryInfo();
				set({ info, infoStatus: 'ready' });
			} catch (error) {
				set({ infoStatus: 'failed', infoError: describeError(error) });
			}
		},

		setQuery: (query) => {
			if (query === get().filters.query) {
				return;
			}
			set((state) => ({ filters: { ...state.filters, query } }));
			clearQueryTimer();
			queryTimer = setTimeout(() => {
				queryTimer = null;
				void get().search();
			}, SEARCH_DEBOUNCE_MS);
		},
		setKinds: (kinds) => updateFilters({ kinds: [...kinds] }),
		setBaseModels: (baseModels) => updateFilters({ base_models: [...baseModels] }),
		setSort: (sort) => updateFilters({ sort }),
		setNsfw: (nsfw) => updateFilters({ nsfw }),

		search: () => {
			clearQueryTimer();
			return fetchPage(null);
		},

		loadMore: async () => {
			const { nextCursor, searchStatus } = get();
			if (nextCursor === null || searchStatus === 'loading' || searchStatus === 'loadingMore') {
				return;
			}
			await fetchPage(nextCursor);
		},

		pickVersion: (key, versionId) => {
			if (get().pickedVersionIds[key] !== versionId) {
				set((state) => ({ pickedVersionIds: { ...state.pickedVersionIds, [key]: versionId } }));
			}
		},

		install: async (model, version, fileId = null) => {
			const key = installKey(model.provider, version, fileId);
			if (isInstallRunning(get().installs[key]?.phase)) {
				return;
			}
			const entry: InstallEntry = {
				key,
				provider: model.provider,
				modelId: model.id,
				versionId: version.id,
				fileId,
				kind: model.kind,
				phase: 'checking',
				taskId: null,
				error: null,
			};
			if (version.unavailable_reason) {
				putInstall({ ...entry, phase: 'failed', error: version.unavailable_reason });
				useNotificationsStore.getState().notify('warning', version.unavailable_reason, { title: `${model.name} cannot be installed` });
				return;
			}
			putInstall(entry);
			await runInstall(entry);
		},

		cancelInstall: async (key) => {
			const entry = get().installs[key];
			if (entry?.phase !== 'downloading' || !entry.taskId) {
				return;
			}
			try {
				await api.cancelDownload(entry.taskId);
			} catch (error) {
				if (error instanceof ApiError && error.status === 404) {
					// The backend runs no such download (lost on a backend restart, or just finished): nothing is
					// left to cancel, the entry must not block the version. A finishing install still registers.
					removeInstall(key);
					return;
				}
				reportError(error, 'Could not cancel the download');
			}
		},

		dismissInstallError: (key) => {
			if (get().installs[key]?.phase === 'failed') {
				removeInstall(key);
			}
		},

		resumeInstalls: async () => {
			let jobs: InstallJob[];
			try {
				jobs = await api.listInstalls();
			} catch {
				return;
			}
			await Promise.all(
				jobs.map((job) => {
					const key = installKey(job.provider, { id: job.version_id, default_file_id: job.file_id }, job.file_id);
					if (isInstallRunning(get().installs[key]?.phase)) {
						return undefined;
					}
					const entry: InstallEntry = {
						key,
						provider: job.provider,
						modelId: job.model_id,
						versionId: job.version_id,
						fileId: job.file_id,
						kind: job.kind,
						phase: 'downloading',
						taskId: job.task_id,
						error: null,
					};
					putInstall(entry);
					return runInstall(entry);
				}),
			);
		},

		setProviderToken: async (provider, token) => {
			try {
				const updated = await api.setProviderToken(provider, token);
				set((state) =>
					state.info
						? { info: { ...state.info, providers: state.info.providers.map((item) => (item.id === updated.id ? updated : item)) } }
						: state,
				);
				useNotificationsStore
					.getState()
					.notify('success', updated.token_set ? `${updated.label} API token saved.` : `${updated.label} API token removed.`);
			} catch (error) {
				reportError(error, 'Could not save the API token');
			}
		},

		copyTriggerWords: (words) => copyTextWithFeedback(triggerWordsText(words), 'Trigger words'),
		copyEmbeddingToken: (path) => copyTextWithFeedback(embeddingPromptToken(path), 'Embedding token'),
	};
});

// ---------------------------------------------------------------------------
// Selectors / hooks (views read through these; nothing derived is stored)
// ---------------------------------------------------------------------------

/** Info of the provider of the current filters (null before the info is loaded). */
export const selectActiveProvider = (state: ModelCatalogState): ModelProviderInfo | null =>
	state.info?.providers.find((provider) => provider.id === state.filters.provider) ?? null;

/** Keys of the installs no result card shows (a card shows the default install of its picked version): the
 *  downloads list. A new array on each call: read it with useShallow. */
export const selectDetachedInstallKeys = (state: ModelCatalogState): string[] => {
	const shown = new Set<string>();
	for (const model of state.results) {
		const version = pickedVersion(model, state.pickedVersionIds[modelKey(model)]);
		if (version) {
			shown.add(installKey(model.provider, version, null));
		}
	}
	return Object.keys(state.installs).filter((key) => !shown.has(key));
};

/** The version shown by a result card (pickedVersion of src/domain/modelCatalog.ts). */
export function usePickedVersion(model: RemoteModel): RemoteModelVersion | null {
	const pickedId = useModelCatalogStore((state) => state.pickedVersionIds[modelKey(model)]);
	return pickedVersion(model, pickedId);
}

export type VersionStatus = {
	kind: VersionStatusKind;
	/** unavailable_reason ('unavailable') or the install error ('failed'). */
	reason: string | null;
	/** installKey of the version's (default) install target. */
	installKey: string;
	install: InstallEntry | null;
	/** Download progress of the running install (tasks store), null otherwise. */
	progress: DownloadProgress | null;
	/** Library entry with this provenance ('in_library'), else null. */
	libraryEntryId: string | null;
	/** Size of the install file in bytes (null when the version has no installable file). */
	sizeBytes: number | null;
};

/** Status of a version for its result card: combines the installs of this store, the tasks store progress
 *  and the library store entries (memoized: the same object while none of them changes). */
export function useVersionStatus(model: RemoteModel, version: RemoteModelVersion): VersionStatus {
	const key = installKey(model.provider, version, null);
	const install = useModelCatalogStore((state) => state.installs[key] ?? null);
	const file = useMemo(() => installFile(version), [version]);
	const sha256 = file?.sha256 ?? null;
	const libraryEntryId = useLibraryStore(
		(state) => findEntryBySource(state, { provider: model.provider, versionId: version.id, sha256 })?.id ?? null,
	);
	const progress = useDownloadProgress(isInstallRunning(install?.phase) ? (install?.taskId ?? null) : null);
	return useMemo(() => {
		const kind = versionStatusKind(version, install?.phase ?? null, libraryEntryId !== null);
		return {
			kind,
			reason: kind === 'unavailable' ? version.unavailable_reason : kind === 'failed' ? (install?.error ?? null) : null,
			installKey: key,
			install,
			progress,
			libraryEntryId,
			sizeBytes: file?.size_bytes ?? null,
		};
	}, [version, key, install, progress, libraryEntryId, file]);
}
