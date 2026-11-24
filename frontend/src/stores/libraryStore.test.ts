import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { InstalledModel, LoraWeight, LoRASpec, ModelSpec } from '../api/types';
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
	selectSelectedLoras,
	selectSelectedModel,
	useLibraryStore,
	useLoraRows,
	useLoraSummary,
} from './libraryStore';
import { useNotificationsStore } from './notificationsStore';

const store = () => useLibraryStore.getState();
const DEFAULT_WEIGHT = LORA_WEIGHT_DEFAULTS.weight;
/** A LoRA selection item (default weight unless given). */
const at = (id: string, weight = DEFAULT_WEIGHT): LoraWeight => ({ id, weight });

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
	it('replaceAll sanitizes (unknown selections dropped, weights clamped, missing model -> first model)', () => {
		store().replaceAll({
			models: [MODEL],
			loras: [SHION],
			selectedModelId: 'gone',
			selectedLoras: [at('shion', 12), at('gone')],
			lastModelDir: 'D:\\models',
		});
		expect(store()).toMatchObject({
			models: [MODEL],
			loras: [SHION],
			selectedModelId: MODEL.id,
			selectedLoras: [at('shion', LORA_WEIGHT_DEFAULTS.max)],
			lastModelDir: 'D:\\models',
			lastLoraDir: null,
		});
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

	it('toggles LoRAs at the default weight and clears the selection', () => {
		store().replaceAll({ loras: [SHION, STYLE] });
		store().setLoraSelected('style', true);
		store().setLoraSelected('shion', true);
		store().setLoraSelected('unknown', true);
		expect(store().selectedLoras).toEqual([at('style'), at('shion')]);
		store().setLoraSelected('style', false);
		expect(store().selectedLoras).toEqual([at('shion')]);
		store().clearSelectedLoras();
		expect(store().selectedLoras).toEqual([]);
	});

	it('setLoraSelected keeps the weight of a LoRA that is already selected and is a no-op when nothing changes', () => {
		store().replaceAll({ loras: [SHION, STYLE], selectedLoras: [at('shion', 0.4)] });
		const before = store().selectedLoras;

		store().setLoraSelected('shion', true);
		store().setLoraSelected('style', false);
		store().setLoraSelected('unknown', false);

		expect(store().selectedLoras).toBe(before);
		expect(before).toEqual([at('shion', 0.4)]);
	});

	it('setLoraSelection replaces the selection with exactly the given LoRAs, in order', () => {
		store().replaceAll({ loras: [SHION, STYLE], selectedLoras: [at('shion', 0.4)] });

		store().setLoraSelection([at('style', 0.6), at('gone', 0.5), at('shion', -1.25), at('style', 2)]);
		expect(store().selectedLoras).toEqual([at('style', 0.6), at('shion', -1.25)]);

		store().setLoraSelection([at('shion', 25)]);
		expect(store().selectedLoras).toEqual([at('shion', LORA_WEIGHT_DEFAULTS.max)]);

		store().setLoraSelection([]);
		expect(store().selectedLoras).toEqual([]);
	});

	it('setLoraWeight clamps; no-op when the LoRA is not selected or the weight is unchanged', () => {
		store().replaceAll({ loras: [SHION, STYLE], selectedLoras: [at('shion'), at('style', 0.5)] });

		store().setLoraWeight('style', 0.75);
		expect(store().selectedLoras).toEqual([at('shion'), at('style', 0.75)]);

		store().setLoraWeight('shion', -50);
		expect(store().selectedLoras).toEqual([at('shion', LORA_WEIGHT_DEFAULTS.min), at('style', 0.75)]);

		store().setLoraWeight('shion', Number.NaN);
		expect(store().selectedLoras[0]).toEqual(at('shion', DEFAULT_WEIGHT));

		const before = store().selectedLoras;
		store().setLoraWeight('style', 0.75);
		store().setLoraSelected('style', false);
		const afterUnselect = store().selectedLoras;
		store().setLoraWeight('style', 0.3);
		store().setLoraWeight('unknown', 0.3);
		expect(before).toEqual([at('shion'), at('style', 0.75)]);
		expect(store().selectedLoras).toBe(afterUnselect);
		expect(afterUnselect).toEqual([at('shion')]);
	});

	it('selectSelectedLoras returns the stored array: a stable reference until the selection changes', () => {
		store().replaceAll({ loras: [SHION, STYLE], selectedLoras: [at('shion', 0.6)] });
		const first = selectSelectedLoras(store());

		expect(first).toBe(store().selectedLoras);
		useLibraryStore.setState({ lastLoraDir: 'D:\\loras' });
		expect(selectSelectedLoras(store())).toBe(first);

		store().setLoraWeight('shion', 0.7);
		expect(selectSelectedLoras(store())).not.toBe(first);
		expect(selectSelectedLoras(store())).toEqual([at('shion', 0.7)]);
	});

	it('selectIsEntrySelected tells whether a checkpoint or LoRA entry is selected for generation', () => {
		store().replaceAll({ models: [MODEL], loras: [SHION, STYLE], selectedModelId: MODEL.id, selectedLoras: [at('style', 0.3)] });
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
		store().replaceAll({ loras: [SHION, STYLE], selectedLoras: [at('shion', 0.2), at('style', 0.8)] });

		store().removeLora('shion');

		expect(store().loras).toEqual([STYLE]);
		expect(store().selectedLoras).toEqual([at('style', 0.8)]);
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

	it('adds and selects LoRA files at the default weight, reusing known paths (selected weights kept)', async () => {
		enableDesktop();
		store().replaceAll({ loras: [SHION], selectedLoras: [at('shion', 0.5)] });
		useLibraryStore.setState({ lastLoraDir: 'D:\\loras' });
		const pickFiles = vi.spyOn(desktop, 'pickFiles').mockResolvedValue(['D:\\loras\\shion.safetensors', 'D:\\new\\Style.pt']);

		await store().addLoraFiles();

		expect(pickFiles).toHaveBeenCalledWith({
			defaultPath: 'D:\\loras',
			title: 'Add LoRA',
			filters: [{ name: 'LoRA files', extensions: ['safetensors', 'bin', 'pt'] }],
		});
		expect(store().loras).toEqual([SHION, { id: 'style', name: 'Style.pt', path: 'D:\\new\\Style.pt', source: null }]);
		expect(store().selectedLoras).toEqual([at('shion', 0.5), at('style')]);
		expect(store().lastLoraDir).toBe('D:\\loras');
	});

	it('adds a LoRA folder', async () => {
		enableDesktop();
		vi.spyOn(desktop, 'pickDirectory').mockResolvedValue('D:\\loras\\character.v2');
		await store().addLoraDirectory();
		expect(store().loras).toEqual([{ id: 'character-v2', name: 'character.v2', path: 'D:\\loras\\character.v2', source: null }]);
		expect(store().selectedLoras).toEqual([at('character-v2')]);
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
	it('builds prompt-link-aware rows with weights and a summary', () => {
		store().replaceAll({ loras: [SHION, STYLE], selectedLoras: [at('shion', 0.6)] });
		useCategoriesStore.setState({ categories: [linkedCategory(['style', 'shion', 'deleted'])] });

		const { result } = renderHook(() => ({ rows: useLoraRows(), summary: useLoraSummary() }));

		expect(result.current.rows).toEqual([
			{ lora: SHION, selected: true, weight: 0.6, promptLinked: true },
			{ lora: STYLE, selected: false, weight: null, promptLinked: true },
		]);
		expect(result.current.summary).toEqual({ selected: 1, promptLinked: 2, possibleActive: 2 });

		const before = result.current;
		act(() => useCategoriesStore.getState().setActivationText('main', 'x'));
		expect(result.current.rows).toBe(before.rows);
		expect(result.current.summary).toBe(before.summary);

		act(() => useCategoriesStore.getState().unlinkLora('style'));
		expect(result.current.rows[1].promptLinked).toBe(false);
		expect(result.current.summary).toEqual({ selected: 1, promptLinked: 1, possibleActive: 1 });

		act(() => store().setLoraWeight('shion', 1.5));
		expect(result.current.rows[0]).toMatchObject({ selected: true, weight: 1.5 });
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
		store().replaceAll({ models: [MODEL], loras: [SHION], selectedLoras: [at('shion', 0.4)] });
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
		expect(store()).toMatchObject({ selectedModelId: id, selectedLoras: [at('shion', 0.4)], lastModelDir: null });
	});

	it('adds a LoRA to the selection once, at the default weight', () => {
		store().replaceAll({ loras: [SHION], selectedLoras: [at('shion', 0.4)] });

		const id = store().registerInstalled(LORA_INSTALL);
		expect(store().registerInstalled(LORA_INSTALL)).toBe(id);

		expect(store().loras).toEqual([SHION, { id: 'add-detail', name: LORA_INSTALL.name, path: LORA_PATH, source: DETAIL_TWEAKER_SOURCE }]);
		expect(store().selectedLoras).toEqual([at('shion', 0.4), at('add-detail')]);
	});

	it('select true keeps the weight of a LoRA that is already selected', () => {
		store().replaceAll({ loras: [SHION], selectedLoras: [at('shion', 0.4)] });
		const id = store().registerInstalled(LORA_INSTALL)!;
		store().setLoraWeight(id, 0.65);

		expect(store().registerInstalled(LORA_INSTALL, { select: true })).toBe(id);

		expect(store().selectedLoras).toEqual([at('shion', 0.4), at(id, 0.65)]);
	});

	it('select false registers without touching the selection', () => {
		store().replaceAll({ models: [MODEL], loras: [SHION], selectedModelId: MODEL.id, selectedLoras: [at('shion', 0.4)] });
		const selection = store().selectedLoras;

		const loraId = store().registerInstalled(LORA_INSTALL, { select: false });
		const checkpointId = store().registerInstalled(CHECKPOINT_INSTALL, { select: false });

		expect(store().loras.map((lora) => lora.id)).toEqual(['shion', loraId]);
		expect(store().models.map((model) => model.id)).toEqual([MODEL.id, checkpointId]);
		expect(store().selectedLoras).toBe(selection);
		expect(store().selectedModelId).toBe(MODEL.id);
	});

	it('reuses a manual entry with the same path and attaches the source', () => {
		const manual: LoRASpec = { id: 'detail', name: 'add_detail.safetensors', path: LORA_PATH.toLowerCase(), source: null };
		store().replaceAll({ loras: [manual] });

		expect(store().registerInstalled(LORA_INSTALL)).toBe('detail');

		expect(store().loras).toEqual([{ ...manual, source: DETAIL_TWEAKER_SOURCE }]);
		expect(store().selectedLoras).toEqual([at('detail')]);
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
	/** A real v0 'library-store' envelope (trimmed): entries have no `source`, the selection is `selectedLoraIds`. */
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
	const { selectedLoraIds: _legacySelection, ...REAL_V0_WITHOUT_SELECTION } = REAL_V0_STATE;
	/** REAL_V0_STATE as version 2 writes it back. */
	const MIGRATED_STATE = {
		...REAL_V0_WITHOUT_SELECTION,
		models: REAL_V0_STATE.models.map((model) => ({ ...model, source: null })),
		loras: REAL_V0_STATE.loras.map((lora) => ({ ...lora, source: null })),
		selectedLoras: [at('shion')],
	};
	/** A v1 envelope: entries carry `source`, the selection is still `selectedLoraIds`. */
	const V1_STATE = {
		...REAL_V0_WITHOUT_SELECTION,
		models: MIGRATED_STATE.models,
		loras: [{ ...MIGRATED_STATE.loras[0], source: DETAIL_TWEAKER_SOURCE }, MIGRATED_STATE.loras[1]],
		selectedLoraIds: ['zy-illustrious-realism-enhancer-v1', 'deleted', 'shion'],
	};

	it('migrates a real v0 envelope: source null, selection at the default weight, written back as version 2', async () => {
		const backend = createMemoryStoreBackend({ 'library-store': { state: REAL_V0_STATE, version: 0 } });
		setStoreBackend(backend);

		expect(await hydratePersistedStores([useLibraryStore])).toEqual([]);
		expect(store()).toMatchObject(MIGRATED_STATE);
		await flushPersistence();

		expect(backend.snapshot()['library-store']).toEqual({ state: MIGRATED_STATE, version: LIBRARY_STORE_VERSION });
		expect(LIBRARY_STORE_VERSION).toBe(2);
	});

	it('migrates a v1 envelope: sources kept, selectedLoraIds -> selectedLoras at the default weight', async () => {
		const backend = createMemoryStoreBackend({ 'library-store': { state: V1_STATE, version: 1 } });
		setStoreBackend(backend);

		await hydratePersistedStores([useLibraryStore]);
		expect(store().loras[0].source).toEqual(DETAIL_TWEAKER_SOURCE);
		expect(store().selectedLoras).toEqual([at('zy-illustrious-realism-enhancer-v1'), at('shion')]);
		await flushPersistence();

		const written = backend.snapshot()['library-store'];
		expect(written?.version).toBe(2);
		expect(written?.state).not.toHaveProperty('selectedLoraIds');
		expect(written?.state).toMatchObject({ selectedLoras: [at('zy-illustrious-realism-enhancer-v1'), at('shion')] });
	});

	it('round-trips v2 weights', async () => {
		const state = { ...MIGRATED_STATE, selectedLoras: [at('shion', 0.6), at('zy-illustrious-realism-enhancer-v1', -1.25)] };
		const backend = createMemoryStoreBackend({ 'library-store': { state, version: 2 } });
		setStoreBackend(backend);

		await hydratePersistedStores([useLibraryStore]);
		expect(store().selectedLoras).toEqual(state.selectedLoras);

		store().setLoraWeight('shion', 0.65);
		await flushPersistence();

		expect(backend.snapshot()['library-store']).toEqual({
			state: { ...state, selectedLoras: [at('shion', 0.65), at('zy-illustrious-realism-enhancer-v1', -1.25)] },
			version: 2,
		});
	});

	it('migrateLibraryState maps v0/v1 selections and leaves v2 states unchanged', () => {
		const { selectedLoraIds: _v1Selection, ...v1WithoutSelection } = V1_STATE;
		expect(migrateLibraryState(REAL_V0_STATE, 0)).toEqual({ ...REAL_V0_WITHOUT_SELECTION, selectedLoras: [at('shion')] });
		// Unknown ids are dropped later, by the merge (sanitizeLibrary).
		const migratedV1 = migrateLibraryState(V1_STATE, 1);
		expect(migratedV1).toEqual({ ...v1WithoutSelection, selectedLoras: [at('zy-illustrious-realism-enhancer-v1'), at('deleted'), at('shion')] });
		expect(migratedV1).not.toHaveProperty('selectedLoraIds');
		// Without a selection: an empty one. A v2 state (or one that already has selectedLoras) is returned as is.
		expect(migrateLibraryState({ models: [] }, 1)).toEqual({ models: [], selectedLoras: [] });
		expect(migrateLibraryState(MIGRATED_STATE, 2)).toBe(MIGRATED_STATE);
		expect(migrateLibraryState(MIGRATED_STATE, 1)).toBe(MIGRATED_STATE);
		expect(migrateLibraryState(null, 0)).toBeNull();
	});

	it('repairs a stale selection on hydration', async () => {
		setStoreBackend(
			createMemoryStoreBackend({
				'library-store': {
					state: { models: [MODEL], loras: [SHION], selectedModelId: 'deleted', selectedLoras: [at('deleted'), at('shion', 40)], lastModelDir: null, lastLoraDir: null },
					version: 2,
				},
			}),
		);
		await hydratePersistedStores([useLibraryStore]);
		expect(store().selectedModelId).toBe(MODEL.id);
		expect(store().selectedLoras).toEqual([at('shion', LORA_WEIGHT_DEFAULTS.max)]);
	});

	it('repairs a stale legacy selection on hydration', async () => {
		setStoreBackend(
			createMemoryStoreBackend({
				'library-store': {
					state: { models: [MODEL], loras: [SHION], selectedModelId: 'deleted', selectedLoraIds: ['deleted', 'shion'], lastModelDir: null, lastLoraDir: null },
					version: 0,
				},
			}),
		);
		await hydratePersistedStores([useLibraryStore]);
		expect(store().selectedModelId).toBe(MODEL.id);
		expect(store().selectedLoras).toEqual([at('shion')]);
	});
});
