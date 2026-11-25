import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../stores/sessionStore';
import { renderWithProviders } from '../test/render';
import { BootScreen } from './BootScreen';

describe('BootScreen', () => {
	it('shows the app name and a spinner while booting', () => {
		useSessionStore.setState({ phase: 'booting' });
		renderWithProviders(<BootScreen />);
		const status = within(screen.getByRole('main')).getByRole('status');
		expect(within(status).getByRole('heading', { level: 1, name: 'Prompt Weaver' })).toBeInTheDocument();
		expect(within(status).getByRole('progressbar')).toBeInTheDocument();
		expect(status).toHaveTextContent('Connecting to the backend…');
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});

	it('shows the idle phase (before start) like booting', () => {
		useSessionStore.setState({ phase: 'idle' });
		renderWithProviders(<BootScreen />);
		expect(screen.getByText('Connecting to the backend…')).toBeInTheDocument();
	});

	it('shows the boot error as an alert and retries through the session store', async () => {
		const retry = vi.fn(async () => undefined);
		useSessionStore.setState({ phase: 'failed', bootError: 'Backend unreachable at http://127.0.0.1:8000', retry });
		const { user } = renderWithProviders(<BootScreen />);

		const alert = screen.getByRole('alert', { name: 'Prompt Weaver could not start' });
		expect(alert).toHaveTextContent('Backend unreachable at http://127.0.0.1:8000');
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Retry' }));
		expect(retry).toHaveBeenCalledTimes(1);
	});

	it('falls back to a generic message when the failure has no details', () => {
		useSessionStore.setState({ phase: 'failed', bootError: null });
		renderWithProviders(<BootScreen />);
		expect(screen.getByRole('alert')).toHaveTextContent('The backend could not be reached.');
	});
});
