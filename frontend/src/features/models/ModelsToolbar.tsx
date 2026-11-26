// Toolbar of the Models section (SectionToolbar): the Online | Local library switch (catalog store view), the model
// search box and its filters (online only), and the provider API token command. Thin view over the catalog store.
import { Tab, TabList } from '@fluentui/react-components';
import { CloudRegular, LibraryRegular } from '@fluentui/react-icons';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { CatalogFilters, CatalogSearchBox } from './CatalogSearchBar';
import { ProviderTokenDialog } from './ProviderTokenDialog';
import { SectionToolbar } from '../../ui/SectionToolbar';

export function ModelsToolbar(): JSX.Element {
	const view = useModelCatalogStore((state) => state.view);
	const setView = useModelCatalogStore((state) => state.setView);
	const online = view === 'online';
	return (
		<SectionToolbar
			views={
				<TabList aria-label="Models to show" selectedValue={view} onTabSelect={(_event, data) => setView(data.value === 'local' ? 'local' : 'online')}>
					<Tab value="online" icon={<CloudRegular />}>
						Online
					</Tab>
					<Tab value="local" icon={<LibraryRegular />}>
						Local library
					</Tab>
				</TabList>
			}
			search={online ? <CatalogSearchBox /> : undefined}
			commands={<ProviderTokenDialog />}
			filters={online ? <CatalogFilters /> : undefined}
			filtersLabel="Model filters"
		/>
	);
}
