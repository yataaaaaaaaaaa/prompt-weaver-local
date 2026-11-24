import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as taskSocket from '../api/taskSocket';
import type { DownloadTaskEvent, GenerationTaskEvent } from '../api/types';
import { generationProgressOf, IDLE_GENERATION_PROGRESS, selectGenerationEvent, useGenerationProgress, useTasksStore } from './tasksStore';

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

const downloadEvent: DownloadTaskEvent = { type: 'download', task_id: 'd1', stage: 'downloading', message: '', current: 1, total: 2 };

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
