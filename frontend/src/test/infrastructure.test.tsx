// Smoke tests of the shared test infrastructure (Fluent in jsdom, store reset between tests).
import { Button, Dialog, DialogBody, DialogSurface, DialogTitle, DialogTrigger, Tooltip } from '@fluentui/react-components';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useNotificationsStore } from '../stores/notificationsStore';
import { renderWithProviders } from './render';

describe('test infrastructure', () => {
	it('renders Fluent components and dialogs in jsdom', async () => {
		const { user } = renderWithProviders(
			<Dialog>
				<DialogTrigger disableButtonEnhancement>
					<Tooltip content="Opens the dialog" relationship="description">
						<Button>Open</Button>
					</Tooltip>
				</DialogTrigger>
				<DialogSurface>
					<DialogBody>
						<DialogTitle>Hello</DialogTitle>
					</DialogBody>
				</DialogSurface>
			</Dialog>,
		);

		await user.click(screen.getByRole('button', { name: 'Open' }));

		expect(await screen.findByRole('dialog')).toHaveTextContent('Hello');
	});

	it('lets a test mutate a store...', () => {
		useNotificationsStore.getState().notify('error', 'boom');
		expect(useNotificationsStore.getState().notifications).toHaveLength(1);
	});

	it('...and resets every store before the next test', () => {
		expect(useNotificationsStore.getState().notifications).toHaveLength(0);
	});
});
