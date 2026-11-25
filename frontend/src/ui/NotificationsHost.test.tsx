import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNotificationsStore } from '../stores/notificationsStore';
import { renderWithProviders } from '../test/render';
import { NotificationsHost } from './NotificationsHost';

describe('NotificationsHost', () => {
	it('renders nothing without notifications', () => {
		const { container } = renderWithProviders(<NotificationsHost />);
		// Only the Fluent provider element of the test wrapper.
		expect(container.firstElementChild).toBeEmptyDOMElement();
	});

	it('renders every notification with its title and message', () => {
		act(() => {
			useNotificationsStore.getState().notify('error', 'The backend is gone.', { title: 'Generation failed' });
			useNotificationsStore.getState().notify('info', 'Prompt copied.');
		});
		renderWithProviders(<NotificationsHost />);

		expect(screen.getByText('Generation failed')).toBeInTheDocument();
		expect(screen.getByText('The backend is gone.')).toBeInTheDocument();
		expect(screen.getByText('Prompt copied.')).toBeInTheDocument();
		expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2);
	});

	it('stacks the toasts in a labelled notifications region, newest last', () => {
		act(() => {
			useNotificationsStore.getState().notify('error', 'First.', { title: 'Saving failed' });
			useNotificationsStore.getState().notify('success', 'Second.');
		});
		renderWithProviders(<NotificationsHost />);

		const region = screen.getByRole('region', { name: 'Notifications' });
		const toasts = within(region).getAllByRole('group');
		expect(toasts).toHaveLength(2);
		expect(toasts[0]).toHaveTextContent('Saving failedFirst.');
		expect(toasts[1]).toHaveTextContent('Second.');
	});

	it('removes the region once the last toast is gone', async () => {
		act(() => {
			useNotificationsStore.getState().notify('info', 'Only one.');
		});
		renderWithProviders(<NotificationsHost />);
		expect(screen.getByRole('region', { name: 'Notifications' })).toBeInTheDocument();

		act(() => useNotificationsStore.getState().clear());
		await waitFor(() => expect(screen.queryByRole('region', { name: 'Notifications' })).not.toBeInTheDocument());
	});

	it('dismisses a notification through the store', async () => {
		act(() => {
			useNotificationsStore.getState().notify('warning', 'Careful.');
		});
		const { user } = renderWithProviders(<NotificationsHost />);

		await user.click(screen.getByRole('button', { name: 'Dismiss' }));

		expect(useNotificationsStore.getState().notifications).toHaveLength(0);
		await waitFor(() => expect(screen.queryByText('Careful.')).not.toBeInTheDocument());
	});
});
