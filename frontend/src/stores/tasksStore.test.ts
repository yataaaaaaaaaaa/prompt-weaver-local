import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as taskSocket from '../api/taskSocket';
import type { DownloadTaskEvent, GenerationTaskEvent } from '../api/types';
import {
	downloadProgressOf,
	generationProgressOf,
	IDLE_GENERATION_PROGRESS,
	overallDownloadRatio,
	selectActiveDownloadCount,
	selectActiveDownloadRatio,
	selectActiveDownloads,
	selectDownloadEvent,
	selectGenerationEvent,
	TERMINAL_TASK_STAGES,
	useDownloadProgress,
	useGenerationProgress,
	useTasksStore,
} from './tasksStore';
import { downloadEvent as buildDownloadEvent } from '../test/modelLibraryData';

vi.mock('../api/taskSocket', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../api/taskSocket')>();
	return { ...actual, connectTaskSocket: vi.fn() };
});

class FakeSocket {
	public static instances: FakeSocket[] = [];
	public onopen: (() => void) | null = null;
	public onmessage: ((message: MessageEvent) => void) | null = null;
	public onclose: (() => void) | null = null;
	public closed = false;

	public constructor(public readonly url: string) {
		FakeSocket.instances.push(this);
	}

	public close(): void {
		this.closed = true;
		this.onclose?.();
	}

	public emit(event: unknown): void {
		this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent);
	}
}

const realConnect = (await vi.importActual<typeof import('../api/taskSocket')>('../api/taskSocket')).connectTaskSocket;

beforeEach(() => {
	FakeSocket.instances = [];
	// The real transport (reconnection included) over a fake WebSocket.
	vi.mocked(taskSocket.connectTaskSocket).mockImplementation((handlers) =>
		realConnect(handlers, { url: 'ws://test/ws/tasks', reconnectDelayMs: 1000, createSocket: (url) => new FakeSocket(url) as unknown as WebSocket }),
	);
});

afterEach(() => {
	useTasksStore.getState().disconnect();
	vi.useRealTimers();
});

const generationEvent = (overrides: Partial<GenerationTaskEvent> = {}): GenerationTaskEvent => ({
	type: 'generation',
	task_id: 'generation',
	stage: 'sampling',
	message: 'Sampling',
	current: 3,
	total: 30,
	...overrides,
});

const downloadEvent = buildDownloadEvent('d1', { title: 'Model', current: 1, total: 2 });

describe('tasksStore connection', () => {
	it('connects once, tracks the connection and applies socket events', () => {
		const tasks = useTasksStore.getState();
		tasks.connect();
		tasks.connect();
		expect(taskSocket.connectTaskSocket).toHaveBeenCalledTimes(1);

		const socket = FakeSocket.instances[0];
		socket.onopen?.();
		expect(useTasksStore.getState().connected).toBe(true);

		socket.emit(generationEvent());
		socket.emit(downloadEvent);
		expect(useTasksStore.getState().events).toEqual({ generation: generationEvent(), d1: downloadEvent });
	});

	it('reconnects after the socket drops until disconnect()', () => {
		vi.useFakeTimers();
		useTasksStore.getState().connect();
		const first = FakeSocket.instances[0];
		first.onopen?.();
		first.onclose?.();
		expect(useTasksStore.getState().connected).toBe(false);

		vi.advanceTimersByTime(1000);
		expect(FakeSocket.instances).toHaveLength(2);

		useTasksStore.getState().disconnect();
		expect(FakeSocket.instances[1].closed).toBe(true);
		vi.advanceTimersByTime(5000);
		expect(FakeSocket.instances).toHaveLength(2);
		expect(useTasksStore.getState().connected).toBe(false);

		useTasksStore.getState().connect();
		expect(FakeSocket.instances).toHaveLength(3);
	});

	it('keeps the latest event per task', () => {
		const tasks = useTasksStore.getState();
		tasks.applyEvent(generationEvent({ current: 1 }));
		tasks.applyEvent(generationEvent({ current: 2 }));
		expect(selectGenerationEvent(useTasksStore.getState())?.current).toBe(2);
		expect(Object.keys(useTasksStore.getState().events)).toEqual(['generation']);
	});
});

