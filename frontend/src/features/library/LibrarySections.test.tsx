import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
	{ id: 'm1', name: 'Model One', path: 'C:/models/one.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16' },
	{ id: 'm2', name: 'Model Two', path: 'C:/models/two', default_width: 1024, default_height: 1024, torch_dtype: 'float16' },
];

const LORA_A: LoRASpec = { id: 'a', name: 'Lora A', path: 'C:/loras/a.safetensors' };
const LORA_B: LoRASpec = { id: 'b', name: 'Lora B', path: 'C:/loras/b.safetensors' };

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

function seedLoras(rows: LoraRow[], summary = { selected: 0, promptLinked: 0, possibleActive: 0 }) {
	vi.mocked(useLoraRows).mockReturnValue(rows);
	vi.mocked(useLoraSummary).mockReturnValue(summary);
	useLibraryStore.setState({ loras: rows.map((row) => row.lora), selectedLoraIds: rows.filter((row) => row.selected).map((row) => row.lora.id) });
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
		seedLoras(
			[
				{ lora: LORA_A, selected: true, promptLinked: false },
				{ lora: LORA_B, selected: false, promptLinked: true },
			],
			{ selected: 1, promptLinked: 1, possibleActive: 2 },
		);
		renderWithProviders(<LoraSection />);

		const items = within(screen.getByRole('list', { name: 'LoRA library' })).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(within(items[0]).getByRole('checkbox', { name: 'Lora A' })).toBeChecked();
		expect(within(items[0]).queryByText('Prompt-linked')).not.toBeInTheDocument();
		expect(within(items[0]).queryByRole('button', { name: /Remove prompt links/ })).not.toBeInTheDocument();
		expect(within(items[1]).getByRole('checkbox', { name: 'Lora B' })).not.toBeChecked();
		expect(within(items[1]).getByText('Prompt-linked')).toBeInTheDocument();
		expect(screen.getByText('Default selected: 1 · Prompt-linked: 1 · Possible active: 2')).toBeInTheDocument();
	});

	it('selects, unselects, unlinks and removes LoRAs', async () => {
		const actions = seedLibraryActions();
		const unlinkLora = vi.fn();
		useCategoriesStore.setState({ unlinkLora });
		seedLoras([
			{ lora: LORA_A, selected: true, promptLinked: false },
			{ lora: LORA_B, selected: false, promptLinked: true },
		]);
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
		seedLoras([{ lora: LORA_A, selected: true, promptLinked: false }]);
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
		seedLoras([
			{ lora: LORA_A, selected: true, promptLinked: true },
			{ lora: LORA_B, selected: false, promptLinked: true },
		]);
		renderWithProviders(<LoraSection />);

		for (const button of screen.getAllByRole('button')) {
			expect(button).toHaveAccessibleName();
		}
		expect(screen.getAllByRole('button', { name: /^Remove prompt links to / })).toHaveLength(2);
		expect(screen.getAllByRole('button', { name: /from the library$/ })).toHaveLength(2);
	});
});
