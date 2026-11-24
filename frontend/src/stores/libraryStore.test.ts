import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InstalledModel, LoRASpec, ModelSource, ModelSpec } from '../api/types';
import type { Category } from '../domain/categories';
import { flushPersistence, hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import { desktop } from '../services/desktop';
import { DETAIL_TWEAKER_SOURCE } from '../test/modelLibraryData';
import { useCategoriesStore } from './categoriesStore';
import { useGenerationSettingsStore } from './generationSettingsStore';
import {
	DESKTOP_DIALOGS_UNAVAILABLE,
	LIBRARY_STORE_VERSION,
	migrateLibraryState,
	selectIsEntrySelected,
	selectModelName,
	selectSelectedModel,
	useLibraryStore,
	useLoraRows,
	useLoraSummary,
} from './libraryStore';
import { useNotificationsStore } from './notificationsStore';

const store = () => useLibraryStore.getState();

const MODEL: ModelSpec = {
	id: 'jankuv5nsfwtrainednoobai-v50-safetensors',
	name: 'JANKUV5NSFWTrainedNoobai_v50.safetensors',
	path: 'D:\\models\\checkpoints\\JANKUV5NSFWTrainedNoobai_v50.safetensors',
	default_width: 1024,
	default_height: 1024,
	torch_dtype: 'float16',
	source: null,
};
const SHION: LoRASpec = { id: 'shion', name: 'Shion.safetensors', path: 'D:\\loras\\Shion.safetensors', source: null };
const STYLE: LoRASpec = { id: 'style', name: 'style.safetensors', path: 'D:\\loras\\style.safetensors', source: null };

function enableDesktop() {
	vi.spyOn(desktop, 'isAvailable').mockReturnValue(true);
}

function notifications() {
	return useNotificationsStore.getState().notifications.map(({ intent, title, message }) => ({ intent, title, message }));
}

function linkedCategory(loraIds: string[]): Category {
	return { text: 'Main', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: 'x', state: 'normal', extraLoraIds: loraIds }] };
}

describe('selection actions', () => {
	it('replaceAll sanitizes (unknown selections dropped, missing model -> first model)', () => {
		store().replaceAll({ models: [MODEL], loras: [SHION], selectedModelId: 'gone', selectedLoraIds: ['shion', 'gone'], lastModelDir: 'D:\\models' });
		expect(store()).toMatchObject({ models: [MODEL], loras: [SHION], selectedModelId: MODEL.id, selectedLoraIds: ['shion'], lastModelDir: 'D:\\models', lastLoraDir: null });
	});

	it('selects known models only', () => {
		store().replaceAll({ models: [MODEL] });
		store().selectModel('unknown');
		expect(store().selectedModelId).toBe(MODEL.id);
		store().selectModel('');
		expect(selectSelectedModel(store())).toBeNull();
		expect(selectModelName('unknown')(store())).toBe('unknown');
		expect(selectModelName(MODEL.id)(store())).toBe(MODEL.name);
	});

	it('toggles and clears selected LoRAs', () => {
		store().replaceAll({ loras: [SHION, STYLE] });
		store().setLoraSelected('style', true);
		store().setLoraSelected('shion', true);
		store().setLoraSelected('shion', true);
		store().setLoraSelected('unknown', true);
		expect(store().selectedLoraIds).toEqual(['style', 'shion']);
		store().setLoraSelected('style', false);
		expect(store().selectedLoraIds).toEqual(['shion']);
		store().clearSelectedLoras();
		expect(store().selectedLoraIds).toEqual([]);
	});

	it('selectIsEntrySelected tells whether a checkpoint or LoRA entry is selected for generation', () => {
		store().replaceAll({ models: [MODEL], loras: [SHION, STYLE], selectedModelId: MODEL.id, selectedLoraIds: ['style'] });
		expect(selectIsEntrySelected('checkpoint', MODEL.id)(store())).toBe(true);
		expect(selectIsEntrySelected('checkpoint', 'other')(store())).toBe(false);
		expect(selectIsEntrySelected('lora', 'style')(store())).toBe(true);
		expect(selectIsEntrySelected('lora', 'shion')(store())).toBe(false);
		// A LoRA id is not a checkpoint selection and the other way round; embeddings and missing ids never are.
		expect(selectIsEntrySelected('lora', MODEL.id)(store())).toBe(false);
		expect(selectIsEntrySelected('checkpoint', 'style')(store())).toBe(false);
		expect(selectIsEntrySelected('embedding', 'style')(store())).toBe(false);
		expect(selectIsEntrySelected('lora', null)(store())).toBe(false);
	});

	it('removeLora drops it from the library and the selection and unlinks it from the sub-prompts', () => {
		const unlinkLora = vi.fn();
		useCategoriesStore.setState({ unlinkLora });
		store().replaceAll({ loras: [SHION, STYLE], selectedLoraIds: ['shion', 'style'] });

		store().removeLora('shion');

		expect(store().loras).toEqual([STYLE]);
		expect(store().selectedLoraIds).toEqual(['style']);
		expect(unlinkLora).toHaveBeenCalledWith('shion');
	});

	it('removeLora really clears prompt links (categories store)', () => {
		useCategoriesStore.setState({ categories: [linkedCategory(['shion', 'style'])] });
		store().replaceAll({ loras: [SHION, STYLE] });
		store().removeLora('shion');
		expect(useCategoriesStore.getState().categories[0].subPrompts[0].extraLoraIds).toEqual(['style']);
	});
});

