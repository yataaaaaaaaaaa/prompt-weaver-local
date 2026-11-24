import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = true;

// React rethrows render errors to window 'error' in development; keep jsdom from printing them.
const swallowWindowError = (event: ErrorEvent) => event.preventDefault();

function Fragile(): JSX.Element {
	if (shouldThrow) {
		throw new Error('kaboom');
	}
	return <p>Recovered content</p>;
}

beforeEach(() => {
	window.addEventListener('error', swallowWindowError);
});

afterEach(() => {
	window.removeEventListener('error', swallowWindowError);
	shouldThrow = true;
});

describe('ErrorBoundary', () => {
	it('renders its children when nothing throws', () => {
		shouldThrow = false;
		renderWithProviders(
			<ErrorBoundary>
				<Fragile />
			</ErrorBoundary>,
		);
		expect(screen.getByText('Recovered content')).toBeInTheDocument();
	});

	it('shows a render crash with its stack and closes back to the children', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { user } = renderWithProviders(
			<ErrorBoundary>
				<Fragile />
			</ErrorBoundary>,
		);

		expect(screen.getByText('Frontend render error')).toBeInTheDocument();
		expect(screen.getAllByText(/kaboom/).length).toBeGreaterThan(0);
		expect(console.error).toHaveBeenCalled();

		shouldThrow = false;
		await user.click(screen.getByRole('button', { name: 'Close' }));

		expect(screen.getByText('Recovered content')).toBeInTheDocument();
		expect(screen.queryByText('Frontend render error')).not.toBeInTheDocument();
	});
});
