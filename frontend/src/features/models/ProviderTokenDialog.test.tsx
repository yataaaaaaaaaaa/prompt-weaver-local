import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { currentDialog, openDialog, waitForDialogClose } from '../../test/dialogs';
import { renderWithProviders } from '../../test/render';
import { ProviderTokenDialog } from './ProviderTokenDialog';
import { INFO, PROVIDER } from '../../test/modelLibraryData';

const SECRET = 'civitai-secret-token';

function seed(tokenSet: boolean, tokenSupported = true) {
	const setProviderToken = vi.fn(async () => undefined);
	useModelCatalogStore.setState({
		info: { ...INFO, providers: [{ ...PROVIDER, token_set: tokenSet, token_supported: tokenSupported }] },
		infoStatus: 'ready',
		setProviderToken,
	});
	return setProviderToken;
}

// The open dialog is always re-queried (cheap selector, then scoped queries): whole-document role queries are
// slow in jsdom once the dialog styles are inserted.
async function openTokenDialog(user: ReturnType<typeof renderWithProviders>['user']): Promise<void> {
	// The modal restores the page's aria-hidden asynchronously after a previous close: find the trigger again.
	await openDialog(user, await screen.findByRole('button', { name: 'Civitai token' }));
	await waitFor(() => expect(currentDialog()).toHaveAccessibleName('Civitai API token'));
}

describe('ProviderTokenDialog', () => {
	it('renders nothing for a provider without token support', () => {
		seed(false, false);
		renderWithProviders(<ProviderTokenDialog />);

		expect(screen.queryByRole('button', { name: 'Civitai token' })).not.toBeInTheDocument();
	});

	it('shows the Token set badge when a token is stored', () => {
		seed(true);
		const { unmount } = renderWithProviders(<ProviderTokenDialog />);
		expect(screen.getByText('Token set')).toBeInTheDocument();
		unmount();

		seed(false);
		renderWithProviders(<ProviderTokenDialog />);
		expect(screen.queryByText('Token set')).not.toBeInTheDocument();
	});

	it('saves a token through the store and never renders it afterwards', async () => {
		const setProviderToken = seed(false);
		const { user } = renderWithProviders(<ProviderTokenDialog />);

		await openTokenDialog(user);
		expect(currentDialog()).toHaveTextContent('stored in the backend settings only and is never shown again');
		expect(currentDialog()).toHaveTextContent('No token is stored.');
		expect(within(currentDialog()).queryByRole('button', { name: 'Remove token' })).not.toBeInTheDocument();
		expect(within(currentDialog()).getByLabelText('API token')).toHaveAttribute('type', 'password');
		expect(within(currentDialog()).getByRole('button', { name: 'Save' })).toBeDisabled();

		await user.type(within(currentDialog()).getByLabelText('API token'), `  ${SECRET} `);
		await user.click(within(currentDialog()).getByRole('button', { name: 'Save' }));

		// Sent as typed: the backend strips it (BackendSettingsStore owns the token rules).
		expect(setProviderToken).toHaveBeenCalledWith('civitai', `  ${SECRET} `);
		await waitForDialogClose();
		expect(document.body).not.toHaveTextContent(SECRET);

		await openTokenDialog(user);
		expect(within(currentDialog()).getByLabelText('API token')).toHaveValue('');
		expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument();
	});

	it('submits with Enter', async () => {
		const setProviderToken = seed(false);
		const { user } = renderWithProviders(<ProviderTokenDialog />);

		await openTokenDialog(user);
		await user.type(within(currentDialog()).getByLabelText('API token'), `${SECRET}{Enter}`);

		expect(setProviderToken).toHaveBeenCalledWith('civitai', SECRET);
		await waitForDialogClose();
	});

	it('removes the stored token', async () => {
		const setProviderToken = seed(true);
		const { user } = renderWithProviders(<ProviderTokenDialog />);

		await openTokenDialog(user);
		expect(currentDialog()).toHaveTextContent('A token is currently stored.');
		await user.click(within(currentDialog()).getByRole('button', { name: 'Remove token' }));

		expect(setProviderToken).toHaveBeenCalledWith('civitai', null);
		await waitForDialogClose();
	});

	it('cancels without saving and forgets the draft', async () => {
		const setProviderToken = seed(false);
		const { user } = renderWithProviders(<ProviderTokenDialog />);

		await openTokenDialog(user);
		await user.type(within(currentDialog()).getByLabelText('API token'), SECRET);
		await user.click(within(currentDialog()).getByRole('button', { name: 'Cancel' }));

		expect(setProviderToken).not.toHaveBeenCalled();
		await waitForDialogClose();
		await openTokenDialog(user);
		expect(within(currentDialog()).getByLabelText('API token')).toHaveValue('');
	});
});
