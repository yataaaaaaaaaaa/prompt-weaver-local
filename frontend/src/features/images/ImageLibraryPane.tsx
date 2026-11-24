// Image library pane: online image search and the favorites collection (image library store), with the detail view
// of the picked image (tags, LoRAs with weights and status, checkpoint, generation parameters) in place of the grid.
// Activates the store on mount (idempotent: first search + favorites once). Local (ephemeral) state: the selected
// tab and the thumbnail to focus again when the detail view is left with Back or Escape.
import { makeStyles, Tab, TabList, tokens, useId } from '@fluentui/react-components';
import { ImageSearchRegular, StarRegular } from '@fluentui/react-icons';
import { useEffect, useRef, useState } from 'react';
import { useImageLibraryStore } from '../../stores/imageLibraryStore';
import { PaneContent, PaneSection } from '../../ui/PaneLayout';
import { ImageDetail } from './ImageDetail';
import { FavoritesGrid, SearchResultsGrid, THUMBNAIL_KEY_ATTRIBUTE } from './ImageGrid';
import { ImageSearchBar } from './ImageSearchBar';

type ImageLibraryTab = 'search' | 'favorites';

const useStyles = makeStyles({
	panel: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		minWidth: 0,
	},
});

/** The thumbnail button of `key` inside `container` (null when not listed). */
function findThumbnail(container: HTMLElement | null, key: string): HTMLElement | null {
	const buttons = container?.querySelectorAll<HTMLElement>(`[${THUMBNAIL_KEY_ATTRIBUTE}]`) ?? [];
	return Array.from(buttons).find((button) => button.getAttribute(THUMBNAIL_KEY_ATTRIBUTE) === key) ?? null;
}

export function ImageLibraryPane(): JSX.Element {
	const styles = useStyles();
	const closeImage = useImageLibraryStore((state) => state.closeImage);
	const selectedKey = useImageLibraryStore((state) => state.selectedImageKey);
	const [tab, setTab] = useState<ImageLibraryTab>('search');
	const tabIds = { search: useId('image-library-tab-search-'), favorites: useId('image-library-tab-favorites-') };
	const panelRef = useRef<HTMLDivElement>(null);
	/** Thumbnail to focus once the grid is back (set by Back / Escape). */
	const returnFocusKeyRef = useRef<string | null>(null);

	useEffect(() => {
		// Once per mount (idempotent in the store anyway).
		void useImageLibraryStore.getState().activate();
	}, []);

	useEffect(() => {
		const key = returnFocusKeyRef.current;
		if (selectedKey === null && key !== null) {
			returnFocusKeyRef.current = null;
			// The selected tab when the image is no longer listed (e.g. removed from the favorites meanwhile).
			(findThumbnail(panelRef.current, key) ?? document.getElementById(tabIds[tab]))?.focus();
		}
		// Runs when the detail view closes; the tab is read as it is then.
	}, [selectedKey]);

	const back = () => {
		returnFocusKeyRef.current = selectedKey;
		closeImage();
	};

	return (
		<PaneContent>
			<TabList
				selectedValue={tab}
				onTabSelect={(_event, data) => {
					setTab(data.value === 'favorites' ? 'favorites' : 'search');
					if (selectedKey !== null) {
						closeImage();
					}
				}}
			>
				<Tab id={tabIds.search} value="search" icon={<ImageSearchRegular />}>
					Search
				</Tab>
				<Tab id={tabIds.favorites} value="favorites" icon={<StarRegular />}>
					Favorites
				</Tab>
			</TabList>
			<div ref={panelRef} role="tabpanel" aria-labelledby={tabIds[tab]} className={styles.panel}>
				{selectedKey !== null ? (
					<ImageDetail key={selectedKey} imageKey={selectedKey} onBack={back} />
				) : tab === 'search' ? (
					<>
						<PaneSection title="Search">
							<ImageSearchBar />
						</PaneSection>
						<PaneSection title="Results">
							<SearchResultsGrid />
						</PaneSection>
					</>
				) : (
					<PaneSection title="Favorites">
						<FavoritesGrid />
					</PaneSection>
				)}
			</div>
		</PaneContent>
	);
}
