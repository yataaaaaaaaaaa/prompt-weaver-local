import { describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { CLIENT_ID } from '../api/clientId';
import type { CodexEvent, ModelSpec } from '../api/types';
import { DRAFT_KEY } from '../domain/coWriter';
import { codexStatus, conversation, CONVERSATION_ID, entry, OTHER_CONVERSATION_ID, toolCall } from '../test/codexData';
import { story, SCENE_IDS, STORY_ID } from '../test/storyData';
import { selectCodexReady, selectConversation, useCodexStore } from './codexStore';
import { useNotificationsStore } from './notificationsStore';
import { useLibraryStore } from './libraryStore';
import { useStoryStore } from './storyStore';

const codex = () => useCodexStore.getState();
const MODEL: ModelSpec = { id: 'model', name: 'model.safetensors', path: 'D:/m/model.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((onResolve) => {
		resolve = onResolve;
	});
	return { promise, resolve };
}

function notificationTitles(): (string | null)[] {
	return useNotificationsStore.getState().notifications.map((item) => item.title);
}

describe('status and settings', () => {
	it('reads the status once; Retry reads it again', async () => {
		const read = vi.spyOn(api, 'codexStatus').mockResolvedValue(codexStatus());

		await codex().loadStatus();
		await codex().loadStatus();
		expect(read).toHaveBeenCalledTimes(1);
		expect(read).toHaveBeenCalledWith(false);
		expect(selectCodexReady(codex())).toBe(true);

		read.mockResolvedValue(codexStatus({ state: 'signed_out', message: 'Sign in' }));
		await codex().loadStatus(true);
		expect(read).toHaveBeenLastCalledWith(true);
		expect(codex().status?.state).toBe('signed_out');
		expect(selectCodexReady(codex())).toBe(false);
	});

	it('keeps why the status could not be read', async () => {
		vi.spyOn(api, 'codexStatus').mockRejectedValue(new Error('backend down'));

		await codex().loadStatus();

		expect(codex()).toMatchObject({ statusLoad: 'failed', statusError: 'backend down', status: null });
	});

	it('sets the path (trimmed; empty = auto-detect) and the model', async () => {
		const update = vi.spyOn(api, 'updateCodexSettings').mockResolvedValue(codexStatus({ configured_path: 'C:/codex.exe' }));

		await codex().setCodexPath('  C:/codex.exe ');
		await codex().setCodexPath('   ');
		await codex().setModel('gpt-6-luna');

		expect(update.mock.calls.map(([body]) => body)).toEqual([{ path: 'C:/codex.exe' }, { path: null }, { model: 'gpt-6-luna' }]);
		expect(codex().status?.configured_path).toBe('C:/codex.exe');
	});
});

describe('conversations', () => {
	it('reads the conversation of a story once, and the draft one', async () => {
		const read = vi.spyOn(api, 'codexConversation').mockImplementation(async (storyId) => conversation({ story_ids: storyId ? [storyId] : [], draft: storyId === null, id: storyId ? CONVERSATION_ID : OTHER_CONVERSATION_ID }));

		await codex().openConversation(STORY_ID);
		await codex().openConversation(STORY_ID);
		await codex().openConversation(null);

		expect(read.mock.calls).toEqual([[STORY_ID], [null]]);
		expect(selectConversation(STORY_ID)(codex())?.id).toBe(CONVERSATION_ID);
		expect(selectConversation(null)(codex())?.id).toBe(OTHER_CONVERSATION_ID);
		expect(codex().byStory).toEqual({ [STORY_ID]: CONVERSATION_ID, [DRAFT_KEY]: OTHER_CONVERSATION_ID });
	});

	it('keeps why a conversation could not be read', async () => {
		vi.spyOn(api, 'codexConversation').mockRejectedValue(new Error('Codex could not start'));

		await codex().openConversation(STORY_ID);

		expect(codex().loadErrors).toEqual({ [STORY_ID]: 'Codex could not start' });
		expect(codex().loading).toEqual({});
	});

	it('sends a message about the story and the selected scene, then clears the draft', async () => {
		useStoryStore.setState({ stories: [story()], selectedStoryId: STORY_ID, selectedSceneId: SCENE_IDS[1] });
		const sent = deferred<ReturnType<typeof conversation>>();
		const post = vi.spyOn(api, 'sendCodexMessage').mockReturnValue(sent.promise);
		codex().setDraft(STORY_ID, 'Write the storm');

		const sending = codex().send(STORY_ID, '  Write the storm ');
		expect(codex().sending).toEqual({ [STORY_ID]: true });
		expect(await codex().send(STORY_ID, 'again')).toBe(false);
		sent.resolve(conversation({ story_ids: [STORY_ID], running: true, entries: [entry({ id: 'u', kind: 'user', text: 'Write the storm' })] }));

		expect(await sending).toBe(true);
		expect(post).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenCalledWith({ story_id: STORY_ID, scene_id: SCENE_IDS[1], text: 'Write the storm', client_id: CLIENT_ID });
		expect(codex().drafts).toEqual({});
		expect(selectConversation(STORY_ID)(codex())?.running).toBe(true);
		// Not while Codex answers.
		expect(await codex().send(STORY_ID, 'more')).toBe(false);
	});

	it('reports a message that could not be sent and keeps the draft', async () => {
		vi.spyOn(api, 'sendCodexMessage').mockRejectedValue(new Error('Codex is still answering.'));
		codex().setDraft(null, 'hello');

		expect(await codex().send(null, 'hello')).toBe(false);

		expect(notificationTitles()).toEqual(['Could not send the message to Codex']);
		expect(codex().drafts).toEqual({ [DRAFT_KEY]: 'hello' });
	});

	it('keeps the end of the turn when the answer of Stop comes after it', async () => {
		useCodexStore.setState({ conversations: { [CONVERSATION_ID]: conversation({ story_ids: [STORY_ID], running: true, revision: 4 }) }, byStory: { [STORY_ID]: CONVERSATION_ID } });
		const answer = deferred<ReturnType<typeof conversation>>();
		vi.spyOn(api, 'interruptCodex').mockReturnValue(answer.promise);

		const stopping = codex().stop(STORY_ID);
		codex().applyEvent({ type: 'codex', kind: 'conversation', conversation: conversation({ story_ids: [STORY_ID], running: false, revision: 6 }) });
		answer.resolve(conversation({ story_ids: [STORY_ID], running: true, revision: 5 }));
		await stopping;

		expect(selectConversation(STORY_ID)(codex())).toMatchObject({ running: false, revision: 6 });
	});

	it('stops a running answer and starts a new conversation', async () => {
		useCodexStore.setState({ conversations: { [CONVERSATION_ID]: conversation({ story_ids: [STORY_ID], running: true }) }, byStory: { [STORY_ID]: CONVERSATION_ID } });
		const interrupt = vi.spyOn(api, 'interruptCodex').mockResolvedValue(conversation({ story_ids: [STORY_ID], running: true }));
		const reset = vi.spyOn(api, 'resetCodexConversation').mockResolvedValue(conversation({ id: OTHER_CONVERSATION_ID, story_ids: [STORY_ID] }));

		await codex().stop(STORY_ID);
		await codex().stop(null);
		await codex().newConversation(STORY_ID);

		expect(interrupt.mock.calls).toEqual([[CONVERSATION_ID]]);
		expect(reset).toHaveBeenCalledWith(STORY_ID);
		expect(selectConversation(STORY_ID)(codex())?.id).toBe(OTHER_CONVERSATION_ID);
	});
});

