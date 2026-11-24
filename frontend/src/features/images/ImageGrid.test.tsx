import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { imageKey } from '../../domain/imageLibrary';
import { useImageLibraryStore } from '../../stores/imageLibraryStore';
import { DETAIL_IMAGE, favoriteImage, remoteImage } from '../../test/imageLibraryData';
import { installIntersectionObserver, type IntersectionObserverControl } from '../../test/intersectionObserver';
import { renderWithProviders } from '../../test/render';
import { FavoritesGrid, SearchResultsGrid } from './ImageGrid';

const ANONYMOUS = remoteImage({ id: '1002', username: null, thumbnail_url: 'https://image.example/1002/width=450/1002.jpeg' });
const RESULTS = [DETAIL_IMAGE, ANONYMOUS];

function seedActions() {
	const actions = {
		search: vi.fn(async () => undefined),
		loadMore: vi.fn(async () => undefined),
		openImage: vi.fn(),
		loadFavorites: vi.fn(async () => undefined),
	};
	useImageLibraryStore.setState(actions);
	return actions;
}

function thumbnails(name = 'Search results'): HTMLElement[] {
	return within(screen.getByRole('list', { name })).getAllByRole('button');
}

describe('SearchResultsGrid', () => {
	let io: IntersectionObserverControl;

	beforeEach(() => {
		io = installIntersectionObserver();
	});

	afterEach(() => {
		io.restore();
	});

	/** The element the live observer watches (the sentinel after the thumbnails). */
	function sentinel(): Element {
		const live = io.observers.filter((observer) => !observer.disconnected);
		expect(live).toHaveLength(1);
		return [...live[0].targets][0];
	}

	it('shows one thumbnail button per result, named after the author', () => {
		seedActions();
		useImageLibraryStore.setState({ searchStatus: 'ready', results: RESULTS });
		renderWithProviders(<SearchResultsGrid />);

		const buttons = thumbnails();
		expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Image by alice', 'Image 1002']);
		expect(within(buttons[0]).getByRole('presentation')).toHaveAttribute('src', DETAIL_IMAGE.thumbnail_url);
		expect(within(buttons[1]).getByRole('presentation')).toHaveAttribute('src', ANONYMOUS.thumbnail_url);
		expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
		expect(io.observers).toHaveLength(0);
	});

	it('opens an image with a click or from the keyboard', async () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ searchStatus: 'ready', results: RESULTS });
		const { user } = renderWithProviders(<SearchResultsGrid />);

		await user.click(screen.getByRole('button', { name: 'Image by alice' }));
		expect(actions.openImage).toHaveBeenLastCalledWith(imageKey(DETAIL_IMAGE));

		act(() => screen.getByRole('button', { name: 'Image 1002' }).focus());
		await user.keyboard('{Enter}');
		expect(actions.openImage).toHaveBeenLastCalledWith(imageKey(ANONYMOUS));
		await user.keyboard(' ');
		expect(actions.openImage).toHaveBeenCalledTimes(3);
	});

	it('shows a spinner while searching, keeping the previous results', () => {
		seedActions();
		useImageLibraryStore.setState({ searchStatus: 'loading', results: RESULTS });
		renderWithProviders(<SearchResultsGrid />);

		expect(screen.getByText('Searching images…')).toBeInTheDocument();
		expect(thumbnails()).toHaveLength(2);
		expect(screen.queryByText('No images match this search.')).not.toBeInTheDocument();
	});

	it('shows nothing before the first search and the empty state after a search without results', () => {
		seedActions();
		const { rerender } = renderWithProviders(<SearchResultsGrid />);
		expect(screen.queryByRole('list')).not.toBeInTheDocument();
		expect(screen.queryByText('No images match this search.')).not.toBeInTheDocument();

		act(() => useImageLibraryStore.setState({ searchStatus: 'ready', results: [] }));
		rerender(<SearchResultsGrid />);
		expect(screen.getByText('No images match this search.')).toBeInTheDocument();
	});

	it('shows the search error and searches again', async () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ searchStatus: 'failed', searchError: 'Civitai is unreachable', results: [] });
		const { user } = renderWithProviders(<SearchResultsGrid />);

		expect(screen.getByText('Search failed')).toBeInTheDocument();
		expect(screen.getByText('Civitai is unreachable')).toBeInTheDocument();
		expect(screen.queryByText('No images match this search.')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));

		expect(actions.search).toHaveBeenCalledTimes(1);
		expect(actions.loadMore).not.toHaveBeenCalled();
	});

	it('keeps the results when a further page failed and retries that page', async () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ searchStatus: 'failed', searchError: 'Timed out', results: RESULTS, nextCursor: 'page-2' });
		const { user } = renderWithProviders(<SearchResultsGrid />);

		expect(thumbnails()).toHaveLength(2);
		expect(screen.getByText('Could not load more images')).toBeInTheDocument();
		expect(screen.queryByText('Search failed')).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
		// No automatic retry loop: the sentinel is ignored until the page loads again.
		io.intersect(sentinel());
		expect(actions.loadMore).not.toHaveBeenCalled();

		await user.click(screen.getByRole('button', { name: 'Retry' }));
		expect(actions.loadMore).toHaveBeenCalledTimes(1);
		expect(actions.search).not.toHaveBeenCalled();
	});

	it('loads the next page when the end of the grid scrolls into view', () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ searchStatus: 'ready', results: RESULTS, nextCursor: 'page-2' });
		renderWithProviders(<SearchResultsGrid />);

		const end = sentinel();
		expect(end.compareDocumentPosition(screen.getByRole('list', { name: 'Search results' })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
		io.intersect(end, false);
		expect(actions.loadMore).not.toHaveBeenCalled();
		io.intersect(end);
		expect(actions.loadMore).toHaveBeenCalledTimes(1);
	});

	it('ignores the end of the grid while a page loads, then checks it again for the appended page', () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ searchStatus: 'loadingMore', results: RESULTS, nextCursor: 'page-2' });
		renderWithProviders(<SearchResultsGrid />);

		expect(screen.getByText('Loading more images…')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
		io.intersect(sentinel());
		expect(actions.loadMore).not.toHaveBeenCalled();

		const pageTwo = remoteImage({ id: '1003', username: 'bob' });
		act(() => useImageLibraryStore.setState({ searchStatus: 'ready', results: [...RESULTS, pageTwo], nextCursor: 'page-3' }));
		expect(thumbnails()).toHaveLength(3);
		// The new observer reports the sentinel still in view: the next page loads.
		io.intersect(sentinel());
		expect(actions.loadMore).toHaveBeenCalledTimes(1);
	});

	it('stops observing on the last page', () => {
		seedActions();
		useImageLibraryStore.setState({ searchStatus: 'ready', results: RESULTS, nextCursor: 'page-2' });
		renderWithProviders(<SearchResultsGrid />);
		expect(io.observers.filter((observer) => !observer.disconnected)).toHaveLength(1);

		act(() => useImageLibraryStore.setState({ nextCursor: null }));
		expect(io.observers.filter((observer) => !observer.disconnected)).toHaveLength(0);
	});

	it('offers a visible Load more fallback while a next page exists', async () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ searchStatus: 'ready', results: RESULTS, nextCursor: 'page-2' });
		const { user } = renderWithProviders(<SearchResultsGrid />);

		await user.click(screen.getByRole('button', { name: 'Load more' }));

		expect(actions.loadMore).toHaveBeenCalledTimes(1);
	});
});

