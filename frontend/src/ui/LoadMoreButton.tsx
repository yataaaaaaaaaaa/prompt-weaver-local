// 'Load more' of a paged result list (model search results, image search results). It stays in place while the next
// page loads, disabled but still focusable (Fluent disabledFocusable) with a spinner and the loading text: a keyboard
// user who pressed it, or whose focus is on it when the infinite scroll loads the page, keeps the focus instead of
// losing it to the document when the button is swapped for a spinner. The owner hides it once no page is left.
import { Button, makeStyles, Spinner } from '@fluentui/react-components';

const useStyles = makeStyles({
	button: {
		alignSelf: 'center',
	},
});

export type LoadMoreButtonProps = {
	/** The next page is loading (the button shows `loadingLabel` and ignores clicks). */
	loading: boolean;
	/** Text while loading, e.g. 'Loading more images…'. */
	loadingLabel: string;
	onLoadMore: () => void;
};

export function LoadMoreButton({ loading, loadingLabel, onLoadMore }: LoadMoreButtonProps): JSX.Element {
	const styles = useStyles();
	return (
		<Button
			className={styles.button}
			disabledFocusable={loading}
			aria-busy={loading}
			icon={loading ? <Spinner size="tiny" /> : undefined}
			onClick={onLoadMore}
		>
			{loading ? loadingLabel : 'Load more'}
		</Button>
	);
}
