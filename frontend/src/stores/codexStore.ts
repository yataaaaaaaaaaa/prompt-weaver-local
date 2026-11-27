// Co-writer store: single truth holder, in the frontend, of the co-writer (the user's Codex embedded in the Story
// section; the backend runs it and owns its conversations: backend/app/services/codex/): its status (found, version,
// signed in, models; the path and model settings), the conversations of the stories (the draft one while no story is
// selected) as the backend streams them (CodexEvent over /ws/tasks, applied by applyEvent; the tasks store forwards
// them), what is being sent, the composer drafts, and the tool calls this window runs.
//
// Tool calls: the backend sends the calls of a turn to the window that sent the message (CLIENT_ID); runCall runs one
// with src/stores/coWriterTools.ts (the story store's actions) and posts its result. Stop interrupts the turn; the
// backend abandons its calls (tool_cancel) and a generation a call started is cancelled here.
//
// Not persisted (the backend saves the settings and the conversations index; Codex keeps the history). Every action
// resolves (never rejects): failures show in the panel (status, loadErrors) or as notifications.
// Rule: never read another store at module top level or in the initial state (stores import each other).
import { create } from 'zustand';
import { api } from '../api/client';
import { CLIENT_ID } from '../api/clientId';
import type { CodexConversation, CodexEvent, CodexStatus, CodexToolCall, CodexToolName } from '../api/types';
import { conversationKey, GENERATION_TOOLS, withConversation, withDelta, withEntry, type ConversationIndex } from '../domain/coWriter';
import { runCoWriterTool } from './coWriterTools';
import { withFlag } from './flags';
import { describeError, reportError } from './notificationsStore';
import type { LoadStatus } from './pagedSearch';
import { useStoryStore } from './storyStore';

export type CodexStoreState = ConversationIndex & {
	status: CodexStatus | null;
	statusLoad: LoadStatus;
	/** Why the status could not be read (the backend is not reachable). */
	statusError: string | null;
	/** Story keys (conversationKey) whose conversation is being read. */
	loading: Record<string, true>;
	/** Why the conversation of a story key could not be read. */
	loadErrors: Record<string, string>;
	/** Story keys with a message being sent. */
	sending: Record<string, true>;
	/** The composer's text per story key. */
	drafts: Record<string, string>;
	/** Tool calls this window runs (call id -> tool). */
	runningCalls: Record<string, CodexToolName>;
};

export type CodexStoreActions = {
	/** Reads the status (once: later calls do nothing unless `refresh`, the panel's Retry, which looks for Codex again). */
	loadStatus: (refresh?: boolean) => Promise<void>;
	/** The codex executable to use (null: auto-detect); Codex is looked for again. */
	setCodexPath: (path: string | null) => Promise<void>;
	/** The co-writer's model (null: the default of the user's Codex). */
	setModel: (model: string | null) => Promise<void>;
	/** Reads the conversation of a story (null: the draft) unless it is known (`refresh`: read it again). */
	openConversation: (storyId: string | null, refresh?: boolean) => Promise<void>;
	/** Sends the user's message about the story (and the scene selected in the story store); the composer's draft is
	 *  cleared once sent. False when nothing was sent. */
	send: (storyId: string | null, text: string) => Promise<boolean>;
	/** Stop: interrupts the answer of the story's conversation. */
	stop: (storyId: string | null) => Promise<void>;
	/** New conversation for the story (null: the draft). */
	newConversation: (storyId: string | null) => Promise<void>;
	setDraft: (storyId: string | null, text: string) => void;
	/** A CodexEvent of /ws/tasks. */
	applyEvent: (event: CodexEvent) => void;
	/** Runs a tool call of this window and posts its result (calls for other windows are ignored, each call runs once). */
	runCall: (call: CodexToolCall) => Promise<void>;
};

export type CodexStore = CodexStoreState & CodexStoreActions;

/** Tool calls already taken (an event seen twice runs once). */
const takenCalls = new Set<string>();
/** Tool calls the backend abandoned (Stop): their result is not sent. */
const abandonedCalls = new Set<string>();

