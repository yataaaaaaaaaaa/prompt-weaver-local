import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { characterImageUrl } from '../../api/config';
import { useCharactersStore } from '../../stores/charactersStore';
import { ALICE_ID, BOB, BOB_ID, character, THUMBNAIL_IMAGE_ID } from '../../test/characterData';
import { currentDialog, openDialog, waitForDialogClose } from '../../test/dialogs';
import { renderWithProviders } from '../../test/render';
import { CharactersPane } from './CharactersPane';
import { editorState, seedCharacterActions, seedIpAdapterActions } from '../../test/characterStores';

const ALICE = character();

let actions: ReturnType<typeof seedCharacterActions>;

beforeEach(() => {
	actions = seedCharacterActions();
	seedIpAdapterActions();
});

function card(name: string): HTMLElement {
	return screen.getByRole('group', { name });
}

describe('CharactersPane load states', () => {
	it('shows a spinner while the characters load', () => {
		useCharactersStore.setState({ loadStatus: 'loading' });
		renderWithProviders(<CharactersPane />);

		expect(screen.getByText('Loading characters…')).toBeInTheDocument();
		expect(screen.queryByText('No characters yet')).not.toBeInTheDocument();
	});

	it('shows the error with Retry', async () => {
		useCharactersStore.setState({ loadStatus: 'failed', loadError: 'The backend is unreachable.' });
		const { user } = renderWithProviders(<CharactersPane />);

		expect(screen.getByText('Could not load the characters')).toBeInTheDocument();
		expect(screen.getByText('The backend is unreachable.')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));

		expect(actions.load).toHaveBeenCalledTimes(1);
	});

	it('explains the entry points when there is no character', () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [] });
		renderWithProviders(<CharactersPane />);

		expect(screen.getByText('No characters yet')).toBeInTheDocument();
		expect(screen.getByText(/Create character in the Output browser/)).toHaveTextContent(/in the\s+Image library/);
		expect(screen.queryByRole('list', { name: 'Characters' })).not.toBeInTheDocument();
	});
});

describe('CharactersPane gallery', () => {
	it('shows one card per character, sorted by name, with thumbnail, name and identity tags', () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [BOB, ALICE] });
		renderWithProviders(<CharactersPane />);

		const items = within(screen.getByRole('list', { name: 'Characters' })).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(within(items[0]).getByRole('group', { name: 'Alice' })).toBeInTheDocument();
		expect(within(items[1]).getByRole('group', { name: 'Bob' })).toBeInTheDocument();

		const alice = card('Alice');
		expect(within(alice).getByRole('img', { name: 'Thumbnail of Alice' })).toHaveAttribute('src', characterImageUrl(ALICE_ID, THUMBNAIL_IMAGE_ID));
		expect(within(alice).getByText('1girl, silver hair, blue eyes')).toBeInTheDocument();
		// Without a thumbnail: a placeholder, no image.
		expect(within(card('Bob')).queryByRole('img')).not.toBeInTheDocument();
		expect(within(card('Bob')).getByText('1boy, black hair')).toBeInTheDocument();
	});

	it('activates or deactivates a character in one click', async () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [ALICE, BOB], activeId: ALICE_ID });
		const { user } = renderWithProviders(<CharactersPane />);

		expect(within(card('Alice')).getByRole('switch', { name: 'Active' })).toBeChecked();
		const bob = within(card('Bob')).getByRole('switch', { name: 'Active' });
		expect(bob).not.toBeChecked();

		await user.click(bob);
		expect(actions.toggleActive).toHaveBeenLastCalledWith(BOB_ID);
		await user.click(within(card('Alice')).getByRole('switch', { name: 'Active' }));
		expect(actions.toggleActive).toHaveBeenLastCalledWith(ALICE_ID);

		act(() => useCharactersStore.setState({ activeId: BOB_ID }));
		expect(bob).toBeChecked();
	});

	it('edits a character', async () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [ALICE, BOB] });
		const { user } = renderWithProviders(<CharactersPane />);

		await user.click(within(card('Bob')).getByRole('button', { name: 'Edit Bob' }));

		expect(actions.startEdit).toHaveBeenCalledWith(BOB_ID);
	});

	it('deletes a character after confirmation only', async () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [ALICE, BOB] });
		const { user } = renderWithProviders(<CharactersPane />);

		let dialog = await openDialog(user, within(card('Alice')).getByRole('button', { name: 'Delete Alice' }), 'alertdialog');
		expect(dialog).toHaveTextContent("Delete character 'Alice'?");
		expect(dialog).toHaveTextContent('Its reference images and thumbnail are deleted too.');
		await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
		await waitForDialogClose('alertdialog');
		expect(actions.remove).not.toHaveBeenCalled();

		// The page is hidden from the accessibility tree while the modal closes: wait for the button again.
		dialog = await openDialog(user, await screen.findByRole('button', { name: 'Delete Alice' }), 'alertdialog');
		await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
		await waitForDialogClose('alertdialog');
		expect(actions.remove).toHaveBeenCalledWith(ALICE_ID);
		expect(() => currentDialog('alertdialog')).toThrow();
	});

	it('disables the controls of a busy character', () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [ALICE, BOB], busyIds: { [ALICE_ID]: true } });
		renderWithProviders(<CharactersPane />);

		const alice = card('Alice');
		expect(within(alice).getByRole('switch', { name: 'Active' })).toBeDisabled();
		expect(within(alice).getByRole('button', { name: 'Edit Alice' })).toBeDisabled();
		expect(within(alice).getByRole('button', { name: 'Delete Alice' })).toBeDisabled();
		expect(within(card('Bob')).getByRole('switch', { name: 'Active' })).toBeEnabled();
	});

	it('creates a new character', async () => {
		useCharactersStore.setState({ loadStatus: 'ready' });
		const { user } = renderWithProviders(<CharactersPane />);

		await user.click(screen.getByRole('button', { name: 'New character' }));

		expect(actions.startCreate).toHaveBeenCalledTimes(1);
	});
});

describe('CharactersPane editor', () => {
	it('shows the editor only while it is open, above the gallery', () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [ALICE] });
		renderWithProviders(<CharactersPane />);
		expect(screen.queryByRole('heading', { name: 'New character' })).not.toBeInTheDocument();

		act(() => useCharactersStore.setState({ editor: editorState() }));
		const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
		expect(headings.slice(0, 2)).toEqual(['New character', 'Characters']);
		expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveFocus();

		act(() => useCharactersStore.setState({ editor: editorState({ characterId: ALICE_ID }) }));
		expect(screen.getByRole('heading', { name: 'Edit Alice' })).toBeInTheDocument();
	});

	it('names every button and labels every field', () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [ALICE, BOB], editor: editorState({ characterId: ALICE_ID }) });
		renderWithProviders(<CharactersPane />);

		for (const role of ['button', 'switch', 'textbox', 'combobox', 'slider', 'radio'] as const) {
			for (const element of screen.getAllByRole(role)) {
				expect(element).toHaveAccessibleName();
			}
		}
	});
});
