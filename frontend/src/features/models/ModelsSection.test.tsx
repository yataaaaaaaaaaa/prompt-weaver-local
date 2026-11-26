import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SECTION_SEARCH_ATTRIBUTE } from '../../app/sections';
import { modelKey } from '../../domain/modelCatalog';
import { useLibraryStore } from '../../stores/libraryStore';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { renderWithProviders } from '../../test/render';
import { INFO, installEntry, remoteModel, remoteVersion } from '../../test/modelLibraryData';
import { ModelsSection } from './ModelsSection';

const FIRST = remoteModel({ id: '1', name: 'Model One' });
const SECOND = remoteModel({ id: '2', name: 'Model Two', kind: 'lora', versions: [remoteVersion({ id: '21', trigger_words: ['smile'] })] });

/** Actions replaced before rendering; selectModel / closeModel / setView update the state like the store does. */
function seed() {
	const actions = {
		activate: vi.fn(async () => undefined),
		selectModel: vi.fn((key: string) => useModelCatalogStore.setState({ selectedModelKey: key })),
		closeModel: vi.fn(() => useModelCatalogStore.setState({ selectedModelKey: null })),
		setView: vi.fn((view: 'online' | 'local') => useModelCatalogStore.setState({ view })),
		applyLibraryCheckpoint: vi.fn(),
	};
	useModelCatalogStore.setState({ ...actions, info: INFO, infoStatus: 'ready', searchStatus: 'ready', results: [FIRST, SECOND] });
	return actions;
}

