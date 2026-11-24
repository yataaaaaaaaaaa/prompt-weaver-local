import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ImageFilters } from '../../domain/imageLibrary';
import { useImageLibraryStore } from '../../stores/imageLibraryStore';
import { renderWithProviders } from '../../test/render';
import { ImageSearchBar } from './ImageSearchBar';

/** Filter actions that also update the filters (like the store does), so controlled inputs follow. */
function seedActions() {
	const updateFilters = (patch: Partial<ImageFilters>) => useImageLibraryStore.setState((state) => ({ filters: { ...state.filters, ...patch } }));
	const actions = {
		setQuery: vi.fn((query: string) => updateFilters({ query })),
		setSort: vi.fn(),
		setPeriod: vi.fn(),
		setNsfw: vi.fn(),
		setUsableOnly: vi.fn(),
	};
	useImageLibraryStore.setState(actions);
	return actions;
}

describe('ImageSearchBar', () => {
	it('updates the query on every keystroke (the store debounces) and explains keyword searches', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ImageSearchBar />);

		const box = screen.getByRole('searchbox', { name: 'Search images' });
		await user.type(box, 'castle');

		expect(actions.setQuery).toHaveBeenCalledTimes(6);
		expect(actions.setQuery).toHaveBeenLastCalledWith('castle');
		expect(box).toHaveValue('castle');
		expect(screen.getByText(/A keyword finds matching LoRAs and checkpoints and shows the images of their galleries/)).toBeInTheDocument();
	});

	it('changes the sort', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ImageSearchBar />);

		const sort = screen.getByRole('combobox', { name: 'Sort by' });
		expect(sort).toHaveTextContent('Most reactions');
		await user.click(sort);
		expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Most reactions', 'Most comments', 'Most collected', 'Newest']);
		await user.click(screen.getByRole('option', { name: 'Newest' }));

		expect(actions.setSort).toHaveBeenCalledWith('newest');
	});

	it('does not search again when the current sort is picked', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ImageSearchBar />);

		await user.click(screen.getByRole('combobox', { name: 'Sort by' }));
		await user.click(screen.getByRole('option', { name: 'Most reactions' }));

		expect(actions.setSort).not.toHaveBeenCalled();
	});

	it('changes the period of the feed', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ImageSearchBar />);

		const period = screen.getByRole('combobox', { name: 'Period' });
		expect(period).toBeEnabled();
		expect(period).toHaveTextContent('Week');
		expect(screen.queryByText('Keyword searches ignore the period.')).not.toBeInTheDocument();
		await user.click(period);
		await user.click(screen.getByRole('option', { name: 'All time' }));

		expect(actions.setPeriod).toHaveBeenCalledWith('all_time');
	});

	it('disables the period with a hint while a keyword is set', async () => {
		seedActions();
		const { user } = renderWithProviders(<ImageSearchBar />);

		await user.type(screen.getByRole('searchbox', { name: 'Search images' }), 'detail');

		const period = screen.getByRole('combobox', { name: 'Period' });
		expect(period).toBeDisabled();
		expect(period).toHaveAccessibleDescription('Keyword searches ignore the period.');
	});

	it('keeps the period applicable for a blank keyword', () => {
		seedActions();
		useImageLibraryStore.setState((state) => ({ filters: { ...state.filters, query: '   ' } }));
		renderWithProviders(<ImageSearchBar />);

		expect(screen.getByRole('combobox', { name: 'Period' })).toBeEnabled();
	});

	it('shows NSFW images only when switched on (off by default)', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ImageSearchBar />);

		const nsfw = screen.getByRole('switch', { name: 'Show NSFW' });
		expect(nsfw).not.toBeChecked();
		await user.click(nsfw);

		expect(actions.setNsfw).toHaveBeenCalledWith(true);
	});

	it('restricts the images to locally usable models (on by default)', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ImageSearchBar />);

		const usable = screen.getByRole('switch', { name: 'Only locally usable models' });
		expect(usable).toBeChecked();
		await user.click(usable);

		expect(actions.setUsableOnly).toHaveBeenCalledWith(false);
	});

	it('reflects the store filters', () => {
		seedActions();
		useImageLibraryStore.setState((state) => ({ filters: { ...state.filters, sort: 'newest', period: 'day', nsfw: true, usable_only: false } }));
		renderWithProviders(<ImageSearchBar />);

		expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveTextContent('Newest');
		expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Day');
		expect(screen.getByRole('switch', { name: 'Show NSFW' })).toBeChecked();
		expect(screen.getByRole('switch', { name: 'Only locally usable models' })).not.toBeChecked();
	});
});
