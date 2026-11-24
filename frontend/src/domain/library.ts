// Model/LoRA library domain: the persisted library data, library entries created from picked paths and
// sanitizing of stored/imported library data. Pure module; state lives in src/stores/libraryStore.ts.
import type { LoRASpec, ModelSpec, TorchDType } from '../api/types';
import { isRecord, positiveNumberOr, stringOr } from './guards';
import type { Size } from './layout';
import { filterKnownLoraIds } from './loraSelection';
import { basename, stripExtension } from './paths';
import { uniqueKey, uniqueStrings } from './text';

/** Persisted format of the 'library-store' (version 0): the shape of the user's existing data. */
export type LibraryData = {
	models: ModelSpec[];
	loras: LoRASpec[];
	/** '' when no model is selected. */
	selectedModelId: string;
	selectedLoraIds: string[];
	lastModelDir: string | null;
	lastLoraDir: string | null;
};

// ---------------------------------------------------------------------------
// Library entries from picked paths
// ---------------------------------------------------------------------------

function samePath(left: string, right: string): boolean {
	return left.toLowerCase() === right.toLowerCase();
}

export const DEFAULT_TORCH_DTYPE: TorchDType = 'float16';

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
		torch_dtype: DEFAULT_TORCH_DTYPE,
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
		};
		next.push(lora);
		loraIds.push(lora.id);
	}
	return { loras: next.length === loras.length ? loras : next, loraIds: uniqueStrings(loraIds) };
}

// ---------------------------------------------------------------------------
// Sanitizing (persisted library-store, legacy import)
// ---------------------------------------------------------------------------

/** Every backend TorchDType value (exhaustive: the type-check fails when the schema changes). */
const TORCH_DTYPES: Record<TorchDType, true> = { float16: true, bfloat16: true, float32: true };

function isTorchDType(value: unknown): value is TorchDType {
	return typeof value === 'string' && Object.hasOwn(TORCH_DTYPES, value);
}

/** A library entry ({id, name, path}; LoRAs have nothing more): null when id or path is unusable. */
function sanitizeLora(value: unknown): LoRASpec | null {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.path !== 'string') {
		return null;
	}
	return {
		id: value.id,
		name: typeof value.name === 'string' && value.name ? value.name : basename(value.path) || value.id,
		path: value.path,
	};
}

function sanitizeModel(value: unknown): ModelSpec | null {
	const entry = sanitizeLora(value);
	if (!entry || !isRecord(value)) {
		return null;
	}
	return {
		...entry,
		default_width: positiveNumberOr(value.default_width, 1024),
		default_height: positiveNumberOr(value.default_height, 1024),
		torch_dtype: isTorchDType(value.torch_dtype) ? value.torch_dtype : DEFAULT_TORCH_DTYPE,
	};
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
 * dropped, ids unique, unknown selected LoRA ids dropped, an unknown/missing selected model -> first model ('' if none).
 */
export function sanitizeLibrary(value: unknown, fallback: LibraryData): LibraryData {
	const raw = isRecord(value) ? value : {};
	const pick = <K extends keyof LibraryData>(key: K): unknown => (key in raw ? raw[key] : fallback[key]);
	const modelsValue = pick('models');
	const lorasValue = pick('loras');
	const models = uniqueById(Array.isArray(modelsValue) ? modelsValue.map(sanitizeModel) : []);
	const loras = uniqueById(Array.isArray(lorasValue) ? lorasValue.map(sanitizeLora) : []);
	const selectedModelValue = pick('selectedModelId');
	const selectedLoraValue = pick('selectedLoraIds');
	const selectedModelId =
		typeof selectedModelValue === 'string' && models.some((model) => model.id === selectedModelValue)
			? selectedModelValue
			: (models[0]?.id ?? '');
	const selectedLoraIds = Array.isArray(selectedLoraValue)
		? filterKnownLoraIds(
				selectedLoraValue.filter((id): id is string => typeof id === 'string'),
				{ loras },
			)
		: [];
	return {
		models,
		loras,
		selectedModelId,
		selectedLoraIds,
		lastModelDir: stringOr(pick('lastModelDir'), null) || null,
		lastLoraDir: stringOr(pick('lastLoraDir'), null) || null,
	};
}
