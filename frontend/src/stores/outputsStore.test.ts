import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api/client';
import type { OutputRecord } from '../api/types';
import { flushPersistence, hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import { clipboard } from '../services/clipboard';
import { useLibraryStore } from './libraryStore';
import { useNotificationsStore } from './notificationsStore';
import {
	migrateOutputsState,
	selectCurrentImageUrl,
	selectNavigation,
	useCurrentOutputDetails,
	useCurrentSelectionKey,
	useIsSubPromptInCurrentOutput,
	useOutputsStore,
} from './outputsStore';
import { useUndoStore } from './undoStore';

const id = (n: number) => String(n).padStart(10, '0');

function makeRecord(outputId: string, overrides: Partial<OutputRecord> = {}): OutputRecord {
	return {
		output_id: outputId,
		generated_at: '2026-03-23T10:00:00Z',
		prompt: `prompt of ${outputId}`,
		negative_prompt: '',
		seed: 1,
		prompt_seed: null,
		image_seed: null,
		width: 832,
		height: 1216,
		steps: 30,
		guidance_scale: 5,
		model_id: 'model-a',
		active_loras: [],
		selections: [],
		image_path: `D:\\data\\output\\${outputId}.png`,
		metadata_path: `D:\\data\\output\\${outputId}.json`,
		...overrides,
	};
}

/** In-memory stand-in for the backend output endpoints. */
function fakeOutputsBackend(initial: number[]) {
	const live = new Set(initial.map(id));
	const trash = new Set<string>();
	const notFound = () => new ApiError('Not found', 404, { detail: 'Not found' });
	const spies = {
		listOutputIds: vi.spyOn(api, 'listOutputIds').mockImplementation(async () => [...live].sort()),
		getOutput: vi.spyOn(api, 'getOutput').mockImplementation(async (outputId) => {
			if (!live.has(outputId)) {
				throw notFound();
			}
			return makeRecord(outputId);
		}),
		trashOutput: vi.spyOn(api, 'trashOutput').mockImplementation(async (outputId) => {
			if (!live.delete(outputId)) {
				throw notFound();
			}
			trash.add(outputId);
		}),
		restoreOutput: vi.spyOn(api, 'restoreOutput').mockImplementation(async (outputId) => {
			if (!trash.delete(outputId)) {
				throw notFound();
			}
			live.add(outputId);
		}),
	};
	return { live, trash, spies };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const outputs = () => useOutputsStore.getState();
const notifications = () => useNotificationsStore.getState().notifications;

describe('outputsStore initialize/select', () => {
	it('shows the preferred output, else the latest, else nothing', async () => {
		fakeOutputsBackend([1, 2, 3]);
		await outputs().initialize([id(3), id(1), id(2)], id(2));
		expect(outputs()).toMatchObject({ ids: [id(1), id(2), id(3)], currentId: id(2), loadingRecord: false });
		expect(outputs().record?.output_id).toBe(id(2));

		await outputs().initialize([id(1), id(2), id(3)], id(9));
		expect(outputs().currentId).toBe(id(3));

		await outputs().initialize([], null);
		expect(outputs()).toMatchObject({ ids: [], currentId: null, record: null });
	});

	it('sets loadingRecord while the record loads and exposes the image url', async () => {
		fakeOutputsBackend([1]);
		const pending = deferred<OutputRecord>();
		vi.spyOn(api, 'getOutput').mockReturnValueOnce(pending.promise);

		const selecting = outputs().select(id(1));
		expect(outputs()).toMatchObject({ currentId: id(1), record: null, loadingRecord: true });
		expect(selectCurrentImageUrl(outputs())).toMatch(/\/api\/outputs\/0000000001\/image$/);

		pending.resolve(makeRecord(id(1)));
		await selecting;
		expect(outputs()).toMatchObject({ loadingRecord: false, record: { output_id: id(1) } });
	});

	it('never lets a stale load overwrite a newer selection', async () => {
		fakeOutputsBackend([1, 2]);
		const slow = deferred<OutputRecord>();
		const fast = deferred<OutputRecord>();
		vi.spyOn(api, 'getOutput').mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

		const first = outputs().select(id(1));
		const second = outputs().select(id(2));
		fast.resolve(makeRecord(id(2)));
		await second;
		slow.resolve(makeRecord(id(1)));
		await first;

		expect(outputs().currentId).toBe(id(2));
		expect(outputs().record?.output_id).toBe(id(2));
	});

	it('falls back to the nearest output when the selected one is gone (404)', async () => {
		const backend = fakeOutputsBackend([1, 2, 3]);
		await outputs().initialize([id(1), id(2), id(3)], id(1));
		backend.live.delete(id(2));

		await outputs().select(id(2));

		expect(outputs().ids).toEqual([id(1), id(3)]);
		expect(outputs().currentId).toBe(id(3));
		expect(outputs().record?.output_id).toBe(id(3));
		expect(notifications()).toEqual([]);
	});

	it('reports other load failures', async () => {
		fakeOutputsBackend([1]);
		vi.spyOn(api, 'getOutput').mockRejectedValueOnce(new ApiError('Corrupt metadata', 500, null));
		await outputs().select(id(1));
		expect(outputs()).toMatchObject({ currentId: id(1), record: null, loadingRecord: false });
		expect(notifications()).toMatchObject([{ intent: 'error', message: 'Corrupt metadata', title: 'Could not load output 0000000001' }]);
	});
});

describe('outputsStore navigation', () => {
	it('moves with previous/next/first/last', async () => {
		fakeOutputsBackend([1, 2, 3]);
		await outputs().initialize([id(1), id(2), id(3)], id(2));

		await outputs().previous();
		expect(outputs().currentId).toBe(id(1));
		expect(selectNavigation(outputs())).toEqual({ index: 0, count: 3, canFirst: false, canPrevious: false, canNext: true, canLast: true });
		await outputs().next();
		await outputs().next();
		expect(outputs().currentId).toBe(id(3));
		await outputs().first();
		expect(outputs().currentId).toBe(id(1));
		await outputs().last();
		expect(outputs().currentId).toBe(id(3));
		expect(outputs().record?.output_id).toBe(id(3));
	});

	it('refreshes the id list when next/previous are at the end', async () => {
		const backend = fakeOutputsBackend([1, 2]);
		await outputs().initialize([id(1), id(2)], id(2));
		backend.live.add(id(3));

		await outputs().next();
		expect(outputs().ids).toEqual([id(1), id(2), id(3)]);
		expect(outputs().currentId).toBe(id(3));

		await outputs().next();
		expect(backend.spies.listOutputIds).toHaveBeenCalledTimes(2);
		expect(outputs().currentId).toBe(id(3));
	});

	it('first/last read the list when it is empty', async () => {
		fakeOutputsBackend([4, 5]);
		await outputs().first();
		expect(outputs().currentId).toBe(id(4));
	});

	it('refreshIds keeps the current output, else shows its neighbour', async () => {
		const backend = fakeOutputsBackend([1, 2, 3]);
		await outputs().initialize([id(1), id(2), id(3)], id(2));
		backend.live.add(id(4));
		expect(await outputs().refreshIds()).toEqual([id(1), id(2), id(3), id(4)]);
		expect(outputs().currentId).toBe(id(2));

		backend.live.delete(id(2));
		await outputs().refreshIds();
		expect(outputs().currentId).toBe(id(3));
		expect(outputs().record?.output_id).toBe(id(3));
	});

	it('refreshIds reports failures and keeps the known ids', async () => {
		fakeOutputsBackend([1]);
		await outputs().initialize([id(1)], null);
		vi.spyOn(api, 'listOutputIds').mockRejectedValueOnce(new Error('offline'));
		expect(await outputs().refreshIds()).toEqual([id(1)]);
		expect(notifications()).toMatchObject([{ intent: 'error', message: 'offline' }]);
	});
});

describe('outputsStore generation, delete and restore', () => {
	it('showGenerated appends and shows the record without refetching, cancelling pending loads', async () => {
		const backend = fakeOutputsBackend([1]);
		await outputs().initialize([id(1)], id(1));
		const pending = deferred<OutputRecord>();
		backend.spies.getOutput.mockReturnValueOnce(pending.promise);
		const selecting = outputs().select(id(1));

		const generated = makeRecord(id(2), { prompt: 'fresh' });
		outputs().showGenerated(generated);
		pending.resolve(makeRecord(id(1)));
		await selecting;

		expect(outputs()).toMatchObject({ ids: [id(1), id(2)], currentId: id(2), record: generated, loadingRecord: false });
		expect(backend.spies.getOutput).toHaveBeenCalledTimes(2);
	});

	it('deleteCurrent trashes, shows the output now at the same index and pushes an undo entry', async () => {
		const backend = fakeOutputsBackend([1, 2, 3]);
		await outputs().initialize([id(1), id(2), id(3)], id(2));

		await outputs().deleteCurrent();

		expect(backend.trash).toEqual(new Set([id(2)]));
		expect(outputs()).toMatchObject({ ids: [id(1), id(3)], currentId: id(3) });
		expect(useUndoStore.getState().entries).toEqual([{ type: 'delete-output', outputId: id(2) }]);
	});

	it('deleting the last output shows the previous one, deleting the only one shows nothing', async () => {
		fakeOutputsBackend([1, 2]);
		await outputs().initialize([id(1), id(2)], id(2));
		await outputs().deleteCurrent();
		expect(outputs().currentId).toBe(id(1));
		await outputs().deleteCurrent();
		expect(outputs()).toMatchObject({ ids: [], currentId: null, record: null });
		expect(useUndoStore.getState().entries).toHaveLength(2);
	});

	it('a failed delete keeps everything and reports', async () => {
		fakeOutputsBackend([1]);
		await outputs().initialize([id(1)], id(1));
		vi.spyOn(api, 'trashOutput').mockRejectedValueOnce(new Error('locked'));
		await outputs().deleteCurrent();
		expect(outputs()).toMatchObject({ ids: [id(1)], currentId: id(1) });
		expect(useUndoStore.getState().entries).toEqual([]);
		expect(notifications()).toMatchObject([{ intent: 'error', message: 'locked' }]);
	});

	it('restore brings a trashed output back and shows it; failures throw', async () => {
		fakeOutputsBackend([1, 2, 3]);
		await outputs().initialize([id(1), id(2), id(3)], id(2));
		await outputs().deleteCurrent();

		await outputs().restore(id(2));
		expect(outputs()).toMatchObject({ ids: [id(1), id(2), id(3)], currentId: id(2) });
		expect(outputs().record?.output_id).toBe(id(2));

		await expect(outputs().restore(id(7))).rejects.toThrow('Not found');
	});
});

describe('outputsStore clipboard', () => {
	it('copies the current prompt and a selection prompt with a success notification', async () => {
		const writeText = vi.spyOn(clipboard, 'writeText').mockResolvedValue(undefined);
		useOutputsStore.setState({
			currentId: id(1),
			record: makeRecord(id(1), {
				prompt: 'full prompt',
				selections: [{ category_name: 'Main', prompt_text: 'masterpiece', locked: false, induced_lora_ids: [] }],
			}),
		});

		await outputs().copyCurrentPrompt();
		await outputs().copySelectionPrompt(0);
		await outputs().copySelectionPrompt(5);

		expect(writeText.mock.calls).toEqual([['full prompt'], ['masterpiece']]);
		expect(notifications().map((item) => item.intent)).toEqual(['success', 'success']);
	});

	it('reports clipboard failures and ignores missing records', async () => {
		const writeText = vi.spyOn(clipboard, 'writeText').mockRejectedValue(new Error('denied'));
		await outputs().copyCurrentPrompt();
		expect(writeText).not.toHaveBeenCalled();

		useOutputsStore.setState({ currentId: id(1), record: makeRecord(id(1)) });
		await outputs().copyCurrentPrompt();
		expect(notifications()).toMatchObject([{ intent: 'error', message: 'denied' }]);
	});
});

describe('outputsStore persistence', () => {
	it('migrates v0 {currentName} to v1 {currentId} and writes it back', async () => {
		const backend = createMemoryStoreBackend({ 'current-image-store': { state: { currentName: 2003 }, version: 0 } });
		setStoreBackend(backend);

		expect(await hydratePersistedStores([useOutputsStore])).toEqual([]);
		expect(outputs().currentId).toBe('0000002003');

		await flushPersistence();
		expect(backend.snapshot()['current-image-store']).toEqual({ state: { currentId: '0000002003' }, version: 1 });
	});

	it('migrates a null or invalid currentName to null', () => {
		expect(migrateOutputsState({ currentName: null }, 0)).toEqual({ currentId: null });
		expect(migrateOutputsState({ currentName: -4 }, 0)).toEqual({ currentId: null });
		expect(migrateOutputsState(undefined, 0)).toEqual({ currentId: null });
	});

	it('persists only currentId', async () => {
		const backend = createMemoryStoreBackend();
		setStoreBackend(backend);
		await hydratePersistedStores([useOutputsStore]);
		outputs().showGenerated(makeRecord(id(8)));
		await flushPersistence();
		expect(backend.snapshot()['current-image-store']).toEqual({ state: { currentId: id(8) }, version: 1 });
	});
});

describe('outputsStore hooks', () => {
	const selections = [
		{ category_name: 'Main Style', prompt_text: 'Masterpiece, best quality', locked: true, induced_lora_ids: [] },
		{ category_name: 'Clothed', prompt_text: 'naked', locked: false, induced_lora_ids: [] },
	];

	it('matches sub-prompts of the current output by key equivalence', () => {
		useOutputsStore.setState({ currentId: id(1), record: makeRecord(id(1), { selections }) });
		const used = renderHook(() => useIsSubPromptInCurrentOutput('main-style', 'masterpiece-best-quality'));
		const unused = renderHook(() => useIsSubPromptInCurrentOutput('clothed', 'clothed'));
		const key = renderHook(() => useCurrentSelectionKey('clothed'));
		const none = renderHook(() => useCurrentSelectionKey('thighhighs'));

		expect(used.result.current).toBe(true);
		expect(unused.result.current).toBe(false);
		expect(key.result.current).toBe('naked');
		expect(none.result.current).toBeNull();
	});

	it('useCurrentOutputDetails resolves library names and is memoized', () => {
		useLibraryStore.setState({
			models: [{ id: 'model-a', name: 'Model A', path: 'a', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null }],
			loras: [{ id: 'alya', name: 'Alya', path: 'l', source: null }],
		});
		const { result, rerender } = renderHook(() => useCurrentOutputDetails());
		expect(result.current).toBeNull();

		useOutputsStore.setState({ currentId: id(1), record: makeRecord(id(1), {
				active_loras: [
					{ id: 'alya', weight: 0.6 },
					{ id: 'gone', weight: 1 },
				],
			}) });
		rerender();
		const details = result.current;
		expect(details).toMatchObject({ outputId: id(1), imageName: '0000000001.png', modelName: 'Model A', loras: [
			{ name: 'Alya', weight: 0.6 },
			{ name: 'gone', weight: 1 },
		] });

		useOutputsStore.setState({ loadingRecord: false });
		rerender();
		expect(result.current).toBe(details);
	});
});
