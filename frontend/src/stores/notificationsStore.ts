// Notifications domain: the single place where user-facing errors/warnings/info live.
// Every store reports problems through `notify` / `reportError`; the NotificationsHost view renders them.
import { create } from 'zustand';
import type { SectionId } from '../app/sections';

export type NotificationIntent = 'error' | 'warning' | 'success' | 'info';

/** A follow-up the user can take from a notification in one click (e.g. 'Go to Create' after an image's LoRAs were
 *  selected: navigationStore goToSectionAction). `run` calls store actions only; the notification is dismissed once it
 *  ran. */
export type NotificationAction = {
	label: string;
	run: () => void;
	/** The section the action shows (a 'Go to <section>' action): it is not offered while that section is shown
	 *  (navigationStore useApplicableAction). */
	section?: SectionId;
};

export type AppNotification = {
	id: number;
	intent: NotificationIntent;
	title: string | null;
	message: string;
	action: NotificationAction | null;
};

export type NotifyOptions = {
	title?: string;
	/** Auto-dismiss delay; errors and warnings stay until dismissed when omitted. */
	timeoutMs?: number;
	/** One follow-up action shown as a button of the notification. */
	action?: NotificationAction;
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
	/** Runs the notification's action, then dismisses it (no-op for an unknown id or a notification without action). */
	runAction: (id: number) => void;
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
			const action = options.action ?? null;
			const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS[intent];
			const notifications = get().notifications;
			const latest = notifications[notifications.length - 1];
			if (
				latest &&
				latest.intent === intent &&
				latest.title === title &&
				latest.message === message &&
				latest.action?.label === action?.label
			) {
				scheduleDismiss(latest.id, timeoutMs);
				return latest.id;
			}
			const id = nextId++;
			set((state) => ({ notifications: [...state.notifications, { id, intent, title, message, action }] }));
			scheduleDismiss(id, timeoutMs);
			return id;
		},
		dismiss: (id) => {
			cancelTimer(id);
			set((state) => ({ notifications: state.notifications.filter((item) => item.id !== id) }));
		},
		runAction: (id) => {
			const action = get().notifications.find((item) => item.id === id)?.action;
			if (!action) {
				return;
			}
			get().dismiss(id);
			action.run();
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
