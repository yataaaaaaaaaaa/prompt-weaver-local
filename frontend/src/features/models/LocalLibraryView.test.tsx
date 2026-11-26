import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LoRASpec, ModelSpec } from '../../api/types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { renderWithProviders } from '../../test/render';
import { LocalLibraryView, ModelFolders } from './LocalLibraryView';
import { INFO, modelSource } from '../../test/modelLibraryData';

const INSTALLED_MODEL: ModelSpec = {
	id: 'model-one',
	name: 'Model One - v1.0',
	path: 'D:/models/checkpoints/model_one.safetensors',
	default_width: 1024,
	default_height: 1024,
	torch_dtype: 'float16',
	source: modelSource(),
};
const LOCAL_MODEL: ModelSpec = { ...INSTALLED_MODEL, id: 'local', name: 'local.safetensors', path: 'C:/sd/local.safetensors', source: null };
const INSTALLED_LORA: LoRASpec = {
	id: 'lora-one',
	name: 'Lora One - v2',
	path: 'D:/models/loras/lora_one.safetensors',
	source: modelSource({ model_id: '2', version_id: '21', version_name: 'v2', base_model: 'SD 1.5', trigger_words: ['blue hair', 'smile'], preview_url: null }),
};
const LOCAL_LORA: LoRASpec = { id: 'local-lora', name: 'local-lora.safetensors', path: 'C:/sd/local-lora.safetensors', source: null };

function seed() {
	const libraryActions = { selectModel: vi.fn(), setLoraSelected: vi.fn(), removeLora: vi.fn() };
	useLibraryStore.setState({
		models: [INSTALLED_MODEL, LOCAL_MODEL],
		loras: [INSTALLED_LORA, LOCAL_LORA],
		selectedModelId: 'local',
		selectedLoras: [{ id: 'lora-one', weight: 0.6 }],
		...libraryActions,
	});
	const catalogActions = { copyTriggerWords: vi.fn(async () => undefined), applyLibraryCheckpoint: vi.fn() };
	useModelCatalogStore.setState({ info: INFO, infoStatus: 'ready', ...catalogActions });
	return { ...libraryActions, ...catalogActions };
}

function entry(listName: string, name: string): HTMLElement {
	return within(screen.getByRole('list', { name: listName })).getByRole('group', { name });
}

