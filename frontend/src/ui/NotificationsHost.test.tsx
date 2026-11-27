import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { COLLAPSED_REGION_WIDTH } from '../domain/layout';
import { useLayoutStore } from '../stores/layoutStore';
import { goToSectionAction, useNavigationStore } from '../stores/navigationStore';
import { useNotificationsStore } from '../stores/notificationsStore';
import { useStoryStore } from '../stores/storyStore';
import { DOCK_WINDOW_INSET } from './SectionLayout';
import { renderWithProviders } from '../test/render';
import { NotificationsHost } from './NotificationsHost';

describe('NotificationsHost', () => {
	it('renders nothing without notifications', () => {
		const { container } = renderWithProviders(<NotificationsHost />);
		// Only the Fluent provider element of the test wrapper.
		expect(container.firstElementChild).toBeEmptyDOMElement();
	});

	it('keeps clear of the generation panel while Create is shown, and takes the corner elsewhere', () => {
		useLayoutStore.setState({ widths: { viewer: 560, generation: 420 } });
		act(() => {
			useNotificationsStore.getState().notify('error', 'Saving failed.');
		});
		renderWithProviders(<NotificationsHost />);
		const region = screen.getByRole('region', { name: 'Notifications' });

		expect(region.style.right).toContain('420px');

		act(() => useLayoutStore.getState().setRegionCollapsed('generation', true));
		expect(region.style.right).toContain(`${COLLAPSED_REGION_WIDTH}px`);

		act(() => useNavigationStore.getState().showSection('models'));
		expect(region.style.right).toContain('0px');
	});

	it("keeps clear of the Story section's dock while it is expanded", () => {
		act(() => {
			useNotificationsStore.getState().notify('error', 'Could not add the scene.');
			useNavigationStore.getState().showSection('story');
		});
		renderWithProviders(<NotificationsHost />);
		const region = screen.getByRole('region', { name: 'Notifications' });

		expect(region.style.right).toContain(DOCK_WINDOW_INSET);
		act(() => useStoryStore.getState().setDockCollapsed(true));
		expect(region.style.right).toContain('0px');
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

	it('shows the action of a notification as a button that runs it and dismisses the toast', async () => {
		const run = vi.fn();
		act(() => {
			useNotificationsStore.getState().notify('success', 'LoRAs selected.', { action: { label: 'Go to Create', run } });
		});
		const { user } = renderWithProviders(<NotificationsHost />);

		await user.click(screen.getByRole('button', { name: 'Go to Create' }));

		expect(run).toHaveBeenCalledTimes(1);
		expect(useNotificationsStore.getState().notifications).toHaveLength(0);
	});

	it("does not offer 'Go to <section>' while that section is shown", () => {
		act(() => {
			useNavigationStore.getState().showSection('images');
			useNotificationsStore.getState().notify('success', 'LoRAs selected.', { action: goToSectionAction('create') });
		});
		renderWithProviders(<NotificationsHost />);
		expect(screen.getByRole('button', { name: 'Go to Create' })).toBeInTheDocument();

		act(() => useNavigationStore.getState().showSection('create'));
		expect(screen.queryByRole('button', { name: 'Go to Create' })).not.toBeInTheDocument();
		expect(screen.getByText('LoRAs selected.')).toBeInTheDocument();

		act(() => useNavigationStore.getState().showSection('models'));
		expect(screen.getByRole('button', { name: 'Go to Create' })).toBeInTheDocument();
	});
});
