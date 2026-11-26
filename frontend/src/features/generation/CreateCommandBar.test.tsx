import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LoRASpec, ModelSpec } from '../../api/types';
import { SHELL_LABELS } from '../../app/sections';
import { useCharactersStore } from '../../stores/charactersStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { ALICE_ID, BOB, character } from '../../test/characterData';
import { seedCharacterActions } from '../../test/characterStores';
import { renderWithProviders } from '../../test/render';
import { CreateCommandBar, LoraCommandContent, loraCountText, ModelCommandContent } from './CreateCommandBar';

// Several user-event interactions with Fluent popovers and tooltips per test: slow on a busy machine.

const MODELS: ModelSpec[] = [
	{ id: 'm1', name: 'Model One', path: 'C:/models/one.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null },
	{ id: 'm2', name: 'Model Two', path: 'C:/models/two', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null },
];
const LORA_A: LoRASpec = { id: 'a', name: 'Lora A', path: 'C:/loras/a.safetensors', source: null };
const LORA_B: LoRASpec = { id: 'b', name: 'Lora B', path: 'C:/loras/b.safetensors', source: null };

function seedLibrary({ withModel = true } = {}) {
	const actions = { selectModel: vi.fn(), addModelFile: vi.fn(async () => undefined), setLoraWeight: vi.fn() };
	useLibraryStore.setState({
		...actions,
		models: withModel ? MODELS : [],
		selectedModelId: withModel ? 'm1' : '',
		loras: [LORA_A, LORA_B],
		selectedLoras: [
			{ id: 'a', weight: 0.6 },
			{ id: 'b', weight: -0.5 },
		],
	});
	return actions;
}

const bar = () => screen.getByRole('toolbar', { name: SHELL_LABELS.createCommandBar });

describe('CreateCommandBar', () => {
	it('shows the model, the character and the LoRA count, one button each', () => {
		seedLibrary();
		seedCharacterActions();
		renderWithProviders(<CreateCommandBar />);

		const buttons = within(bar()).getAllByRole('button');
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Model: Model One', 'Character: No character', 'LoRAs: 2 LoRAs']);
		expect(within(bar()).getByText('Model One')).toBeInTheDocument();
		expect(within(bar()).getByText('No character')).toBeInTheDocument();
		expect(within(bar()).getByText('2 LoRAs')).toBeInTheDocument();
	});

	it('truncates long values on one line and names them in full in the tooltip', async () => {
		const long = { ...MODELS[0], name: `Ultra detailed cinematic checkpoint ${'x'.repeat(80)}` };
		seedLibrary();
		useLibraryStore.setState({ models: [long], selectedModelId: long.id });
		seedCharacterActions();
		const { user } = renderWithProviders(<CreateCommandBar />);

		const value = within(bar()).getByText(long.name);
		expect(getComputedStyle(value).textOverflow).toBe('ellipsis');
		expect(getComputedStyle(value).whiteSpace).toBe('nowrap');
		await user.hover(within(bar()).getByRole('button', { name: `Model: ${long.name}` }));
		expect(await screen.findByRole('tooltip')).toHaveTextContent(`Model: ${long.name}. Change the checkpoint`);
	});

	it('opens the model popover from its button', async () => {
		seedLibrary();
		seedCharacterActions();
		const { user } = renderWithProviders(<CreateCommandBar />);
		const trigger = within(bar()).getByRole('button', { name: 'Model: Model One' });
		expect(trigger).toHaveAttribute('aria-expanded', 'false');

		await user.click(trigger);

		expect(trigger).toHaveAttribute('aria-expanded', 'true');
	});

	it('model popover content: the checkpoint picker, Add model file, Browse models (then closes)', async () => {
		const actions = seedLibrary();
		const onDone = vi.fn();
		const { user } = renderWithProviders(<ModelCommandContent onDone={onDone} />);

		await user.click(screen.getByRole('combobox', { name: 'Checkpoint' }));
		await user.click(screen.getByRole('option', { name: 'Model Two' }));
		expect(actions.selectModel).toHaveBeenCalledWith('m2');

		await user.click(screen.getByRole('button', { name: 'Add model file' }));
		expect(actions.addModelFile).toHaveBeenCalledTimes(1);
		expect(onDone).not.toHaveBeenCalled();
		await user.click(screen.getByRole('button', { name: 'Browse models' }));
		expect(useNavigationStore.getState().section).toBe('models');
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it('says when there is no model', () => {
		seedLibrary({ withModel: false });
		seedCharacterActions();
		renderWithProviders(<CreateCommandBar />);

		expect(within(bar()).getByRole('button', { name: 'Model: No model' })).toBeInTheDocument();
	});

	it('activates a character from its menu, the active one checked; None deactivates', async () => {
		seedLibrary();
		const actions = seedCharacterActions();
		useCharactersStore.setState({ loadStatus: 'ready', characters: [character(), BOB] });
		const { user, unmount } = renderWithProviders(<CreateCommandBar />);

		await user.click(within(bar()).getByRole('button', { name: 'Character: No character' }));
		const menu = await screen.findByRole('menu', {}, { timeout: 5000 });
		const radios = within(menu).getAllByRole('menuitemradio');
		expect(radios.map((radio) => radio.textContent)).toEqual(['None', 'Alice', 'Bob']);
		expect(within(menu).getByRole('menuitemradio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
		await user.click(within(menu).getByRole('menuitemradio', { name: 'Alice' }));
		expect(actions.setActive).toHaveBeenCalledWith(ALICE_ID);
		unmount();

		useCharactersStore.setState({ activeId: ALICE_ID });
		const second = renderWithProviders(<CreateCommandBar />);
		await second.user.click(within(bar()).getByRole('button', { name: 'Character: Alice' }));
		const reopened = await screen.findByRole('menu', {}, { timeout: 5000 });
		expect(within(reopened).getByRole('menuitemradio', { name: 'Alice' })).toHaveAttribute('aria-checked', 'true');
		await second.user.click(within(reopened).getByRole('menuitemradio', { name: 'None' }));
		expect(actions.setActive).toHaveBeenLastCalledWith(null);
	});

	it('creates or manages characters from the character menu', async () => {
		seedLibrary();
		const actions = seedCharacterActions();
		useCharactersStore.setState({ loadStatus: 'ready', characters: [character()] });
		const { user } = renderWithProviders(<CreateCommandBar />);

		await user.click(within(bar()).getByRole('button', { name: 'Character: No character' }));
		await user.click(await screen.findByRole('menuitem', { name: 'New character' }));
		expect(actions.startCreate).toHaveBeenCalledTimes(1);

		await user.click(within(bar()).getByRole('button', { name: 'Character: No character' }));
		await user.click(await screen.findByRole('menuitem', { name: 'Manage characters' }));
		expect(useNavigationStore.getState().section).toBe('characters');
	});

	it('opens the LoRA popover from its button', async () => {
		seedLibrary();
		seedCharacterActions();
		const { user } = renderWithProviders(<CreateCommandBar />);
		const trigger = within(bar()).getByRole('button', { name: 'LoRAs: 2 LoRAs' });

		await user.click(trigger);

		expect(trigger).toHaveAttribute('aria-expanded', 'true');
	});

	it('LoRA popover content: the selected weights; Edit LoRAs expands the generation panel and closes', async () => {
		const actions = seedLibrary();
		useLayoutStore.getState().setRegionCollapsed('generation', true);
		const onDone = vi.fn();
		const { user } = renderWithProviders(<LoraCommandContent onDone={onDone} />);

		const weight = screen.getByRole('spinbutton', { name: 'Weight of Lora A' });
		expect(weight).toHaveValue('0.6');
		await user.click(weight);
		await user.keyboard('{ArrowUp}');
		expect(actions.setLoraWeight).toHaveBeenLastCalledWith('a', 0.65);

		await user.click(screen.getByRole('button', { name: 'Edit LoRAs' }));
		expect(useLayoutStore.getState().collapsed.generation).toBe(false);
		expect(onDone).toHaveBeenCalledTimes(1);
	});

	it('counts the LoRAs in words', () => {
		expect(loraCountText(0)).toBe('No LoRAs');
		expect(loraCountText(1)).toBe('1 LoRA');
		expect(loraCountText(12)).toBe('12 LoRAs');
	});
});