describe('SearchResultsGrid without IntersectionObserver', () => {
	it('still pages with the Load more button', async () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ searchStatus: 'ready', results: RESULTS, nextCursor: 'page-2' });
		const { user } = renderWithProviders(<SearchResultsGrid />);

		await user.click(screen.getByRole('button', { name: 'Load more' }));

		expect(actions.loadMore).toHaveBeenCalledTimes(1);
	});
});

describe('FavoritesGrid', () => {
	it('lists the favorites without paging', async () => {
		const actions = seedActions();
		useImageLibraryStore.setState({
			favoritesStatus: 'ready',
			favorites: [favoriteImage(ANONYMOUS), favoriteImage(DETAIL_IMAGE)],
			nextCursor: 'page-2',
		});
		const { user } = renderWithProviders(<FavoritesGrid />);

		expect(thumbnails('Favorites').map((button) => button.getAttribute('aria-label'))).toEqual(['Image 1002', 'Image by alice']);
		expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Image by alice' }));

		expect(actions.openImage).toHaveBeenCalledWith(imageKey(DETAIL_IMAGE));
	});

	it('shows a spinner while loading and the empty state once loaded', () => {
		seedActions();
		useImageLibraryStore.setState({ favoritesStatus: 'loading' });
		const { rerender } = renderWithProviders(<FavoritesGrid />);
		expect(screen.getByText('Loading favorites…')).toBeInTheDocument();
		expect(screen.queryByText(/No favorites yet/)).not.toBeInTheDocument();

		act(() => useImageLibraryStore.setState({ favoritesStatus: 'ready' }));
		rerender(<FavoritesGrid />);
		expect(screen.getByText('No favorites yet. Open an image and select Favorite to keep it here.')).toBeInTheDocument();
	});

	it('shows the loading error and loads again', async () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ favoritesStatus: 'failed', favoritesError: 'Backend unreachable' });
		const { user } = renderWithProviders(<FavoritesGrid />);

		expect(screen.getByText('Could not load the favorites')).toBeInTheDocument();
		expect(screen.getByText('Backend unreachable')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));

		expect(actions.loadFavorites).toHaveBeenCalledTimes(1);
	});
});
