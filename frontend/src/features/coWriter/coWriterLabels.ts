// THE accessible names of the co-writer panel (the Story section's dock): the views render them, their component tests
// and the e2e helpers (frontend/e2e/story/coWriterDriver.ts) find the elements by them. Pure data (no React, no Fluent),
// so the Node-side e2e suite can import it.

export const CO_WRITER_LABELS = {
	/** The dock's name (complementary landmark) and the panel's heading. */
	panel: 'Co-writer',
	/** The conversation log. */
	transcript: 'Conversation with Codex',
	/** The panel's commands toolbar. */
	commands: 'Co-writer commands',
	message: 'Message Codex',
	send: 'Send',
	stop: 'Stop',
	newConversation: 'New conversation',
	collapse: 'Collapse co-writer',
	model: 'Model',
	codexPath: 'Codex path',
	usePath: 'Use this path',
	autoDetect: 'Detect automatically',
	retry: 'Retry',
	/** The status line while Codex answers. */
	working: 'Codex is working…',
} as const;

/** The state of the panel, on its root (`data-co-writer-state`): 'checking' while the status is read, then the
 *  CodexState ('ready', 'not_found', 'signed_out', 'error') or 'unreachable' (the backend did not answer). The e2e
 *  suite waits for it to leave 'checking' before screenshots. */
export const CO_WRITER_STATE_ATTRIBUTE = 'data-co-writer-state';

/** The name of a model menu item: the default one says which model it is. */
export function defaultModelLabel(model: string | null): string {
	return model ? `Default (${model})` : 'Default';
}

/** The link of a tool activity row to the scene (or story) it acted on. */
export function showTargetLabel(title: string): string {
	return `Show ${title}`;
}
