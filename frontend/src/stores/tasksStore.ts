// Background tasks store: latest TaskEvent per task, fed by the /ws/tasks socket (src/api/taskSocket.ts).
// Generation progress and (batch 2) download progress are read from here. Not persisted.
import { useMemo } from 'react';
import { create } from 'zustand';
import { connectTaskSocket } from '../api/taskSocket';
import type { GenerationStage, GenerationTaskEvent, TaskEvent } from '../api/types';

export type TasksState = {
	/** Latest event per task_id. */
	events: Record<string, TaskEvent>;
	connected: boolean;
};

export type TasksActions = {
	/** Opens the socket (idempotent); reconnects automatically until disconnect(). */
	connect: () => void;
	disconnect: () => void;
	applyEvent: (event: TaskEvent) => void;
};

export type TasksStore = TasksState & TasksActions;

/** Closes the open socket; null while disconnected. */
let closeSocket: (() => void) | null = null;

export const useTasksStore = create<TasksStore>()((set, get) => ({
	events: {},
	connected: false,
	connect: () => {
		if (closeSocket) {
			return;
		}
		closeSocket = connectTaskSocket({
			onEvent: (event) => get().applyEvent(event),
			onConnectionChange: (connected) => set({ connected }),
		});
	},
	disconnect: () => {
		const close = closeSocket;
		closeSocket = null;
		close?.();
		set({ connected: false });
	},
	applyEvent: (event) => set((state) => ({ events: { ...state.events, [event.task_id]: event } })),
}));

export const selectGenerationEvent = (state: TasksState): GenerationTaskEvent | null => {
	const event = Object.values(state.events).find((item): item is GenerationTaskEvent => item.type === 'generation');
	return event ?? null;
};

export type GenerationProgress = {
	stage: GenerationStage | null;
	message: string;
	current: number;
	total: number;
	/** 0..1 */
	ratio: number;
	/** loading_model | loading_loras | sampling | saving */
	active: boolean;
};

const ACTIVE_GENERATION_STAGES: ReadonlySet<GenerationStage> = new Set<GenerationStage>([
	'loading_model',
	'loading_loras',
	'sampling',
	'saving',
]);

export const IDLE_GENERATION_PROGRESS: GenerationProgress = { stage: null, message: '', current: 0, total: 0, ratio: 0, active: false };

/** Progress view model of a generation event (null = no generation seen yet). */
export function generationProgressOf(event: GenerationTaskEvent | null): GenerationProgress {
	if (!event) {
		return IDLE_GENERATION_PROGRESS;
	}
	const ratio = event.total > 0 ? Math.max(0, Math.min(1, event.current / event.total)) : 0;
	return {
		stage: event.stage,
		message: event.message,
		current: event.current,
		total: event.total,
		ratio,
		active: ACTIVE_GENERATION_STAGES.has(event.stage),
	};
}

/** Generation progress for progress bars (one shared derivation, memoized on the generation event). */
export function useGenerationProgress(): GenerationProgress {
	const event = useTasksStore(selectGenerationEvent);
	return useMemo(() => generationProgressOf(event), [event]);
}
