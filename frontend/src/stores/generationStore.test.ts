import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../api/client';
import { LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { GenerateRequest, LoRASpec, ModelSpec, OutputRecord } from '../api/types';
import type { Category } from '../domain/categories';
import type { SceneGenerationInput } from '../domain/stories';
import { ALICE_ID, BOB, character } from '../test/characterData';
import { useCategoriesStore } from './categoriesStore';
import { useCharactersStore } from './charactersStore';
import { useGenerationSettingsStore } from './generationSettingsStore';
import { GENERATION_BUSY_MESSAGE, GENERATION_FAILED_TITLE, isAbortError, useCanGenerate, useCanToggleContinuous, useGenerationStore } from './generationStore';
import { useLibraryStore } from './libraryStore';
import { useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { useTasksStore } from './tasksStore';
import { useUndoStore } from './undoStore';

const MODEL: ModelSpec = { id: 'model', name: 'model.safetensors', path: 'D:/m/model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };
const STYLE: LoRASpec = { id: 'style', name: 'style.safetensors', path: 'D:/l/style.safetensors', source: null };
const DETAIL: LoRASpec = { id: 'detail', name: 'detail.safetensors', path: 'D:/l/detail.safetensors', source: null };

const CATEGORIES: Category[] = [
	{ text: 'Main', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: '1girl, smile', state: 'lock', extraLoraIds: ['style'] }] },
];

const store = () => useGenerationStore.getState();

function record(request: GenerateRequest, outputId = '0000000004'): OutputRecord {
	return {
		output_id: outputId,
		generated_at: '2026-01-01T00:00:00Z',
		image_path: `D:/out/${outputId}.png`,
		metadata_path: `D:/out/${outputId}.json`,
		model_id: request.model.id,
		active_loras: (request.loras ?? []).map((lora) => ({ id: lora.id, weight: lora.weight ?? 1 })),
		prompt: request.prompt,
		negative_prompt: request.negative_prompt,
		width: request.width,
		height: request.height,
		steps: request.steps,
		guidance_scale: request.guidance_scale,
		seed: request.seed ?? 0,
		image_seed: request.seed ?? null,
		prompt_seed: request.prompt_seed ?? null,
		selections: (request.selections ?? []).map((item) => ({ ...item, locked: item.locked, induced_lora_ids: item.induced_lora_ids ?? [] })),
		character: null,
		story: null,
	};
}

function setup() {
	useLibraryStore.setState({ models: [MODEL], loras: [STYLE, DETAIL], selectedModelId: MODEL.id, selectedLoras: [] });
	useCategoriesStore.setState({ categories: CATEGORIES });
	useGenerationSettingsStore.setState({ promptSeedInput: '5', promptSeedBehavior: 'fixed', seedInput: '10', imageSeedBehavior: 'increment' });
	const showGenerated = vi.fn();
	const push = vi.fn();
	useOutputsStore.setState({ currentId: '0000000003', showGenerated });
	useUndoStore.setState({ push });
	const cancelGeneration = vi.spyOn(api, 'cancelGeneration').mockResolvedValue(undefined);
	return { showGenerated, push, cancelGeneration };
}

function untilAborted(signal: AbortSignal | undefined): Promise<OutputRecord> {
	return new Promise((_, reject) => {
		signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
	});
}

function notifications() {
	return useNotificationsStore.getState().notifications.map(({ intent, title, message }) => ({ intent, title, message }));
}

describe('generate', () => {
	it('sends the built request, advances the seeds, shows the output and pushes an undo entry', async () => {
		const { showGenerated, push } = setup();
		let generatingDuringRequest = false;
		const generate = vi.spyOn(api, 'generate').mockImplementation(async (request) => {
			generatingDuringRequest = store().generating;
			return record(request);
		});

		await store().generate();

		const [request, signal] = generate.mock.calls[0];
		expect(request).toMatchObject({ model: MODEL, loras: [{ ...STYLE, weight: 1 }], prompt: '1girl, smile', seed: 10, prompt_seed: 5, width: 1024, steps: 30 });
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(generatingDuringRequest).toBe(true);
		expect(store().generating).toBe(false);
		expect(useGenerationSettingsStore.getState()).toMatchObject({ seedInput: '11', promptSeedInput: '5' });
		expect(showGenerated).toHaveBeenCalledWith(record(request));
		expect(push).toHaveBeenCalledWith({
			type: 'generate',
			previousOutputId: '0000000003',
			seeds: { promptSeedInput: '5', seedInput: '10', promptSeedBehavior: 'fixed', imageSeedBehavior: 'increment', promptCategorySeedState: {} },
		});
		expect(notifications()).toEqual([]);
	});

	it('sends the selected LoRA weights; prompt-linked LoRAs get the default weight', async () => {
		setup();
		useLibraryStore.getState().setLoraSelection([{ id: 'detail', weight: 0.6 }]);
		useLibraryStore.getState().setLoraWeight('detail', 0.65);
		const generate = vi.spyOn(api, 'generate').mockImplementation(async (request) => record(request));

		await store().generate();

		expect(generate.mock.calls[0][0].loras).toEqual([
			{ ...DETAIL, weight: 0.65 },
			{ ...STYLE, weight: LORA_WEIGHT_DEFAULTS.weight },
		]);
	});

	it('a selected LoRA that a sub-prompt also links keeps its selected weight', async () => {
		setup();
		useLibraryStore.getState().setLoraSelection([{ id: 'style', weight: -1.5 }]);
		const generate = vi.spyOn(api, 'generate').mockImplementation(async (request) => record(request));

		await store().generate();

		expect(generate.mock.calls[0][0].loras).toEqual([{ ...STYLE, weight: -1.5 }]);
	});

	it('replaces the per-category counters in cycle mode', async () => {
		setup();
		useGenerationSettingsStore.setState({ promptSeedBehavior: 'per_category_cycle', promptCategorySeedState: { main: { seed: 3, remaining: 1, prompt_count: 1 } } });
		vi.spyOn(api, 'generate').mockImplementation(async (request) => record(request));

		await store().generate();

		expect(useGenerationSettingsStore.getState()).toMatchObject({
			promptSeedInput: '5',
			promptCategorySeedState: { main: { seed: 3, remaining: 1, prompt_count: 1 } },
		});
	});

	it('is a no-op while a generation runs', async () => {
		setup();
		const generate = vi.spyOn(api, 'generate');
		useGenerationStore.setState({ generating: true });
		await store().generate();
		useGenerationStore.setState({ generating: false, continuous: true });
		await store().generate();
		expect(generate).not.toHaveBeenCalled();
	});

	it('reports request building and API errors', async () => {
		const { showGenerated } = setup();
		const generate = vi.spyOn(api, 'generate').mockRejectedValue(new ApiError('CUDA out of memory', 500, null));

		await store().generate();
		useLibraryStore.setState({ selectedModelId: '' });
		await store().generate();

		expect(generate).toHaveBeenCalledOnce();
		expect(showGenerated).not.toHaveBeenCalled();
		expect(store().generating).toBe(false);
		expect(notifications()).toEqual([
			{ intent: 'error', title: GENERATION_FAILED_TITLE, message: 'CUDA out of memory' },
			{ intent: 'error', title: GENERATION_FAILED_TITLE, message: 'Select a model before generating.' },
		]);
	});

	it('warns about LoRAs missing from the library', async () => {
		setup();
		useLibraryStore.setState({ selectedLoras: [{ id: 'deleted', weight: 1 }] });
		useCategoriesStore.setState({ categories: [{ ...CATEGORIES[0], subPrompts: [{ ...CATEGORIES[0].subPrompts[0], extraLoraIds: ['style', 'gone'] }] }] });
		const generate = vi.spyOn(api, 'generate').mockImplementation(async (request) => record(request));

		await store().generate();

		expect(generate.mock.calls[0][0].loras).toEqual([{ ...STYLE, weight: 1 }]);
		expect(generate.mock.calls[0][0].selections?.[0].induced_lora_ids).toEqual(['style']);
		expect(notifications()).toEqual([{ intent: 'warning', title: 'Missing LoRAs', message: 'LoRAs missing from the library were ignored: deleted, gone.' }]);
	});
});

describe('generate with the active character', () => {
	const ALICE = character({ loras: [{ id: 'detail', weight: 0.5 }], seed: 777, seed_locked: true, negative_tags: ['short hair'] });

	it('the active character of the characters store reaches api.generate; a locked seed keeps the seed field', async () => {
		setup();
		useCharactersStore.setState({ characters: [BOB, ALICE], activeId: ALICE_ID });
		useGenerationSettingsStore.setState({ negativePrompt: 'lowres' });
		const generate = vi.spyOn(api, 'generate').mockImplementation(async (request) => record(request));

		await store().generate();

		const request = generate.mock.calls[0][0];
		expect(request).toMatchObject({
			character_id: ALICE_ID,
			seed: 777,
			prompt_seed: 5,
			negative_prompt: 'lowres, short hair',
			prompt: '1girl, silver hair, blue eyes, school uniform, 1girl, smile',
			loras: [
				{ ...DETAIL, weight: 0.5 },
				{ ...STYLE, weight: LORA_WEIGHT_DEFAULTS.weight },
			],
		});
		expect(request.selections?.slice(0, 2).map((item) => [item.category_name, item.locked])).toEqual([
			['Character', true],
			['Character outfit', true],
		]);
		// imageSeedBehavior 'increment' would advance the field to '11' without the lock.
		expect(useGenerationSettingsStore.getState()).toMatchObject({ seedInput: '10', promptSeedInput: '5' });
		expect(notifications()).toEqual([]);
	});

	it('an unlocked character advances the seed field; no active character sends character_id null', async () => {
		setup();
		useCharactersStore.setState({ characters: [{ ...ALICE, seed_locked: false }], activeId: ALICE_ID });
		const generate = vi.spyOn(api, 'generate').mockImplementation(async (request) => record(request));

		await store().generate();
		expect(generate.mock.calls[0][0]).toMatchObject({ character_id: ALICE_ID, seed: 10 });
		expect(useGenerationSettingsStore.getState().seedInput).toBe('11');

		useCharactersStore.setState({ activeId: null });
		await store().generate();
		expect(generate.mock.calls[1][0]).toMatchObject({ character_id: null, seed: 11, prompt: '1girl, smile' });
	});

	it('warns about character LoRAs missing from the library', async () => {
		setup();
		useCharactersStore.setState({ characters: [character({ loras: [{ id: 'gone-character-lora', weight: 0.8 }] })], activeId: ALICE_ID });
		vi.spyOn(api, 'generate').mockImplementation(async (request) => record(request));

		await store().generate();

		expect(notifications()).toEqual([
			{ intent: 'warning', title: 'Missing LoRAs', message: 'LoRAs missing from the library were ignored: gone-character-lora.' },
		]);
	});
});

describe('continuous generation and cancel', () => {
	it('loops until stopped; stopping aborts the request and asks the backend to cancel', async () => {
		const { showGenerated, cancelGeneration } = setup();
		useLibraryStore.setState({ selectedLoras: [{ id: 'deleted', weight: 1 }] });
		const generate = vi.spyOn(api, 'generate').mockImplementation(async (request, signal) =>
			generate.mock.calls.length < 3 ? record(request, `000000000${generate.mock.calls.length + 3}`) : untilAborted(signal),
		);

		const running = store().toggleContinuous();
		await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(3));
		expect(store().continuous).toBe(true);

		await store().toggleContinuous();
		await running;

		expect(store()).toMatchObject({ continuous: false, generating: false });
		expect(showGenerated).toHaveBeenCalledTimes(2);
		expect(cancelGeneration).toHaveBeenCalledOnce();
		expect(generate.mock.calls[2][1]?.aborted).toBe(true);
		expect(notifications()).toEqual([{ intent: 'warning', title: 'Missing LoRAs', message: 'LoRAs missing from the library were ignored: deleted.' }]);
		expect(useGenerationSettingsStore.getState().seedInput).toBe('12');
	});

	it('stops the loop on the first error and reports it', async () => {
		setup();
		const generate = vi
			.spyOn(api, 'generate')
			.mockImplementationOnce(async (request) => record(request))
			.mockRejectedValueOnce(new Error('backend crashed'));

		await store().toggleContinuous();

		expect(generate).toHaveBeenCalledTimes(2);
		expect(store().continuous).toBe(false);
		expect(notifications()).toEqual([{ intent: 'error', title: GENERATION_FAILED_TITLE, message: 'backend crashed' }]);
	});

	it('does not start the loop while a single generation runs', async () => {
		setup();
		const generate = vi.spyOn(api, 'generate');
		useGenerationStore.setState({ generating: true });
		await store().toggleContinuous();
		expect(generate).not.toHaveBeenCalled();
		expect(store().continuous).toBe(false);
	});

	it('cancel aborts a single generation silently and ignores backend cancel failures', async () => {
		const { showGenerated, cancelGeneration } = setup();
		cancelGeneration.mockRejectedValue(new Error('not running'));
		const generate = vi.spyOn(api, 'generate').mockImplementation((_request, signal) => untilAborted(signal));

		const running = store().generate();
		await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
		await store().cancel();
		await running;

		expect(cancelGeneration).toHaveBeenCalledOnce();
		expect(showGenerated).not.toHaveBeenCalled();
		expect(store().generating).toBe(false);
		expect(notifications()).toEqual([]);
	});
});

