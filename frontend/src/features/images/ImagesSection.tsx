// The Images section (navigation rail): find online images and reuse their LoRAs (with weights), tags and checkpoint.
// Full page (src/ui/SectionLayout.tsx): the toolbar (Search | Favorites, keyword, filters), the thumbnail grid and,
// next to it, the detail panel of the selected image (ImageDetail; Escape or Close returns to its thumbnail). Thin
// view over the image library store (view, selection, search, favorites); activates the store on its first mount
// (the section mounts on its first visit).
import { ImageMultipleRegular } from '@fluentui/react-icons';
import { useEffect } from 'react';
import { SECTION_LABELS } from '../../app/sections';
import { selectSelectedImage, useImageLibraryStore } from '../../stores/imageLibraryStore';
import { EmptyState } from '../../ui/EmptyState';
import { SectionLayout } from '../../ui/SectionLayout';
import { ImageDetail } from './ImageDetail';
import { FavoritesGrid, SearchResultsGrid } from './ImageGrid';
import { ImagesToolbar } from './ImagesToolbar';

function NoImageSelected(): JSX.Element {
	return (
		<EmptyState icon={ImageMultipleRegular} title="Pick an image to see its tags, LoRAs and checkpoint">
			<p>Then reuse them in one click: Use these LoRAs, Use this checkpoint, or add its tags to a category.</p>
			<p>
				A keyword finds matching LoRAs and checkpoints and shows the images of their galleries. Without a keyword, all
				recent images are browsed by sort and period.
			</p>
		</EmptyState>
	);
}

export function ImagesSection(): JSX.Element {
	const search = useImageLibraryStore((state) => state.view === 'search');
	// The key only while the image is listed (in the results or the favorites).
	const shownKey = useImageLibraryStore((state) => (selectSelectedImage(state) ? state.selectedImageKey : null));
	const closeImage = useImageLibraryStore((state) => state.closeImage);

	useEffect(() => {
		// Once per mount (idempotent in the store anyway).
		void useImageLibraryStore.getState().activate();
	}, []);

	return (
		<SectionLayout
			title={SECTION_LABELS.images}
			toolbar={<ImagesToolbar />}
			results={search ? <SearchResultsGrid /> : <FavoritesGrid />}
			resultsLabel={search ? 'Image search results' : 'Favorite images'}
			detail={shownKey !== null ? <ImageDetail key={shownKey} imageKey={shownKey} onClose={closeImage} /> : null}
			detailLabel="Image details"
			emptyDetail={<NoImageSelected />}
		/>
	);
}
