import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api/client';
import type { CodexConversation } from '../../api/types';
import { useCharactersStore } from '../../stores/charactersStore';
import { useCodexStore } from '../../stores/codexStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useStoryStore } from '../../stores/storyStore';
import { BOB, character } from '../../test/characterData';
import { codexStatus, conversation, CONVERSATION_ID, entry } from '../../test/codexData';
import { renderWithProviders } from '../../test/render';
import { hasActionIntent } from '../../test/stateClasses';
import { SCENE_IDS, story, STORY_ID } from '../../test/storyData';
import { CO_WRITER_LABELS, CO_WRITER_STATE_ATTRIBUTE } from './coWriterLabels';
import { CoWriterPanel } from './CoWriterPanel';

function renderPanel(chat: CodexConversation = conversation({ story_ids: [STORY_ID] }), options: { colorScheme?: 'light' | 'dark' } = {}) {
	vi.spyOn(api, 'codexConversation').mockResolvedValue(chat);
	return renderWithProviders(<CoWriterPanel />, options);
}

const panelState = (container: HTMLElement) => container.firstElementChild?.querySelector(`[${CO_WRITER_STATE_ATTRIBUTE}]`)?.getAttribute(CO_WRITER_STATE_ATTRIBUTE) ?? container.querySelector(`[${CO_WRITER_STATE_ATTRIBUTE}]`)?.getAttribute(CO_WRITER_STATE_ATTRIBUTE);
const log = () => screen.getByRole('log', { name: CO_WRITER_LABELS.transcript });
const findLog = () => screen.findByRole('log', { name: CO_WRITER_LABELS.transcript });
const messageBox = () => screen.getByRole('textbox', { name: CO_WRITER_LABELS.message });

beforeEach(() => {
	useStoryStore.setState({ stories: [story()], loadStatus: 'ready', selectedStoryId: STORY_ID, selectedSceneId: null });
	vi.spyOn(api, 'codexStatus').mockResolvedValue(codexStatus());
});

