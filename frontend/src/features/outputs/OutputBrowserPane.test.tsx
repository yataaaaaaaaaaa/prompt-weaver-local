import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCharactersStore } from '../../stores/charactersStore';
import { useCurrentOutputDetails, useOutputsStore, type CurrentOutputDetails } from '../../stores/outputsStore';
import { outputCharacter } from '../../test/characterData';
import { renderWithProviders } from '../../test/render';
import { hasActionIntent } from '../../test/stateClasses';
import { OutputBrowserPane } from './OutputBrowserPane';

// The details derivation (record + library names) is the outputs store's; this view only renders it.
vi.mock('../../stores/outputsStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/outputsStore')>();
	return { ...actual, useCurrentOutputDetails: vi.fn() };
});
vi.mock('../generation/GenerationProgress', () => ({ GenerationProgress: () => <div data-testid="generation-progress" /> }));

const DETAILS: CurrentOutputDetails = {
	outputId: '0000000002',
	imageName: '0000000002.png',
	generatedAt: '2026-11-24T10:00:00Z',
	width: 832,
	height: 1216,
	steps: 28,
	guidanceScale: 5.5,
	seed: 123456,
	promptSeed: 77,
	modelName: 'Noobai v50',
	loras: [
		{ name: 'Detail tweaker', weight: 0.6 },
		{ name: 'Film grain', weight: -1.25 },
	],
	prompt: '1girl, red hair',
	negativePrompt: 'lowres',
	character: null,
};

function stubActions() {
	const actions = {
		first: vi.fn(async () => undefined),
		previous: vi.fn(async () => undefined),
		next: vi.fn(async () => undefined),
		last: vi.fn(async () => undefined),
		deleteCurrent: vi.fn(async () => undefined),
		copyCurrentPrompt: vi.fn(async () => undefined),
	};
	useOutputsStore.setState(actions);
	return actions;
}

const button = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) });

let actions: ReturnType<typeof stubActions>;

beforeEach(() => {
	actions = stubActions();
	vi.mocked(useCurrentOutputDetails).mockReturnValue(null);
});

describe('OutputBrowserPane navigation', () => {
	it('enables only the moves that exist from the current output', () => {
		useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003'], currentId: '0000000003' });
		renderWithProviders(<OutputBrowserPane />);

		expect(button('First output')).toBeEnabled();
		expect(button('Previous output')).toBeEnabled();
		expect(button('Next output')).toBeDisabled();
		expect(button('Last output')).toBeDisabled();
		expect(button('Delete')).toBeEnabled();
	});

	it('disables everything without outputs', () => {
		useOutputsStore.setState({ ids: [], currentId: null });
		renderWithProviders(<OutputBrowserPane />);

		for (const name of ['First output', 'Previous output', 'Next output', 'Last output', 'Delete', 'Copy prompt']) {
			expect(button(name)).toBeDisabled();
		}
		expect(screen.getByText('No outputs yet: generate an image to see its details here.')).toBeInTheDocument();
	});

	it('says when outputs exist but none is selected', () => {
		useOutputsStore.setState({ ids: ['0000000001'], currentId: null });
		renderWithProviders(<OutputBrowserPane />);

		expect(screen.getByText('No output selected.')).toBeInTheDocument();
		expect(button('Delete')).toBeDisabled();
	});

	it('shows Delete as the danger action, disabled without an output', () => {
		useOutputsStore.setState({ ids: ['0000000001'], currentId: '0000000001' });
		const { unmount } = renderWithProviders(<OutputBrowserPane />);
		expect(hasActionIntent(button('Delete'), 'filled', 'danger')).toBe(true);
		unmount();

		useOutputsStore.setState({ ids: [], currentId: null });
		renderWithProviders(<OutputBrowserPane />);
		expect(button('Delete')).toBeDisabled();
		expect(hasActionIntent(button('Delete'), 'filled', 'danger')).toBe(true);
	});

	it('calls the outputs store actions', async () => {
		useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003'], currentId: '0000000002' });
		vi.mocked(useCurrentOutputDetails).mockReturnValue(DETAILS);
		const { user } = renderWithProviders(<OutputBrowserPane />);

		await user.click(button('First output'));
		await user.click(button('Previous output'));
		await user.click(button('Next output'));
		await user.click(button('Last output'));
		await user.click(button('Delete'));
		await user.click(button('Copy prompt'));

		expect(actions.first).toHaveBeenCalledTimes(1);
		expect(actions.previous).toHaveBeenCalledTimes(1);
		expect(actions.next).toHaveBeenCalledTimes(1);
		expect(actions.last).toHaveBeenCalledTimes(1);
		expect(actions.deleteCurrent).toHaveBeenCalledTimes(1);
		expect(actions.copyCurrentPrompt).toHaveBeenCalledTimes(1);
	});

	it('announces the arrow-key shortcuts and shows the progress view', () => {
		useOutputsStore.setState({ ids: ['0000000001'], currentId: '0000000001' });
		renderWithProviders(<OutputBrowserPane />);

		expect(button('Previous output')).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowUp');
		expect(button('Next output')).toHaveAttribute('aria-keyshortcuts', 'ArrowRight ArrowDown');
		expect(screen.getByText(/Use the arrow keys to navigate the output folder/)).toBeInTheDocument();
		expect(screen.getByTestId('generation-progress')).toBeInTheDocument();
	});
});