describe('events', () => {
	const apply = (event: CodexEvent) => codex().applyEvent(event);

	it('applies the status, conversations, entries and streamed text', () => {
		apply({ type: 'codex', kind: 'status', status: codexStatus({ state: 'signed_out' }) });
		apply({ type: 'codex', kind: 'conversation', conversation: conversation({ story_ids: [STORY_ID], running: true }) });
		apply({ type: 'codex', kind: 'entry', conversation_id: CONVERSATION_ID, entry: entry({ id: 'a', text: 'Once', status: 'running' }), revision: 2 });
		apply({ type: 'codex', kind: 'delta', conversation_id: CONVERSATION_ID, entry_id: 'a', delta: ' upon a time', revision: 3 });
		apply({ type: 'codex', kind: 'delta', conversation_id: OTHER_CONVERSATION_ID, entry_id: 'a', delta: 'ignored', revision: 4 });

		expect(codex().status?.state).toBe('signed_out');
		expect(selectConversation(STORY_ID)(codex())?.entries).toEqual([entry({ id: 'a', text: 'Once upon a time', status: 'running' })]);
	});

	it("runs this window's tool calls once and posts their results", async () => {
		useStoryStore.setState({ stories: [story()], selectedStoryId: STORY_ID });
		const post = vi.spyOn(api, 'sendCodexToolResult').mockResolvedValue();
		const call = toolCall('get_story', { story_id: STORY_ID });

		apply({ type: 'codex', kind: 'tool_call', call });
		apply({ type: 'codex', kind: 'tool_call', call });
		apply({ type: 'codex', kind: 'tool_call', call: toolCall('list_stories', {}, { callId: 'call-other', clientId: 'another-window' }) });
		await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));

		expect(post.mock.calls[0][0]).toBe('call-1');
		expect(post.mock.calls[0][1]).toMatchObject({ ok: true, summary: 'Read The lighthouse', story_id: STORY_ID });
		await vi.waitFor(() => expect(codex().runningCalls).toEqual({}));
	});

	it('an abandoned call (Stop) runs to its end but sends no result', async () => {
		useStoryStore.setState({ stories: [story()], selectedStoryId: STORY_ID });
		const finish = deferred<void>();
		const cancel = vi.fn(async () => finish.resolve());
		useStoryStore.setState({ cancelGeneration: cancel, generateScene: vi.fn(async () => { await finish.promise; return null; }) });
		const post = vi.spyOn(api, 'sendCodexToolResult').mockResolvedValue();
		useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id });

		const running = codex().runCall(toolCall('generate_scene', { story_id: STORY_ID, scene_id: SCENE_IDS[2] }, { callId: 'call-7' }));
		await vi.waitFor(() => expect(codex().runningCalls).toEqual({ 'call-7': 'generate_scene' }));
		apply({ type: 'codex', kind: 'tool_cancel', call_id: 'call-7', client_id: CLIENT_ID });
		await running;

		expect(cancel).toHaveBeenCalledTimes(1);
		expect(post).not.toHaveBeenCalled();
		expect(codex().runningCalls).toEqual({});
	});

	it('Stop of a running generation call cancels the generation', async () => {
		const cancel = vi.spyOn(useStoryStore.getState(), 'cancelGeneration').mockResolvedValue();
		useStoryStore.setState({ cancelGeneration: cancel });
		useCodexStore.setState({ runningCalls: { 'call-9': 'generate_scene', 'call-8': 'get_story' } });

		apply({ type: 'codex', kind: 'tool_cancel', call_id: 'call-8', client_id: CLIENT_ID });
		expect(cancel).not.toHaveBeenCalled();
		apply({ type: 'codex', kind: 'tool_cancel', call_id: 'call-9', client_id: CLIENT_ID });
		expect(cancel).toHaveBeenCalledTimes(1);
	});
});