describe('generation progress', () => {
	it('derives ratio and activity from the generation event', () => {
		expect(generationProgressOf(null)).toBe(IDLE_GENERATION_PROGRESS);
		expect(generationProgressOf(generationEvent())).toEqual({
			stage: 'sampling',
			message: 'Sampling',
			current: 3,
			total: 30,
			ratio: 0.1,
			active: true,
			outcome: 'running',
			value: 0.1,
		});
		expect(generationProgressOf(generationEvent({ current: 40 })).ratio).toBe(1);
		expect(generationProgressOf(generationEvent({ current: -2 })).ratio).toBe(0);
		expect(generationProgressOf(generationEvent({ stage: 'loading_model', total: 0 }))).toMatchObject({ ratio: 0, active: true });
		for (const stage of ['loading_loras', 'saving'] as const) {
			expect(generationProgressOf(generationEvent({ stage })).active).toBe(true);
		}
		for (const stage of ['idle', 'complete', 'error', 'cancelled'] as const) {
			expect(generationProgressOf(generationEvent({ stage })).active).toBe(false);
		}
	});

	it('maps every stage to its outcome and progress bar fill', () => {
		const cases = [
			// stage, current, total, outcome, value
			['idle', 0, 0, 'idle', 0],
			['loading_model', 0, 0, 'running', undefined],
			['loading_loras', 0, 0, 'running', undefined],
			['sampling', 0, 0, 'running', undefined],
			['sampling', 5, 12, 'running', 5 / 12],
			['saving', 0, 0, 'running', 1],
			['complete', 12, 12, 'complete', 1],
			['error', 0, 0, 'error', 1],
			['cancelled', 0, 0, 'cancelled', 1],
		] as const;
		for (const [stage, current, total, outcome, value] of cases) {
			expect(generationProgressOf(generationEvent({ stage, current, total })), stage).toMatchObject({ outcome, value, active: outcome === 'running' });
		}
		expect(IDLE_GENERATION_PROGRESS).toMatchObject({ outcome: 'idle', value: 0, active: false });
	});

	it('useGenerationProgress follows the store and is memoized on the event', () => {
		const { result, rerender } = renderHook(() => useGenerationProgress());
		expect(result.current).toBe(IDLE_GENERATION_PROGRESS);

		act(() => useTasksStore.getState().applyEvent(generationEvent()));
		const progress = result.current;
		expect(progress).toMatchObject({ stage: 'sampling', ratio: 0.1, active: true });

		act(() => useTasksStore.getState().applyEvent(downloadEvent));
		rerender();
		expect(result.current).toBe(progress);
	});
});

const download = (overrides: Partial<DownloadTaskEvent> = {}): DownloadTaskEvent => ({ ...downloadEvent, ...overrides });

describe('download progress', () => {
	it('derives the progress view model of a download event', () => {
		expect(downloadProgressOf(null)).toBeNull();
		expect(downloadProgressOf(download({ current: 512, total: 2048 }))).toEqual({
			stage: 'downloading',
			title: 'Model',
			message: '',
			current: 512,
			total: 2048,
			ratio: 0.25,
			active: true,
		});
		expect(downloadProgressOf(download({ current: 10, total: 0 }))?.ratio).toBeNull();
		expect(downloadProgressOf(download({ current: 9, total: 4 }))?.ratio).toBe(1);
		expect(downloadProgressOf(download({ stage: 'queued', current: 0 }))?.active).toBe(true);
		for (const stage of ['complete', 'error', 'cancelled'] as const) {
			expect(downloadProgressOf(download({ stage }))?.active).toBe(false);
		}
	});

	it('selects the download event of a task only', () => {
		const tasks = useTasksStore.getState();
		tasks.applyEvent(generationEvent());
		tasks.applyEvent(downloadEvent);
		const state = useTasksStore.getState();
		expect(selectDownloadEvent('d1')(state)).toBe(downloadEvent);
		expect(selectDownloadEvent('generation')(state)).toBeNull();
		expect(selectDownloadEvent('unknown')(state)).toBeNull();
		expect(selectDownloadEvent(null)(state)).toBeNull();
	});

	it('useDownloadProgress follows one task and is memoized on its event', () => {
		const { result, rerender } = renderHook(({ taskId }) => useDownloadProgress(taskId), { initialProps: { taskId: 'd1' as string | null } });
		expect(result.current).toBeNull();

		act(() => useTasksStore.getState().applyEvent(downloadEvent));
		const progress = result.current;
		expect(progress).toMatchObject({ title: 'Model', ratio: 0.5, active: true });

		act(() => useTasksStore.getState().applyEvent(download({ task_id: 'd2' })));
		act(() => useTasksStore.getState().applyEvent(generationEvent()));
		rerender({ taskId: 'd1' });
		expect(result.current).toBe(progress);

		act(() => useTasksStore.getState().applyEvent(download({ stage: 'complete', current: 2 })));
		expect(result.current).toMatchObject({ stage: 'complete', ratio: 1, active: false });

		rerender({ taskId: null });
		expect(result.current).toBeNull();
	});
});