describe('an abandoned generation that the backend completes', () => {
	const generationEvent = (stage: 'sampling' | 'cancelled' | 'complete') =>
		({ type: 'generation', task_id: 'generation', stage, message: '', current: 12, total: 12 }) as const;

	it('lists its output once its complete event arrives, not for the generations the client waited for', async () => {
		setup();
		const refreshIds = vi.fn().mockResolvedValue([]);
		useOutputsStore.setState({ refreshIds });
		const generate = vi.spyOn(api, 'generate').mockImplementation((_request, signal) => untilAborted(signal));

		const running = store().generate();
		await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
		await store().cancel();
		await running;

		// The backend reports the cancel request, then completes the generation it was already saving.
		useTasksStore.getState().applyEvent(generationEvent('cancelled'));
		expect(refreshIds).not.toHaveBeenCalled();
		useTasksStore.getState().applyEvent(generationEvent('complete'));
		expect(refreshIds).toHaveBeenCalledOnce();

		// A generation the client waited for: its output is shown from the response, no extra listing.
		generate.mockImplementation(async (request) => record(request, '0000000005'));
		await store().generate();
		useTasksStore.getState().applyEvent(generationEvent('sampling'));
		useTasksStore.getState().applyEvent(generationEvent('complete'));
		expect(refreshIds).toHaveBeenCalledOnce();
	});
});

