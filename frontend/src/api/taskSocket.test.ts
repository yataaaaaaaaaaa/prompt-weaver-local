import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectTaskSocket, parseCodexEvent, parseTaskEvent } from './taskSocket';

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

	public emit(data: unknown): void {
		this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
	}
}

const createSocket = (url: string) => new FakeSocket(url) as unknown as WebSocket;

afterEach(() => {
	FakeSocket.instances = [];
	vi.useRealTimers();
});

describe('parseTaskEvent', () => {
	it('accepts known task events', () => {
		const event = { type: 'generation', task_id: 'generation', stage: 'sampling', message: '', current: 3, total: 30 };
		expect(parseTaskEvent(JSON.stringify(event))).toEqual(event);
	});

	it('rejects malformed or unknown messages', () => {
		expect(parseTaskEvent('not json')).toBeNull();
		expect(parseTaskEvent(JSON.stringify({ type: 'unknown', task_id: 'x', stage: 'idle' }))).toBeNull();
		expect(parseTaskEvent(JSON.stringify({ type: 'generation', stage: 'idle' }))).toBeNull();
		expect(parseTaskEvent(42)).toBeNull();
	});
});

describe('connectTaskSocket', () => {
	it('forwards parsed events and connection changes', () => {
		const onEvent = vi.fn();
		const onConnectionChange = vi.fn();
		connectTaskSocket({ onEvent, onConnectionChange }, { url: 'ws://test/ws/tasks', createSocket });
		const socket = FakeSocket.instances[0];

		socket.onopen?.();
		socket.emit({ type: 'download', task_id: 'd1', stage: 'downloading', message: '', current: 1, total: 2 });
		socket.emit('garbage');

		expect(socket.url).toBe('ws://test/ws/tasks');
		expect(onConnectionChange).toHaveBeenCalledWith(true);
		expect(onEvent).toHaveBeenCalledTimes(1);
		expect(onEvent.mock.calls[0][0]).toMatchObject({ type: 'download', task_id: 'd1' });
	});

	it('reconnects after an unexpected close but not after disconnect', () => {
		vi.useFakeTimers();
		const disconnect = connectTaskSocket({ onEvent: vi.fn() }, { createSocket, reconnectDelayMs: 100 });

		FakeSocket.instances[0].onclose?.();
		vi.advanceTimersByTime(100);
		expect(FakeSocket.instances).toHaveLength(2);

		disconnect();
		vi.advanceTimersByTime(1000);
		expect(FakeSocket.instances).toHaveLength(2);
		expect(FakeSocket.instances[1].closed).toBe(true);
	});
});

describe('co-writer events', () => {
	const delta = { type: 'codex', kind: 'delta', conversation_id: 'cnv-000000000001', entry_id: 'a', delta: 'Hi' };

	it('parses codex events of a known kind only', () => {
		expect(parseCodexEvent(JSON.stringify(delta))).toEqual(delta);
		expect(parseCodexEvent(JSON.stringify({ ...delta, kind: 'unknown' }))).toBeNull();
		expect(parseCodexEvent(JSON.stringify({ ...delta, kind: 'toString' }))).toBeNull();
		expect(parseCodexEvent(JSON.stringify({ type: 'generation', task_id: 'generation', stage: 'idle' }))).toBeNull();
		expect(parseCodexEvent('[]')).toBeNull();
		expect(parseTaskEvent(JSON.stringify(delta))).toBeNull();
	});

	it('names the window and hands codex events to their own handler', () => {
		const onEvent = vi.fn();
		const onCodexEvent = vi.fn();
		connectTaskSocket({ onEvent, onCodexEvent }, { url: 'ws://test/ws/tasks', clientId: 'window-1234', createSocket });
		const socket = FakeSocket.instances[0];

		socket.emit(delta);
		socket.emit({ type: 'generation', task_id: 'generation', stage: 'idle', message: '', current: 0, total: 0 });

		expect(socket.url).toBe('ws://test/ws/tasks?client_id=window-1234');
		expect(onCodexEvent).toHaveBeenCalledWith(delta);
		expect(onEvent).toHaveBeenCalledTimes(1);
	});
});
