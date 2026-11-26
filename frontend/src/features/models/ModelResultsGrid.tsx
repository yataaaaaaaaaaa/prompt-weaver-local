// Online results of the Models section (catalog store): the provider info error, the downloads no card shows
// (DownloadsSection), a spinner while searching (the previous results stay visible), the search error with Retry,
// the empty state, the responsive grid of result cards and 'Load more' (LoadMoreButton) while the provider has a next
// page.
import {
	Body1,
	Button,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	Spinner,
	tokens,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { modelKey } from '../../domain/modelCatalog';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { LoadMoreButton } from '../../ui/LoadMoreButton';
import { ProviderInfoError } from './CatalogSearchBar';
import { DownloadsSection } from './DownloadsSection';
import { ModelResultCard } from './ModelResultCard';

/** Narrowest card column of the results grid (more columns as the section grows). */
export const RESULT_CARD_MIN_WIDTH = '320px';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		minWidth: 0,
	},
	grid: {
		display: 'grid',
		gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${RESULT_CARD_MIN_WIDTH}), 1fr))`,
		gap: tokens.spacingHorizontalM,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	item: {
		minWidth: 0,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

export function ModelResultsGrid(): JSX.Element {
	const styles = useStyles();
	const results = useModelCatalogStore((state) => state.results);
	const searchStatus = useModelCatalogStore((state) => state.searchStatus);
	const searchError = useModelCatalogStore((state) => state.searchError);
	const hasMore = useModelCatalogStore((state) => state.nextCursor != null);
	const search = useModelCatalogStore((state) => state.search);
	const loadMore = useModelCatalogStore((state) => state.loadMore);

	return (
		<div className={styles.root} aria-busy={searchStatus === 'loading'}>
			<ProviderInfoError />
			<DownloadsSection />
			{searchStatus === 'loading' ? <Spinner size="small" label="Searching models…" /> : null}
			{searchStatus === 'failed' ? (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>
						<MessageBarTitle>Search failed</MessageBarTitle>
						{searchError}
					</MessageBarBody>
					<MessageBarActions>
						<Button size="small" icon={<ArrowClockwiseRegular />} onClick={() => void search()}>
							Retry
						</Button>
					</MessageBarActions>
				</MessageBar>
			) : null}
			{results.length > 0 ? (
				<ul className={styles.grid} aria-label="Search results">
					{results.map((model) => (
						<li key={modelKey(model)} className={styles.item}>
							<ModelResultCard model={model} />
						</li>
					))}
				</ul>
			) : searchStatus === 'ready' ? (
				<Body1 className={styles.muted}>No models match this search.</Body1>
			) : null}
			{hasMore ? (
				<LoadMoreButton loading={searchStatus === 'loadingMore'} loadingLabel="Loading more models…" onLoadMore={() => void loadMore()} />
			) : null}
		</div>
	);
}
