import { describe, expect, it, vi } from 'vitest';
import type { SeedSnapshot } from '../domain/seeds';
import { useGenerationSettingsStore } from './generationSettingsStore';
import { useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { selectCanUndo, UNDO_LIMIT, useUndoStore, type UndoEntry } from './undoStore';

const seeds: SeedSnapshot = {
	promptSeedInput: '94',
	seedInput: '689303569',
	promptSeedBehavior: 'increment',
	imageSeedBehavior: 'increment',
	promptCategorySeedState: { main: { seed: 4, remaining: 2, prompt_count: 2 } },
};

const undo = () => useUndoStore.getState();

describe('undoStore', () => {
	it('push keeps the latest UNDO_LIMIT entries', () => {
		for (let index = 0; index < UNDO_LIMIT + 5; index += 1) {
			undo().push({ type: 'delete-output', outputId: String(index) });
		}
		expect(undo().entries).toHaveLength(UNDO_LIMIT);
		expect(undo().entries[0]).toEqual({ type: 'delete-output', outputId: '5' });
		expect(selectCanUndo(undo())).toBe(true);
		undo().clear();
		expect(selectCanUndo(undo())).toBe(false);
	});

	it('undoes a generation: shows the previous output and restores the seed settings', async () => {
		const select = vi.fn(async () => undefined);
		const applySeedSnapshot = vi.fn();
		useOutputsStore.setState({ select });
		useGenerationSettingsStore.setState({ applySeedSnapshot });
		undo().push({ type: 'generate', previousOutputId: '0000000111', seeds });

		await undo().undo();

		expect(select).toHaveBeenCalledWith('0000000111');
		expect(applySeedSnapshot).toHaveBeenCalledWith(seeds);
		expect(undo().entries).toEqual([]);
	});

	it('restores the seed settings through the real settings store', async () => {
		useOutputsStore.setState({ select: vi.fn(async () => undefined) });
		undo().push({ type: 'generate', previousOutputId: null, seeds });
		await undo().undo();
		expect(useGenerationSettingsStore.getState()).toMatchObject(seeds);
	});

	it('undoes a deletion by restoring the output', async () => {
		const restore = vi.fn(async () => undefined);
		useOutputsStore.setState({ restore });
		undo().push({ type: 'delete-output', outputId: '0000000112' });

		await undo().undo();

		expect(restore).toHaveBeenCalledWith('0000000112');
		expect(undo().entries).toEqual([]);
	});

	it('keeps the entry and reports when reverting fails', async () => {
		useOutputsStore.setState({ restore: vi.fn(async () => Promise.reject(new Error('not in trash'))) });
		undo().push({ type: 'delete-output', outputId: '0000000112' });

		await undo().undo();

		expect(undo().entries).toHaveLength(1);
		expect(useNotificationsStore.getState().notifications).toMatchObject([{ intent: 'error', title: 'Undo failed', message: 'not in trash' }]);
	});

	it('is a no-op when empty and serializes repeated undos', async () => {
		await undo().undo();

		const restored: string[] = [];
		useOutputsStore.setState({
			restore: vi.fn(async (outputId: string) => {
				await new Promise((resolve) => setTimeout(resolve, 1));
				restored.push(outputId);
			}),
		});
		undo().push({ type: 'delete-output', outputId: 'a' });
		undo().push({ type: 'delete-output', outputId: 'b' });

		await Promise.all([undo().undo(), undo().undo()]);

		expect(restored).toEqual(['b', 'a']);
		expect(undo().entries).toEqual([]);
	});

	it('pops the reverted entry even when a newer entry was pushed meanwhile', async () => {
		let finish!: () => void;
		useOutputsStore.setState({
			restore: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						finish = resolve;
					}),
			),
		});
		undo().push({ type: 'delete-output', outputId: 'a' });
		const undoing = undo().undo();
		await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
		const newer: UndoEntry = { type: 'delete-output', outputId: 'b' };
		undo().push(newer);
		finish();
		await undoing;
		expect(undo().entries).toEqual([newer]);
	});
});