describe('setup states', () => {
	it('looks for Codex, then shows the conversation of the selected story', async () => {
		const { container } = renderPanel(conversation({ story_ids: [STORY_ID], entries: [entry({ id: 'a', text: 'Hello again.' })] }));

		expect(panelState(container)).toBe('checking');
		expect(screen.getByText('Looking for Codex…')).toBeInTheDocument();
		expect(await within(await findLog()).findByText('Hello again.')).toBeInTheDocument();
		expect(panelState(container)).toBe('ready');
		expect(api.codexConversation).toHaveBeenCalledWith(STORY_ID);
		expect(screen.getByRole('heading', { level: 2, name: CO_WRITER_LABELS.panel })).toBeInTheDocument();
		expect(screen.getByText('Codex 0.169.0 · gpt-5.6-sol')).toBeInTheDocument();
	});

	it('not found: where it looked, a path field and Retry', async () => {
		vi.mocked(api.codexStatus).mockResolvedValue(codexStatus({ state: 'not_found', message: 'Codex was not found. Install it.', path: null, version: null, searched: ['codex on PATH', 'the OpenAI Codex app (OpenAI.Codex)'] }));
		const setPath = vi.spyOn(api, 'updateCodexSettings').mockResolvedValue(codexStatus({ configured_path: 'D:/codex.exe' }));
		const { user, container } = renderPanel();

		expect(await screen.findByRole('heading', { name: 'Codex was not found' })).toBeInTheDocument();
		expect(panelState(container)).toBe('not_found');
		expect(within(screen.getByRole('list', { name: 'Where the app looked' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['codex on PATH', 'the OpenAI Codex app (OpenAI.Codex)']);
		expect(screen.queryByRole('textbox', { name: CO_WRITER_LABELS.message })).not.toBeInTheDocument();
		const usePath = screen.getByRole('button', { name: CO_WRITER_LABELS.usePath });
		expect(usePath).toBeDisabled();

		await user.type(screen.getByRole('textbox', { name: CO_WRITER_LABELS.codexPath }), 'D:/codex.exe');
		await user.click(usePath);
		expect(setPath).toHaveBeenCalledWith({ path: 'D:/codex.exe' });
		expect(await screen.findByRole('textbox', { name: CO_WRITER_LABELS.message })).toBeInTheDocument();
	});

	it('not signed in: asks to sign in through the Codex app; Retry looks again', async () => {
		vi.mocked(api.codexStatus).mockResolvedValue(codexStatus({ state: 'signed_out', message: 'Codex is not signed in. Open the OpenAI Codex app, sign in, then select Retry.', account: null }));
		const { user } = renderPanel();

		expect(await screen.findByRole('heading', { name: 'Sign in to Codex' })).toBeInTheDocument();
		expect(screen.getByText('Codex is not signed in. Open the OpenAI Codex app, sign in, then select Retry.')).toBeInTheDocument();
		expect(screen.getByText('Codex 0.169.0 is installed.')).toBeInTheDocument();
		vi.mocked(api.codexStatus).mockResolvedValue(codexStatus());
		await user.click(screen.getByRole('button', { name: CO_WRITER_LABELS.retry }));

		expect(api.codexStatus).toHaveBeenLastCalledWith(true);
		expect(await screen.findByRole('textbox', { name: CO_WRITER_LABELS.message })).toBeInTheDocument();
	});

	it('cannot start, or the backend does not answer', async () => {
		vi.mocked(api.codexStatus).mockResolvedValue(codexStatus({ state: 'error', message: 'Codex could not start: broken' }));
		renderPanel();
		expect(await screen.findByRole('heading', { name: 'Codex could not start' })).toBeInTheDocument();
		expect(screen.getByText('Codex could not start: broken')).toBeInTheDocument();
		expect(screen.getByRole('textbox', { name: CO_WRITER_LABELS.codexPath })).toBeInTheDocument();
	});

	it('the backend does not answer', async () => {
		vi.mocked(api.codexStatus).mockRejectedValue(new Error('Failed to fetch'));
		const { container } = renderPanel();

		expect(await screen.findByRole('heading', { name: 'The co-writer is not available' })).toBeInTheDocument();
		expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
		expect(panelState(container)).toBe('unreachable');
	});
});

describe('the conversation', () => {
	const chat = conversation({
		story_ids: [STORY_ID],
		entries: [
			entry({ id: 'u', kind: 'user', text: 'Add a scene' }),
			entry({ id: 'a', text: 'Adding it.' }),
			entry({ id: 't1', kind: 'tool', tool: 'add_scenes', text: 'Added Scene 2 · The storm', story_id: STORY_ID, scene_id: SCENE_IDS[1] }),
			entry({ id: 't2', kind: 'tool', tool: 'generate_scenes', status: 'running', story_id: STORY_ID, scene_id: SCENE_IDS[2] }),
			entry({ id: 't3', kind: 'tool', tool: 'delete_scenes', status: 'failed', text: 'Deletion not confirmed', story_id: STORY_ID }),
			entry({ id: 't4', kind: 'tool', tool: 'update_character', text: 'Edited Bob (outfit tags)', character_id: BOB.id }),
			entry({ id: 't5', kind: 'tool', tool: 'update_character', status: 'running', character_id: BOB.id }),
			entry({ id: 'e', kind: 'error', text: 'Rate limited' }),
			entry({ id: 'n', kind: 'notice', text: 'Stopped.' }),
		],
	});

	it('shows messages, tool activity with links to the scenes and characters, errors and notices', async () => {
		useCharactersStore.setState({ characters: [character(), BOB] });
		const { user } = renderPanel(chat);

		await within(await findLog()).findByText('Add a scene');
		expect(within(log()).getByText('Adding it.')).toBeInTheDocument();
		expect(within(log()).getByText('Added Scene 2 · The storm')).toBeInTheDocument();
		expect(within(log()).getByText('Generating Scene 3 · Morning calm…')).toBeInTheDocument();
		expect(within(log()).getByText('Deletion not confirmed')).toBeInTheDocument();
		expect(within(log()).getByText('Rate limited')).toBeInTheDocument();
		expect(within(log()).getByText('Stopped.')).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('Stopped.');

		await user.click(within(log()).getByRole('button', { name: 'Show Scene 2 · The storm' }));
		expect(useStoryStore.getState()).toMatchObject({ selectedStoryId: STORY_ID, selectedSceneId: SCENE_IDS[1] });
		await user.click(within(log()).getByRole('button', { name: 'Show The lighthouse' }));
		expect(useStoryStore.getState().selectedSceneId).toBeNull();

		// A character's activity: its running label names it, Show opens it in the Characters section.
		expect(within(log()).getByText('Editing Bob…')).toBeInTheDocument();
		expect(within(log()).getByText('Edited Bob (outfit tags)')).toBeInTheDocument();
		await user.click(within(log()).getAllByRole('button', { name: 'Show Bob' })[0]);
		expect(useCharactersStore.getState().selectedId).toBe(BOB.id);
		expect(useNavigationStore.getState().section).toBe('characters');
	});

	it("renders Codex's answers as Markdown, never as HTML", async () => {
		const answer = [
			'## Plan',
			'Two **scenes**, one *quiet*:',
			'',
			'1. `The harbor` at dawn',
			'2. The storm',
			'',
			'- see [the docs](https://example.com/docs)',
			'- [a trap](javascript:alert(1)) <img src=x onerror=alert(1)>',
			'',
			'```',
			'rain, night',
			'```',
		].join('\n');
		const { container } = renderPanel(conversation({ story_ids: [STORY_ID], entries: [entry({ id: 'a', text: answer })] }));
		const reply = (await within(await findLog()).findByText('Plan')).closest('[data-entry-kind="assistant"]') as HTMLElement;

		expect(within(reply).getByRole('heading', { level: 3, name: 'Plan' })).toBeInTheDocument();
		expect(within(reply).getByText('scenes').tagName).toBe('STRONG');
		expect(within(reply).getByText('quiet').tagName).toBe('EM');
		expect(within(reply).getByText('The harbor').tagName).toBe('CODE');
		expect(within(reply).getAllByRole('list').map((list) => list.tagName)).toEqual(['OL', 'UL']);
		expect(within(reply).getByRole('link', { name: 'the docs' })).toHaveAttribute('href', 'https://example.com/docs');
		expect(within(reply).getByRole('link', { name: 'the docs' })).toHaveAttribute('target', '_blank');
		expect(within(reply).queryByRole('link', { name: 'a trap' })).not.toBeInTheDocument();
		expect(within(reply).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
		expect(container.querySelector('img')).toBeNull();
		expect(within(reply).getByText('rain, night').closest('pre')).not.toBeNull();
	});

	it('says what Codex can do in an empty conversation', async () => {
		renderPanel();
		expect(await within(await findLog()).findByText('Write with Codex')).toBeInTheDocument();
	});

	it('Enter sends, Shift+Enter adds a line; Send is disabled without text', async () => {
		const send = vi.spyOn(api, 'sendCodexMessage').mockResolvedValue(conversation({ story_ids: [STORY_ID], running: true, entries: [entry({ id: 'u', kind: 'user', text: 'one\ntwo' })] }));
		const { user } = renderPanel();
		await screen.findByRole('textbox', { name: CO_WRITER_LABELS.message });
		expect(screen.getByRole('button', { name: CO_WRITER_LABELS.send })).toBeDisabled();

		await user.click(messageBox());
		await user.keyboard('one{Shift>}{Enter}{/Shift}two');
		expect(messageBox()).toHaveValue('one\ntwo');
		await user.keyboard('{Enter}');

		expect(send).toHaveBeenCalledWith(expect.objectContaining({ story_id: STORY_ID, text: 'one\ntwo' }));
		await waitFor(() => expect(messageBox()).toHaveValue(''));
		// While Codex answers: Stop (the amber action) instead of Send.
		const stop = await screen.findByRole('button', { name: CO_WRITER_LABELS.stop });
		expect(hasActionIntent(stop, 'filled', 'warning')).toBe(true);
		expect(screen.queryByRole('button', { name: CO_WRITER_LABELS.send })).not.toBeInTheDocument();
		expect(screen.getAllByText(CO_WRITER_LABELS.working)).toHaveLength(1);
		const interrupt = vi.spyOn(api, 'interruptCodex').mockResolvedValue(conversation({ story_ids: [STORY_ID] }));
		await user.click(stop);
		expect(interrupt).toHaveBeenCalledWith(CONVERSATION_ID);
	});

	it('streams into the transcript from the events', async () => {
		renderPanel(conversation({ story_ids: [STORY_ID], running: true, entries: [entry({ id: 'u', kind: 'user', text: 'Go' })] }));
		await within(await findLog()).findByText('Go');

		act(() => {
			useCodexStore.getState().applyEvent({ type: 'codex', kind: 'entry', conversation_id: CONVERSATION_ID, entry: entry({ id: 'a', text: 'Once', status: 'running' }), revision: 2 });
			useCodexStore.getState().applyEvent({ type: 'codex', kind: 'delta', conversation_id: CONVERSATION_ID, entry_id: 'a', delta: ' upon a time', revision: 3 });
		});

		expect(within(log()).getByText('Once upon a time').closest('[data-entry-kind="assistant"]')).toHaveAttribute('aria-busy', 'true');
	});

	it('New conversation, the model menu and Collapse', async () => {
		const reset = vi.spyOn(api, 'resetCodexConversation').mockResolvedValue(conversation({ id: 'cnv-000000000009', story_ids: [STORY_ID] }));
		const update = vi.spyOn(api, 'updateCodexSettings').mockResolvedValue(codexStatus({ model: 'gpt-6-luna' }));
		const { user } = renderPanel(conversation({ story_ids: [STORY_ID], entries: [entry({ id: 'a', text: 'Hi' })] }));
		await within(await findLog()).findByText('Hi');
		const commands = screen.getByRole('toolbar', { name: CO_WRITER_LABELS.commands });

		await user.click(within(commands).getByRole('button', { name: CO_WRITER_LABELS.newConversation }));
		expect(reset).toHaveBeenCalledWith(STORY_ID);
		expect(await within(await findLog()).findByText('Write with Codex')).toBeInTheDocument();
		expect(within(commands).getByRole('button', { name: CO_WRITER_LABELS.newConversation })).toHaveAttribute('aria-disabled', 'true');

		await user.click(within(commands).getByRole('button', { name: 'Model: gpt-5.6-sol' }));
		expect(screen.getByRole('menuitemradio', { name: 'Default (gpt-5.6-sol)' })).toHaveAttribute('aria-checked', 'true');
		await user.click(screen.getByRole('menuitemradio', { name: 'GPT 6 Luna' }));
		expect(update).toHaveBeenCalledWith({ model: 'gpt-6-luna' });

		await user.click(within(commands).getByRole('button', { name: CO_WRITER_LABELS.collapse }));
		expect(useStoryStore.getState().dockCollapsed).toBe(true);
	});

	it('renders in the dark theme', async () => {
		renderPanel(chat, { colorScheme: 'dark' });
		expect(await within(await findLog()).findByText('Adding it.')).toBeInTheDocument();
	});
});