export const useCodexStore = create<CodexStore>()((set, get) => {
	let statusToken = 0;

	const applyConversation = (conversation: CodexConversation) =>
		set((state) => withConversation({ conversations: state.conversations, byStory: state.byStory }, conversation));

	const updateConversation = (conversationId: string, change: (conversation: CodexConversation) => CodexConversation) =>
		set((state) => {
			const conversation = state.conversations[conversationId];
			return conversation ? { conversations: { ...state.conversations, [conversationId]: change(conversation) } } : state;
		});

	const conversationOf = (storyId: string | null): CodexConversation | null => selectConversation(storyId)(get());

	return {
		conversations: {},
		byStory: {},
		status: null,
		statusLoad: 'idle',
		statusError: null,
		loading: {},
		loadErrors: {},
		sending: {},
		drafts: {},
		runningCalls: {},

		loadStatus: async (refresh = false) => {
			if (!refresh && (get().statusLoad === 'loading' || get().statusLoad === 'ready')) {
				return;
			}
			const token = ++statusToken;
			set({ statusLoad: 'loading', statusError: null });
			try {
				const status = await api.codexStatus(refresh);
				if (token === statusToken) {
					set({ status, statusLoad: 'ready' });
				}
			} catch (error) {
				if (token === statusToken) {
					set({ statusLoad: 'failed', statusError: describeError(error) });
				}
			}
		},

		setCodexPath: async (path) => {
			const token = ++statusToken;
			set({ statusLoad: 'loading', statusError: null });
			try {
				const status = await api.updateCodexSettings({ path: path?.trim() || null });
				if (token === statusToken) {
					set({ status, statusLoad: 'ready' });
				}
			} catch (error) {
				if (token === statusToken) {
					set({ statusLoad: 'failed', statusError: describeError(error) });
				}
			}
		},

		setModel: async (model) => {
			try {
				set({ status: await api.updateCodexSettings({ model }) });
			} catch (error) {
				reportError(error, 'Could not change the model');
			}
		},

		openConversation: async (storyId, refresh = false) => {
			const key = conversationKey(storyId);
			if (get().loading[key] || (!refresh && get().byStory[key] !== undefined)) {
				return;
			}
			set((state) => ({ loading: withFlag(state.loading, key, true), loadErrors: withoutKey(state.loadErrors, key) }));
			try {
				applyConversation(await api.codexConversation(storyId));
			} catch (error) {
				set((state) => ({ loadErrors: { ...state.loadErrors, [key]: describeError(error) } }));
			} finally {
				set((state) => ({ loading: withFlag(state.loading, key, false) }));
			}
		},

		send: async (storyId, text) => {
			const key = conversationKey(storyId);
			const message = text.trim();
			if (!message || get().sending[key] || conversationOf(storyId)?.running) {
				return false;
			}
			set((state) => ({ sending: withFlag(state.sending, key, true) }));
			try {
				const story = useStoryStore.getState();
				const sceneId = story.selectedStoryId === storyId ? story.selectedSceneId : null;
				applyConversation(await api.sendCodexMessage({ story_id: storyId, scene_id: sceneId, text: message, client_id: CLIENT_ID }));
				set((state) => ({ drafts: withoutKey(state.drafts, key) }));
				return true;
			} catch (error) {
				reportError(error, 'Could not send the message to Codex');
				return false;
			} finally {
				set((state) => ({ sending: withFlag(state.sending, key, false) }));
			}
		},

		stop: async (storyId) => {
			const conversation = conversationOf(storyId);
			if (!conversation?.running) {
				return;
			}
			try {
				applyConversation(await api.interruptCodex(conversation.id));
			} catch (error) {
				reportError(error, 'Could not stop Codex');
			}
		},

		newConversation: async (storyId) => {
			try {
				applyConversation(await api.resetCodexConversation(storyId));
			} catch (error) {
				reportError(error, 'Could not start a new conversation');
			}
		},

		setDraft: (storyId, text) => set((state) => ({ drafts: { ...state.drafts, [conversationKey(storyId)]: text } })),

		applyEvent: (event) => {
			switch (event.kind) {
				case 'status':
					set({ status: event.status, statusLoad: 'ready', statusError: null });
					return;
				case 'conversation':
					applyConversation(event.conversation);
					return;
				case 'entry':
					updateConversation(event.conversation_id, (conversation) => withEntry(conversation, event.entry, event.revision));
					return;
				case 'delta':
					updateConversation(event.conversation_id, (conversation) => withDelta(conversation, event.entry_id, event.delta, event.revision));
					return;
				case 'tool_call':
					void get().runCall(event.call);
					return;
				case 'tool_cancel': {
					const tool = get().runningCalls[event.call_id];
					if (!tool) {
						return;
					}
					abandonedCalls.add(event.call_id);
					if (GENERATION_TOOLS.has(tool)) {
						void useStoryStore.getState().cancelGeneration();
					}
					return;
				}
			}
		},

		runCall: async (call) => {
			if (call.client_id !== CLIENT_ID || takenCalls.has(call.call_id)) {
				return;
			}
			takenCalls.add(call.call_id);
			set((state) => ({ runningCalls: { ...state.runningCalls, [call.call_id]: call.tool } }));
			try {
				const result = await runCoWriterTool(call);
				if (!abandonedCalls.has(call.call_id)) {
					await api.sendCodexToolResult(call.call_id, result).catch(() => undefined); // 404: the call is over (timed out)
				}
			} finally {
				abandonedCalls.delete(call.call_id);
				set((state) => ({ runningCalls: withoutKey(state.runningCalls, call.call_id) }));
			}
		},
	};
});

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
	if (!(key in record)) {
		return record;
	}
	const { [key]: _removed, ...rest } = record;
	return rest;
}

// ---------------------------------------------------------------------------
// Selectors / hooks
// ---------------------------------------------------------------------------

/** The conversation of a story (null: the draft); null while it is not known. */
export const selectConversation =
	(storyId: string | null) =>
	(state: CodexStoreState): CodexConversation | null => {
		const id = state.byStory[conversationKey(storyId)];
		return id === undefined ? null : (state.conversations[id] ?? null);
	};

/** The co-writer can be used: Codex is found and signed in. */
export const selectCodexReady = (state: CodexStoreState): boolean => state.status?.state === 'ready';
