// Co-writer test data, shared by the domain, store and view tests (imported by tests only): builders with neutral
// defaults (override what a test is about), with the shapes the backend sends (CodexStatus, CodexConversation,
// CodexEntry, the tool calls of CodexToolCallEvent).
import { CLIENT_ID } from '../api/clientId';
import type { CodexConversation, CodexEntry, CodexStatus, CodexToolArguments, CodexToolCall, CodexToolName } from '../api/types';

export const CONVERSATION_ID = 'cnv-000000000001';
export const OTHER_CONVERSATION_ID = 'cnv-000000000002';

export function codexStatus(overrides: Partial<CodexStatus> = {}): CodexStatus {
	return {
		state: 'ready',
		message: '',
		path: 'C:/Codex/codex.exe',
		source: 'windows_app',
		version: '0.169.0',
		configured_path: null,
		searched: [],
		account: 'chatgpt',
		default_model: 'gpt-5.6-sol',
		model: null,
		models: [
			{ id: 'gpt-5.6-sol', name: 'GPT 5.6 Sol' },
			{ id: 'gpt-6-luna', name: 'GPT 6 Luna' },
		],
		running: false,
		...overrides,
	};
}

export function entry(overrides: Partial<CodexEntry> & Pick<CodexEntry, 'id'>): CodexEntry {
	return { kind: 'assistant', text: '', status: 'completed', tool: null, story_id: null, scene_id: null, ...overrides };
}

export function conversation(overrides: Partial<CodexConversation> = {}): CodexConversation {
	return { id: CONVERSATION_ID, story_ids: [], draft: false, entries: [], running: false, revision: 1, ...overrides };
}

/** A tool call for this window (CLIENT_ID) unless `clientId` says otherwise. */
export function toolCall<T extends CodexToolName>(tool: T, args: CodexToolArguments<T>, { callId = 'call-1', clientId = CLIENT_ID } = {}): CodexToolCall {
	return { call_id: callId, client_id: clientId, conversation_id: CONVERSATION_ID, tool, arguments: args } as CodexToolCall;
}
