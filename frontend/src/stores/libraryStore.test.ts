import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LoRASpec, ModelSpec } from '../api/types';
import type { Category } from '../domain/categories';
import { flushPersistence, hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import { desktop } from '../services/desktop';
import { useCategoriesStore } from './categoriesStore';
import { useGenerationSettingsStore } from './generationSettingsStore';
import {
	DESKTOP_DIALOGS_UNAVAILABLE,
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
};
const SHION: LoRASpec = { id: 'shion', name: 'Shion.safetensors', path: 'D:\\loras\\Shion.safetensors' };
const STYLE: LoRASpec = { id: 'style', name: 'style.safetensors', path: 'D:\\loras\\style.safetensors' };

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
		expect(store().loras).toEqual([SHION, { id: 'style', name: 'Style.pt', path: 'D:\\new\\Style.pt' }]);
		expect(store().selectedLoraIds).toEqual(['shion', 'style']);
		expect(store().lastLoraDir).toBe('D:\\loras');
	});

	it('adds a LoRA folder', async () => {
		enableDesktop();
		vi.spyOn(desktop, 'pickDirectory').mockResolvedValue('D:\\loras\\character.v2');
		await store().addLoraDirectory();
		expect(store().loras).toEqual([{ id: 'character-v2', name: 'character.v2', path: 'D:\\loras\\character.v2' }]);
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

describe('persistence', () => {
	it('round-trips the real library-store format', async () => {
		const state = {
			models: [
				MODEL,
				{ ...MODEL, id: 'catponyreal-ilv41-safetensors', name: 'catponyReal_ilV41.safetensors', path: 'D:\\models\\catponyReal_ilV41.safetensors', default_width: 896, default_height: 1344 },
			],
			loras: [SHION, STYLE],
			selectedModelId: 'catponyreal-ilv41-safetensors',
			selectedLoraIds: [],
			lastModelDir: 'D:\\models',
			lastLoraDir: 'D:\\loras',
		};
		const backend = createMemoryStoreBackend({ 'library-store': { state, version: 0 } });
		setStoreBackend(backend);

		expect(await hydratePersistedStores([useLibraryStore])).toEqual([]);
		expect(store()).toMatchObject(state);

		store().setLoraSelected('style', true);
		await flushPersistence();

		expect(backend.snapshot()['library-store']).toEqual({ state: { ...state, selectedLoraIds: ['style'] }, version: 0 });
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
