import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useNotificationsStore } from '../stores/notificationsStore';
import { useSessionStore } from '../stores/sessionStore';
import { renderWithProviders } from '../test/render';
import { App } from './App';

// The workspace has its own tests; here it only has to appear once the session is ready.
vi.mock('../workspace/Workspace', () => ({ Workspace: () => <div data-testid="workspace" /> }));

function stubSession(phase: 'idle' | 'booting' | 'ready' | 'failed') {
	const start = vi.fn(async () => undefined);
	const retry = vi.fn(async () => undefined);
	useSessionStore.setState({ phase, start, retry, bootError: phase === 'failed' ? 'No backend' : null });
	return { start, retry };
}

describe('App', () => {
	it('starts the session once and shows the boot screen while booting', () => {
		const { start } = stubSession('booting');
		const { rerender } = renderWithProviders(<App />);
		rerender(<App />);

		expect(start).toHaveBeenCalledTimes(1);
		expect(screen.getByText('Connecting to the backend…')).toBeInTheDocument();
		expect(screen.queryByTestId('workspace')).not.toBeInTheDocument();
	});

	it('offers Retry when booting failed', async () => {
		const { retry } = stubSession('failed');
		const { user } = renderWithProviders(<App />);

		await user.click(screen.getByRole('button', { name: 'Retry' }));
		expect(retry).toHaveBeenCalledTimes(1);
	});

	it('shows the workspace once the session is ready', () => {
		stubSession('booting');
		renderWithProviders(<App />);

		act(() => useSessionStore.setState({ phase: 'ready' }));

		expect(screen.getByTestId('workspace')).toBeInTheDocument();
		expect(screen.queryByText('Connecting to the backend…')).not.toBeInTheDocument();
	});

	it('shows notifications in every phase', () => {
		stubSession('booting');
		act(() => {
			useNotificationsStore.getState().notify('error', 'Backend is starting slowly');
		});
		renderWithProviders(<App />);
		expect(screen.getByText('Backend is starting slowly')).toBeInTheDocument();
	});
});
