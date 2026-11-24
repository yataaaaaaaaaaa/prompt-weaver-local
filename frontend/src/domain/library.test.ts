import { describe, expect, it } from 'vitest';
import type { LoRASpec, ModelSpec } from '../api/types';
import { addLoraPaths, addModelPath, sanitizeLibrary, type LibraryData } from './library';

const EMPTY_LIBRARY: LibraryData = { models: [], loras: [], selectedModelId: '', selectedLoraIds: [], lastModelDir: null, lastLoraDir: null };

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
			},
		]);
	});

	it('reuses a model with the same path (case-insensitive) and suffixes colliding ids', () => {
		const existing: ModelSpec[] = [
			{ id: 'model-safetensors', name: 'model.safetensors', path: 'D:\\A\\model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16' },
		];
		const same = addModelPath(existing, 'd:\\a\\MODEL.safetensors', size);
		expect(same).toEqual({ models: existing, modelId: 'model-safetensors' });
		expect(same.models).toBe(existing);
		expect(addModelPath(existing, 'D:\\B\\model.safetensors', size).modelId).toBe('model-safetensors-2');
		expect(addModelPath([], 'D:\\diffusers\\sdxl-base', size).models[0]).toMatchObject({ id: 'sdxl-base', name: 'sdxl-base' });
	});

	it('adds LoRA files (id without extension) and folders, reusing known paths and unique ids within one batch', () => {
		const existing: LoRASpec[] = [{ id: 'shion', name: 'Shion.safetensors', path: 'D:\\loras\\Shion.safetensors' }];
		const { loras, loraIds } = addLoraPaths(existing, ['D:\\loras\\shion.SAFETENSORS', 'D:\\other\\Shion.pt', 'D:\\third\\Shion.bin'], 'file');
		expect(loraIds).toEqual(['shion', 'shion-2', 'shion-3']);
		expect(loras.map((lora) => lora.name)).toEqual(['Shion.safetensors', 'Shion.pt', 'Shion.bin']);
		const folder = addLoraPaths(existing, ['D:\\loras\\style.v2'], 'directory');
		expect(folder.loraIds).toEqual(['style-v2']);
		expect(addLoraPaths(existing, ['D:\\loras\\Shion.safetensors'], 'file').loras).toBe(existing);
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
			},
		],
		loras: [{ id: 'shion', name: 'Shion.safetensors', path: 'D:\\loras\\Shion.safetensors' }],
		selectedModelId: 'catponyreal-ilv41-safetensors',
		selectedLoraIds: ['shion'],
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
				selectedLoraIds: ['shion', 'deleted', 'shion', 4],
				lastLoraDir: 12,
			},
			EMPTY_LIBRARY,
		);
		expect(result.models.map((model) => model.id)).toEqual(['catponyreal-ilv41-safetensors', 'x']);
		expect(result.models[1]).toEqual({ id: 'x', name: 'x.ckpt', path: 'D:\\x.ckpt', default_width: 1024, default_height: 1024, torch_dtype: 'float16' });
		expect(result.loras.map((lora) => lora.id)).toEqual(['shion']);
		expect(result.selectedModelId).toBe('catponyreal-ilv41-safetensors');
		expect(result.selectedLoraIds).toEqual(['shion']);
		expect(result.lastLoraDir).toBeNull();
	});

	it('fills missing fields from the fallback', () => {
		const fallback = sanitizeLibrary(persisted, EMPTY_LIBRARY);
		expect(sanitizeLibrary({ selectedLoraIds: [] }, fallback)).toEqual({ ...persisted, selectedLoraIds: [] });
		expect(sanitizeLibrary(undefined, EMPTY_LIBRARY)).toEqual(EMPTY_LIBRARY);
	});
});
