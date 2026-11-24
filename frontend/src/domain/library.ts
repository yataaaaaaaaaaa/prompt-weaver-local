// Model/LoRA library domain: the persisted library data, library entries created from picked paths and
// sanitizing of stored/imported library data. Pure module; state lives in src/stores/libraryStore.ts.
import { GENERATION_DEFAULTS, LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { InstalledModel, LoraWeight, LoRASpec, ModelKind, ModelSource, ModelSpec, TorchDType } from '../api/types';
import { isRecord, positiveNumberOr, stringOr } from './guards';
import type { Size } from './layout';
import { filterKnownLoras, loraAtDefaultWeight } from './loraSelection';
import { basename, stripExtension } from './paths';
import { uniqueKey, uniqueStrings } from './text';

/** Persisted format of the 'library-store' (version 2). Version 1 held the LoRA selection as `selectedLoraIds:
 *  string[]` (every LoRA at the default weight); version 0 = version 1 without `source` on entries. */
export type LibraryData = {
	models: ModelSpec[];
	loras: LoRASpec[];
	/** '' when no model is selected. */
	selectedModelId: string;
	/** The LoRAs selected for generation with their weights, in selection order (known ids, unique). */
	selectedLoras: LoraWeight[];
	lastModelDir: string | null;
	lastLoraDir: string | null;
};

// ---------------------------------------------------------------------------
// Library entries from picked paths
// ---------------------------------------------------------------------------

function samePath(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

/** Adds a model for a checkpoint file or a Diffusers folder (an entry with the same path is reused).
 *  id = unique key of the file name (legacy ids: 'JANKUV5NSFWTrainedNoobai_v50.safetensors' ->
 *  'jankuv5nsfwtrainednoobai-v50-safetensors'). */
export function addModelPath(models: ModelSpec[], path: string, defaultSize: Size): { models: ModelSpec[]; modelId: string } {
	const existing = models.find((model) => samePath(model.path, path));
	if (existing) {
		return { models, modelId: existing.id };
	}
	const name = basename(path);
	const model: ModelSpec = {
		id: uniqueKey(name, models.map((item) => item.id)),
		name,
		path,
		default_width: defaultSize.width,
		default_height: defaultSize.height,
		torch_dtype: GENERATION_DEFAULTS.torch_dtype,
		source: null,
	};
	return { models: [...models, model], modelId: model.id };
}

/** Adds LoRA entries for picked files (id from the name without extension) or folders (id from the folder
 *  name); entries with the same path are reused. Returns the ids of every picked path, in order. */
export function addLoraPaths(
	loras: LoRASpec[],
	paths: readonly string[],
	kind: 'file' | 'directory',
): { loras: LoRASpec[]; loraIds: string[] } {
	const next = [...loras];
	const loraIds: string[] = [];
	for (const path of paths) {
		const existing = next.find((lora) => samePath(lora.path, path));
		if (existing) {
			loraIds.push(existing.id);
			continue;
		}
		const name = basename(path);
		const lora: LoRASpec = {
			id: uniqueKey(kind === 'file' ? stripExtension(name) : name, next.map((item) => item.id)),
			name,
			path,
			source: null,
		};
		next.push(lora);
		loraIds.push(lora.id);
	}
	return { loras: next.length === loras.length ? loras : next, loraIds: uniqueStrings(loraIds) };
}

// ---------------------------------------------------------------------------
// Installed models (model library provenance)
// ---------------------------------------------------------------------------

/** Kinds that have library entries (embeddings are resolved from their folder by the runtime). */
export type LibraryEntryKind = Exclude<ModelKind, 'embedding'>;

export type LibraryEntryRef = { kind: LibraryEntryKind; id: string };

/** What identifies a provider file: provider + version (+ file), or its SHA-256 when known (lowercase hex, as the
 *  backend sends it and sanitizeModelSource stores it). */
export type SourceQuery = {
	provider: string;
	versionId: string;
	/** Restricts the provenance match to this file (any file of the version when absent). */
	fileId?: string | null;
	sha256?: string | null;
};

function matchesSource(source: ModelSource | null, query: SourceQuery): boolean {
	if (!source) {
		return false;
	}
	if (query.sha256 && source.sha256) {
		return source.sha256 === query.sha256;
	}
	return (
		source.provider === query.provider && source.version_id === query.versionId && (query.fileId == null || source.file_id === query.fileId)
	);
}

/** The first library entry (models, then LoRAs) installed from this provider file: same SHA-256 when
 *  both hashes are known, else same provider + version id (+ file id when given). null when none. */
export function findEntryBySource(library: Pick<LibraryData, 'models' | 'loras'>, query: SourceQuery): LibraryEntryRef | null {
	const model = library.models.find((entry) => matchesSource(entry.source, query));
	if (model) {
		return { kind: 'checkpoint', id: model.id };
	}
	const lora = library.loras.find((entry) => matchesSource(entry.source, query));
	return lora ? { kind: 'lora', id: lora.id } : null;
}

/** Every library entry (ModelSpec too) has the LoRASpec fields. */
type LibraryEntry = LoRASpec;

/** `entries` with `entryId` replaced by `patch(entry)`; the same array when the entry is unknown. */
function patchEntry<T extends LibraryEntry>(entries: T[], entryId: string, patch: (entry: T) => T): T[] {
	const index = entries.findIndex((entry) => entry.id === entryId);
	return index < 0 ? entries : entries.map((entry, position) => (position === index ? patch(entry) : entry));
}

/** Registers `installed` in one entry list; `add` (addModelPath / addLoraPaths) owns the path dedupe and id rules:
 *  1. the entry `add` finds at installed.path is reused and gets installed.source when it has none;
 *  2. else an entry with this provenance (`known`) is reused, its path updated to installed.path (the backend
 *     just found the file there: the old copy moved or the models folder changed);
 *  3. else the entry `add` created is kept, named installed.name, with installed.source. */
function registerIn<T extends LibraryEntry>(
	entries: T[],
	installed: InstalledModel,
	known: LibraryEntryRef | null,
	add: (entries: T[]) => { entries: T[]; entryId: string },
): { entries: T[]; entryId: string } {
	const { path, source } = installed;
	const added = add(entries);
	if (added.entries === entries) {
		const atPath = entries.find((entry) => entry.id === added.entryId);
		return { entries: atPath?.source ? entries : patchEntry(entries, added.entryId, (entry) => ({ ...entry, source })), entryId: added.entryId };
	}
	if (known?.kind === installed.kind) {
		return { entries: patchEntry(entries, known.id, (entry) => ({ ...entry, path })), entryId: known.id };
	}
	return { entries: patchEntry(added.entries, added.entryId, (entry) => ({ ...entry, name: installed.name, source })), entryId: added.entryId };
}

/** Library entry of a file installed by the model library (src/stores/libraryStore.ts registerInstalled).
 *  Reuses the entry at the same path (its missing source is attached, an existing one is kept), else the entry
 *  with the same provenance (path refreshed), else adds one named installed.name with installed.source.
 *  Embeddings have no library entry: entryId null. Unchanged lists keep their array reference. */
export function registerInstalledEntry(
	library: Pick<LibraryData, 'models' | 'loras'>,
	installed: InstalledModel,
	defaultSize: Size,
): Pick<LibraryData, 'models' | 'loras'> & { entryId: string | null } {
	const { models, loras } = library;
	if (installed.kind === 'embedding') {
		return { models, loras, entryId: null };
	}
	const { source } = installed;
	const known = findEntryBySource(library, { provider: source.provider, versionId: source.version_id, fileId: source.file_id, sha256: source.sha256 });
	if (installed.kind === 'checkpoint') {
		const result = registerIn(models, installed, known, (entries) => {
			const added = addModelPath(entries, installed.path, defaultSize);
			return { entries: added.models, entryId: added.modelId };
		});
		return { models: result.entries, loras, entryId: result.entryId };
	}
	const result = registerIn(loras, installed, known, (entries) => {
		const added = addLoraPaths(entries, [installed.path], 'file');
		return { entries: added.loras, entryId: added.loraIds[0] };
	});
	return { models, loras: result.entries, entryId: result.entryId };
}

// ---------------------------------------------------------------------------
// Sanitizing (persisted library-store, legacy import)
// ---------------------------------------------------------------------------

/** Every backend TorchDType value (exhaustive: the type-check fails when the schema changes). */
const TORCH_DTYPES: Record<TorchDType, true> = { float16: true, bfloat16: true, float32: true };

function isTorchDType(value: unknown): value is TorchDType {
	return typeof value === 'string' && Object.hasOwn(TORCH_DTYPES, value);
}

function isStringList(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function optionalString(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

const SOURCE_ID_FIELDS = ['provider', 'model_id', 'version_id', 'file_id'] as const;

/** Provenance of a stored entry: null when absent or unusable (a provider id or the model/version/file ids
 *  missing); optional fields fall back to ''/null/[]. */
export function sanitizeModelSource(value: unknown): ModelSource | null {
	if (!isRecord(value) || !SOURCE_ID_FIELDS.every((field) => typeof value[field] === 'string' && value[field])) {
		return null;
	}
	const sha256 = optionalString(value.sha256);
	return {
		provider: value.provider as string,
		model_id: value.model_id as string,
		version_id: value.version_id as string,
		file_id: value.file_id as string,
		model_name: stringOr(value.model_name, ''),
		version_name: stringOr(value.version_name, ''),
		base_model: stringOr(value.base_model, ''),
		sha256: sha256 ? sha256.toLowerCase() : null,
		preview_url: optionalString(value.preview_url),
		trigger_words: isStringList(value.trigger_words) ? value.trigger_words : [],
		page_url: optionalString(value.page_url),
	};
}

/** A library entry ({id, name, path, source}; LoRAs have nothing more): null when id or path is unusable. */
function sanitizeLora(value: unknown): LoRASpec | null {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.path !== 'string') {
		return null;
	}
	return {
		id: value.id,
		name: typeof value.name === 'string' && value.name ? value.name : basename(value.path) || value.id,
		path: value.path,
		source: sanitizeModelSource(value.source),
	};
}

function sanitizeModel(value: unknown): ModelSpec | null {
	const entry = sanitizeLora(value);
	if (!entry || !isRecord(value)) {
		return null;
	}
	return {
		...entry,
		default_width: positiveNumberOr(value.default_width, GENERATION_DEFAULTS.width),
		default_height: positiveNumberOr(value.default_height, GENERATION_DEFAULTS.height),
		torch_dtype: isTorchDType(value.torch_dtype) ? value.torch_dtype : GENERATION_DEFAULTS.torch_dtype,
	};
}

/** Legacy LoRA selections (library-store v0/v1 `selectedLoraIds`, app_state.json `last_lora_ids`): every id at
 *  LORA_WEIGHT_DEFAULTS.weight; anything but a list of strings is dropped. */
export function lorasFromLegacyIds(ids: unknown): LoraWeight[] {
	return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && id !== '').map(loraAtDefaultWeight) : [];
}

/** Stored LoraWeight items: entries without a usable id dropped, a missing or non-numeric weight ->
 *  LORA_WEIGHT_DEFAULTS.weight (ranges are clamped by filterKnownLoras). */
function parseLoraWeights(value: unknown): LoraWeight[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item): LoraWeight[] =>
		isRecord(item) && typeof item.id === 'string' && item.id
			? [{ id: item.id, weight: typeof item.weight === 'number' ? item.weight : LORA_WEIGHT_DEFAULTS.weight }]
			: [],
	);
}

