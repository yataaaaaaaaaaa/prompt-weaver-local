// Model catalog domain (online model library): search filters -> requests, keys of result models and
// installs, and the status of a remote version for the views. Pure module; state lives in
// src/stores/modelCatalogStore.ts. Backend-owned rules are only READ here, never re-implemented:
// - which file an install uses: RemoteModelVersion.default_file_id;
// - whether a version can be installed: RemoteModelVersion.unavailable_reason;
// - display names of installs: InstalledModel.name / DownloadTaskEvent.title;
// - search defaults: MODEL_SEARCH_QUERY_DEFAULTS (generated from the backend ModelSearchQuery).
import { MODEL_SEARCH_QUERY_DEFAULTS } from '../api/defaults.gen';
import type { ModelKind, ModelSearchQuery, ModelSort, RemoteFile, RemoteModel, RemoteModelVersion } from '../api/types';
import { basename, stripExtension } from './paths';

/** User-editable search filters (the rest of ModelSearchQuery: limit from the defaults, cursor from paging). */
export type CatalogFilters = Pick<ModelSearchQuery, 'provider' | 'query' | 'kinds' | 'base_models' | 'sort' | 'nsfw'>;

/** Initial filters: the backend ModelSearchQuery defaults. */
export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
	provider: MODEL_SEARCH_QUERY_DEFAULTS.provider,
	query: MODEL_SEARCH_QUERY_DEFAULTS.query,
	kinds: [...MODEL_SEARCH_QUERY_DEFAULTS.kinds],
	base_models: [...MODEL_SEARCH_QUERY_DEFAULTS.base_models],
	sort: MODEL_SEARCH_QUERY_DEFAULTS.sort,
	nsfw: MODEL_SEARCH_QUERY_DEFAULTS.nsfw,
};

/** The request of one result page: filters (query trimmed) + MODEL_SEARCH_QUERY_DEFAULTS.limit + cursor. */
export function buildSearchQuery(filters: CatalogFilters, cursor: string | null): ModelSearchQuery {
	return {
		...filters,
		query: filters.query.trim(),
		kinds: [...filters.kinds],
		base_models: [...filters.base_models],
		limit: MODEL_SEARCH_QUERY_DEFAULTS.limit,
		cursor,
	};
}

/** Stable key of a result model: '<provider>:<model id>'. */
export function modelKey(model: Pick<RemoteModel, 'provider' | 'id'>): string {
	return `${model.provider}:${model.id}`;
}

/** Key of one install target: '<provider>:<version id>:<file id>' (file id = the version's default file when null,
 *  '' when the version has none). At most one install per key runs at a time. */
export function installKey(provider: string, version: Pick<RemoteModelVersion, 'id' | 'default_file_id'>, fileId: string | null): string {
	return `${provider}:${version.id}:${fileId ?? version.default_file_id ?? ''}`;
}

/** The version shown for a result: the picked one when it still exists, else the first (newest) one; null without versions. */
export function pickedVersion(model: RemoteModel, pickedVersionId: string | undefined): RemoteModelVersion | null {
	return model.versions.find((version) => version.id === pickedVersionId) ?? model.versions[0] ?? null;
}

/** The file an install of `version` downloads (version.default_file_id), or the given one; null when unknown. */
export function installFile(version: RemoteModelVersion, fileId: string | null = null): RemoteFile | null {
	const id = fileId ?? version.default_file_id;
	return id == null ? null : (version.files.find((file) => file.id === id) ?? null);
}

/** Merges a further result page: keeps the order, drops models already listed (same modelKey). */
export function appendResults(current: readonly RemoteModel[], page: readonly RemoteModel[]): RemoteModel[] {
	const seen = new Set(current.map(modelKey));
	const added = page.filter((model) => {
		const key = modelKey(model);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	return [...current, ...added];
}

/** Trigger words as pasted into a prompt: trimmed, empty ones dropped, joined with ', '. */
export function triggerWordsText(words: readonly string[]): string {
	return words
		.map((word) => word.trim())
		.filter(Boolean)
		.join(', ');
}

/** Prompt text that uses an installed embedding file: 'embedding:<file name without extension>'
 *  (diffusion-lora-runtime resolves it against the embeddings folder). */
export function embeddingPromptToken(path: string): string {
	return `embedding:${stripExtension(basename(path))}`;
}

/** Phase of an install (src/stores/modelCatalogStore.ts installs). checking: api.installModel running (the backend
 *  may hash local candidates); downloading: following the download task; registering: re-installing after the
 *  download + library registration; failed: kept with its error until dismissed or retried. */
export type InstallPhase = 'checking' | 'downloading' | 'registering' | 'failed';

/** Phases of a running install (at most one runs per installKey). */
export const RUNNING_INSTALL_PHASES: ReadonlySet<InstallPhase> = new Set<InstallPhase>(['checking', 'downloading', 'registering']);

/** True while an install in `phase` runs (false without install). */
export function isInstallRunning(phase: InstallPhase | null | undefined): boolean {
	return phase != null && RUNNING_INSTALL_PHASES.has(phase);
}

/** Status of a remote version as shown by a result card (first match wins, in this order):
 *  - 'unavailable': version.unavailable_reason is set;
 *  - 'installing': an install of it is running (RUNNING_INSTALL_PHASES);
 *  - 'failed': its last install failed (error kept until dismissed or retried);
 *  - 'in_library': a library entry has this provenance (findEntryBySource in src/domain/library.ts);
 *  - 'on_disk': the install file has a local_path (backend-known local copy, not registered yet);
 *  - 'remote': nothing local. */
export type VersionStatusKind = 'unavailable' | 'installing' | 'failed' | 'in_library' | 'on_disk' | 'remote';

/** The VersionStatusKind of `version` (precedence above) from the phase of its install (null = none) and
 *  whether a library entry has its provenance. */
export function versionStatusKind(version: RemoteModelVersion, installPhase: InstallPhase | null, inLibrary: boolean): VersionStatusKind {
	if (version.unavailable_reason) {
		return 'unavailable';
	}
	if (isInstallRunning(installPhase)) {
		return 'installing';
	}
	if (installPhase === 'failed') {
		return 'failed';
	}
	if (inLibrary) {
		return 'in_library';
	}
	return installFile(version)?.local_path ? 'on_disk' : 'remote';
}

/** Every ModelKind with its UI label (exhaustive: the type-check fails when the backend adds a kind). */
export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
	checkpoint: 'Checkpoint',
	lora: 'LoRA',
	embedding: 'Embedding',
};

/** Every ModelSort with its UI label (exhaustive). */
export const MODEL_SORT_LABELS: Record<ModelSort, string> = {
	most_downloaded: 'Most downloaded',
	highest_rated: 'Highest rated',
	newest: 'Newest',
};