describe('desktop dialogs', () => {
	it('warns that dialogs need the desktop app in the browser', async () => {
		vi.spyOn(desktop, 'isAvailable').mockReturnValue(false);
		const pickFile = vi.spyOn(desktop, 'pickFile');
		const notify = vi.fn();
		useNotificationsStore.setState({ notify });
		await store().addModelFile();
		await store().addModelDirectory();
		await store().addLoraFiles();
		await store().addLoraDirectory();
		expect(pickFile).not.toHaveBeenCalled();
		expect(notify.mock.calls).toEqual(Array.from({ length: 4 }, () => ['warning', DESKTOP_DIALOGS_UNAVAILABLE]));
	});

	it('adds and selects a checkpoint file with the current generation size', async () => {
		enableDesktop();
		useGenerationSettingsStore.setState({ width: 768, height: 1344 });
		useLibraryStore.setState({ lastModelDir: 'D:\\models\\checkpoints' });
		const pickFile = vi.spyOn(desktop, 'pickFile').mockResolvedValue(MODEL.path);

		await store().addModelFile();

		expect(pickFile).toHaveBeenCalledWith({
			defaultPath: 'D:\\models\\checkpoints',
			title: 'Select checkpoint',
			filters: [{ name: 'Checkpoint files', extensions: ['safetensors', 'ckpt'] }],
		});
		expect(store().models).toEqual([{ ...MODEL, default_width: 768, default_height: 1344 }]);
		expect(store().selectedModelId).toBe(MODEL.id);
		expect(store().lastModelDir).toBe('D:\\models\\checkpoints');
	});

	it('adds a Diffusers model folder and reuses a model already in the library', async () => {
		enableDesktop();
		const pickDirectory = vi.spyOn(desktop, 'pickDirectory').mockResolvedValue('D:\\diffusers\\sdxl-base');
		await store().addModelDirectory();
		expect(store().models.map((model) => [model.id, model.path])).toEqual([['sdxl-base', 'D:\\diffusers\\sdxl-base']]);
		expect(store().lastModelDir).toBe('D:\\diffusers');

		pickDirectory.mockResolvedValue('d:\\DIFFUSERS\\sdxl-base');
		store().selectModel('');
		await store().addModelDirectory();
		expect(store().models).toHaveLength(1);
		expect(store().selectedModelId).toBe('sdxl-base');
	});

	it('adds and selects LoRA files, reusing known paths', async () => {
		enableDesktop();
		store().replaceAll({ loras: [SHION], selectedLoraIds: [] });
		useLibraryStore.setState({ lastLoraDir: 'D:\\loras' });
		const pickFiles = vi.spyOn(desktop, 'pickFiles').mockResolvedValue(['D:\\loras\\shion.safetensors', 'D:\\new\\Style.pt']);

		await store().addLoraFiles();

		expect(pickFiles).toHaveBeenCalledWith({
			defaultPath: 'D:\\loras',
			title: 'Add LoRA',
			filters: [{ name: 'LoRA files', extensions: ['safetensors', 'bin', 'pt'] }],
		});
		expect(store().loras).toEqual([SHION, { id: 'style', name: 'Style.pt', path: 'D:\\new\\Style.pt', source: null }]);
		expect(store().selectedLoraIds).toEqual(['shion', 'style']);
		expect(store().lastLoraDir).toBe('D:\\loras');
	});

	it('adds a LoRA folder', async () => {
		enableDesktop();
		vi.spyOn(desktop, 'pickDirectory').mockResolvedValue('D:\\loras\\character.v2');
		await store().addLoraDirectory();
		expect(store().loras).toEqual([{ id: 'character-v2', name: 'character.v2', path: 'D:\\loras\\character.v2', source: null }]);
		expect(store().selectedLoraIds).toEqual(['character-v2']);
	});

	it('does nothing when a dialog is cancelled and reports dialog failures', async () => {
		enableDesktop();
		vi.spyOn(desktop, 'pickFile').mockResolvedValue(null);
		vi.spyOn(desktop, 'pickFiles').mockRejectedValue(new Error('dialog crashed'));
		await store().addModelFile();
		await store().addLoraFiles();
		expect(store().models).toEqual([]);
		expect(notifications()).toEqual([{ intent: 'error', title: 'Could not add the LoRAs', message: 'dialog crashed' }]);
	});
});

