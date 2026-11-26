// Background tasks store: latest TaskEvent per task, fed by the /ws/tasks socket (src/api/taskSocket.ts).
// Generation progress and download progress are read from here. Not persisted.
import { useMemo } from 'react';
import { create } from 'zustand';
import { connectTaskSocket } from '../api/taskSocket';
import type { DownloadStage, DownloadTaskEvent, GenerationStage, GenerationTaskEvent, TaskEvent } from '../api/types';

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
	/** Resolves with the first terminal event (stage complete | error | cancelled) of `taskId`: immediately when the
	 *  latest known event already is one, else when it arrives (also through the snapshot sent on reconnect).
	 *  Never rejects; pending waits stay pending until the event arrives. */
	waitForTask: (taskId: string) => Promise<TaskEvent>;
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
	waitForTask: (taskId) => {
		const latest = get().events[taskId];
		if (isTerminal(latest)) {
			return Promise.resolve(latest);
		}
		return new Promise<TaskEvent>((resolve) => {
			const unsubscribe = useTasksStore.subscribe((state) => {
				const event = state.events[taskId];
				if (isTerminal(event)) {
					unsubscribe();
					resolve(event);
				}
			});
		});
	},
}));

/** The event ends its task (TERMINAL_TASK_STAGES). */
function isTerminal(event: TaskEvent | undefined): event is TaskEvent {
	return event !== undefined && TERMINAL_TASK_STAGES.has(event.stage);
}

export const selectGenerationEvent = (state: TasksState): GenerationTaskEvent | null => {
	const event = Object.values(state.events).find((item): item is GenerationTaskEvent => item.type === 'generation');
	return event ?? null;
};

/** How the latest generation stands: nothing yet / idle, running, or its terminal outcome. */
export type GenerationOutcome = 'idle' | 'running' | 'complete' | 'error' | 'cancelled';

export type GenerationProgress = {
	stage: GenerationStage | null;
	message: string;
	current: number;
	total: number;
	/** 0..1 */
	ratio: number;
	/** loading_model | loading_loras | sampling | saving */
	active: boolean;
	outcome: GenerationOutcome;
	/** Fill of a progress bar (0..1); undefined = indeterminate (loading, step count not known yet). Saving and complete
	 *  are full; error and cancelled are full too so their status color shows (the bar never ends up empty and
	 *  colorless after a failure). */
	value: number | undefined;
};

const ACTIVE_GENERATION_STAGES: ReadonlySet<GenerationStage> = new Set<GenerationStage>([
	'loading_model',
	'loading_loras',
	'sampling',
	'saving',
]);

const TERMINAL_GENERATION_OUTCOMES: Readonly<Partial<Record<GenerationStage, GenerationOutcome>>> = {
	complete: 'complete',
	error: 'error',
	cancelled: 'cancelled',
};

export const IDLE_GENERATION_PROGRESS: GenerationProgress = {
	stage: null,
	message: '',
	current: 0,
	total: 0,
	ratio: 0,
	active: false,
	outcome: 'idle',
	value: 0,
};

function generationOutcomeOf(stage: GenerationStage): GenerationOutcome {
	return ACTIVE_GENERATION_STAGES.has(stage) ? 'running' : (TERMINAL_GENERATION_OUTCOMES[stage] ?? 'idle');
}

function progressValueOf(stage: GenerationStage, outcome: GenerationOutcome, total: number, ratio: number): number | undefined {
	if (outcome === 'idle') {
		return 0;
	}
	if (outcome !== 'running' || stage === 'saving') {
		return 1;
	}
	return total > 0 ? ratio : undefined;
}

/** Progress view model of a generation event (null = no generation seen yet). */
export function generationProgressOf(event: GenerationTaskEvent | null): GenerationProgress {
	if (!event) {
		return IDLE_GENERATION_PROGRESS;
	}
	const ratio = event.total > 0 ? Math.max(0, Math.min(1, event.current / event.total)) : 0;
	const outcome = generationOutcomeOf(event.stage);
	return {
		stage: event.stage,
		message: event.message,
		current: event.current,
		total: event.total,
		ratio,
		active: outcome === 'running',
		outcome,
		value: progressValueOf(event.stage, outcome, event.total, ratio),
	};
}