// Fluent components render slowly on a busy machine: more than the default 5 s per test.
describe('LocalLibraryView', () => {
	it('shows the provenance of installed checkpoints and marks local files', () => {
		seed();
		renderWithProviders(<LocalLibraryView />);

		const installed = entry('Checkpoints', 'Model One - v1.0');
		expect(within(installed).getByRole('img', { name: 'Model One - v1.0' })).toHaveAttribute('src', 'https://image.example/v1.jpeg');
		expect(within(installed).getByText('Illustrious')).toBeInTheDocument();
		expect(within(installed).getByText('v1.0')).toBeInTheDocument();
		expect(within(installed).getByText('D:/models/checkpoints/model_one.safetensors')).toBeInTheDocument();
		expect(within(installed).queryByText('Local file')).not.toBeInTheDocument();

		const local = entry('Checkpoints', 'local.safetensors');
		expect(within(local).getByText('Local file')).toBeInTheDocument();
		expect(within(local).getByText('C:/sd/local.safetensors')).toBeInTheDocument();
		expect(within(local).queryByRole('img')).not.toBeInTheDocument();
	});

	it("uses a checkpoint for generation through the catalog store's hand-off, and shows the selected one", async () => {
		const actions = seed();
		const { user } = renderWithProviders(<LocalLibraryView />);

		expect(within(entry('Checkpoints', 'local.safetensors')).getByText('Selected')).toBeInTheDocument();
		expect(within(entry('Checkpoints', 'local.safetensors')).queryByRole('button', { name: 'Use' })).not.toBeInTheDocument();
		await user.click(within(entry('Checkpoints', 'Model One - v1.0')).getByRole('button', { name: 'Use' }));

		expect(actions.applyLibraryCheckpoint).toHaveBeenCalledWith('model-one');
		expect(actions.selectModel).not.toHaveBeenCalled();
	});

	it('lists the entries in grids (a card per entry)', () => {
		seed();
		renderWithProviders(<LocalLibraryView />);

		expect(within(screen.getByRole('list', { name: 'Checkpoints' })).getAllByRole('group')).toHaveLength(2);
		expect(within(screen.getByRole('list', { name: 'LoRAs' })).getAllByRole('group')).toHaveLength(2);
		// The model folders are the detail panel's (ModelFolders).
		expect(screen.queryByRole('heading', { name: 'Model folders' })).not.toBeInTheDocument();
	});

	it('toggles the default selection of LoRAs and removes them', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<LocalLibraryView />);

		const installed = entry('LoRAs', 'Lora One - v2');
		const local = entry('LoRAs', 'local-lora.safetensors');
		expect(within(installed).getByRole('checkbox', { name: 'Use by default' })).toBeChecked();
		expect(within(local).getByRole('checkbox', { name: 'Use by default' })).not.toBeChecked();
		expect(within(local).getByText('Local file')).toBeInTheDocument();

		await user.click(within(installed).getByRole('checkbox', { name: 'Use by default' }));
		expect(actions.setLoraSelected).toHaveBeenLastCalledWith('lora-one', false);
		await user.click(within(local).getByRole('checkbox', { name: 'Use by default' }));
		expect(actions.setLoraSelected).toHaveBeenLastCalledWith('local-lora', true);

		await user.click(within(local).getByRole('button', { name: 'Remove local-lora.safetensors from the library' }));
		expect(actions.removeLora).toHaveBeenCalledWith('local-lora');
	});

	it('shows and copies the trigger words of an installed LoRA', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<LocalLibraryView />);

		const installed = entry('LoRAs', 'Lora One - v2');
		expect(within(installed).getByText('SD 1.5')).toBeInTheDocument();
		const words = within(within(installed).getByRole('list', { name: 'Trigger words' })).getAllByRole('listitem');
		expect(words.map((word) => word.textContent)).toEqual(['blue hair', 'smile']);
		expect(within(entry('LoRAs', 'local-lora.safetensors')).queryByRole('button', { name: 'Copy trigger words' })).not.toBeInTheDocument();

		await user.click(within(installed).getByRole('button', { name: 'Copy trigger words' }));
		expect(actions.copyTriggerWords).toHaveBeenCalledWith(['blue hair', 'smile']);
	});

	it('shows the model folders of the backend', () => {
		seed();
		renderWithProviders(<ModelFolders />);

		expect(screen.getByRole('heading', { name: 'Model folders', level: 2 })).toBeInTheDocument();
		expect(screen.getByText(/^Downloads are saved in these folders/)).toBeInTheDocument();
		const folders = screen.getAllByRole('definition');
		expect(folders.map((folder) => folder.textContent)).toEqual(['D:/models/checkpoints', 'D:/models/loras', 'D:/models/embeddings']);
		expect(screen.getAllByRole('term').map((term) => term.textContent)).toEqual(['Checkpoint', 'LoRA', 'Embedding']);
	});

	it('shows the empty states and waits for the folders', () => {
		renderWithProviders(
			<>
				<LocalLibraryView />
				<ModelFolders />
			</>,
		);

		expect(screen.getByText('No checkpoint in the library.')).toBeInTheDocument();
		expect(screen.getByText('No LoRA in the library.')).toBeInTheDocument();
		expect(screen.getByText('The model folders are shown once the model providers are loaded.')).toBeInTheDocument();
	});

	it('names every control', () => {
		seed();
		renderWithProviders(<LocalLibraryView />);

		for (const button of screen.getAllByRole('button')) {
			expect(button).toHaveAccessibleName();
		}
		expect(screen.getAllByRole('checkbox', { name: 'Use by default' })).toHaveLength(2);
	});
});