/** The selection of untrusted library data: `selectedLoras`, else the legacy `selectedLoraIds` (default weight),
 *  else the fallback's selection. */
function pickSelectedLoras(raw: Record<string, unknown>, fallback: LibraryData): LoraWeight[] {
	if ('selectedLoras' in raw) {
		return parseLoraWeights(raw.selectedLoras);
	}
	if ('selectedLoraIds' in raw) {
		return lorasFromLegacyIds(raw.selectedLoraIds);
	}
	return fallback.selectedLoras;
}

function uniqueById<T extends { id: string }>(items: readonly (T | null)[]): T[] {
	const seen = new Set<string>();
	return items.filter((item): item is T => {
		if (!item || seen.has(item.id)) {
			return false;
		}
		seen.add(item.id);
		return true;
	});
}

/**
 * Library data from untrusted input (fields missing from `value` come from `fallback`): malformed entries
 * dropped, ids unique, an unknown/missing selected model -> first model ('' if none). The LoRA selection is read
 * from `selectedLoras` or, in data written before per-LoRA weights, from `selectedLoraIds` (default weight); unknown
 * and malformed ids are dropped, the first of duplicate ids wins and weights go through clampLoraWeight.
 */
export function sanitizeLibrary(value: unknown, fallback: LibraryData): LibraryData {
	const raw = isRecord(value) ? value : {};
	const pick = <K extends keyof LibraryData>(key: K): unknown => (key in raw ? raw[key] : fallback[key]);
	const modelsValue = pick('models');
	const lorasValue = pick('loras');
	const models = uniqueById(Array.isArray(modelsValue) ? modelsValue.map(sanitizeModel) : []);
	const loras = uniqueById(Array.isArray(lorasValue) ? lorasValue.map(sanitizeLora) : []);
	const selectedModelValue = pick('selectedModelId');
	const selectedModelId =
		typeof selectedModelValue === 'string' && models.some((model) => model.id === selectedModelValue)
			? selectedModelValue
			: (models[0]?.id ?? '');
	return {
		models,
		loras,
		selectedModelId,
		selectedLoras: filterKnownLoras(pickSelectedLoras(raw, fallback), { loras }),
		lastModelDir: stringOr(pick('lastModelDir'), null) || null,
		lastLoraDir: stringOr(pick('lastLoraDir'), null) || null,
	};
}
