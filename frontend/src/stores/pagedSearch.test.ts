import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { appendUnique, createPagedSearch, SEARCH_DEBOUNCE_MS, type PagedSearchActions, type PagedSearchState } from './pagedSearch';

type Item = { id: string };
type Filters = { query: string; sort: string };
type Page = { items: Item[]; next_cursor: string | null };

const items = (...ids: string[]): Item[] => ids.map((id) => ({ id }));

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

/** A store made of the search slice and its engine over `fetchPage`. */
function searchStore(fetchPage: (filters: Filters, cursor: string | null, signal: AbortSignal) => Promise<Page>) {
	return create<PagedSearchState<Item, Filters> & PagedSearchActions>()((set, get) => ({
		filters: { query: '', sort: 'newest' },
		results: [],
		nextCursor: null,
		searchStatus: 'idle',
		searchError: null,
		...createPagedSearch<Item, Filters>(set, get, {
			fetchPage,
			keyOf: (item) => item.id,
			describeError: (error) => (error instanceof Error ? error.message : String(error)),
		}),
	}));
}

afterEach(() => {
	vi.useRealTimers();
});

describe('appendUnique', () => {
	it('appends a page in order and drops items already listed', () => {
		const first = items('1', '2');
		const merged = appendUnique(first, items('2', '3', '3', '4'), (item) => item.id);
		expect(merged.map((item) => item.id)).toEqual(['1', '2', '3', '4']);
		expect(merged[0]).toBe(first[0]);
		expect(appendUnique([], first, (item) => item.id)).toEqual(first);
	});
});

describe('createPagedSearch', () => {
	it('searches the first page, then appends further pages without duplicates', async () => {
		const fetchPage = vi.fn(async (_filters: Filters, cursor: string | null): Promise<Page> =>
			cursor === null ? { items: items('a', 'b'), next_cursor: 'p2' } : { items: items('b', 'c'), next_cursor: null },
		);
		const store = searchStore(fetchPage);

		await store.getState().search();
		expect(store.getState()).toMatchObject({ results: items('a', 'b'), nextCursor: 'p2', searchStatus: 'ready' });

		await store.getState().loadMore();
		expect(store.getState()).toMatchObject({ results: items('a', 'b', 'c'), nextCursor: null, searchStatus: 'ready' });
		expect(fetchPage.mock.calls.map(([filters, cursor]) => [filters.query, cursor])).toEqual([
			['', null],
			['', 'p2'],
		]);

		await store.getState().loadMore(); // no next page
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('debounces the query and ignores an unchanged one', async () => {
		vi.useFakeTimers();
		const fetchPage = vi.fn(async (_filters: Filters, _cursor: string | null): Promise<Page> => ({ items: [], next_cursor: null }));
		const store = searchStore(fetchPage);

		store.getState().setQuery('cas');
		store.getState().setQuery('castle');
		store.getState().setQuery('castle');
		expect(store.getState().filters).toEqual({ query: 'castle', sort: 'newest' });
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
		expect(fetchPage).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(fetchPage.mock.calls[0][0].query).toBe('castle');

		// An explicit search cancels a pending debounced one.
		store.getState().setQuery('tower');
		await store.getState().search();
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2);
		expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('aborts the request in flight and ignores its late answer', async () => {
		const answers = [deferred<Page>(), deferred<Page>()];
		const signals: AbortSignal[] = [];
		const store = searchStore((_filters, _cursor, signal) => {
			signals.push(signal);
			return answers[signals.length - 1].promise;
		});

		const first = store.getState().search();
		const second = store.getState().search();
		expect(signals[0].aborted).toBe(true);
		answers[1].resolve({ items: items('new'), next_cursor: null });
		await second;
		answers[0].resolve({ items: items('stale'), next_cursor: 'stale' });
		await first;

		expect(store.getState()).toMatchObject({ results: items('new'), nextCursor: null, searchStatus: 'ready' });
	});

	it('clears the results when the first page fails and keeps them when a further page fails', async () => {
		let fail = false;
		const store = searchStore(async () => {
			if (fail) {
				throw new Error('Civitai is unreachable');
			}
			return { items: items('a'), next_cursor: 'p2' };
		});
		await store.getState().search();

		fail = true;
		await store.getState().loadMore();
		expect(store.getState()).toMatchObject({ results: items('a'), searchStatus: 'failed', searchError: 'Civitai is unreachable' });

		await store.getState().search();
		expect(store.getState()).toMatchObject({ results: [], nextCursor: null, searchStatus: 'failed' });
	});
});
