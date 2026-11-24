import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModelKind } from '../../api/types';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { renderWithProviders } from '../../test/render';
import { CatalogSearchBar } from './CatalogSearchBar';
import { INFO } from '../../test/modelLibraryData';

/** Filter actions that also update the filters (like the store does), so controlled inputs follow. */
function seedActions() {
	const updateFilters = (patch: Partial<ReturnType<typeof useModelCatalogStore.getState>['filters']>) =>
		useModelCatalogStore.setState((state) => ({ filters: { ...state.filters, ...patch } }));
	const actions = {
		setQuery: vi.fn((query: string) => updateFilters({ query })),
		setKinds: vi.fn((kinds: ModelKind[]) => updateFilters({ kinds })),
		setBaseModels: vi.fn((base_models: string[]) => updateFilters({ base_models })),
		setSort: vi.fn(),
		setNsfw: vi.fn(),
		loadInfo: vi.fn(async () => undefined),
	};
	useModelCatalogStore.setState(actions);
	return actions;
}

function seedInfo() {
	useModelCatalogStore.setState({ info: INFO, infoStatus: 'ready' });
}

describe('CatalogSearchBar', () => {
	it('updates the query on every keystroke (the store debounces)', async () => {
		const actions = seedActions();
		seedInfo();
		const { user } = renderWithProviders(<CatalogSearchBar />);

		const box = screen.getByRole('searchbox', { name: 'Search models' });
		expect(box).toHaveAttribute('placeholder', 'Search Civitai models');
		await user.type(box, 'pony');

		expect(actions.setQuery).toHaveBeenCalledTimes(4);
		expect(actions.setQuery).toHaveBeenLastCalledWith('pony');
		expect(box).toHaveValue('pony');
	});

	it('filters by model type', async () => {
		const actions = seedActions();
		seedInfo();
		const { user } = renderWithProviders(<CatalogSearchBar />);

		const types = screen.getByRole('combobox', { name: 'Type' });
		expect(types).toHaveTextContent('All types');
		await user.click(types);
		// Multiselect dropdowns are menus of checkbox items.
		expect(screen.getAllByRole('menuitemcheckbox').map((option) => option.textContent)).toEqual(['Checkpoint', 'LoRA', 'Embedding']);
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'LoRA' }));
		expect(actions.setKinds).toHaveBeenLastCalledWith(['lora']);
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Checkpoint' }));
		// Provider order is kept.
		expect(actions.setKinds).toHaveBeenLastCalledWith(['checkpoint', 'lora']);
		expect(types).toHaveTextContent('Checkpoint, LoRA');
	});

	it('filters by base model and hints the ones not supported locally', async () => {
		const actions = seedActions();
		seedInfo();
		const { user } = renderWithProviders(<CatalogSearchBar />);

		const baseModels = screen.getByRole('combobox', { name: 'Base model' });
		expect(baseModels).toHaveTextContent('All base models');
		await user.click(baseModels);
		expect(screen.getByRole('menuitemcheckbox', { name: /^Flux\.1 D/ })).toHaveTextContent('Not supported locally');
		expect(screen.getByRole('menuitemcheckbox', { name: 'Illustrious' })).not.toHaveTextContent('Not supported locally');
		await user.click(screen.getByRole('menuitemcheckbox', { name: 'Illustrious' }));

		expect(actions.setBaseModels).toHaveBeenLastCalledWith(['Illustrious']);
		expect(baseModels).toHaveTextContent('Illustrious');
	});

	it('changes the sort', async () => {
		const actions = seedActions();
		seedInfo();
		const { user } = renderWithProviders(<CatalogSearchBar />);

		const sort = screen.getByRole('combobox', { name: 'Sort by' });
		expect(sort).toHaveTextContent('Most downloaded');
		await user.click(sort);
		await user.click(screen.getByRole('option', { name: 'Newest' }));

		expect(actions.setSort).toHaveBeenCalledWith('newest');
	});

	it('toggles NSFW results', async () => {
		const actions = seedActions();
		seedInfo();
		const { user } = renderWithProviders(<CatalogSearchBar />);

		const nsfw = screen.getByRole('switch', { name: 'Show NSFW' });
		expect(nsfw).not.toBeChecked();
		await user.click(nsfw);

		expect(actions.setNsfw).toHaveBeenCalledWith(true);
	});

	it('shows a spinner while the providers load, without provider filters', () => {
		seedActions();
		useModelCatalogStore.setState({ infoStatus: 'loading' });
		renderWithProviders(<CatalogSearchBar />);

		expect(screen.getByText('Loading providers…')).toBeInTheDocument();
		expect(screen.getByRole('searchbox', { name: 'Search models' })).toBeInTheDocument();
		expect(screen.queryByRole('combobox', { name: 'Type' })).not.toBeInTheDocument();
	});

	it('shows the provider error and retries', async () => {
		const actions = seedActions();
		useModelCatalogStore.setState({ infoStatus: 'failed', infoError: 'Backend unreachable' });
		const { user } = renderWithProviders(<CatalogSearchBar />);

		expect(screen.getByText('Could not load the model providers')).toBeInTheDocument();
		expect(screen.getByText('Backend unreachable')).toBeInTheDocument();
		expect(screen.queryByText('Loading providers…')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));

		expect(actions.loadInfo).toHaveBeenCalledTimes(1);
	});

	it('is operable from the keyboard', async () => {
		const actions = seedActions();
		seedInfo();
		const { user } = renderWithProviders(<CatalogSearchBar />);

		await user.tab();
		expect(screen.getByRole('searchbox', { name: 'Search models' })).toHaveFocus();
		await user.keyboard('a');
		expect(actions.setQuery).toHaveBeenLastCalledWith('a');

		// jsdom + tabster cannot Tab into a Fluent Dropdown: focus the controls directly, then use keys only.
		act(() => screen.getByRole('combobox', { name: 'Type' }).focus());
		await user.keyboard('{Enter}{ArrowDown}{Enter}');
		expect(actions.setKinds).toHaveBeenLastCalledWith(['lora']);
		await user.keyboard('{Escape}');

		act(() => screen.getByRole('combobox', { name: 'Sort by' }).focus());
		await user.keyboard('{Enter}{ArrowDown}{ArrowDown}{Enter}');
		expect(actions.setSort).toHaveBeenLastCalledWith('newest');

		act(() => screen.getByRole('switch', { name: 'Show NSFW' }).focus());
		await user.keyboard(' ');
		expect(actions.setNsfw).toHaveBeenCalledWith(true);
	});
});
