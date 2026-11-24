// WebSocket transport of background task events (/ws/tasks) with automatic reconnection.
// Only the tasks store (src/stores/tasksStore.ts) uses this; components never open sockets.
import { TASKS_WS_URL } from './config';
import type { TaskEvent, TaskEventType } from './types';

const KNOWN_EVENT_TYPES: ReadonlySet<TaskEventType> = new Set<TaskEventType>(['generation', 'download']);

export type TaskSocketHandlers = {
	onEvent: (event: TaskEvent) => void;
	onConnectionChange?: (connected: boolean) => void;
};

export type TaskSocketOptions = {
	url?: string;
	reconnectDelayMs?: number;
	/** Injected in tests. */
	createSocket?: (url: string) => WebSocket;
};

/** Parses one message; returns null for malformed or unknown events. */
export function parseTaskEvent(data: unknown): TaskEvent | null {
	if (typeof data !== 'string') {
		return null;
	}
	try {
		const parsed = JSON.parse(data) as Partial<TaskEvent> | null;
		if (!parsed || typeof parsed !== 'object' || !KNOWN_EVENT_TYPES.has(parsed.type as TaskEventType)) {
			return null;
		}
		if (typeof parsed.task_id !== 'string' || typeof parsed.stage !== 'string') {
			return null;
		}
		return parsed as TaskEvent;
	} catch {
		return null;
	}
}

/** Opens the socket and keeps it open until the returned disconnect function is called. */
export function connectTaskSocket(handlers: TaskSocketHandlers, options: TaskSocketOptions = {}): () => void {
	const url = options.url ?? TASKS_WS_URL;
	const reconnectDelayMs = options.reconnectDelayMs ?? 1000;
	const createSocket = options.createSocket ?? ((target: string) => new WebSocket(target));
	let socket: WebSocket | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let closedByClient = false;

	const open = () => {
		socket = createSocket(url);
		socket.onopen = () => handlers.onConnectionChange?.(true);
		socket.onmessage = (message: MessageEvent) => {
			const event = parseTaskEvent(message.data);
			if (event) {
				handlers.onEvent(event);
			}
		};
		socket.onclose = () => {
			handlers.onConnectionChange?.(false);
			socket = null;
			if (!closedByClient) {
				reconnectTimer = setTimeout(open, reconnectDelayMs);
			}
		};
	};

	open();

	return () => {
		closedByClient = true;
		if (reconnectTimer != null) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		socket?.close();
		socket = null;
	};
}
