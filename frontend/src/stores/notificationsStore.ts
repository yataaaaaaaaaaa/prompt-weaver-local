// Notifications domain: the single place where user-facing errors/warnings/info live.
// Every store reports problems through `notify` / `reportError`; the NotificationsHost view renders them.
import { create } from 'zustand';

export type NotificationIntent = 'error' | 'warning' | 'success' | 'info';

export type AppNotification = {
	id: number;
	intent: NotificationIntent;
	title: string | null;
	message: string;
};

export type NotifyOptions = {
	title?: string;
	/** Auto-dismiss delay; errors and warnings stay until dismissed when omitted. */
	timeoutMs?: number;
};

export type NotificationsState = {
	notifications: AppNotification[];
};

export type NotificationsActions = {
	/** Shows a notification and returns its id. A notification identical to the latest one shown
	 *  (same intent, title and message) is not repeated: the latest one is kept (its auto-dismiss
	 *  delay restarts) and its id is returned. */
	notify: (intent: NotificationIntent, message: string, options?: NotifyOptions) => number;
	dismiss: (id: number) => void;
	clear: () => void;
};

export type NotificationsStore = NotificationsState & NotificationsActions;

export const DEFAULT_TIMEOUT_MS: Record<NotificationIntent, number | null> = {
	error: null,
	warning: null,
	success: 4000,
	info: 4000,
};

let nextId = 1;
/** Pending auto-dismiss timers by notification id. */
const dismissTimers = new Map<number, ReturnType<typeof setTimeout>>();

function cancelTimer(id: number): void {
	const timer = dismissTimers.get(id);
	if (timer !== undefined) {
		clearTimeout(timer);
		dismissTimers.delete(id);
	}
}

export const useNotificationsStore = create<NotificationsStore>()((set, get) => {
	const scheduleDismiss = (id: number, timeoutMs: number | null) => {
		cancelTimer(id);
		if (timeoutMs != null) {
			dismissTimers.set(
				id,
				setTimeout(() => {
					dismissTimers.delete(id);
					get().dismiss(id);
				}, timeoutMs),
			);
		}
	};

	return {
		notifications: [],
		notify: (intent, message, options = {}) => {
			const title = options.title ?? null;
			const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[intent];
			const notifications = get().notifications;
			const latest = notifications[notifications.length - 1];
			if (latest && latest.intent === intent && latest.title === title && latest.message === message) {
				scheduleDismiss(latest.id, timeoutMs);
				return latest.id;
			}
			const id = nextId++;
			set((state) => ({ notifications: [...state.notifications, { id, intent, title, message }] }));
			scheduleDismiss(id, timeoutMs);
			return id;
		},
		dismiss: (id) => {
			cancelTimer(id);
			set((state) => ({ notifications: state.notifications.filter((item) => item.id !== id) }));
		},
		clear: () => {
			for (const id of dismissTimers.keys()) {
				cancelTimer(id);
			}
			set({ notifications: [] });
		},
	};
});

export function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message || error.name;
	}
	if (typeof error === 'string') {
		return error;
	}
	try {
		return JSON.stringify(error) ?? String(error);
	} catch {
		return String(error);
	}
}

/** Convenience for store actions: `catch (error) { reportError(error, 'Generation failed'); }` */
export function reportError(error: unknown, title?: string): number {
	return useNotificationsStore.getState().notify('error', describeError(error), title ? { title } : {});
}
