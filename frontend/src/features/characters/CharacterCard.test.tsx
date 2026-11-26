import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { characterImageUrl } from '../../api/config';
import { useCharactersStore } from '../../stores/charactersStore';
import { ALICE_ID, BOB, BOB_ID, character, THUMBNAIL_IMAGE_ID } from '../../test/characterData';
import { seedCharacterActions, seedIpAdapterActions } from '../../test/characterStores';
import { currentDialog, openDialog, waitForDialogClose } from '../../test/dialogs';
import { renderWithProviders } from '../../test/render';
import { hasActionIntent } from '../../test/stateClasses';
import { CharacterCard } from './CharacterCard';

const ALICE = character();

let actions: ReturnType<typeof seedCharacterActions>;

beforeEach(() => {
	actions = seedCharacterActions();
	seedIpAdapterActions();
});

function renderCards(characters = [ALICE, BOB]) {
	useCharactersStore.setState({ loadStatus: 'ready', characters });
	return renderWithProviders(
		<ul>
			{characters.map((item) => (
				<li key={item.id}>
					<CharacterCard character={item} />
				</li>
			))}
		</ul>,
	);
}

/** The card: a group named by the character. */
const card = (name: string) => screen.getByRole('group', { name });
/** The card's selection button (its picture), named by the character. */
const selectButton = (name: string) => within(card(name)).getByRole('button', { name });

describe('CharacterCard content', () => {
	it('shows the thumbnail, the name and the identity tags; a named placeholder without thumbnail', () => {
		renderCards();

		const alice = card('Alice');
		expect(within(alice).getByRole('img', { name: 'Thumbnail of Alice' })).toHaveAttribute('src', characterImageUrl(ALICE_ID, THUMBNAIL_IMAGE_ID));
		expect(within(alice).getByText('1girl, silver hair, blue eyes')).toBeInTheDocument();
		expect(within(card('Bob')).getByRole('img', { name: 'No thumbnail for Bob' })).toBeInTheDocument();
		expect(card('Bob').querySelector('img')).toBeNull();
		expect(within(card('Bob')).getByText('1boy, black hair')).toBeInTheDocument();
	});

	it('shows the full identity tags (clamped on screen only), or says there are none', () => {
		const long = character({ id: 'chr-000000000009', name: 'Long', identity_tags: Array.from({ length: 30 }, (_value, index) => `tag ${index}`) });
		renderCards([long, character({ identity_tags: [] })]);

		expect(within(card('Long')).getByText(/^tag 0, tag 1, .*tag 29$/)).toBeInTheDocument();
		expect(within(card('Alice')).getByText('No identity tags')).toBeInTheDocument();
	});

	it("marks the active character with an 'Active' badge and its switch on", () => {
		useCharactersStore.setState({ activeId: BOB_ID });
		renderCards();

		expect(within(card('Bob')).getByText('Active', { selector: '.fui-Badge' })).toBeInTheDocument();
		expect(within(card('Alice')).queryByText('Active', { selector: '.fui-Badge' })).not.toBeInTheDocument();
		expect(within(card('Bob')).getByRole('switch', { name: 'Active' })).toBeChecked();
	});
});

describe('CharacterCard selection', () => {
	it('selects the card from its picture button; the selected one is aria-current and framed', async () => {
		const { user } = renderCards();
		const unselectedClass = card('Alice').className;

		await user.click(selectButton('Bob'));

		expect(actions.select).toHaveBeenLastCalledWith(BOB_ID);
		expect(selectButton('Bob')).toHaveAttribute('aria-current', 'true');
		expect(selectButton('Alice')).not.toHaveAttribute('aria-current');
		expect(selectButton('Bob')).toHaveAccessibleDescription('1boy, black hair');
		expect(card('Bob').className).not.toBe(unselectedClass);
		expect(card('Alice').className).toBe(unselectedClass);
	});

	it('selects the card from the keyboard (Enter or Space on the picture button)', async () => {
		const { user } = renderCards();

		selectButton('Alice').focus();
		await user.keyboard('{Enter}');
		expect(actions.select).toHaveBeenLastCalledWith(ALICE_ID);
		selectButton('Bob').focus();
		await user.keyboard(' ');
		expect(actions.select).toHaveBeenLastCalledWith(BOB_ID);
	});

	it('a click anywhere on the card selects it, its own controls included', async () => {
		const { user } = renderCards();

		await user.click(within(card('Bob')).getByText('1boy, black hair'));
		expect(actions.select).toHaveBeenLastCalledWith(BOB_ID);
		await user.click(within(card('Alice')).getByRole('switch', { name: 'Active' }));
		expect(actions.select).toHaveBeenLastCalledWith(ALICE_ID);
		expect(actions.toggleActive).toHaveBeenLastCalledWith(ALICE_ID);
		// The card is not a Tab stop of its own: the picture button is.
		expect(card('Alice')).not.toHaveAttribute('tabindex');
	});
});

describe('CharacterCard actions', () => {
	it('activates or deactivates a character in one click', async () => {
		useCharactersStore.setState({ activeId: ALICE_ID });
		const { user } = renderCards();

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
		const { user } = renderCards();

		await user.click(within(card('Bob')).getByRole('button', { name: 'Edit Bob' }));

		expect(actions.startEdit).toHaveBeenCalledWith(BOB_ID);
	});

	it('deletes a character after confirmation only', async () => {
		const { user } = renderCards();

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
		useCharactersStore.setState({ busyIds: { [ALICE_ID]: true } });
		renderCards();

		const alice = card('Alice');
		expect(within(alice).getByRole('switch', { name: 'Active' })).toBeDisabled();
		expect(within(alice).getByRole('button', { name: 'Edit Alice' })).toBeDisabled();
		expect(within(alice).getByRole('button', { name: 'Delete Alice' })).toBeDisabled();
		expect(within(card('Bob')).getByRole('switch', { name: 'Active' })).toBeEnabled();
	});

	it('gives Delete the danger intent (also while disabled), and Edit none', () => {
		useCharactersStore.setState({ busyIds: { [ALICE_ID]: true } });
		renderCards();

		expect(hasActionIntent(within(card('Bob')).getByRole('button', { name: 'Delete Bob' }), 'subtle', 'danger')).toBe(true);
		// Busy: disabled; the danger classes color enabled buttons only, so it keeps Fluent's disabled look.
		expect(within(card('Alice')).getByRole('button', { name: 'Delete Alice' })).toBeDisabled();
		expect(hasActionIntent(within(card('Alice')).getByRole('button', { name: 'Delete Alice' }), 'subtle', 'danger')).toBe(true);
		expect(hasActionIntent(within(card('Bob')).getByRole('button', { name: 'Edit Bob' }), 'subtle', 'danger')).toBe(false);
	});
});
