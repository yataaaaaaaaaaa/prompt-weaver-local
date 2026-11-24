// Online search results of the catalog store: spinner while searching (the previous results stay visible),
// error with Retry, empty state, the result cards and 'Load more' while the provider has a next page.
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
import { ModelResultCard } from './ModelResultCard';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
	more: {
		alignSelf: 'center',
	},
});

export function ModelResultList(): JSX.Element {
	const styles = useStyles();
	const results = useModelCatalogStore((state) => state.results);
	const searchStatus = useModelCatalogStore((state) => state.searchStatus);
	const searchError = useModelCatalogStore((state) => state.searchError);
	const hasMore = useModelCatalogStore((state) => state.nextCursor != null);
	const search = useModelCatalogStore((state) => state.search);
	const loadMore = useModelCatalogStore((state) => state.loadMore);

	return (
		<div className={styles.root} aria-busy={searchStatus === 'loading'}>
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
				<ul className={styles.list} aria-label="Search results">
					{results.map((model) => (
						<li key={modelKey(model)}>
							<ModelResultCard model={model} />
						</li>
					))}
				</ul>
			) : searchStatus === 'ready' ? (
				<Body1 className={styles.muted}>No models match this search.</Body1>
			) : null}
			{searchStatus === 'loadingMore' ? (
				<Spinner size="tiny" label="Loading more models…" />
			) : hasMore ? (
				<Button className={styles.more} onClick={() => void loadMore()}>
					Load more
				</Button>
			) : null}
		</div>
	);
}
