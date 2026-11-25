// Thumbnail grids of the image library store: the search results (spinner, error with Retry, empty state, infinite
// scroll with a visible, focus-keeping 'Load more' fallback: LoadMoreButton) and the favorites (no paging). Each
// thumbnail is a button opening the image in the detail view (openImage); arrow keys move between thumbnails (Fluent
// arrow navigation group, one Tab stop). Thin views: paging, guards and the favorites collection stay in the store.
import {
	Body1,
	Button,
	createFocusOutlineStyle,
	Image,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	Spinner,
	tokens,
	useArrowNavigationGroup,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import { useShallow } from 'zustand/react/shallow';
import type { RemoteImage } from '../../api/types';
import { imageKey } from '../../domain/imageLibrary';
import { useImageLibraryStore } from '../../stores/imageLibraryStore';
import { ownsKeysProps } from '../../ui/keyboard';
import { useInfiniteScroll } from '../../ui/useInfiniteScroll';
import { LoadMoreButton } from '../../ui/LoadMoreButton';
import { imageLabel } from './imageLabels';

/** Attribute naming the image of a thumbnail button (the pane moves the focus back to it after the detail view). */
export const THUMBNAIL_KEY_ATTRIBUTE = 'data-image-key';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	grid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, minmax(144px, 1fr))',
		gap: tokens.spacingHorizontalS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	item: {
		minWidth: 0,
	},
	// Positioned and not clipping: Fluent's focus ring (createFocusOutlineStyle) is a pseudo element drawn around the
	// thumbnail, outside its box. The picture rounds its own corners.
	thumbnail: {
		position: 'relative',
		display: 'block',
		width: '100%',
		aspectRatio: '3 / 4',
		padding: 0,
		border: 'none',
		borderRadius: tokens.borderRadiusMedium,
		backgroundColor: tokens.colorNeutralBackground3,
		boxShadow: tokens.shadow2,
		cursor: 'pointer',
		transitionProperty: 'box-shadow',
		transitionDuration: tokens.durationFaster,
		transitionTimingFunction: tokens.curveEasyEase,
		':hover': {
			boxShadow: tokens.shadow8,
		},
		':active': {
			boxShadow: tokens.shadow4,
		},
		...createFocusOutlineStyle(),
	},
	// A block picture: an inline one adds its baseline gap under the image, making the thumbnail taller than 3:4.
	picture: {
		display: 'block',
		width: '100%',
		height: '100%',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

function Thumbnail({ image }: { image: RemoteImage }): JSX.Element {
	const styles = useStyles();
	const openImage = useImageLibraryStore((state) => state.openImage);
	const key = imageKey(image);
	return (
		<button
			type="button"
			className={styles.thumbnail}
			aria-label={imageLabel(image)}
			{...{ [THUMBNAIL_KEY_ATTRIBUTE]: key }}
			onClick={() => openImage(key)}
		>
			<Image className={styles.picture} src={image.thumbnail_url} alt="" fit="cover" shape="rounded" loading="lazy" />
		</button>
	);
}

/** The thumbnails of `images` (a list named `label`). */
function ThumbnailGrid({ images, label }: { images: readonly RemoteImage[]; label: string }): JSX.Element {
	const styles = useStyles();
	const arrowNavigation = useArrowNavigationGroup({ axis: 'grid-linear', memorizeCurrent: true });
	return (
		<ul className={styles.grid} aria-label={label} {...arrowNavigation} {...ownsKeysProps}>
			{images.map((image) => (
				<li key={imageKey(image)} className={styles.item}>
					<Thumbnail image={image} />
				</li>
			))}
		</ul>
	);
}

function RetryButton({ onClick }: { onClick: () => void }): JSX.Element {
	return (
		<Button size="small" icon={<ArrowClockwiseRegular />} onClick={onClick}>
			Retry
		</Button>
	);
}

export function SearchResultsGrid(): JSX.Element {
	const styles = useStyles();
	const results = useImageLibraryStore((state) => state.results);
	const status = useImageLibraryStore((state) => state.searchStatus);
	const searchError = useImageLibraryStore((state) => state.searchError);
	const hasMore = useImageLibraryStore((state) => state.nextCursor !== null);
	const search = useImageLibraryStore((state) => state.search);
	const loadMore = useImageLibraryStore((state) => state.loadMore);
	const sentinelRef = useInfiniteScroll({ enabled: hasMore && status === 'ready', onReach: () => void loadMore(), resetKey: results });
	// A failed first page clears the results; a failed further page keeps them.
	const pageFailed = status === 'failed' && results.length > 0;

	return (
		<div className={styles.root} aria-busy={status === 'loading' || status === 'loadingMore'}>
			{status === 'loading' ? <Spinner size="small" label="Searching images…" /> : null}
			{status === 'failed' && !pageFailed ? (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>
						<MessageBarTitle>Search failed</MessageBarTitle>
						{searchError}
					</MessageBarBody>
					<MessageBarActions>
						<RetryButton onClick={() => void search()} />
					</MessageBarActions>
				</MessageBar>
			) : null}
			{results.length > 0 ? (
				<ThumbnailGrid images={results} label="Search results" />
			) : status === 'ready' ? (
				<Body1 className={styles.muted}>No images match this search.</Body1>
			) : null}
			{hasMore ? <div ref={sentinelRef} aria-hidden /> : null}
			{pageFailed ? (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>
						<MessageBarTitle>Could not load more images</MessageBarTitle>
						{searchError}
					</MessageBarBody>
					<MessageBarActions>
						<RetryButton onClick={() => void loadMore()} />
					</MessageBarActions>
				</MessageBar>
			) : null}
			{hasMore && (status === 'ready' || status === 'loadingMore') ? (
				<LoadMoreButton loading={status === 'loadingMore'} loadingLabel="Loading more images…" onLoadMore={() => void loadMore()} />
			) : null}
		</div>
	);
}

export function FavoritesGrid(): JSX.Element {
	const styles = useStyles();
	const images = useImageLibraryStore(useShallow((state) => state.favorites.map((favorite) => favorite.image)));
	const status = useImageLibraryStore((state) => state.favoritesStatus);
	const favoritesError = useImageLibraryStore((state) => state.favoritesError);
	const loadFavorites = useImageLibraryStore((state) => state.loadFavorites);

	return (
		<div className={styles.root} aria-busy={status === 'loading'}>
			{status === 'loading' ? <Spinner size="small" label="Loading favorites…" /> : null}
			{status === 'failed' ? (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>
						<MessageBarTitle>Could not load the favorites</MessageBarTitle>
						{favoritesError}
					</MessageBarBody>
					<MessageBarActions>
						<RetryButton onClick={() => void loadFavorites()} />
					</MessageBarActions>
				</MessageBar>
			) : null}
			{images.length > 0 ? (
				<ThumbnailGrid images={images} label="Favorites" />
			) : status === 'ready' ? (
				<Body1 className={styles.muted}>No favorites yet. Open an image and select Favorite to keep it here.</Body1>
			) : null}
		</div>
	);
}
