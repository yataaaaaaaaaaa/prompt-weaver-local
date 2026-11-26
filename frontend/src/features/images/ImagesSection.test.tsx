import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SECTION_SEARCH_ATTRIBUTE } from '../../app/sections';
import { imageKey } from '../../domain/imageLibrary';
import { useImageCheckpointRow, useImageLibraryStore, useImageLoraRows, useImageTags, type ImagesView } from '../../stores/imageLibraryStore';
import { DETAIL_IMAGE, favoriteImage, remoteImage } from '../../test/imageLibraryData';
import { renderWithProviders } from '../../test/render';
import { ImagesSection } from './ImagesSection';

vi.mock('../../stores/imageLibraryStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/imageLibraryStore')>();
	return { ...actual, useImageTags: vi.fn(), useImageLoraRows: vi.fn(), useImageCheckpointRow: vi.fn() };
});

const OTHER = remoteImage({ id: '2002', username: 'bob' });
const SAVED = remoteImage({ id: '3003', username: 'carol' });
const EMPTY_DETAIL = 'Pick an image to see its tags, LoRAs and checkpoint';

/** Actions replaced before rendering; open / close / setView update the state like the store does. */
function seed() {
	const actions = {
		activate: vi.fn(async () => undefined),
		openImage: vi.fn((key: string) => useImageLibraryStore.setState({ selectedImageKey: key })),
		closeImage: vi.fn(() => useImageLibraryStore.setState({ selectedImageKey: null })),
		setView: vi.fn((view: ImagesView) => useImageLibraryStore.setState({ view })),
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

function detailPanel(): HTMLElement {
	return screen.getByRole('complementary', { name: 'Image details' });
}

beforeEach(() => {
	vi.mocked(useImageTags).mockReset().mockReturnValue([]);
	vi.mocked(useImageLoraRows).mockReset().mockReturnValue([]);
	vi.mocked(useImageCheckpointRow).mockReset().mockReturnValue(null);
});

// Full sections render many Fluent components: slower than the default 5 s on a busy machine.
describe('ImagesSection', () => {
	it('activates the image library store once on mount', () => {
		const actions = seed();
		const { rerender } = renderWithProviders(<ImagesSection />);
		rerender(<ImagesSection />);

		expect(actions.activate).toHaveBeenCalledTimes(1);
	});

	it('lays out the title, the toolbar, the grid and the empty detail panel with its guidance', () => {
		seed();
		renderWithProviders(<ImagesSection />);

		expect(screen.getByRole('heading', { name: 'Images', level: 1 })).toBeInTheDocument();
		expect(screen.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('searchbox', { name: 'Search images' })).toHaveAttribute(SECTION_SEARCH_ATTRIBUTE);
		const filters = screen.getByRole('group', { name: 'Image filters' });
		expect(within(filters).getByRole('combobox', { name: 'Sort by' })).toBeInTheDocument();
		expect(within(filters).getByRole('combobox', { name: 'Period' })).toBeInTheDocument();
		expect(within(filters).getByRole('switch', { name: 'Show NSFW' })).toBeInTheDocument();
		expect(within(filters).getByRole('switch', { name: 'Only locally usable models' })).toBeInTheDocument();

		const results = screen.getByRole('region', { name: 'Image search results' });
		expect(within(within(results).getByRole('list', { name: 'Search results' })).getAllByRole('button')).toHaveLength(2);

		expect(within(detailPanel()).getByRole('heading', { name: EMPTY_DETAIL })).toBeInTheDocument();
		expect(within(detailPanel()).getByText(/^A keyword finds matching LoRAs and checkpoints/)).toBeInTheDocument();
	});

	it('switches to the favorites (no search filters) and back', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ImagesSection />);

		await user.click(screen.getByRole('tab', { name: 'Favorites' }));
		expect(actions.setView).toHaveBeenCalledWith('favorites');
		expect(screen.getByRole('tab', { name: 'Favorites' })).toHaveAttribute('aria-selected', 'true');
		const results = screen.getByRole('region', { name: 'Favorite images' });
		expect(within(results).getByRole('button', { name: 'Image by carol' })).toBeInTheDocument();
		expect(screen.queryByRole('searchbox', { name: 'Search images' })).not.toBeInTheDocument();
		expect(screen.queryByRole('group', { name: 'Image filters' })).not.toBeInTheDocument();

		await user.click(screen.getByRole('tab', { name: 'Search' }));
		expect(screen.getByRole('searchbox', { name: 'Search images' })).toBeInTheDocument();
	});

	it('shows the opened image next to the grid, its heading focused', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ImagesSection />);

		await user.click(screen.getByRole('button', { name: 'Image by alice' }));

		expect(actions.openImage).toHaveBeenCalledWith(imageKey(DETAIL_IMAGE));
		expect(within(detailPanel()).getByRole('heading', { name: 'Image by alice', level: 2 })).toHaveFocus();
		expect(within(detailPanel()).getByRole('img', { name: 'Image by alice' })).toHaveAttribute('src', DETAIL_IMAGE.url);
		// The grid and the toolbar stay; the shown thumbnail is marked.
		expect(screen.getByRole('list', { name: 'Search results' })).toBeInTheDocument();
		expect(screen.getByRole('searchbox', { name: 'Search images' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Image by alice' })).toHaveAttribute('aria-current', 'true');
	});

	it('Close clears the selection and focuses the opened thumbnail again', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ImagesSection />);

		await user.click(screen.getByRole('button', { name: 'Image by alice' }));
		await user.click(screen.getByRole('button', { name: 'Close details' }));

		expect(actions.closeImage).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Image by alice' })).toHaveFocus();
		expect(within(detailPanel()).getByRole('heading', { name: EMPTY_DETAIL })).toBeInTheDocument();
	});

	it('Escape from the keyboard does the same', async () => {
		const actions = seed();
		const { user } = renderWithProviders(<ImagesSection />);

		act(() => screen.getByRole('button', { name: 'Image by bob' }).focus());
		await user.keyboard('{Enter}');
		expect(screen.getByRole('heading', { name: 'Image by bob', level: 2 })).toHaveFocus();
		await user.keyboard('{Escape}');

		expect(actions.closeImage).toHaveBeenCalledTimes(1);
		expect(screen.getByRole('button', { name: 'Image by bob' })).toHaveFocus();
	});

	it('returns to the favorite opened in the favorites grid', async () => {
		seed();
		const { user } = renderWithProviders(<ImagesSection />);

		await user.click(screen.getByRole('tab', { name: 'Favorites' }));
		await user.click(screen.getByRole('button', { name: 'Image by carol' }));
		expect(screen.getByRole('heading', { name: 'Image by carol' })).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Close details' }));

		expect(screen.getByRole('button', { name: 'Image by carol' })).toHaveFocus();
	});

	it('focuses the results when the opened image is no longer in the shown grid', async () => {
		seed();
		useImageLibraryStore.setState({ results: [OTHER, DETAIL_IMAGE, SAVED] });
		const { user } = renderWithProviders(<ImagesSection />);

		await user.click(screen.getByRole('tab', { name: 'Favorites' }));
		await user.click(screen.getByRole('button', { name: 'Image by carol' }));
		// Removed from the favorites while shown: still a search result, so it stays shown.
		act(() => useImageLibraryStore.setState({ favorites: [] }));
		expect(screen.getByRole('heading', { name: 'Image by carol', level: 2 })).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Close details' }));

		expect(screen.getByRole('region', { name: 'Favorite images' })).toHaveFocus();
	});

	it('keeps the shown image when the other grid is picked', async () => {
		const actions = seed();
		useImageLibraryStore.setState({ selectedImageKey: imageKey(DETAIL_IMAGE) });
		const { user } = renderWithProviders(<ImagesSection />);

		await user.click(screen.getByRole('tab', { name: 'Favorites' }));

		expect(actions.closeImage).not.toHaveBeenCalled();
		expect(screen.getByRole('list', { name: 'Favorites' })).toBeInTheDocument();
		expect(within(detailPanel()).getByRole('heading', { name: 'Image by alice', level: 2 })).toBeInTheDocument();
	});

	it('shows the empty detail when the selected image is listed nowhere any more', () => {
		seed();
		useImageLibraryStore.setState({ selectedImageKey: imageKey(DETAIL_IMAGE) });
		renderWithProviders(<ImagesSection />);

		act(() => useImageLibraryStore.setState({ results: [OTHER] }));

		expect(within(detailPanel()).getByRole('heading', { name: EMPTY_DETAIL })).toBeInTheDocument();
	});

	it('names every control', () => {
		seed();
		renderWithProviders(<ImagesSection />);

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