/** Generation progress for progress bars (one shared derivation, memoized on the generation event). */
export function useGenerationProgress(): GenerationProgress {
	const event = useTasksStore(selectGenerationEvent);
	return useMemo(() => generationProgressOf(event), [event]);
}

// ---------------------------------------------------------------------------
// Downloads (DownloadTaskEvent: current/total are bytes, total 0 = unknown size)
// ---------------------------------------------------------------------------

export const TERMINAL_TASK_STAGES: ReadonlySet<TaskEvent['stage']> = new Set<TaskEvent['stage']>(['complete', 'error', 'cancelled']);

export type DownloadProgress = {
	stage: DownloadStage;
	title: string;
	message: string;
	/** Bytes received / expected (0 = unknown). */
	current: number;
	total: number;
	/** 0..1, null while the size is unknown. */
	ratio: number | null;
	/** queued | downloading */
	active: boolean;
};

const ACTIVE_DOWNLOAD_STAGES: ReadonlySet<DownloadStage> = new Set<DownloadStage>(['queued', 'downloading']);

/** Progress view model of a download event (null = no event). */
export function downloadProgressOf(event: DownloadTaskEvent | null): DownloadProgress | null {
	if (!event) {
		return null;
	}
	return {
		stage: event.stage,
		title: event.title,
		message: event.message,
		current: event.current,
		total: event.total,
		ratio: event.total > 0 ? Math.max(0, Math.min(1, event.current / event.total)) : null,
		active: ACTIVE_DOWNLOAD_STAGES.has(event.stage),
	};
}

/** Display name of a download task (DownloadTaskEvent.title, from the backend; '' for another task type). */
export function downloadTitleOf(event: TaskEvent): string {
	return event.type === 'download' ? event.title : '';
}

export const selectDownloadEvent =
	(taskId: string | null) =>
	(state: TasksState): DownloadTaskEvent | null => {
		const event = taskId == null ? undefined : state.events[taskId];
		return event?.type === 'download' ? event : null;
	};

/** Progress of one download task (memoized on its event); null without task id or event. */
export function useDownloadProgress(taskId: string | null): DownloadProgress | null {
	const event = useTasksStore(useMemo(() => selectDownloadEvent(taskId), [taskId]));
	return useMemo(() => downloadProgressOf(event), [event]);
}

const NO_DOWNLOADS: DownloadTaskEvent[] = [];
let activeDownloadsMemo: { events: Record<string, TaskEvent>; active: DownloadTaskEvent[] } | null = null;

/** Every download still running (queued or downloading), whatever started it (model library installs, "Use these
 *  LoRAs", IP-Adapter files), in task order. Memoized on the events record: referentially stable between events. */
export const selectActiveDownloads = (state: TasksState): DownloadTaskEvent[] => {
	if (activeDownloadsMemo?.events !== state.events) {
		const active = Object.values(state.events).filter(
			(event): event is DownloadTaskEvent => event.type === 'download' && ACTIVE_DOWNLOAD_STAGES.has(event.stage),
		);
		activeDownloadsMemo = { events: state.events, active: active.length > 0 ? active : NO_DOWNLOADS };
	}
	return activeDownloadsMemo.active;
};

/** How many downloads are running (the Models navigation badge, the shell's download indicator). */
export const selectActiveDownloadCount = (state: TasksState): number => selectActiveDownloads(state).length;

/** Overall progress of several downloads (0..1): received bytes over expected bytes of those whose size is known;
 *  undefined (indeterminate) while no size is known. */
export function overallDownloadRatio(downloads: readonly DownloadTaskEvent[]): number | undefined {
	const sized = downloads.filter((event) => event.total > 0);
	if (sized.length === 0) {
		return undefined;
	}
	const current = sized.reduce((sum, event) => sum + Math.min(event.current, event.total), 0);
	const total = sized.reduce((sum, event) => sum + event.total, 0);
	return Math.max(0, Math.min(1, current / total));
}

/** Overall progress of the running downloads (the rail's downloads indicator); undefined while no size is known. */
export const selectActiveDownloadRatio = (state: TasksState): number | undefined => overallDownloadRatio(selectActiveDownloads(state));

export function useActiveDownloadCount(): number {
	return useTasksStore(selectActiveDownloadCount);
}