describe('useCanGenerate', () => {
	it('needs a selected model and no running generation', () => {
		const { result } = renderHook(() => useCanGenerate());
		expect(result.current).toBe(false);
		act(() => useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id }));
		expect(result.current).toBe(true);
		act(() => useGenerationStore.setState({ generating: true }));
		expect(result.current).toBe(false);
	});
});

describe('useCanToggleContinuous', () => {
	it('starts only with a model and no single generation running, and can always stop a running loop', () => {
		const { result } = renderHook(() => useCanToggleContinuous());
		expect(result.current).toBe(false);
		act(() => useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id }));
		expect(result.current).toBe(true);
		act(() => useGenerationStore.setState({ generating: true }));
		expect(result.current).toBe(false);
		act(() => useGenerationStore.setState({ continuous: true }));
		expect(result.current).toBe(true);
		act(() => useLibraryStore.setState({ selectedModelId: '' }));
		expect(result.current).toBe(true);
	});
});

describe('generateScene', () => {
	const SCENE: SceneGenerationInput = {
		storyId: 'sty-000000000001',
		sceneId: 'scn-000000000001',
		cast: [BOB],
		locks: [],
		extraTags: ['storm'],
		negativeTags: [],
		seed: 77,
		loras: [],
	};

	it("sends the scene's request through the same path, lists the output and leaves the seeds, the viewer and undo alone", async () => {
		const { showGenerated, push } = setup();
		const addGenerated = vi.fn();
		useOutputsStore.setState({ addGenerated });
		useCharactersStore.setState({ characters: [character()], activeId: ALICE_ID });
		const generate = vi.spyOn(api, 'generate').mockImplementation(async (request) => record(request, '0000000009'));

		const saved = await store().generateScene(SCENE);

		const [request, signal] = generate.mock.calls[0];
		expect(request).toMatchObject({
			prompt: '1boy, black hair, storm, 1girl, smile',
			seed: 77,
			prompt_seed: 5,
			character_id: BOB.id,
			story: { story_id: 'sty-000000000001', scene_id: 'scn-000000000001' },
		});
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(saved.output_id).toBe('0000000009');
		expect(addGenerated).toHaveBeenCalledWith(saved);
		expect(showGenerated).not.toHaveBeenCalled();
		expect(push).not.toHaveBeenCalled();
		expect(useGenerationSettingsStore.getState()).toMatchObject({ seedInput: '10', promptSeedInput: '5' });
		expect(store().generating).toBe(false);
	});

	it('refuses while another generation runs, and rejects with the failure (the caller reports it)', async () => {
		setup();
		useGenerationStore.setState({ generating: true });
		await expect(store().generateScene(SCENE)).rejects.toThrow(GENERATION_BUSY_MESSAGE);

		useGenerationStore.setState({ generating: false });
		vi.spyOn(api, 'generate').mockRejectedValue(new ApiError('Generation failed: out of memory', 409, null));
		await expect(store().generateScene(SCENE)).rejects.toThrow('out of memory');
		expect(notifications()).toEqual([]);
		expect(store().generating).toBe(false);
	});

	it('previewScene builds the same request generateScene would send, and sends nothing', async () => {
		setup();
		const generate = vi.spyOn(api, 'generate');

		const preview = store().previewScene({ ...SCENE, loras: [{ id: 'gone', weight: 1 }] });

		expect(preview.request).toMatchObject({ prompt: '1boy, black hair, storm, 1girl, smile', seed: 77, prompt_seed: 5, character_id: BOB.id });
		expect(preview.imageSeedLocked).toBe(true);
		expect(preview.missingLoraIds).toEqual(['gone']);
		expect(generate).not.toHaveBeenCalled();
		expect(store().generating).toBe(false);
		expect(notifications()).toEqual([]);
		expect(useGenerationSettingsStore.getState()).toMatchObject({ seedInput: '10', promptSeedInput: '5' });
	});

	it('is cancelled by cancel (an AbortError)', async () => {
		const { cancelGeneration } = setup();
		vi.spyOn(api, 'generate').mockImplementation((_request, signal) => untilAborted(signal));

		const running = store().generateScene(SCENE);
		await store().cancel();

		await expect(running).rejects.toSatisfy(isAbortError);
		expect(cancelGeneration).toHaveBeenCalled();
	});
});