describe('hooks', () => {
	it('builds prompt-link-aware rows and a summary', () => {
		store().replaceAll({ loras: [SHION, STYLE], selectedLoraIds: ['shion'] });
		useCategoriesStore.setState({ categories: [linkedCategory(['style', 'shion', 'deleted'])] });

		const { result } = renderHook(() => ({ rows: useLoraRows(), summary: useLoraSummary() }));

		expect(result.current.rows).toEqual([
			{ lora: SHION, selected: true, promptLinked: true },
			{ lora: STYLE, selected: false, promptLinked: true },
		]);
		expect(result.current.summary).toEqual({ selected: 1, promptLinked: 2, possibleActive: 2 });

		const before = result.current;
		act(() => useCategoriesStore.getState().setActivationText('main', 'x'));
		expect(result.current.rows).toBe(before.rows);
		expect(result.current.summary).toBe(before.summary);

		act(() => useCategoriesStore.getState().unlinkLora('style'));
		expect(result.current.rows[1].promptLinked).toBe(false);
		expect(result.current.summary).toEqual({ selected: 1, promptLinked: 1, possibleActive: 1 });
	});
});

describe('registerInstalled', () => {
	const LORA_PATH = 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\loras\\add_detail.safetensors';
	const CHECKPOINT_PATH = 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\checkpoints\\JANKU v7.777.safetensors';
	const LORA_INSTALL: InstalledModel = { kind: 'lora', name: 'Detail Tweaker LoRA - v1.0', path: LORA_PATH, source: DETAIL_TWEAKER_SOURCE };
	const CHECKPOINT_INSTALL: InstalledModel = {
		kind: 'checkpoint',
		name: 'JANKU Illustrious XL - v7.77',
		path: CHECKPOINT_PATH,
		source: { ...DETAIL_TWEAKER_SOURCE, model_id: '1277670', version_id: '2786084', file_id: '2672243', sha256: null },
	};

	it('adds a checkpoint with the current generation size and selects it', () => {
		store().replaceAll({ models: [MODEL], loras: [SHION], selectedLoraIds: ['shion'] });
		useGenerationSettingsStore.setState({ width: 832, height: 1216 });

		const id = store().registerInstalled(CHECKPOINT_INSTALL);

		expect(id).toBe('janku-v7-777-safetensors');
		expect(store().models[1]).toEqual({
			id,
			name: CHECKPOINT_INSTALL.name,
			path: CHECKPOINT_PATH,
			default_width: 832,
			default_height: 1216,
			torch_dtype: 'float16',
			source: CHECKPOINT_INSTALL.source,
		});
		expect(store()).toMatchObject({ selectedModelId: id, selectedLoraIds: ['shion'], lastModelDir: null });
	});

	it('adds a LoRA to the selection once', () => {
		store().replaceAll({ loras: [SHION], selectedLoraIds: ['shion'] });

		const id = store().registerInstalled(LORA_INSTALL);
		expect(store().registerInstalled(LORA_INSTALL)).toBe(id);

		expect(store().loras).toEqual([SHION, { id: 'add-detail', name: LORA_INSTALL.name, path: LORA_PATH, source: DETAIL_TWEAKER_SOURCE }]);
		expect(store().selectedLoraIds).toEqual(['shion', 'add-detail']);
	});

	it('reuses a manual entry with the same path and attaches the source', () => {
		const manual: LoRASpec = { id: 'detail', name: 'add_detail.safetensors', path: LORA_PATH.toLowerCase(), source: null };
		store().replaceAll({ loras: [manual] });

		expect(store().registerInstalled(LORA_INSTALL)).toBe('detail');

		expect(store().loras).toEqual([{ ...manual, source: DETAIL_TWEAKER_SOURCE }]);
		expect(store().selectedLoraIds).toEqual(['detail']);
	});

	it('reuses the entry with the same provenance', () => {
		const installed = { ...MODEL, id: 'janku', path: 'D:\\old\\JANKU v7.777.safetensors', source: CHECKPOINT_INSTALL.source };
		store().replaceAll({ models: [MODEL, installed], selectedModelId: MODEL.id });

		expect(store().registerInstalled(CHECKPOINT_INSTALL)).toBe('janku');

		expect(store().models).toEqual([MODEL, { ...installed, path: CHECKPOINT_PATH }]);
		expect(store().selectedModelId).toBe('janku');
	});

	it('changes nothing for an embedding', () => {
		store().replaceAll({ models: [MODEL], loras: [SHION] });
		const before = store();

		expect(store().registerInstalled({ ...LORA_INSTALL, kind: 'embedding', path: 'D:\\embeddings\\easynegative.safetensors' })).toBeNull();

		expect(store()).toBe(before);
	});
});

