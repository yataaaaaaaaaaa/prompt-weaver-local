import { act, fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { characterImageUrl } from '../../api/config';
import { useCharactersStore } from '../../stores/charactersStore';
import { useIpAdapterStore } from '../../stores/ipAdapterStore';
import { ALICE_ID, BOB, BOB_ID, character, ipAdapterStatus, THUMBNAIL_IMAGE_ID } from '../../test/characterData';
import { renderWithProviders } from '../../test/render';
import { ActiveCharacterSection } from './ActiveCharacterSection';
import { seedCharacterActions, seedIpAdapterActions } from '../../test/characterStores';

const ALICE = character();

let actions: ReturnType<typeof seedCharacterActions>;
let ipAdapterActions: ReturnType<typeof seedIpAdapterActions>;

beforeEach(() => {
	actions = seedCharacterActions();
	ipAdapterActions = seedIpAdapterActions();
});

describe('ActiveCharacterSection without an active character', () => {
	it('activates a character picked in the dropdown', async () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [BOB, ALICE] });
		const { user } = renderWithProviders(<ActiveCharacterSection />);

		expect(screen.getByRole('heading', { name: 'Character' })).toBeInTheDocument();
		const dropdown = screen.getByRole('combobox', { name: 'Active character' });
		expect(dropdown).toHaveTextContent('None');
		await user.click(dropdown);
		expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Alice', 'Bob']);
		await user.click(screen.getByRole('option', { name: 'Bob' }));

		expect(actions.setActive).toHaveBeenCalledWith(BOB_ID);
		// No reference support is asked for without an active character.
		expect(ipAdapterActions.refresh).not.toHaveBeenCalled();
	});

	it('creates a new character, also when there is none yet', async () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [] });
		const { user } = renderWithProviders(<ActiveCharacterSection />);

		const dropdown = screen.getByRole('combobox', { name: 'Active character' });
		expect(dropdown).toBeDisabled();
		expect(dropdown).toHaveTextContent('No characters yet');
		await user.click(screen.getByRole('button', { name: 'New character' }));

		expect(actions.startCreate).toHaveBeenCalledTimes(1);
	});
});

describe('ActiveCharacterSection with an active character', () => {
	it('shows its thumbnail, name and tags, and deactivates it', async () => {
		useCharactersStore.setState({ loadStatus: 'ready', characters: [ALICE, BOB], activeId: ALICE_ID });
		const { user } = renderWithProviders(<ActiveCharacterSection />);

		expect(screen.queryByRole('combobox', { name: 'Active character' })).not.toBeInTheDocument();
		const avatar = screen.getByRole('img', { name: 'Alice' });
		expect(avatar.querySelector('img')).toHaveAttribute('src', characterImageUrl(ALICE_ID, THUMBNAIL_IMAGE_ID));
		expect(screen.getByText('1girl, silver hair, blue eyes')).toBeInTheDocument();
		expect(screen.queryByText(/Seed locked/)).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Deactivate' }));
		expect(actions.toggleActive).toHaveBeenCalledWith(ALICE_ID);
	});

	it('shows the seed lock', () => {
		useCharactersStore.setState({ characters: [character({ seed: 77, seed_locked: true })], activeId: ALICE_ID });
		renderWithProviders(<ActiveCharacterSection />);

		expect(screen.getByText('Seed locked to 77')).toBeInTheDocument();
	});

	it('sets the reference strength (committed on release, shown until saved) and shows the support of its focus', async () => {
		useCharactersStore.setState({ characters: [character({ reference_focus: 'face' })], activeId: ALICE_ID });
		useIpAdapterStore.setState({ status: ipAdapterStatus(), loadStatus: 'ready' });
		let finishSave: () => void = () => undefined;
		actions.setReferenceStrength.mockImplementation(() => new Promise<undefined>((resolve) => (finishSave = () => resolve(undefined))));
		renderWithProviders(<ActiveCharacterSection />);

		const slider = screen.getByRole('slider', { name: 'Reference strength' });
		expect(slider).toHaveValue('0.6');
		fireEvent.change(slider, { target: { value: '0.75' } });
		expect(actions.setReferenceStrength).not.toHaveBeenCalled();
		fireEvent.pointerUp(slider);
		expect(actions.setReferenceStrength).toHaveBeenCalledTimes(1);
		expect(actions.setReferenceStrength).toHaveBeenCalledWith(ALICE_ID, 0.75);
		// The committed value stays shown while the backend saves it...
		expect(slider).toHaveValue('0.75');
		await act(async () => {
			useCharactersStore.setState({ characters: [character({ reference_strength: 0.75 })] });
			finishSave();
		});
		// ...then the saved character's value is shown.
		expect(slider).toHaveValue('0.75');
		expect(slider).toHaveAttribute('aria-valuetext', '0.75');

		expect(ipAdapterActions.refresh).toHaveBeenCalled();
		expect(screen.getByText('Download the IP-Adapter to use reference images.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
	});

	it('explains how to add reference images when it has none', () => {
		useCharactersStore.setState({ characters: [character({ reference_images: [], thumbnail: null })], activeId: ALICE_ID });
		renderWithProviders(<ActiveCharacterSection />);

		expect(screen.getByText(/No reference images: add some in the Characters pane/)).toBeInTheDocument();
		expect(screen.queryByRole('slider')).not.toBeInTheDocument();
		// No thumbnail: the avatar shows the initials.
		const avatar = screen.getByRole('img', { name: 'Alice' });
		expect(avatar.querySelector('img')).toBeNull();
		expect(avatar).toHaveTextContent('A');
	});

	it('disables Deactivate while the character is busy', () => {
		useCharactersStore.setState({ characters: [ALICE], activeId: ALICE_ID, busyIds: { [ALICE_ID]: true } });
		renderWithProviders(<ActiveCharacterSection />);

		expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled();
	});
});
