import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SECTION_SEARCH_ATTRIBUTE } from '../../app/sections';
import { useCharactersStore } from '../../stores/charactersStore';
import { useIsSectionShown, useNavigationStore } from '../../stores/navigationStore';
import { ALICE_ID, BOB, BOB_ID, character } from '../../test/characterData';
import { editorState, seedCharacterActions, seedIpAdapterActions } from '../../test/characterStores';
import { renderWithProviders } from '../../test/render';
import { hasActionIntent } from '../../test/stateClasses';
import { CharactersSection } from './CharactersSection';

const ALICE = character();

let actions: ReturnType<typeof seedCharacterActions>;

beforeEach(() => {
	actions = seedCharacterActions();
	seedIpAdapterActions();
	useNavigationStore.setState({ section: 'characters', visited: { create: true, characters: true } });
});

function renderSection(state: Partial<ReturnType<typeof useCharactersStore.getState>> = {}) {
	useCharactersStore.setState({ loadStatus: 'ready', characters: [ALICE, BOB], ...state });
	return renderWithProviders(<CharactersSection />);
}

const gallery = () => screen.getByRole('region', { name: 'Character gallery' });
const details = () => screen.getByRole('complementary', { name: 'Character details' });
const search = () => screen.getByRole('searchbox', { name: 'Search characters' });
const nameField = () => screen.getByRole('textbox', { name: /^Name/ });

describe('CharactersSection layout', () => {
	it('has the title, the toolbar (search, count, New character), the gallery and the detail panel', async () => {
		const { user } = renderSection();

		expect(screen.getByRole('heading', { level: 1, name: 'Characters' })).toBeInTheDocument();
		expect(search()).toHaveAttribute(SECTION_SEARCH_ATTRIBUTE);
		expect(search()).toHaveAttribute('placeholder', 'Search by name or tag');
		expect(screen.getByRole('status')).toHaveTextContent('2 characters');
		const newCharacter = screen.getAllByRole('button', { name: 'New character' })[0];
		expect(newCharacter.closest('header')).not.toBeNull();
		await user.click(newCharacter);
		expect(actions.startCreate).toHaveBeenCalledTimes(1);

		const cards = within(within(gallery()).getByRole('list', { name: 'Characters' })).getAllByRole('listitem');
		// Sorted by name.
		expect(cards).toHaveLength(2);
		expect(within(cards[0]).getByRole('group', { name: 'Alice' })).toBeInTheDocument();
		expect(within(cards[1]).getByRole('group', { name: 'Bob' })).toBeInTheDocument();
		expect(within(details()).getByRole('region', { name: 'Reference images (IP-Adapter)' })).toBeInTheDocument();
		// Nothing repeats the section's name as a region.
		expect(screen.queryAllByRole('region', { name: 'Characters' })).toEqual([]);
	});

	it('shows a spinner while the characters load, the error with Retry after a failure', async () => {
		useCharactersStore.setState({ loadStatus: 'loading', characters: [] });
		const { user, unmount } = renderWithProviders(<CharactersSection />);
		expect(within(gallery()).getByText('Loading characters…')).toBeInTheDocument();
		expect(within(gallery()).queryByText('No characters yet')).not.toBeInTheDocument();
		// Nothing counted or said about the details before the collection is known.
		expect(screen.getByRole('status')).toHaveTextContent(/^$/);
		expect(within(details()).queryByText('No character yet')).not.toBeInTheDocument();
		unmount();

		renderSection({ loadStatus: 'failed', loadError: 'The backend is unreachable.', characters: [] });
		expect(screen.getByRole('status')).toHaveTextContent(/^$/);
		expect(within(details()).queryByText('No character yet')).not.toBeInTheDocument();
		expect(within(gallery()).getByText('Could not load the characters')).toBeInTheDocument();
		expect(within(gallery()).getByText('The backend is unreachable.')).toBeInTheDocument();
		await user.click(within(gallery()).getByRole('button', { name: 'Retry' }));
		expect(actions.load).toHaveBeenCalledTimes(1);
	});
});