describe('persistence', () => {
	/** A real v0 'library-store' envelope (trimmed): entries have no `source`. */
	const REAL_V0_STATE = {
		models: [
			{
				id: 'jankuv5nsfwtrainednoobai-v50-safetensors',
				name: 'JANKUV5NSFWTrainedNoobai_v50.safetensors',
				path: 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\checkpoints\\JANKUV5NSFWTrainedNoobai_v50.safetensors',
				default_width: 1024,
				default_height: 1024,
				torch_dtype: 'float16',
			},
			{
				id: 'catponyreal-ilv41-safetensors',
				name: 'catponyReal_ilV41.safetensors',
				path: 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\checkpoints\\catponyReal_ilV41.safetensors',
				default_width: 896,
				default_height: 1344,
				torch_dtype: 'float16',
			},
		],
		loras: [
			{
				id: 'zy-illustrious-realism-enhancer-v1',
				name: 'zy_illustrious_Realism_Enhancer_v1.safetensors',
				path: 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\loras\\illustrous\\zy_illustrious_Realism_Enhancer_v1.safetensors',
			},
			{ id: 'shion', name: 'Shion.safetensors', path: 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\loras\\illustrous\\charachter\\Shion.safetensors' },
		],
		selectedModelId: 'catponyreal-ilv41-safetensors',
		selectedLoraIds: ['shion'],
		lastModelDir: 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\checkpoints',
		lastLoraDir: 'D:\\Anything\\ComfyUI\\ComfyUI\\models\\loras\\illustrous\\charachter',
	};
	const withNullSources = {
		...REAL_V0_STATE,
		models: REAL_V0_STATE.models.map((model) => ({ ...model, source: null })),
		loras: REAL_V0_STATE.loras.map((lora) => ({ ...lora, source: null })),
	};

	it('migrates a real v0 envelope: entries get source null and the store is written back as version 1', async () => {
		const backend = createMemoryStoreBackend({ 'library-store': { state: REAL_V0_STATE, version: 0 } });
		setStoreBackend(backend);

		expect(await hydratePersistedStores([useLibraryStore])).toEqual([]);
		expect(store()).toMatchObject(withNullSources);
		await flushPersistence();

		expect(backend.snapshot()['library-store']).toEqual({ state: withNullSources, version: LIBRARY_STORE_VERSION });
		expect(LIBRARY_STORE_VERSION).toBe(1);
		expect(migrateLibraryState(REAL_V0_STATE)).toBe(REAL_V0_STATE);
	});

	it('round-trips v1 sources', async () => {
		const state = { ...withNullSources, loras: [{ ...withNullSources.loras[0], source: DETAIL_TWEAKER_SOURCE }, withNullSources.loras[1]] };
		const backend = createMemoryStoreBackend({ 'library-store': { state, version: 1 } });
		setStoreBackend(backend);

		await hydratePersistedStores([useLibraryStore]);
		expect(store().loras[0].source).toEqual(DETAIL_TWEAKER_SOURCE);

		store().setLoraSelected('zy-illustrious-realism-enhancer-v1', true);
		await flushPersistence();

		expect(backend.snapshot()['library-store']).toEqual({
			state: { ...state, selectedLoraIds: ['shion', 'zy-illustrious-realism-enhancer-v1'] },
			version: 1,
		});
	});

	it('repairs a stale selection on hydration', async () => {
		setStoreBackend(
			createMemoryStoreBackend({
				'library-store': { state: { models: [MODEL], loras: [SHION], selectedModelId: 'deleted', selectedLoraIds: ['deleted', 'shion'], lastModelDir: null, lastLoraDir: null }, version: 0 },
			}),
		);
		await hydratePersistedStores([useLibraryStore]);
		expect(store().selectedModelId).toBe(MODEL.id);
		expect(store().selectedLoraIds).toEqual(['shion']);
	});
});