// Full sections render many Fluent components: slower than the default 5 s on a busy machine.
describe('ModelsSection', () => {
	it('activates the catalog store once on mount', () => {
		const { activate } = seed();
		const { rerender } = renderWithProviders(<ModelsSection />);
		rerender(<ModelsSection />);

		expect(activate).toHaveBeenCalledTimes(1);
	});

	it('lays out the title, the toolbar, the results grid and the empty detail panel', () => {
		seed();
		renderWithProviders(<ModelsSection />);

		expect(screen.getByRole('heading', { name: 'Models', level: 1 })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Online' })).toHaveAttribute('aria-selected', 'true');
		const search = screen.getByRole('searchbox', { name: 'Search models' });
		expect(search).toHaveAttribute(SECTION_SEARCH_ATTRIBUTE);
		const filters = screen.getByRole('group', { name: 'Model filters' });
		for (const name of ['Type', 'Base model', 'Sort by']) {
			expect(within(filters).getByRole('combobox', { name })).toBeInTheDocument();
		}
		expect(within(filters).getByRole('switch', { name: 'Show NSFW' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Civitai token' })).toBeInTheDocument();

		const results = screen.getByRole('region', { name: 'Model search results' });
		const cards = within(within(results).getByRole('list', { name: 'Search results' })).getAllByRole('listitem');
		expect(cards).toHaveLength(2);

		const detail = screen.getByRole('complementary', { name: 'Model details' });
		expect(within(detail).getByRole('heading', { name: 'Pick a model to see its versions, files and trigger words' })).toBeInTheDocument();
	});

	it('shows the model picked in the grid next to it, and Escape returns to its card', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ModelsSection />);

		await user.click(screen.getByRole('button', { name: 'Model Two' }));

		expect(actions.selectModel).toHaveBeenCalledWith(modelKey(SECOND));
		const detail = screen.getByRole('complementary', { name: 'Model details' });
		expect(within(detail).getByRole('heading', { name: 'Model Two', level: 2 })).toHaveFocus();
		expect(within(detail).getByRole('combobox', { name: 'Version' })).toBeInTheDocument();
		expect(within(detail).getByRole('list', { name: 'Trigger words' })).toBeInTheDocument();
		// The grid stays, the shown card is marked.
		expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Model Two' })).toHaveAttribute('aria-current', 'true');

		await user.keyboard('{Escape}');

		expect(actions.closeModel).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Model Two' })).toHaveFocus();
		expect(screen.getByRole('heading', { name: 'Pick a model to see its versions, files and trigger words' })).toBeInTheDocument();
	});

	it('Close returns the focus to the card too', async () => {
		seed();
		const { user } = renderWithProviders(<ModelsSection />);

		await user.click(screen.getByRole('button', { name: 'Model One' }));
		await user.click(screen.getByRole('button', { name: 'Close details' }));

		expect(screen.getByRole('button', { name: 'Model One' })).toHaveFocus();
	});

	it('shows the empty detail when the selected model is no longer listed', () => {
		seed();
		useModelCatalogStore.setState({ selectedModelKey: modelKey(SECOND) });
		renderWithProviders(<ModelsSection />);
		expect(screen.getByRole('heading', { name: 'Model Two', level: 2 })).toBeInTheDocument();

		act(() => useModelCatalogStore.setState({ results: [FIRST] }));

		expect(screen.queryByRole('heading', { name: 'Model Two', level: 2 })).not.toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Pick a model to see its versions, files and trigger words' })).toBeInTheDocument();
	});

	it('shows the downloads of models outside the results', () => {
		seed();
		const model = remoteModel({ id: '9', kind: 'lora', versions: [remoteVersion({ id: '91' })] });
		const install = installEntry(model, model.versions[0], { phase: 'checking', taskId: null });
		useModelCatalogStore.setState({ installs: { [install.key]: install } });
		renderWithProviders(<ModelsSection />);

		expect(within(screen.getByRole('region', { name: 'Model search results' })).getByRole('heading', { name: 'Downloads' })).toBeInTheDocument();
		expect(screen.getByText('LoRA download')).toBeInTheDocument();
	});

	it('switches to the local library: its grids, the model folders in the detail panel, no online filters', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ModelsSection />);

		await user.click(screen.getByRole('tab', { name: 'Local library' }));

		expect(actions.setView).toHaveBeenCalledWith('local');
		expect(screen.getByRole('tab', { name: 'Local library' })).toHaveAttribute('aria-selected', 'true');
		const results = screen.getByRole('region', { name: 'Local library' });
		expect(within(results).getByRole('heading', { name: 'Checkpoints' })).toBeInTheDocument();
		expect(within(results).getByRole('heading', { name: 'LoRAs' })).toBeInTheDocument();
		const folders = screen.getByRole('complementary', { name: 'Model folders' });
		expect(within(folders).getAllByRole('definition').map((item) => item.textContent)).toEqual(['D:/models/checkpoints', 'D:/models/loras', 'D:/models/embeddings']);
		expect(screen.queryByRole('searchbox', { name: 'Search models' })).not.toBeInTheDocument();
		expect(screen.queryByRole('group', { name: 'Model filters' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Civitai token' })).toBeInTheDocument();

		await user.click(screen.getByRole('tab', { name: 'Online' }));
		expect(screen.getByRole('searchbox', { name: 'Search models' })).toBeInTheDocument();
	});

	it("'Use' of a local checkpoint goes through the catalog store's hand-off", async () => {
		const actions = seed();
		useModelCatalogStore.setState({ view: 'local' });
		useLibraryStore.getState().replaceAll({
			models: [
				{ id: 'one', name: 'one.safetensors', path: 'D:/models/checkpoints/one.safetensors', source: null, default_width: 1024, default_height: 1024, torch_dtype: 'float16' },
				{ id: 'two', name: 'two.safetensors', path: 'D:/models/checkpoints/two.safetensors', source: null, default_width: 512, default_height: 512, torch_dtype: 'float16' },
			],
			selectedModelId: 'one',
		});
		const { user } = renderWithProviders(<ModelsSection />);

		const two = screen.getByRole('group', { name: 'two.safetensors' });
		await user.click(within(two).getByRole('button', { name: 'Use' }));

		expect(actions.applyLibraryCheckpoint).toHaveBeenCalledWith('two');
		expect(within(screen.getByRole('group', { name: 'one.safetensors' })).getByText('Selected')).toBeInTheDocument();
	});

	it('switches views from the keyboard', async () => {
		seed();
		const { user } = renderWithProviders(<ModelsSection />);

		// Arrow-key moves between tabs come from tabster, which does not run in jsdom: focus the tab directly.
		act(() => screen.getByRole('tab', { name: 'Local library' }).focus());
		await user.keyboard('{Enter}');
		expect(screen.getByRole('heading', { name: 'Checkpoints' })).toBeInTheDocument();

		act(() => screen.getByRole('tab', { name: 'Online' }).focus());
		await user.keyboard(' ');
		expect(screen.getByRole('searchbox', { name: 'Search models' })).toBeInTheDocument();
	});

	it('names every control', () => {
		seed();
		renderWithProviders(<ModelsSection />);

		for (const control of [
			...screen.getAllByRole('tab'),
			...screen.getAllByRole('button'),
			...screen.getAllByRole('switch'),
			...screen.getAllByRole('combobox'),
			screen.getByRole('tablist'),
		]) {
			expect(control).toHaveAccessibleName();
		}
	});
});