describe('CharactersSection search', () => {
	it('filters the gallery by name and tags through the store, with the count', async () => {
		const { user } = renderSection();

		await user.type(search(), '1boy');

		expect(actions.setQuery).toHaveBeenLastCalledWith('1boy');
		expect(useCharactersStore.getState().query).toBe('1boy');
		const list = within(gallery()).getByRole('list', { name: 'Characters' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(1);
		expect(within(list).getByRole('group', { name: 'Bob' })).toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('1 of 2 characters');
	});

	it('says when nothing matches, and Clear search shows every character again', async () => {
		const { user } = renderSection({ query: 'dragon' });

		expect(within(gallery()).getByText('No character matches “dragon”')).toBeInTheDocument();
		expect(within(gallery()).queryByRole('list', { name: 'Characters' })).not.toBeInTheDocument();
		expect(screen.getByRole('status')).toHaveTextContent('0 of 2 characters');
		await user.click(within(gallery()).getByRole('button', { name: 'Clear search' }));

		expect(actions.setQuery).toHaveBeenLastCalledWith('');
		expect(within(within(gallery()).getByRole('list', { name: 'Characters' })).getAllByRole('listitem')).toHaveLength(2);
	});
});

describe('CharactersSection empty gallery', () => {
	it('explains the three ways to create a character, each one click away', async () => {
		const { user } = renderSection({ characters: [] });

		expect(within(gallery()).getByText('No characters yet')).toBeInTheDocument();
		const ways = within(within(gallery()).getByRole('list', { name: 'Ways to create a character' })).getAllByRole('listitem');
		expect(ways.map((way) => within(way).getByRole('button').textContent)).toEqual(['New character', 'Go to Create', 'Browse images']);
		expect(ways[1]).toHaveTextContent(/In Create, show the output, then choose Create character/);
		expect(ways[2]).toHaveTextContent(/In Images, open an image, then choose Create character/);
		expect(screen.getByRole('status')).toHaveTextContent('0 characters');
		expect(within(details()).getByText('No character yet')).toBeInTheDocument();

		await user.click(within(ways[0]).getByRole('button'));
		expect(actions.startCreate).toHaveBeenCalledTimes(1);
		await user.click(within(ways[1]).getByRole('button'));
		expect(useNavigationStore.getState().section).toBe('create');
		act(() => useNavigationStore.setState({ section: 'characters' }));
		await user.click(within(ways[2]).getByRole('button'));
		expect(useNavigationStore.getState().section).toBe('images');
	});
});

describe('CharactersSection detail panel', () => {
	it('asks to select a character while none is selected', () => {
		renderSection();

		expect(within(details()).getByText('No character selected')).toBeInTheDocument();
		expect(within(details()).getByText(/Select a character in the gallery/)).toBeInTheDocument();
	});

	it("shows the selected character's details, with Activate (primary), Edit and Delete", async () => {
		const { user } = renderSection();

		await user.click(within(gallery()).getByRole('button', { name: 'Alice' }));

		const alice = within(details()).getByRole('region', { name: 'Alice' });
		const values = alice.querySelector<HTMLElement>('dl[aria-label="Values of Alice"]');
		if (!values) {
			throw new Error('no values list');
		}
		expect(within(values).getAllByRole('term').map((term) => term.textContent)).toEqual([
			'Identity tags',
			'Outfit tags',
			'Negative tags',
			'LoRAs',
			'Seed',
			'Reference focus',
			'Reference strength',
		]);
		expect(within(values).getAllByRole('definition').map((value) => value.textContent)).toEqual([
			'1girl, silver hair, blue eyes',
			'school uniform',
			'short hair',
			'None',
			'1234',
			'Face',
			'0.6',
		]);
		expect(within(alice).getByRole('list', { name: 'Reference images of Alice' })).toBeInTheDocument();
		expect(within(alice).getByText('1 of 4 images')).toBeInTheDocument();

		const activate = within(alice).getByRole('button', { name: 'Activate' });
		await user.click(activate);
		expect(actions.toggleActive).toHaveBeenCalledWith(ALICE_ID);
		await user.click(within(alice).getByRole('button', { name: 'Edit' }));
		expect(actions.startEdit).toHaveBeenCalledWith(ALICE_ID);
		expect(within(alice).getByRole('button', { name: 'Delete Alice' })).toBeInTheDocument();
		expect(hasActionIntent(within(alice).getByRole('button', { name: 'Delete Alice' }), 'subtle', 'danger')).toBe(true);
	});

	it('shows the active state, the seed lock and how to add reference images', () => {
		const bob = { ...BOB, seed: 99, seed_locked: true, loras: [{ id: 'gone', weight: 0.8 }] };
		renderSection({ characters: [ALICE, bob], selectedId: BOB_ID, activeId: BOB_ID });

		const panel = within(details()).getByRole('region', { name: 'Bob' });
		expect(within(panel).getByText('Active', { selector: '.fui-Badge' })).toBeInTheDocument();
		expect(within(panel).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
		expect(within(panel).queryByRole('button', { name: 'Activate' })).not.toBeInTheDocument();
		expect(within(panel).getByText('99 (locked)')).toBeInTheDocument();
		// A LoRA no longer in the library shows its id.
		expect(within(within(panel).getByRole('list', { name: 'LoRAs of Bob' })).getByRole('listitem')).toHaveTextContent('gone · 0.8');
		expect(within(panel).getByText(/None yet: Edit adds some/)).toBeInTheDocument();
	});

	it('shows the editor while it is open (the details hidden), the IP-Adapter section in every state', () => {
		renderSection({ selectedId: ALICE_ID });
		expect(within(details()).getByRole('region', { name: 'Alice' })).toBeInTheDocument();

		act(() => useCharactersStore.setState({ editor: editorState({ characterId: ALICE_ID }) }));
		expect(within(details()).getByRole('region', { name: 'Edit Alice' })).toBeInTheDocument();
		expect(within(details()).queryByRole('region', { name: 'Alice' })).not.toBeInTheDocument();
		expect(within(details()).getByRole('region', { name: 'Reference images (IP-Adapter)' })).toBeInTheDocument();

		act(() => useCharactersStore.setState({ editor: null }));
		expect(within(details()).getByRole('region', { name: 'Alice' })).toBeInTheDocument();
		expect(within(details()).queryByRole('region', { name: 'Edit Alice' })).not.toBeInTheDocument();
	});

	it('names every button and labels every field of the editor', () => {
		renderSection({ editor: editorState({ characterId: ALICE_ID }), selectedId: ALICE_ID });

		for (const role of ['button', 'switch', 'textbox', 'combobox', 'slider', 'radio', 'searchbox'] as const) {
			for (const element of screen.queryAllByRole(role)) {
				expect(element).toHaveAccessibleName();
			}
		}
	});
});

/** The shell's two sections, as far as the focus goes: the Create section with a 'Create character' opener and the
 *  Characters section, each hidden while the other is shown. */
function TwoSections(): JSX.Element {
	const createShown = useIsSectionShown('create');
	const charactersShown = useIsSectionShown('characters');
	return (
		<>
			<div hidden={!createShown}>
				<button type="button">Create character</button>
			</div>
			<div hidden={!charactersShown}>
				<CharactersSection />
			</div>
		</>
	);
}

describe('CharactersSection editor focus', () => {
	it('focuses the name field when the editor opens, and returns the focus to New character when it closes', () => {
		renderSection();
		const newCharacter = screen.getAllByRole('button', { name: 'New character' })[0];
		newCharacter.focus();

		act(() => useCharactersStore.setState({ editor: editorState() }));
		expect(nameField()).toHaveFocus();

		act(() => useCharactersStore.setState({ editor: null }));
		expect(newCharacter).toHaveFocus();
	});

	it('focuses the name field again when an open editor is replaced', () => {
		renderSection({ selectedId: BOB_ID });
		act(() => useCharactersStore.setState({ editor: editorState({ session: 1 }) }));
		within(gallery()).getByRole('button', { name: 'Edit Bob' }).focus();

		act(() => useCharactersStore.setState({ editor: editorState({ session: 2, characterId: BOB_ID }) }));
		expect(nameField()).toHaveFocus();

		// The opener is the latest one: Edit Bob.
		act(() => useCharactersStore.setState({ editor: null }));
		expect(within(gallery()).getByRole('button', { name: 'Edit Bob' })).toHaveFocus();
	});

	it("returns the focus to the details' Edit (kept, hidden, while editing)", () => {
		renderSection({ selectedId: ALICE_ID });
		const edit = within(within(details()).getByRole('region', { name: 'Alice' })).getByRole('button', { name: 'Edit' });
		edit.focus();

		act(() => useCharactersStore.setState({ editor: editorState({ characterId: ALICE_ID }) }));
		expect(nameField()).toHaveFocus();
		act(() => useCharactersStore.setState({ editor: null }));

		expect(edit).toHaveFocus();
	});

	it('after saving a character opened from elsewhere, focuses the primary action of its details', () => {
		renderWithProviders(<TwoSections />);
		act(() => useCharactersStore.setState({ loadStatus: 'ready', characters: [BOB] }));
		act(() => useNavigationStore.setState({ section: 'create' }));
		screen.getByRole('button', { name: 'Create character' }).focus();

		// "Create character" from an output: the editor opens and the Characters section is shown, in one update.
		act(() => {
			useCharactersStore.setState({ editor: editorState({ returnSection: 'create' }) });
			useNavigationStore.setState({ section: 'characters' });
		});
		expect(nameField()).toHaveFocus();

		// Saved: the new character is selected, the section stays shown; its opener is hidden.
		act(() => useCharactersStore.setState({ editor: null, characters: [ALICE, BOB], selectedId: ALICE_ID }));
		expect(screen.getByRole('button', { name: 'Activate' })).toHaveFocus();
	});

	it('after Cancel, returns the focus to the opener in the section it goes back to', () => {
		renderWithProviders(<TwoSections />);
		act(() => useCharactersStore.setState({ loadStatus: 'ready', characters: [BOB] }));
		act(() => useNavigationStore.setState({ section: 'create' }));
		const opener = screen.getByRole('button', { name: 'Create character' });
		opener.focus();
		act(() => {
			useCharactersStore.setState({ editor: editorState({ returnSection: 'create' }) });
			useNavigationStore.setState({ section: 'characters' });
		});

		act(() => {
			useCharactersStore.setState({ editor: null });
			useNavigationStore.setState({ section: 'create' });
		});

		expect(opener).toHaveFocus();
	});

	it('focuses the name field once the section is shown, when the editor opened while it was hidden', () => {
		renderWithProviders(<TwoSections />);
		act(() => useNavigationStore.setState({ section: 'create' }));

		act(() => useCharactersStore.setState({ loadStatus: 'ready', characters: [BOB], editor: editorState() }));
		expect(screen.getByRole('textbox', { name: /^Name/, hidden: true })).not.toHaveFocus();

		act(() => useNavigationStore.setState({ section: 'characters' }));
		expect(nameField()).toHaveFocus();
	});

	it('after a deletion took the focused Delete away, focuses the details of the selection, else New character', () => {
		renderSection({ characters: [ALICE, BOB, character({ id: 'chr-000000000003', name: 'Carl' })], selectedId: BOB_ID });
		within(gallery()).getByRole('button', { name: 'Delete Alice' }).focus();

		act(() => useCharactersStore.setState({ characters: [BOB, character({ id: 'chr-000000000003', name: 'Carl' })] }));
		expect(within(details()).getByRole('button', { name: 'Activate' })).toHaveFocus();

		// The selected one, deleted from its details: nothing is selected any more.
		within(details()).getByRole('button', { name: 'Delete Bob' }).focus();
		act(() => useCharactersStore.setState({ characters: [character({ id: 'chr-000000000003', name: 'Carl' })], selectedId: null }));
		expect(screen.getAllByRole('button', { name: 'New character' })[0]).toHaveFocus();

		// A focus elsewhere is left alone.
		search().focus();
		act(() => useCharactersStore.setState({ characters: [] }));
		expect(search()).toHaveFocus();
	});

	it('falls back to New character without a selection, and leaves a focus the user moved elsewhere', () => {
		renderSection();
		act(() => useCharactersStore.setState({ editor: editorState() }));
		act(() => useCharactersStore.setState({ editor: null }));
		// Nothing had the focus before the editor opened: New character.
		expect(screen.getAllByRole('button', { name: 'New character' })[0]).toHaveFocus();

		act(() => useCharactersStore.setState({ editor: editorState({ session: 3 }) }));
		search().focus();
		act(() => useCharactersStore.setState({ editor: null }));
		expect(search()).toHaveFocus();
	});
});
