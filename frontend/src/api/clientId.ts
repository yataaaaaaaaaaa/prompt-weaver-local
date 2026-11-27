// THE id of this window (one per page load): its /ws/tasks socket names it (src/api/taskSocket.ts) and the co-writer's
// messages carry it, so the backend sends the tool calls of a turn to the window that sent the message
// (src/stores/codexStore.ts runs them). Random, never persisted (a reloaded page is another window).

function randomId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `window-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

export const CLIENT_ID: string = randomId();
