// The paged, debounced online search shared by the stores of the online catalogs (model catalog, image library):
// the one implementation of "type to search" (debounce), "search from the first page" (the previous request is
// aborted, stale answers ignored, a failed first page clears the results) and "append the next page" (infinite
// scroll / Load more; duplicates dropped by key, a failed further page keeps the results). Each store creates one
// engine over its own state slice (PagedSearchState) and exposes its actions; the timer, the AbortController and
// the request sequence are private to that engine.

export const SEARCH_DEBOUNCE_MS = 350;

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'failed';
export type SearchStatus = 'idle' | 'loading' | 'loadingMore' | 'ready' | 'failed';

/** The search slice of a store's state. */
export type PagedSearchState<Item, Filters extends { query: string }> = {
	filters: Filters;
	results: Item[];
	nextCursor: string | null;
	searchStatus: SearchStatus;
	searchError: string | null;
};

export type PagedSearchActions = {
	/** Updates filters.query and searches after SEARCH_DEBOUNCE_MS of inactivity (no-op when unchanged). */
	setQuery: (query: string) => void;
	/** Searches from the first page (cancels a pending debounced search and aborts the request in flight). */
	search: () => Promise<void>;
	/** Appends the next page; no-op without nextCursor or while a search runs. */
	loadMore: () => Promise<void>;
};

export type PagedSearchOptions<Item, Filters extends { query: string }> = {
	/** One page of results for these filters (cursor null: the first page). */
	fetchPage: (filters: Filters, cursor: string | null, signal: AbortSignal) => Promise<{ items: Item[]; next_cursor: string | null }>;
	/** Identity of a result: a further page drops the results already listed. */
	keyOf: (item: Item) => string;
	/** User-facing text of a failure (the store's error description). */
	describeError: (error: unknown) => string;
};

type SliceUpdate<Item, Filters extends { query: string }> =
	| Partial<PagedSearchState<Item, Filters>>
	| ((state: PagedSearchState<Item, Filters>) => Partial<PagedSearchState<Item, Filters>>);

/** `current` followed by the items of `page` not listed yet (same key), in order. */
export function appendUnique<Item>(current: readonly Item[], page: readonly Item[], keyOf: (item: Item) => string): Item[] {
	const seen = new Set(current.map(keyOf));
	const added = page.filter((item) => {
		const key = keyOf(item);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
	return [...current, ...added];
}

/** The search actions of a store over its PagedSearchState slice (`set` / `get` of its zustand creator). */
export function createPagedSearch<Item, Filters extends { query: string }>(
	set: (update: SliceUpdate<Item, Filters>) => void,
	get: () => PagedSearchState<Item, Filters>,
	{ fetchPage, keyOf, describeError }: PagedSearchOptions<Item, Filters>,
): PagedSearchActions {
	/** The request in flight (aborted by the next one) and the sequence number of the latest request: an answer is
	 *  applied only while its request is still the latest. */
	let controller: AbortController | null = null;
	let sequence = 0;
	/** Pending debounced search of setQuery (cleared by every search). */
	let queryTimer: ReturnType<typeof setTimeout> | null = null;

	const clearQueryTimer = () => {
		if (queryTimer !== null) {
			clearTimeout(queryTimer);
			queryTimer = null;
		}
	};

	/** Searches one page: cursor null = the first page (replaces the results), else the next one (appended). */
	const runPage = async (cursor: string | null): Promise<void> => {
		controller?.abort();
		const current = new AbortController();
		controller = current;
		const request = ++sequence;
		set(cursor === null ? { searchStatus: 'loading', searchError: null, nextCursor: null } : { searchStatus: 'loadingMore', searchError: null });
		try {
			const page = await fetchPage(get().filters, cursor, current.signal);
			if (request === sequence) {
				set((state) => ({
					results: appendUnique(cursor === null ? [] : state.results, page.items, keyOf),
					nextCursor: page.next_cursor,
					searchStatus: 'ready',
				}));
			}
		} catch (error) {
			if (request === sequence) {
				set({ searchStatus: 'failed', searchError: describeError(error), ...(cursor === null ? { results: [] } : {}) });
			}
		} finally {
			if (controller === current) {
				controller = null;
			}
		}
	};

	const search = () => {
		clearQueryTimer();
		return runPage(null);
	};

	return {
		setQuery: (query) => {
			if (query === get().filters.query) {
				return;
			}
			set((state) => ({ filters: { ...state.filters, query } }));
			clearQueryTimer();
			queryTimer = setTimeout(() => {
				queryTimer = null;
				void search();
			}, SEARCH_DEBOUNCE_MS);
		},
		search,
		loadMore: async () => {
			const { nextCursor, searchStatus } = get();
			if (nextCursor === null || searchStatus === 'loading' || searchStatus === 'loadingMore') {
				return;
			}
			await runPage(nextCursor);
		},
	};
}
