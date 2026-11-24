import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { imageKey } from '../../domain/imageLibrary';
import { useImageCheckpointRow, useImageLibraryStore, useImageLoraRows, useImageTags } from '../../stores/imageLibraryStore';
import { DETAIL_IMAGE, favoriteImage, remoteImage } from '../../test/imageLibraryData';
import { renderWithProviders } from '../../test/render';
import { ImageLibraryPane } from './ImageLibraryPane';

vi.mock('../../stores/imageLibraryStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/imageLibraryStore')>();
	return { ...actual, useImageTags: vi.fn(), useImageLoraRows: vi.fn(), useImageCheckpointRow: vi.fn() };
});

const OTHER = remoteImage({ id: '2002', username: 'bob' });
const SAVED = remoteImage({ id: '3003', username: 'carol' });

/** Actions replaced before rendering; open/close update the selection like the store does. */
function seed() {
	const actions = {
		activate: vi.fn(async () => undefined),
		openImage: vi.fn((key: string) => useImageLibraryStore.setState({ selectedImageKey: key })),
		closeImage: vi.fn(() => useImageLibraryStore.setState({ selectedImageKey: null })),
		search: vi.fn(async () => undefined),
		loadMore: vi.fn(async () => undefined),
		loadFavorites: vi.fn(async () => undefined),
		setQuery: vi.fn(),
	};
	useImageLibraryStore.setState({
		...actions,
		searchStatus: 'ready',
		results: [OTHER, DETAIL_IMAGE],
		favoritesStatus: 'ready',
		favorites: [favoriteImage(SAVED)],
	});
	return actions;
}

beforeEach(() => {
	vi.mocked(useImageTags).mockReset().mockReturnValue([]);
	vi.mocked(useImageLoraRows).mockReset().mockReturnValue([]);
	vi.mocked(useImageCheckpointRow).mockReset().mockReturnValue(null);
});

describe('ImageLibraryPane', () => {
	it('activates the image library store once on mount', () => {
		const actions = seed();
		const { rerender } = renderWithProviders(<ImageLibraryPane />);
		rerender(<ImageLibraryPane />);

		expect(actions.activate).toHaveBeenCalledTimes(1);
	});

	it('opens on the search with its results', () => {
		seed();
		renderWithProviders(<ImageLibraryPane />);

		expect(screen.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel', { name: 'Search' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument();
		expect(screen.getByRole('searchbox', { name: 'Search images' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
		expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'Favorites' })).not.toBeInTheDocument();
	});

	it('switches to the favorites and back', async () => {
		seed();
		const { user } = renderWithProviders(<ImageLibraryPane />);

		await user.click(screen.getByRole('tab', { name: 'Favorites' }));
		expect(screen.getByRole('tab', { name: 'Favorites' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel', { name: 'Favorites' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Image by carol' })).toBeInTheDocument();
		expect(screen.queryByRole('searchbox', { name: 'Search images' })).not.toBeInTheDocument();

		await user.click(screen.getByRole('tab', { name: 'Search' }));
		expect(screen.getByRole('searchbox', { name: 'Search images' })).toBeInTheDocument();
	});

	it('shows the detail view of the opened image instead of the grid', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ImageLibraryPane />);

		await user.click(screen.getByRole('button', { name: 'Image by alice' }));

		expect(actions.openImage).toHaveBeenCalledWith(imageKey(DETAIL_IMAGE));
		expect(screen.getByRole('img', { name: 'Image by alice' })).toHaveAttribute('src', DETAIL_IMAGE.url);
		expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
		expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
		expect(screen.queryByRole('searchbox', { name: 'Search images' })).not.toBeInTheDocument();
	});

	it('goes back to the grid with Back and focuses the opened thumbnail again', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ImageLibraryPane />);

		await user.click(screen.getByRole('button', { name: 'Image by alice' }));
		await user.click(screen.getByRole('button', { name: 'Back' }));

		expect(actions.closeImage).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Image by alice' })).toHaveFocus();
	});

	it('goes back with Escape from the keyboard', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ImageLibraryPane />);

		act(() => screen.getByRole('button', { name: 'Image by bob' }).focus());
		await user.keyboard('{Enter}');
		expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
		await user.keyboard('{Escape}');

		expect(actions.closeImage).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Image by bob' })).toHaveFocus();
	});

	it('returns to the favorites grid from an image opened there', async () => {
		seed();
		const { user } = renderWithProviders(<ImageLibraryPane />);

		await user.click(screen.getByRole('tab', { name: 'Favorites' }));
		await user.click(screen.getByRole('button', { name: 'Image by carol' }));
		expect(screen.getByRole('heading', { name: 'Image by carol' })).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Back' }));

		expect(screen.getByRole('list', { name: 'Favorites' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Image by carol' })).toHaveFocus();
	});

	it('focuses the tab when the opened image is no longer listed', async () => {
		seed();
		const { user } = renderWithProviders(<ImageLibraryPane />);

		await user.click(screen.getByRole('tab', { name: 'Favorites' }));
		await user.click(screen.getByRole('button', { name: 'Image by carol' }));
		// Removed from the favorites while its detail view was shown.
		act(() => useImageLibraryStore.setState({ favorites: [] }));
		await user.click(screen.getByRole('button', { name: 'Back' }));

		expect(screen.queryByRole('button', { name: 'Image by carol' })).not.toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Favorites' })).toHaveFocus();
	});

	it('closes the image when another tab is picked', async () => {
		const actions = seed();
		useImageLibraryStore.setState({ selectedImageKey: imageKey(DETAIL_IMAGE) });
		const { user } = renderWithProviders(<ImageLibraryPane />);
		expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();

		await user.click(screen.getByRole('tab', { name: 'Favorites' }));

		expect(actions.closeImage).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('list', { name: 'Favorites' })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Favorites' })).toHaveFocus();
	});

	it('names every control of the search view', () => {
		seed();
		renderWithProviders(<ImageLibraryPane />);

		for (const control of [
			...screen.getAllByRole('tab'),
			...screen.getAllByRole('button'),
			...screen.getAllByRole('switch'),
			...screen.getAllByRole('combobox'),
		]) {
			expect(control).toHaveAccessibleName();
		}
	});
});
