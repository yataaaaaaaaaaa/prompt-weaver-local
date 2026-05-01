import type {
	BootstrapResponse,
	GenerateRequest,
	GenerateResponse,
	OutputRecord,
	OutputSummary,
	ProgressEvent,
} from './types';

const API_BASE = 'http://127.0.0.1:8000/api';
const WS_BASE = 'ws://127.0.0.1:8000/ws/progress';

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${API_BASE}${path}`, {
		headers: {
			'Content-Type': 'application/json',
			...(init?.headers ?? {}),
		},
		...init,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text || `Request failed: ${response.status}`);
	}

	return (await response.json()) as T;
}

export const api = {
	bootstrap: () => jsonRequest<BootstrapResponse>('/bootstrap'),
	listOutputs: () => jsonRequest<OutputSummary[]>('/outputs'),
	getOutput: (outputId: string) => jsonRequest<OutputRecord>(`/outputs/${outputId}`),
	trashOutput: (outputId: string) =>
		jsonRequest<{ ok: boolean }>(`/outputs/${outputId}/trash`, {
			method: 'POST',
		}),
	restoreOutput: (outputId: string) =>
		jsonRequest<{ ok: boolean }>(`/trash/${outputId}/restore`, {
			method: 'POST',
		}),
	generate: (request: GenerateRequest, signal?: AbortSignal) =>
		jsonRequest<GenerateResponse>('/generate', {
			method: 'POST',
			body: JSON.stringify(request),
			signal,
		}),
	cancelGeneration: () =>
		jsonRequest<{ ok: boolean }>('/generate/cancel', {
			method: 'POST',
		}),
	connectProgress(onEvent: (event: ProgressEvent) => void): () => void {
		const socket = new WebSocket(WS_BASE);
		socket.onmessage = (message) => {
			try {
				onEvent(JSON.parse(message.data) as ProgressEvent);
			} catch {
				// ignore malformed progress events
			}
		};
		return () => socket.close();
	},
};
