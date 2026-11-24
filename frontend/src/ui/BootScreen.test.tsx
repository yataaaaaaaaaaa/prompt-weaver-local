import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSessionStore } from '../stores/sessionStore';
import { renderWithProviders } from '../test/render';
import { BootScreen } from './BootScreen';

describe('BootScreen', () => {
	it('shows a spinner while booting', () => {
		useSessionStore.setState({ phase: 'booting' });
		renderWithProviders(<BootScreen />);
		expect(screen.getByText('Connecting to the backend…')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});

	it('shows the boot error and retries through the session store', async () => {
		const retry = vi.fn(async () => undefined);
		useSessionStore.setState({ phase: 'failed', bootError: 'Backend unreachable at http://127.0.0.1:8000', retry });
		const { user } = renderWithProviders(<BootScreen />);

		expect(screen.getByText('Startup error')).toBeInTheDocument();
		expect(screen.getByText('Backend unreachable at http://127.0.0.1:8000')).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Retry' }));
		expect(retry).toHaveBeenCalledTimes(1);
	});
});
