// WebSocket transport of the backend's live messages (/ws/tasks) with automatic reconnection: background task events
// (TaskEvent: generation, downloads) and the co-writer's events (CodexEvent, `type` 'codex'). The socket names this
// window (`clientId`, src/api/clientId.ts) so the co-writer's tool calls reach the window that sent the message.
// Only the tasks store (src/stores/tasksStore.ts) uses this; components never open sockets.
import { TASKS_WS_URL } from './config';
import type { CodexEvent, CodexEventKind, TaskEvent, TaskEventType } from './types';

const KNOWN_EVENT_TYPES: ReadonlySet<TaskEventType> = new Set<TaskEventType>(['generation', 'download']);
const CODEX_EVENT_KINDS: Readonly<Record<CodexEventKind, true>> = {
	status: true,
	conversation: true,
	entry: true,
	delta: true,
	tool_call: true,
	tool_cancel: true,
};

export type TaskSocketHandlers = {
	onEvent: (event: TaskEvent) => void;
	onCodexEvent?: (event: CodexEvent) => void;
	onConnectionChange?: (connected: boolean) => void;
};

export type TaskSocketOptions = {
	url?: string;
	/** The window's id, sent as `client_id`. */
	clientId?: string;
	reconnectDelayMs?: number;
	/** Injected in tests. */
	createSocket?: (url: string) => WebSocket;
};

function parseJson(data: unknown): Record<string, unknown> | null {
	if (typeof data !== 'string') {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(data);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Parses one message; returns null for malformed or unknown task events. */
export function parseTaskEvent(data: unknown): TaskEvent | null {
	const parsed = parseJson(data);
	if (!parsed || !KNOWN_EVENT_TYPES.has(parsed.type as TaskEventType)) {
		return null;
	}
	if (typeof parsed.task_id !== 'string' || typeof parsed.stage !== 'string') {
		return null;
	}
	return parsed as unknown as TaskEvent;
}

/** Parses one co-writer message; null for anything else (the backend validated its shape). */
export function parseCodexEvent(data: unknown): CodexEvent | null {
	const parsed = parseJson(data);
	if (!parsed || parsed.type !== 'codex' || typeof parsed.kind !== 'string' || !Object.hasOwn(CODEX_EVENT_KINDS, parsed.kind)) {
		return null;
	}
	return parsed as unknown as CodexEvent;
}

function socketUrl(url: string, clientId: string | undefined): string {
	return clientId ? `${url}${url.includes('?') ? '&' : '?'}client_id=${encodeURIComponent(clientId)}` : url;
}

/** Opens the socket and keeps it open until the returned disconnect function is called. */
export function connectTaskSocket(handlers: TaskSocketHandlers, options: TaskSocketOptions = {}): () => void {
	const url = socketUrl(options.url ?? TASKS_WS_URL, options.clientId);
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
				return;
			}
			const codexEvent = parseCodexEvent(message.data);
			if (codexEvent) {
				handlers.onCodexEvent?.(codexEvent);
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
