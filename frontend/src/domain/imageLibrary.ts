// Image library domain (online images with their tags, LoRAs and checkpoint): search filters -> requests, image
// keys, tags of an image, its LoRA / checkpoint resources and the status rows the views show. Pure module; state
// lives in src/stores/imageLibraryStore.ts. Backend-owned rules are only READ here, never re-implemented:
// - parsing of the provider's image metadata and inline <lora:name:weight> tags: RemoteImage.resources and
//   ImageGenerationParams.clean_prompt (backend services/model_providers/civitai_images.py);
// - search defaults: IMAGE_SEARCH_QUERY_DEFAULTS (generated from the backend ImageSearchQuery);
// - weight range/default: LORA_WEIGHT_DEFAULTS through clampLoraWeight (src/domain/loraSelection.ts);
// - tag splitting and joining: splitPromptTags / joinPromptTags (src/domain/text.ts); library matching: findEntryBySource (src/domain/library.ts);
//   install keys and version status: installKey / versionStatusKind (src/domain/modelCatalog.ts).
import { IMAGE_SEARCH_QUERY_DEFAULTS, LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type {
	ImagePeriod,
	ImageResource,
	ImageSearchQuery,
	ImageSort,
	ModelKind,
	RemoteImage,
	RemoteModel,
	RemoteModelVersion,
	ResolvedImageResource,
} from '../api/types';
import { findEntryBySource, type LibraryData } from './library';
import { clampLoraWeight } from './loraSelection';
import { installKey, versionStatusKind, type InstallPhase, type VersionStatusKind } from './modelCatalog';
import { basename, stripExtension } from './paths';
import { splitPromptTags } from './text';

/** User-editable search filters (the rest of ImageSearchQuery: limit from the defaults, cursor from paging). */
export type ImageFilters = Pick<ImageSearchQuery, 'provider' | 'query' | 'sort' | 'period' | 'nsfw' | 'usable_only'>;

/** Initial filters: the backend ImageSearchQuery defaults (NSFW off, locally usable base models only). */
export const DEFAULT_IMAGE_FILTERS: ImageFilters = {
	provider: IMAGE_SEARCH_QUERY_DEFAULTS.provider,
	query: IMAGE_SEARCH_QUERY_DEFAULTS.query,
	sort: IMAGE_SEARCH_QUERY_DEFAULTS.sort,
	period: IMAGE_SEARCH_QUERY_DEFAULTS.period,
	nsfw: IMAGE_SEARCH_QUERY_DEFAULTS.nsfw,
	usable_only: IMAGE_SEARCH_QUERY_DEFAULTS.usable_only,
};

/** The request of one result page: filters (query trimmed) + IMAGE_SEARCH_QUERY_DEFAULTS.limit + cursor. */
export function buildImageSearchQuery(filters: ImageFilters, cursor: string | null): ImageSearchQuery {
	return { ...filters, query: filters.query.trim(), limit: IMAGE_SEARCH_QUERY_DEFAULTS.limit, cursor };
}

/** Stable key of an image: '<provider>:<image id>' (results and their paging, favorites, resolutions, selection). */
export function imageKey(image: Pick<RemoteImage, 'provider' | 'id'>): string {
	return `${image.provider}:${image.id}`;
}

/** The period filter only applies to the unfiltered feed: a keyword search ignores it (backend ImageSearchQuery). */
export function isPeriodApplicable(filters: Pick<ImageFilters, 'query'>): boolean {
	return filters.query.trim() === '';
}

/** Every ImageSort with its UI label (exhaustive: the type-check fails when the backend adds one). */
export const IMAGE_SORT_LABELS: Record<ImageSort, string> = {
	most_reactions: 'Most reactions',
	most_comments: 'Most comments',
	most_collected: 'Most collected',
	newest: 'Newest',
};

/** Every ImagePeriod with its UI label (exhaustive). */
export const IMAGE_PERIOD_LABELS: Record<ImagePeriod, string> = {
	day: 'Day',
	week: 'Week',
	month: 'Month',
	year: 'Year',
	all_time: 'All time',
};

const LINE_BREAKS = /\r\n|\r|\n/g;

/** Tags of an image: splitPromptTags (src/domain/text.ts) of params.clean_prompt, line breaks counting as
 *  separators; [] without generation data. */
export function imageTags(image: RemoteImage): string[] {
	const prompt = image.params?.clean_prompt;
	return prompt ? splitPromptTags(prompt.replace(LINE_BREAKS, ',')) : [];
}

/** The weight "Use these LoRAs" applies for a resource: its published weight (default
 *  LORA_WEIGHT_DEFAULTS.weight when unpublished), through clampLoraWeight. */
export function appliedLoraWeight(resource: ImageResource): number {
	return clampLoraWeight(resource.weight ?? LORA_WEIGHT_DEFAULTS.weight);
}

/** Status of one image resource (first match wins): 'resolving' while its image's resolution runs; a library
 *  entry found (SHA-256 or provenance via findEntryBySource, else an entry of the same kind whose file name without
 *  extension equals resource.name, case-insensitive: resourceLibraryEntryId) -> 'in_library'; 'unresolved' when the resolution gave no model; otherwise
 *  versionStatusKind of the resolved version (unavailable / installing / failed / in_library / on_disk / remote). */
export type ImageResourceStatusKind = VersionStatusKind | 'resolving' | 'unresolved';

/** One row of the detail panel's LoRA list or checkpoint line (computed by the image library store hooks). */
export type ImageResourceRow = {
	/** Position in RemoteImage.resources (stable React key). */
	index: number;
	resource: ImageResource;
	/** Resolved model name (+ version name), else resource.name, else a generic label. */
	name: string;
	/** LoRAs: the weight "Use these LoRAs" applies (appliedLoraWeight); null for other kinds. */
	weight: number | null;
	/** False when the image publishes no weight (weight is then the default). */
	weightPublished: boolean;
	status: ImageResourceStatusKind;
	/** Why it cannot be used: unavailable_reason, resolution error or install error (null otherwise). */
	reason: string | null;
	/** Library entry used by this resource (status 'in_library'), else null. */
	libraryEntryId: string | null;
	/** installKey (src/domain/modelCatalog.ts) of the resolved version's default install, null when unresolved.
	 *  Views read the running install from useModelCatalogStore installs[installKey] and show it with
	 *  InstallProgress (src/features/models/InstallProgress.tsx; progress from useDownloadProgress). */
	installKey: string | null;
	/** Resolved provider model / version (null while resolving or when unresolved). */
	model: RemoteModel | null;
	version: RemoteModelVersion | null;
	/** Provider page of the resolved version (null when unresolved). */
	pageUrl: string | null;
};

// ---------------------------------------------------------------------------
// Resolution of an image's resources and the rows of the detail panel
// ---------------------------------------------------------------------------

export type ImageResolutionStatus = 'loading' | 'ready' | 'failed';

/** Resolution of an image's resources (api.resolveImageResources), kept per imageKey by the image library store. */
export type ImageResolution = {
	status: ImageResolutionStatus;
	/** One item per RemoteImage.resources entry, in order (empty until ready). */
	items: ResolvedImageResource[];
	/** Why the request failed (status 'failed'). */
	error: string | null;
};

/** What a resource row reads of an install (src/stores/modelCatalogStore.ts InstallEntry). */
export type ResourceInstallState = { phase: InstallPhase; error: string | null };

/** Everything besides the image that resource rows are computed from. */
export type ImageResourceContext = {
	/** The image's resolution (undefined: never requested). */
	resolution: ImageResolution | undefined;
	/** Library store entries. */
	library: Pick<LibraryData, 'models' | 'loras'>;
	/** Installs by installKey (the catalog store installs, or the ones of resolvedInstallKeys). */
	installs: Readonly<Record<string, ResourceInstallState | undefined>>;
};

/** Name of a resource that has none (neither resolved nor published). */
const UNKNOWN_RESOURCE_NAMES: Record<ModelKind, string> = {
	checkpoint: 'Unknown checkpoint',
	lora: 'Unknown LoRA',
	embedding: 'Unknown embedding',
};

/** The provider model and version a resolution item resolved to (ResolvedImageResource.model carries versions ==
 *  [the resolved version]); null when unresolved. */
export function resolvedModelVersion(item: ResolvedImageResource | null | undefined): { model: RemoteModel; version: RemoteModelVersion } | null {
	const model = item?.model ?? null;
	const version = model?.versions[0] ?? null;
	return model && version ? { model, version } : null;
}

/** installKey of the default install of every resolved version of a ready resolution (unique, in resource order):
 *  the catalog installs the rows of the image read. */
export function resolvedInstallKeys(resolution: ImageResolution | undefined): string[] {
	if (resolution?.status !== 'ready') {
		return [];
	}
	const keys = new Set<string>();
	for (const item of resolution.items) {
		const resolved = resolvedModelVersion(item);
		if (resolved) {
			keys.add(installKey(resolved.model.provider, resolved.version, null));
		}
	}
	return [...keys];
}

/** The library entry a resource uses: same SHA-256 or provenance (findEntryBySource with the resolved version, else
 *  the published version id, and the resolution's SHA-256), else an entry of the same kind whose file name without
 *  extension equals resource.name (case-insensitive). Only checkpoints and LoRAs have entries. */
export function resourceLibraryEntryId(
	library: Pick<LibraryData, 'models' | 'loras'>,
	provider: string,
	resource: ImageResource,
	item: ResolvedImageResource | null,
): string | null {
	if (resource.kind === 'embedding') {
		return null;
	}
	const resolved = resolvedModelVersion(item);
	const versionId = resolved?.version.id ?? resource.version_id;
	const sha256 = item?.sha256 ?? null;
	if (versionId || sha256) {
		const match = findEntryBySource(library, { provider: resolved?.model.provider ?? provider, versionId: versionId ?? '', sha256 });
		if (match?.kind === resource.kind) {
			return match.id;
		}
	}
	const name = resource.name?.trim().toLowerCase();
	if (!name) {
		return null;
	}
	const entries = resource.kind === 'checkpoint' ? library.models : library.loras;
	return entries.find((entry) => stripExtension(basename(entry.path)).toLowerCase() === name)?.id ?? null;
}

/** The row of image.resources[index] (status precedence: see ImageResourceStatusKind). */
export function imageResourceRow(image: RemoteImage, index: number, context: ImageResourceContext): ImageResourceRow {
	const resource = image.resources[index];
	const { resolution } = context;
	const item = resolution?.status === 'ready' ? (resolution.items[index] ?? null) : null;
	const resolved = resolvedModelVersion(item);
	const key = resolved ? installKey(resolved.model.provider, resolved.version, null) : null;
	const install = key === null ? null : (context.installs[key] ?? null);
	const isLora = resource.kind === 'lora';
	const row: ImageResourceRow = {
		index,
		resource,
		name: resolved ? `${resolved.model.name} - ${resolved.version.name}` : resource.name || UNKNOWN_RESOURCE_NAMES[resource.kind],
		weight: isLora ? appliedLoraWeight(resource) : null,
		weightPublished: isLora && resource.weight !== null,
		status: 'resolving',
		reason: null,
		libraryEntryId: null,
		installKey: key,
		model: resolved?.model ?? null,
		version: resolved?.version ?? null,
		pageUrl: resolved ? (resolved.version.page_url ?? resolved.model.page_url) : null,
	};
	if (resolution?.status === 'loading') {
		return row;
	}
	const libraryEntryId = resourceLibraryEntryId(context.library, image.provider, resource, item);
	if (libraryEntryId !== null) {
		return { ...row, status: 'in_library', libraryEntryId };
	}
	if (!resolved) {
		return { ...row, status: 'unresolved', reason: item?.error ?? resolution?.error ?? null };
	}
	const status = versionStatusKind(resolved.version, install?.phase ?? null, false);
	const reason = status === 'unavailable' ? resolved.version.unavailable_reason : status === 'failed' ? (install?.error ?? null) : null;
	return { ...row, status, reason };
}

/** The LoRA rows of an image (one per LoRA resource, in order). */
export function imageLoraRows(image: RemoteImage, context: ImageResourceContext): ImageResourceRow[] {
	return image.resources.flatMap((resource, index) => (resource.kind === 'lora' ? [imageResourceRow(image, index, context)] : []));
}

/** The checkpoint row of an image: its first checkpoint resource (null when it publishes none). */
export function imageCheckpointRow(image: RemoteImage, context: ImageResourceContext): ImageResourceRow | null {
	const index = image.resources.findIndex((resource) => resource.kind === 'checkpoint');
	return index < 0 ? null : imageResourceRow(image, index, context);
}

const INSTALLABLE_STATUSES: ReadonlySet<ImageResourceStatusKind> = new Set<ImageResourceStatusKind>(['installing', 'failed', 'on_disk', 'remote']);

/** A row whose resolved version can be installed through the catalog store (not in the library, resolved, not
 *  unavailable; a running install is joined, a failed one retried). */
export function isInstallableRow(row: ImageResourceRow): row is ImageResourceRow & { model: RemoteModel; version: RemoteModelVersion } {
	return row.model !== null && row.version !== null && INSTALLABLE_STATUSES.has(row.status);
}

/** Why a resource without a more precise reason cannot be used. */
export const UNRESOLVED_RESOURCE = 'Its model could not be identified.';
