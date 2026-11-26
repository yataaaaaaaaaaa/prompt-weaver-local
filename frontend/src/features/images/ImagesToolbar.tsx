// Toolbar of the Images section (SectionToolbar of src/features/models): the Search | Favorites switch (image
// library store view), and the keyword box with the search filters (search only). Thin view over the store.
import { Tab, TabList } from '@fluentui/react-components';
import { ImageSearchRegular, StarRegular } from '@fluentui/react-icons';
import { useImageLibraryStore } from '../../stores/imageLibraryStore';
import { SectionToolbar } from '../../ui/SectionToolbar';
import { ImageSearchBox, ImageSearchFilters } from './ImageSearchBar';

export function ImagesToolbar(): JSX.Element {
	const view = useImageLibraryStore((state) => state.view);
	const setView = useImageLibraryStore((state) => state.setView);
	const search = view === 'search';
	return (
		<SectionToolbar
			views={
				<TabList aria-label="Images to show" selectedValue={view} onTabSelect={(_event, data) => setView(data.value === 'favorites' ? 'favorites' : 'search')}>
					<Tab value="search" icon={<ImageSearchRegular />}>
						Search
					</Tab>
					<Tab value="favorites" icon={<StarRegular />}>
						Favorites
					</Tab>
				</TabList>
			}
			search={search ? <ImageSearchBox /> : undefined}
			filters={search ? <ImageSearchFilters /> : undefined}
			filtersLabel="Image filters"
		/>
	);
}
