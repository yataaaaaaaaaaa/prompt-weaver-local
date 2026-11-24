import { describe, expect, it } from 'vitest';
import { LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { InstalledModel, LoRASpec, ModelSource, ModelSpec } from '../api/types';
import { DETAIL_TWEAKER_FILE, DETAIL_TWEAKER_SOURCE } from '../test/modelLibraryData';
import {
	addLoraPaths,
	addModelPath,
	findEntryBySource,
	lorasFromLegacyIds,
	registerInstalledEntry,
	sanitizeLibrary,
	sanitizeModelSource,
	type LibraryData,
} from './library';

const EMPTY_LIBRARY: LibraryData = { models: [], loras: [], selectedModelId: '', selectedLoras: [], lastModelDir: null, lastLoraDir: null };
const DEFAULT_WEIGHT = LORA_WEIGHT_DEFAULTS.weight;

describe('library entries from picked paths', () => {
	const size = { width: 768, height: 1344 };

	it('adds a model with a legacy-compatible id and the given default size', () => {
		const path = 'D:\\models\\checkpoints\\JANKUV5NSFWTrainedNoobai_v50.safetensors';
		const { models, modelId } = addModelPath([], path, size);
		expect(modelId).toBe('jankuv5nsfwtrainednoobai-v50-safetensors');
		expect(models).toEqual([
			{
				id: 'jankuv5nsfwtrainednoobai-v50-safetensors',
				name: 'JANKUV5NSFWTrainedNoobai_v50.safetensors',
				path,
				default_width: 768,
				default_height: 1344,
				torch_dtype: 'float16',
				source: null,
			},
		]);
	});

	it('reuses a model with the same path (case-insensitive) and suffixes colliding ids', () => {
		const existing: ModelSpec[] = [
			{ id: 'model-safetensors', name: 'model.safetensors', path: 'D:\\A\\model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null },
		];
		const same = addModelPath(existing, 'd:\\a\\MODEL.safetensors', size);
		expect(same).toEqual({ models: existing, modelId: 'model-safetensors' });
		expect(same.models).toBe(existing);
		expect(addModelPath(existing, 'D:\\B\\model.safetensors', size).modelId).toBe('model-safetensors-2');
		expect(addModelPath([], 'D:\\diffusers\\sdxl-base', size).models[0]).toMatchObject({ id: 'sdxl-base', name: 'sdxl-base' });
	});

	it('adds LoRA files (id without extension) and folders, reusing known paths and unique ids within one batch', () => {
		const existing: LoRASpec[] = [{ id: 'shion', name: 'Shion.safetensors', path: 'D:\\loras\\Shion.safetensors', source: null }];
		const { loras, loraIds } = addLoraPaths(existing, ['D:\\loras\\shion.SAFETENSORS', 'D:\\other\\Shion.pt', 'D:\\third\\Shion.bin'], 'file');
		expect(loraIds).toEqual(['shion', 'shion-2', 'shion-3']);
		expect(loras.map((lora) => lora.name)).toEqual(['Shion.safetensors', 'Shion.pt', 'Shion.bin']);
		const folder = addLoraPaths(existing, ['D:\\loras\\style.v2'], 'directory');
		expect(folder.loraIds).toEqual(['style-v2']);
		expect(addLoraPaths(existing, ['D:\\loras\\Shion.safetensors'], 'file').loras).toBe(existing);
	});
});

const SOURCE = {
	...DETAIL_TWEAKER_SOURCE,
	sha256: DETAIL_TWEAKER_FILE.sha256 as string,
	preview_url: 'https://image.civitai.com/x/width=450/692411.jpeg',
	trigger_words: ['detailed'],
} satisfies ModelSource;

describe('sanitizeModelSource', () => {
	it('keeps a valid provenance and normalizes the hash to lowercase', () => {
		expect(sanitizeModelSource(SOURCE)).toEqual(SOURCE);
		expect(sanitizeModelSource({ ...SOURCE, sha256: SOURCE.sha256.toUpperCase() })?.sha256).toBe(SOURCE.sha256);
	});

	it('drops unusable provenance and repairs optional fields', () => {
		expect(sanitizeModelSource(null)).toBeNull();
		expect(sanitizeModelSource({ ...SOURCE, version_id: '' })).toBeNull();
		expect(sanitizeModelSource({ ...SOURCE, sha256: 5, preview_url: '', trigger_words: ['a', 1], page_url: undefined, base_model: null })).toEqual({
			...SOURCE,
			sha256: null,
			preview_url: null,
			trigger_words: [],
			page_url: null,
			base_model: '',
		});
	});

	it('is kept on persisted entries (entries without one get null)', () => {
		const library = sanitizeLibrary(
			{ loras: [{ id: 'a', name: 'a', path: 'a', source: SOURCE }, { id: 'b', name: 'b', path: 'b' }] },
			EMPTY_LIBRARY,
		);
		expect(library.loras.map((lora) => lora.source)).toEqual([SOURCE, null]);
	});
});

describe('sanitizeLibrary', () => {
	const persisted = {
		models: [
			{
				id: 'catponyreal-ilv41-safetensors',
				name: 'catponyReal_ilV41.safetensors',
				path: 'D:\\models\\catponyReal_ilV41.safetensors',
				default_width: 896,
				default_height: 1344,
				torch_dtype: 'float16',
				source: null,
			},
		],
		loras: [
			{ id: 'shion', name: 'Shion.safetensors', path: 'D:\\loras\\Shion.safetensors', source: null },
			{ id: 'style', name: 'style.safetensors', path: 'D:\\loras\\style.safetensors', source: null },
		],
		selectedModelId: 'catponyreal-ilv41-safetensors',
		selectedLoras: [
			{ id: 'shion', weight: 0.6 },
			{ id: 'style', weight: -1.25 },
		],
		lastModelDir: 'D:\\models',
		lastLoraDir: 'D:\\loras',
	};

	it('keeps valid persisted data unchanged', () => {
		expect(sanitizeLibrary(persisted, EMPTY_LIBRARY)).toEqual(persisted);
	});

	it('drops malformed entries and unknown selections; an unknown model falls back to the first one', () => {
		const result = sanitizeLibrary(
			{
				...persisted,
				models: [...persisted.models, { id: 'x', path: 'D:\\x.ckpt', torch_dtype: 'int8' }, { name: 'no id' }, persisted.models[0]],
				loras: [...persisted.loras, { id: 'broken' }],
				selectedModelId: 'deleted-model',
				selectedLoras: [
					{ id: 'shion', weight: 0.6 },
					{ id: 'deleted', weight: 1 },
					{ id: 'shion', weight: 2 },
					4,
					'style',
					{ weight: 1 },
					{ id: '', weight: 1 },
					{ id: 7, weight: 1 },
				],
				lastLoraDir: 12,
			},
			EMPTY_LIBRARY,
		);
		expect(result.models.map((model) => model.id)).toEqual(['catponyreal-ilv41-safetensors', 'x']);
		expect(result.models[1]).toEqual({ id: 'x', name: 'x.ckpt', path: 'D:\\x.ckpt', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null });
		expect(result.loras.map((lora) => lora.id)).toEqual(['shion', 'style']);
		expect(result.selectedModelId).toBe('catponyreal-ilv41-safetensors');
		// Unknown and malformed items dropped, the first of duplicate ids kept.
		expect(result.selectedLoras).toEqual([{ id: 'shion', weight: 0.6 }]);
		expect(result.lastLoraDir).toBeNull();
	});

	it('clamps weights; a missing, non-numeric or non-finite weight -> the default weight', () => {
		const sanitizeSelection = (selectedLoras: unknown) => sanitizeLibrary({ ...persisted, selectedLoras }, EMPTY_LIBRARY).selectedLoras;

		expect(sanitizeSelection([{ id: 'shion', weight: 99 }, { id: 'style', weight: -10.5 }])).toEqual([
			{ id: 'shion', weight: LORA_WEIGHT_DEFAULTS.max },
			{ id: 'style', weight: LORA_WEIGHT_DEFAULTS.min },
		]);
		expect(sanitizeSelection([{ id: 'shion' }, { id: 'style', weight: '0.5' }])).toEqual([
			{ id: 'shion', weight: DEFAULT_WEIGHT },
			{ id: 'style', weight: DEFAULT_WEIGHT },
		]);
		expect(sanitizeSelection([{ id: 'shion', weight: Number.NaN }])).toEqual([{ id: 'shion', weight: DEFAULT_WEIGHT }]);
		expect(sanitizeSelection('shion')).toEqual([]);
	});

	it('reads the legacy selectedLoraIds (stored before per-LoRA weights) at the default weight', () => {
		const { selectedLoras: _selection, ...withoutSelection } = persisted;

		const result = sanitizeLibrary({ ...withoutSelection, selectedLoraIds: ['style', 'deleted', 'style', 4, 'shion'] }, EMPTY_LIBRARY);

		expect(result.selectedLoras).toEqual([
			{ id: 'style', weight: DEFAULT_WEIGHT },
			{ id: 'shion', weight: DEFAULT_WEIGHT },
		]);
		expect(result).not.toHaveProperty('selectedLoraIds');
		expect(sanitizeLibrary({ ...withoutSelection, selectedLoraIds: 'shion' }, EMPTY_LIBRARY).selectedLoras).toEqual([]);
	});

	it('prefers selectedLoras when both shapes are present', () => {
		expect(sanitizeLibrary({ ...persisted, selectedLoraIds: ['style'] }, EMPTY_LIBRARY).selectedLoras).toEqual(persisted.selectedLoras);
	});

	it('fills missing fields from the fallback', () => {
		const fallback = sanitizeLibrary(persisted, EMPTY_LIBRARY);
		expect(sanitizeLibrary({ selectedLoras: [] }, fallback)).toEqual({ ...persisted, selectedLoras: [] });
		expect(sanitizeLibrary({ lastLoraDir: 'D:\\other' }, fallback)).toEqual({ ...persisted, lastLoraDir: 'D:\\other' });
		// The fallback selection is restricted to the new LoRAs (weights kept).
		expect(sanitizeLibrary({ loras: [persisted.loras[1]] }, fallback).selectedLoras).toEqual([{ id: 'style', weight: -1.25 }]);
		expect(sanitizeLibrary(undefined, EMPTY_LIBRARY)).toEqual(EMPTY_LIBRARY);
	});
});

describe('lorasFromLegacyIds', () => {
	it('maps string ids to the default weight and drops anything else', () => {
		expect(lorasFromLegacyIds(['a', 3, null, '', 'b'])).toEqual([
			{ id: 'a', weight: DEFAULT_WEIGHT },
			{ id: 'b', weight: DEFAULT_WEIGHT },
		]);
		expect(lorasFromLegacyIds(undefined)).toEqual([]);
		expect(lorasFromLegacyIds({ 0: 'a' })).toEqual([]);
	});
});

describe('installed models', () => {
	const size = { width: 768, height: 1344 };
	const LORA_PATH = 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\loras\\add_detail.safetensors';
	const LORA: InstalledModel = { kind: 'lora', name: 'Detail Tweaker LoRA - v1.0', path: LORA_PATH, source: SOURCE };
	// Real Civitai checkpoint (backend/tests/fixtures/civitai/search_checkpoints.json).
	const CHECKPOINT_SOURCE: ModelSource = {
		...SOURCE,
		model_id: '1277670',
		version_id: '2786084',
		file_id: '2672243',
		model_name: 'JANKU Trained + Chenkin & NoobAI + RouWei Illustrious XL',
		version_name: 'v7.77',
		base_model: 'Illustrious',
		sha256: '88177d224ce97f60cf3e908f87902f913ed4562bd79d237f84238a4354601efb',
		trigger_words: [],
	};
	const CHECKPOINT: InstalledModel = {
		kind: 'checkpoint',
		name: 'JANKU Trained + Chenkin & NoobAI + RouWei Illustrious XL - v7.77',
		path: 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\checkpoints\\JANKU v7.777.safetensors',
		source: CHECKPOINT_SOURCE,
	};
	const MANUAL_MODEL: ModelSpec = {
		id: 'catponyreal-ilv41-safetensors',
		name: 'catponyReal_ilV41.safetensors',
		path: 'D:\\models\\catponyReal_ilV41.safetensors',
		default_width: 896,
		default_height: 1344,
		torch_dtype: 'float16',
		source: null,
	};
	const MANUAL_LORA: LoRASpec = { id: 'shion', name: 'Shion.safetensors', path: 'D:\\loras\\Shion.safetensors', source: null };
	const OTHER_HASH = 'f'.repeat(64);

	describe('findEntryBySource', () => {
		const library = {
			models: [MANUAL_MODEL, { ...MANUAL_MODEL, id: 'janku', path: CHECKPOINT.path, source: CHECKPOINT_SOURCE }],
			loras: [MANUAL_LORA, { ...MANUAL_LORA, id: 'add-detail', path: LORA_PATH, source: SOURCE }],
		};

		it('matches provider + version (+ file when given)', () => {
			expect(findEntryBySource(library, { provider: 'civitai', versionId: '62833' })).toEqual({ kind: 'lora', id: 'add-detail' });
			expect(findEntryBySource(library, { provider: 'civitai', versionId: '2786084', fileId: '2672243' })).toEqual({ kind: 'checkpoint', id: 'janku' });
			expect(findEntryBySource(library, { provider: 'civitai', versionId: '62833', fileId: 'other' })).toBeNull();
			expect(findEntryBySource(library, { provider: 'huggingface', versionId: '62833' })).toBeNull();
			expect(findEntryBySource({ models: [MANUAL_MODEL], loras: [MANUAL_LORA] }, { provider: 'civitai', versionId: '62833' })).toBeNull();
		});

		it('matches the SHA-256 when both hashes are known (whatever the provider ids)', () => {
			expect(findEntryBySource(library, { provider: 'other', versionId: 'x', sha256: SOURCE.sha256 })).toEqual({ kind: 'lora', id: 'add-detail' });
			// Both known but different: another file of the same version.
			expect(findEntryBySource(library, { provider: 'civitai', versionId: '62833', sha256: OTHER_HASH })).toBeNull();
			// Hash unknown on the entry: the provider ids decide.
			const noHash = { models: [], loras: [{ ...MANUAL_LORA, source: { ...SOURCE, sha256: null } }] };
			expect(findEntryBySource(noHash, { provider: 'civitai', versionId: '62833', sha256: OTHER_HASH })).toEqual({ kind: 'lora', id: 'shion' });
		});
	});

	describe('registerInstalledEntry', () => {
		it('adds a new checkpoint named after the install, with its source and the given size', () => {
			const models = [MANUAL_MODEL];
			const loras = [MANUAL_LORA];
			const result = registerInstalledEntry({ models, loras }, CHECKPOINT, size);
			expect(result.entryId).toBe('janku-v7-777-safetensors');
			expect(result.loras).toBe(loras);
			expect(result.models).toEqual([
				MANUAL_MODEL,
				{
					id: 'janku-v7-777-safetensors',
					name: CHECKPOINT.name,
					path: CHECKPOINT.path,
					default_width: 768,
					default_height: 1344,
					torch_dtype: 'float16',
					source: CHECKPOINT_SOURCE,
				},
			]);
		});

		it('adds a new LoRA (unique id from the file name) named after the install', () => {
			const loras = [{ ...MANUAL_LORA, id: 'add-detail', path: 'D:\\elsewhere\\add_detail.pt' }];
			const result = registerInstalledEntry({ models: [], loras }, LORA, size);
			expect(result.entryId).toBe('add-detail-2');
			expect(result.loras[1]).toEqual({ id: 'add-detail-2', name: LORA.name, path: LORA_PATH, source: SOURCE });
		});

		it('reuses the entry at the same path (case-insensitive) and attaches the missing source, keeping its name', () => {
			const manual: LoRASpec = { id: 'add-detail', name: 'add_detail.safetensors', path: LORA_PATH.toUpperCase(), source: null };
			const result = registerInstalledEntry({ models: [], loras: [manual] }, LORA, size);
			expect(result.entryId).toBe('add-detail');
			expect(result.loras).toEqual([{ ...manual, source: SOURCE }]);
		});

		it('keeps an existing source and returns the same lists when nothing changes', () => {
			const library = { models: [{ ...MANUAL_MODEL, path: CHECKPOINT.path, source: { ...CHECKPOINT_SOURCE, version_name: 'older' } }], loras: [MANUAL_LORA] };
			const result = registerInstalledEntry(library, CHECKPOINT, size);
			expect(result).toEqual({ ...library, entryId: MANUAL_MODEL.id });
			expect(result.models).toBe(library.models);
			expect(result.loras).toBe(library.loras);
		});

		it('reuses the entry with this provenance and moves it to the installed path', () => {
			const moved: LoRASpec = { id: 'detail', name: 'My detail LoRA', path: 'D:\\old\\add_detail.safetensors', source: SOURCE };
			const result = registerInstalledEntry({ models: [], loras: [MANUAL_LORA, moved] }, LORA, size);
			expect(result.entryId).toBe('detail');
			expect(result.loras).toEqual([MANUAL_LORA, { ...moved, path: LORA_PATH }]);
		});

		it('ignores a provenance match of another kind', () => {
			const library = { models: [{ ...MANUAL_MODEL, source: SOURCE }], loras: [] };
			const result = registerInstalledEntry(library, LORA, size);
			expect(result.models).toBe(library.models);
			expect(result.loras).toEqual([{ id: 'add-detail', name: LORA.name, path: LORA_PATH, source: SOURCE }]);
		});

		it('has no entry for embeddings', () => {
			const library = { models: [MANUAL_MODEL], loras: [MANUAL_LORA] };
			const embedding: InstalledModel = { kind: 'embedding', name: 'EasyNegative - EasyNegative', path: 'D:\\embeddings\\easynegative.safetensors', source: SOURCE };
			const result = registerInstalledEntry(library, embedding, size);
			expect(result).toEqual({ ...library, entryId: null });
			expect(result.models).toBe(library.models);
			expect(result.loras).toBe(library.loras);
		});
	});
});