describe('OutputBrowserPane details', () => {
	it('lists the metadata of the current output', () => {
		useOutputsStore.setState({ ids: ['0000000001', '0000000002', '0000000003'], currentId: '0000000002' });
		vi.mocked(useCurrentOutputDetails).mockReturnValue(DETAILS);
		renderWithProviders(<OutputBrowserPane />);

		const list = within(screen.getByLabelText('Output details'));
		const value = (term: string) => list.getByText(term).nextElementSibling?.textContent;
		expect(value('Output')).toBe('#0000000002');
		expect(value('Position')).toBe('2 / 3');
		expect(value('Image name')).toBe('0000000002.png');
		expect(value('Size')).toBe('832 × 1216');
		expect(value('Steps')).toBe('28');
		expect(value('CFG')).toBe('5.5');
		expect(value('Seed')).toBe('123456');
		expect(value('Prompt seed')).toBe('77');
		expect(value('Model')).toBe('Noobai v50');
		// One line per LoRA: a name and its weight never wrap apart from the next LoRA.
		const loras = within(list.getByText('LoRAs').nextElementSibling as HTMLElement).getAllByRole('listitem');
		expect(loras.map((item) => item.textContent)).toEqual(['Detail tweaker (0.6)', 'Film grain (-1.25)']);
		// A long name is truncated, its weight never is.
		const name = within(loras[1]).getByText('Film grain');
		expect(getComputedStyle(name).textOverflow).toBe('ellipsis');
		expect(getComputedStyle(within(loras[1]).getByText('(-1.25)')).flexShrink).toBe('0');
		expect(button('Copy prompt')).toBeEnabled();
	});

	it('shows placeholders for missing optional values', () => {
		useOutputsStore.setState({ ids: ['0000000002'], currentId: '0000000002' });
		vi.mocked(useCurrentOutputDetails).mockReturnValue({ ...DETAILS, promptSeed: null, loras: [], prompt: '' });
		renderWithProviders(<OutputBrowserPane />);

		const list = within(screen.getByLabelText('Output details'));
		expect(list.getByText('Prompt seed').nextElementSibling).toHaveTextContent('—');
		expect(list.getByText('LoRAs').nextElementSibling).toHaveTextContent('None');
		expect(button('Copy prompt')).toBeDisabled();
	});

	it('shows a spinner while the record loads', () => {
		useOutputsStore.setState({ ids: ['0000000002'], currentId: '0000000002', loadingRecord: true });
		renderWithProviders(<OutputBrowserPane />);
		expect(screen.getByText('Loading output details…')).toBeInTheDocument();
	});
});

describe('OutputBrowserPane characters', () => {
	it('creates a character from the current output', async () => {
		const startCreateFromOutput = vi.fn();
		useCharactersStore.setState({ startCreateFromOutput });
		useOutputsStore.setState({ ids: ['0000000002'], currentId: '0000000002' });
		vi.mocked(useCurrentOutputDetails).mockReturnValue(DETAILS);
		const { user } = renderWithProviders(<OutputBrowserPane />);

		await user.click(button('Create character'));

		expect(startCreateFromOutput).toHaveBeenCalledTimes(1);
	});

	it('disables Create character without an output', () => {
		useOutputsStore.setState({ ids: [], currentId: null });
		renderWithProviders(<OutputBrowserPane />);

		expect(button('Create character')).toBeDisabled();
	});

	it("shows the output's character and how its references were used", () => {
		useOutputsStore.setState({ ids: ['0000000002'], currentId: '0000000002' });
		vi.mocked(useCurrentOutputDetails).mockReturnValue({ ...DETAILS, character: outputCharacter() });
		const { unmount } = renderWithProviders(<OutputBrowserPane />);

		const list = within(screen.getByLabelText('Output details'));
		expect(list.getByText('Character').nextElementSibling).toHaveTextContent('Alice · references applied (strength 0.6, 1 image)');
		unmount();

		vi.mocked(useCurrentOutputDetails).mockReturnValue(DETAILS);
		renderWithProviders(<OutputBrowserPane />);
		expect(within(screen.getByLabelText('Output details')).queryByText('Character')).not.toBeInTheDocument();
	});
});