describe('waitForTask', () => {
	it('knows the terminal stages', () => {
		expect([...TERMINAL_TASK_STAGES]).toEqual(['complete', 'error', 'cancelled']);
	});

	it('resolves immediately when the latest event already is terminal', async () => {
		const done = download({ stage: 'complete', current: 2 });
		useTasksStore.getState().applyEvent(done);
		await expect(useTasksStore.getState().waitForTask('d1')).resolves.toBe(done);
	});

	it('resolves with the first terminal event of the task, ignoring other events, then unsubscribes', async () => {
		const realSubscribe = useTasksStore.subscribe;
		const unsubscribe = vi.fn();
		vi.spyOn(useTasksStore, 'subscribe').mockImplementation((listener) => {
			unsubscribe.mockImplementation(realSubscribe(listener));
			return unsubscribe;
		});
		const settled = vi.fn();
		const waiting = useTasksStore.getState().waitForTask('d1').then(settled);
		const tasks = useTasksStore.getState();

		tasks.applyEvent(download({ stage: 'queued', current: 0 }));
		tasks.applyEvent(downloadEvent);
		tasks.applyEvent(download({ task_id: 'other', stage: 'error', message: 'not this one' }));
		tasks.applyEvent(generationEvent({ stage: 'complete' }));
		await Promise.resolve();
		expect(settled).not.toHaveBeenCalled();
		expect(unsubscribe).not.toHaveBeenCalled();

		const failed = download({ stage: 'error', message: 'Hash mismatch' });
		tasks.applyEvent(failed);
		expect(unsubscribe).toHaveBeenCalledTimes(1);
		tasks.applyEvent(download({ stage: 'complete' }));
		await waiting;
		expect(settled).toHaveBeenCalledTimes(1);
		expect(settled).toHaveBeenCalledWith(failed);
	});

	it('resolves on events delivered by the task socket (e.g. the snapshot after a reconnect)', async () => {
		const waiting = useTasksStore.getState().waitForTask('d1');
		useTasksStore.getState().connect();
		FakeSocket.instances[0].emit(download({ stage: 'cancelled', message: 'Cancelled' }));
		await expect(waiting).resolves.toMatchObject({ task_id: 'd1', stage: 'cancelled' });
	});
});

describe('active downloads', () => {
	it('lists the queued and downloading downloads only, and counts them', () => {
		const tasks = useTasksStore.getState();
		tasks.applyEvent(generationEvent());
		tasks.applyEvent(buildDownloadEvent('a', { stage: 'queued' }));
		tasks.applyEvent(buildDownloadEvent('b', { stage: 'downloading' }));
		tasks.applyEvent(buildDownloadEvent('c', { stage: 'complete' }));
		tasks.applyEvent(buildDownloadEvent('d', { stage: 'error' }));
		tasks.applyEvent(buildDownloadEvent('e', { stage: 'cancelled' }));

		const state = useTasksStore.getState();
		expect(selectActiveDownloads(state).map((event) => event.task_id)).toEqual(['a', 'b']);
		expect(selectActiveDownloadCount(state)).toBe(2);
	});

	it('is referentially stable until an event arrives', () => {
		useTasksStore.getState().applyEvent(buildDownloadEvent('a'));
		const first = selectActiveDownloads(useTasksStore.getState());
		expect(selectActiveDownloads(useTasksStore.getState())).toBe(first);

		useTasksStore.getState().applyEvent(buildDownloadEvent('a', { stage: 'complete' }));
		expect(selectActiveDownloads(useTasksStore.getState())).toEqual([]);
		expect(selectActiveDownloadCount(useTasksStore.getState())).toBe(0);
	});

	it('sums the progress of the downloads whose size is known', () => {
		const sized = (taskId: string, current: number, total: number) => buildDownloadEvent(taskId, { current, total });
		expect(overallDownloadRatio([])).toBeUndefined();
		expect(overallDownloadRatio([sized('a', 5, 0)])).toBeUndefined();
		expect(overallDownloadRatio([sized('a', 1, 4), sized('b', 3, 4), sized('c', 9, 0)])).toBe(0.5);
		expect(overallDownloadRatio([sized('a', 9, 4)])).toBe(1);

		useTasksStore.getState().applyEvent(sized('a', 1, 4));
		useTasksStore.getState().applyEvent(buildDownloadEvent('b', { stage: 'complete', current: 4, total: 4 }));
		expect(selectActiveDownloadRatio(useTasksStore.getState())).toBe(0.25);
	});
});
