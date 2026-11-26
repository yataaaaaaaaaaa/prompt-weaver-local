import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelCatalogStore, useVersionStatus } from '../../stores/modelCatalogStore';
import { renderWithProviders } from '../../test/render';
import { ModelResultsGrid } from './ModelResultsGrid';
import { remoteModel, versionStatus } from '../../test/modelLibraryData';

vi.mock('../../stores/modelCatalogStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/modelCatalogStore')>();
	return { ...actual, useVersionStatus: vi.fn() };
});

const RESULTS = [remoteModel(), remoteModel({ id: '2', name: 'Model Two', kind: 'lora' })];

function seedActions() {
	const actions = { search: vi.fn(async () => undefined), loadMore: vi.fn(async () => undefined) };
	useModelCatalogStore.setState(actions);
	return actions;
}

beforeEach(() => {
	vi.mocked(useVersionStatus)
		.mockReset()
		.mockImplementation((model, version) => versionStatus(model, version));
});

// Fluent components render slowly on a busy machine: more than the default 5 s per test.
describe('ModelResultsGrid', () => {
	it('shows a spinner while searching, keeping the previous results', () => {
		seedActions();
		useModelCatalogStore.setState({ searchStatus: 'loading', results: RESULTS });
		renderWithProviders(<ModelResultsGrid />);

		expect(screen.getByText('Searching models…')).toBeInTheDocument();
		expect(within(screen.getByRole('list', { name: 'Search results' })).getAllByRole('listitem')).toHaveLength(2);
		expect(screen.queryByText('No models match this search.')).not.toBeInTheDocument();
	});

	it('shows only the spinner during the first search', () => {
		seedActions();
		useModelCatalogStore.setState({ searchStatus: 'loading', results: [] });
		renderWithProviders(<ModelResultsGrid />);

		expect(screen.getByText('Searching models…')).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
		expect(screen.queryByText('No models match this search.')).not.toBeInTheDocument();
	});

	it('lists one card per result', () => {
		seedActions();
		useModelCatalogStore.setState({ searchStatus: 'ready', results: RESULTS });
		renderWithProviders(<ModelResultsGrid />);

		const items = within(screen.getByRole('list', { name: 'Search results' })).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(within(items[0]).getByRole('group', { name: 'Model One' })).toBeInTheDocument();
		expect(within(items[1]).getByRole('group', { name: 'Model Two' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
	});

	it('shows the provider error with Retry above the results', async () => {
		seedActions();
		const loadInfo = vi.fn(async () => undefined);
		useModelCatalogStore.setState({ loadInfo, infoStatus: 'failed', infoError: 'Backend unreachable', searchStatus: 'ready', results: RESULTS });
		const { user } = renderWithProviders(<ModelResultsGrid />);

		expect(screen.getByText('Could not load the model providers')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));
		expect(loadInfo).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();
	});

	it('shows the empty state after a search without results', () => {
		seedActions();
		useModelCatalogStore.setState({ searchStatus: 'ready', results: [] });
		renderWithProviders(<ModelResultsGrid />);

		expect(screen.getByText('No models match this search.')).toBeInTheDocument();
	});

	it('shows nothing before the first search', () => {
		seedActions();
		renderWithProviders(<ModelResultsGrid />);

		expect(screen.queryByText('No models match this search.')).not.toBeInTheDocument();
		expect(screen.queryByRole('list')).not.toBeInTheDocument();
	});

	it('shows the search error and retries', async () => {
		const actions = seedActions();
		useModelCatalogStore.setState({ searchStatus: 'failed', searchError: 'Civitai is unreachable', results: [] });
		const { user } = renderWithProviders(<ModelResultsGrid />);

		expect(screen.getByText('Search failed')).toBeInTheDocument();
		expect(screen.getByText('Civitai is unreachable')).toBeInTheDocument();
		expect(screen.queryByText('No models match this search.')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));

		expect(actions.search).toHaveBeenCalledTimes(1);
	});

	it('loads more while a next page exists', async () => {
		const actions = seedActions();
		useModelCatalogStore.setState({ searchStatus: 'ready', results: RESULTS, nextCursor: 'cursor-2' });
		const { user } = renderWithProviders(<ModelResultsGrid />);

		await user.click(screen.getByRole('button', { name: 'Load more' }));

		expect(actions.loadMore).toHaveBeenCalledTimes(1);
	});

	it('shows the Load more button busy while loading more (focus kept), keeping the results', () => {
		seedActions();
		useModelCatalogStore.setState({ searchStatus: 'loadingMore', results: RESULTS, nextCursor: 'cursor-2' });
		renderWithProviders(<ModelResultsGrid />);

		expect(screen.getByRole('button', { name: 'Loading more models…' })).toHaveAttribute('aria-disabled', 'true');
		expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
		expect(within(screen.getByRole('list', { name: 'Search results' })).getAllByRole('listitem')).toHaveLength(2);
	});
});
