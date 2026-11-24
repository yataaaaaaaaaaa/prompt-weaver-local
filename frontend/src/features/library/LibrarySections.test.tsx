import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LORA_WEIGHT_DEFAULTS } from '../../api/defaults.gen';
import type { LoRASpec, ModelSpec } from '../../api/types';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useLibraryStore, useLoraRows, useLoraSummary, type LoraRow } from '../../stores/libraryStore';
import { renderWithProviders } from '../../test/render';
import { LoraSection } from './LoraSection';
import { ModelSection } from './ModelSection';

// Prompt links are derived by the library store from the categories store: the view is tested against
// the contract of useLoraRows / useLoraSummary.
vi.mock('../../stores/libraryStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/libraryStore')>();
	return { ...actual, useLoraRows: vi.fn(), useLoraSummary: vi.fn() };
});

const MODELS: ModelSpec[] = [
	{ id: 'm1', name: 'Model One', path: 'C:/models/one.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null },
	{ id: 'm2', name: 'Model Two', path: 'C:/models/two', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null },
];

const LORA_A: LoRASpec = { id: 'a', name: 'Lora A', path: 'C:/loras/a.safetensors', source: null };
const LORA_B: LoRASpec = { id: 'b', name: 'Lora B', path: 'C:/loras/b.safetensors', source: null };

function seedLibraryActions() {
	const actions = {
		selectModel: vi.fn(),
		addModelFile: vi.fn(async () => undefined),
		addModelDirectory: vi.fn(async () => undefined),
		addLoraFiles: vi.fn(async () => undefined),
		addLoraDirectory: vi.fn(async () => undefined),
		setLoraSelected: vi.fn(),
		clearSelectedLoras: vi.fn(),
		removeLora: vi.fn(),
	};
	useLibraryStore.setState(actions);
	return actions;
}

/** A LoRA list row as useLoraRows builds it (weight null when unselected). */
function row(lora: LoRASpec, weight: number | null, promptLinked = false): LoraRow {
	return { lora, selected: weight !== null, weight, promptLinked };
}

function seedLoras(rows: LoraRow[], summary = { selected: 0, promptLinked: 0, possibleActive: 0 }) {
	vi.mocked(useLoraRows).mockReturnValue(rows);
	vi.mocked(useLoraSummary).mockReturnValue(summary);
	useLibraryStore.setState({
		loras: rows.map((item) => item.lora),
		selectedLoras: rows.flatMap((item) => (item.weight === null ? [] : [{ id: item.lora.id, weight: item.weight }])),
	});
}

/** The real row/summary hooks (derived from the library and categories stores) instead of the contract mocks. */
async function withRealLoraHooks() {
	const actual = await vi.importActual<typeof import('../../stores/libraryStore')>('../../stores/libraryStore');
	vi.mocked(useLoraRows).mockImplementation(actual.useLoraRows);
	vi.mocked(useLoraSummary).mockImplementation(actual.useLoraSummary);
}

beforeEach(() => {
	vi.mocked(useLoraRows).mockReset().mockReturnValue([]);
	vi.mocked(useLoraSummary).mockReset().mockReturnValue({ selected: 0, promptLinked: 0, possibleActive: 0 });
});

describe('ModelSection', () => {
	it('shows the empty state without models', () => {
		seedLibraryActions();
		renderWithProviders(<ModelSection />);

		const dropdown = screen.getByRole('combobox', { name: 'Checkpoint' });
		expect(dropdown).toBeDisabled();
		expect(dropdown).toHaveTextContent('No model available');
	});

	it('selects a model', async () => {
		const actions = seedLibraryActions();
		useLibraryStore.setState({ models: MODELS, selectedModelId: 'm1' });
		const { user } = renderWithProviders(<ModelSection />);
		const dropdown = screen.getByRole('combobox', { name: 'Checkpoint' });
		expect(dropdown).toHaveTextContent('Model One');

		await user.click(dropdown);
		await user.click(screen.getByRole('option', { name: 'Model Two' }));

		expect(actions.selectModel).toHaveBeenCalledWith('m2');
	});

	it('adds a model file or folder through the store', async () => {
		const actions = seedLibraryActions();
		const { user } = renderWithProviders(<ModelSection />);

		await user.click(screen.getByRole('button', { name: 'Add model file' }));
		await user.click(screen.getByRole('button', { name: 'Add model folder' }));

		expect(actions.addModelFile).toHaveBeenCalledTimes(1);
		expect(actions.addModelDirectory).toHaveBeenCalledTimes(1);
	});
});

describe('LoraSection', () => {
	it('shows the empty state and the summary', () => {
		seedLibraryActions();
		renderWithProviders(<LoraSection />);

		expect(screen.getByText('No LoRAs loaded.')).toBeInTheDocument();
		expect(screen.getByText('Default selected: 0 · Prompt-linked: 0 · Possible active: 0')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
	});

	it('renders rows with selection, prompt links and the summary', () => {
		seedLibraryActions();
		seedLoras([row(LORA_A, 0.6), row(LORA_B, null, true)], { selected: 1, promptLinked: 1, possibleActive: 2 });
		renderWithProviders(<LoraSection />);

		const items = within(screen.getByRole('list', { name: 'LoRA library' })).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(within(items[0]).getByRole('checkbox', { name: 'Lora A' })).toBeChecked();
		expect(within(items[0]).queryByText('Prompt-linked')).not.toBeInTheDocument();
		expect(within(items[0]).queryByRole('button', { name: /Remove prompt links/ })).not.toBeInTheDocument();
		expect(within(items[1]).getByRole('checkbox', { name: 'Lora B' })).not.toBeChecked();
		expect(within(items[1]).getByText('Prompt-linked')).toBeInTheDocument();
		expect(screen.getByText('Default selected: 1 · Prompt-linked: 1 · Possible active: 2')).toBeInTheDocument();
		// Only selected LoRAs have a weight editor.
		expect(within(items[0]).getByRole('spinbutton', { name: 'Weight of Lora A' })).toHaveValue('0.6');
		expect(within(items[1]).queryByRole('spinbutton')).not.toBeInTheDocument();
	});

	it('selects, unselects, unlinks and removes LoRAs', async () => {
		const actions = seedLibraryActions();
		const unlinkLora = vi.fn();
		useCategoriesStore.setState({ unlinkLora });
		seedLoras([row(LORA_A, 1), row(LORA_B, null, true)]);
		const { user } = renderWithProviders(<LoraSection />);

		await user.click(screen.getByRole('checkbox', { name: 'Lora A' }));
		expect(actions.setLoraSelected).toHaveBeenLastCalledWith('a', false);
		await user.click(screen.getByRole('checkbox', { name: 'Lora B' }));
		expect(actions.setLoraSelected).toHaveBeenLastCalledWith('b', true);

		await user.click(screen.getByRole('button', { name: 'Remove prompt links to Lora B' }));
		expect(unlinkLora).toHaveBeenCalledWith('b');

		await user.click(screen.getByRole('button', { name: 'Delete Lora A from the library' }));
		expect(actions.removeLora).toHaveBeenCalledWith('a');
	});

	it('clears the selection and adds files or folders', async () => {
		const actions = seedLibraryActions();
		seedLoras([row(LORA_A, 1)]);
		const { user } = renderWithProviders(<LoraSection />);

		await user.click(screen.getByRole('button', { name: 'Clear' }));
		await user.click(screen.getByRole('button', { name: 'Add files' }));
		await user.click(screen.getByRole('button', { name: 'Add folder' }));

		expect(actions.clearSelectedLoras).toHaveBeenCalledTimes(1);
		expect(actions.addLoraFiles).toHaveBeenCalledTimes(1);
		expect(actions.addLoraDirectory).toHaveBeenCalledTimes(1);
	});

	it('names every icon-only button', () => {
		seedLibraryActions();
		seedLoras([row(LORA_A, 1, true), row(LORA_B, null, true)]);
		renderWithProviders(<LoraSection />);

		for (const button of screen.getAllByRole('button')) {
			expect(button).toHaveAccessibleName();
		}
		expect(screen.getAllByRole('button', { name: /^Remove prompt links to / })).toHaveLength(2);
		expect(screen.getAllByRole('button', { name: /from the library$/ })).toHaveLength(2);
	});
});

describe('LoraSection weights', () => {
	it('configures the weight editor from LORA_WEIGHT_DEFAULTS and steps through the store action', async () => {
		const setLoraWeight = vi.fn();
		seedLibraryActions();
		useLibraryStore.setState({ setLoraWeight });
		seedLoras([row(LORA_A, 0.6)]);
		const { user } = renderWithProviders(<LoraSection />);

		const weight = screen.getByRole('spinbutton', { name: 'Weight of Lora A' });
		expect(weight).toHaveAttribute('aria-valuemin', String(LORA_WEIGHT_DEFAULTS.min));
		expect(weight).toHaveAttribute('aria-valuemax', String(LORA_WEIGHT_DEFAULTS.max));
		expect(weight).toHaveAttribute('aria-valuenow', '0.6');
		// Compact field sized in characters (no hard-coded width).
		expect(weight).toHaveAttribute('size', '5');

		await user.click(weight);
		await user.keyboard('{ArrowUp}');
		expect(setLoraWeight).toHaveBeenLastCalledWith('a', 0.65);
		await user.keyboard('{ArrowDown}');
		expect(setLoraWeight).toHaveBeenLastCalledWith('a', 0.55);
	});

	it('typing a weight updates the store, clamped to the accepted range; unparseable text is ignored', async () => {
		await withRealLoraHooks();
		useLibraryStore.setState({ loras: [LORA_A, LORA_B], selectedLoras: [{ id: 'a', weight: 0.6 }] });
		const { user } = renderWithProviders(<LoraSection />);
		const weight = screen.getByRole('spinbutton', { name: 'Weight of Lora A' });
		expect(weight).toHaveValue('0.6');

		await user.clear(weight);
		await user.type(weight, '0.35{Enter}');
		expect(useLibraryStore.getState().selectedLoras).toEqual([{ id: 'a', weight: 0.35 }]);
		expect(weight).toHaveValue('0.35');

		await user.clear(weight);
		await user.type(weight, '25');
		await user.tab();
		expect(useLibraryStore.getState().selectedLoras).toEqual([{ id: 'a', weight: LORA_WEIGHT_DEFAULTS.max }]);
		expect(weight).toHaveValue(String(LORA_WEIGHT_DEFAULTS.max));

		await user.clear(weight);
		await user.type(weight, 'heavy{Enter}');
		expect(useLibraryStore.getState().selectedLoras).toEqual([{ id: 'a', weight: LORA_WEIGHT_DEFAULTS.max }]);
		expect(weight).toHaveValue(String(LORA_WEIGHT_DEFAULTS.max));

		await user.clear(weight);
		await user.type(weight, '-1.25{Enter}{ArrowUp}');
		expect(useLibraryStore.getState().selectedLoras).toEqual([{ id: 'a', weight: -1.2 }]);
		expect(weight).toHaveValue('-1.2');
	});

	it('the weight editor appears when a LoRA is selected (default weight) and goes away when unselected', async () => {
		await withRealLoraHooks();
		useLibraryStore.setState({ loras: [LORA_A, LORA_B], selectedLoras: [] });
		const { user } = renderWithProviders(<LoraSection />);
		expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();

		await user.click(screen.getByRole('checkbox', { name: 'Lora B' }));
		expect(screen.getByRole('spinbutton', { name: 'Weight of Lora B' })).toHaveValue(String(LORA_WEIGHT_DEFAULTS.weight));
		expect(screen.queryByRole('spinbutton', { name: 'Weight of Lora A' })).not.toBeInTheDocument();

		await user.click(screen.getByRole('checkbox', { name: 'Lora B' }));
		expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
		expect(useLibraryStore.getState().selectedLoras).toEqual([]);
	});
});
