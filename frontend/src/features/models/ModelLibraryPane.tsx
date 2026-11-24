// Model library pane: online search (catalog store: filters, results, installs) and the local library view
// (library store entries). Activates the catalog store on mount (idempotent: info + first search once);
// the selected tab is the only local (ephemeral) state.
import { makeStyles, Tab, TabList, tokens, useId } from '@fluentui/react-components';
import { CloudRegular, LibraryRegular } from '@fluentui/react-icons';
import { useEffect, useState } from 'react';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { PaneContent, PaneSection } from '../../ui/PaneLayout';
import { CatalogSearchBar } from './CatalogSearchBar';
import { DownloadsSection } from './DownloadsSection';
import { LocalLibraryView } from './LocalLibraryView';
import { ModelResultList } from './ModelResultList';
import { ProviderTokenDialog } from './ProviderTokenDialog';

type LibraryTab = 'online' | 'local';

const useStyles = makeStyles({
	panel: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		minWidth: 0,
	},
});

export function ModelLibraryPane(): JSX.Element {
	const styles = useStyles();
	const activate = useModelCatalogStore((state) => state.activate);
	const [tab, setTab] = useState<LibraryTab>('online');
	const tabIds = { online: useId('model-library-tab-online-'), local: useId('model-library-tab-local-') };

	useEffect(() => {
		void activate();
	}, [activate]);

	return (
		<PaneContent>
			<TabList selectedValue={tab} onTabSelect={(_event, data) => setTab(data.value === 'local' ? 'local' : 'online')}>
				<Tab id={tabIds.online} value="online" icon={<CloudRegular />}>
					Online
				</Tab>
				<Tab id={tabIds.local} value="local" icon={<LibraryRegular />}>
					Local library
				</Tab>
			</TabList>
			<div role="tabpanel" aria-labelledby={tabIds[tab]} className={styles.panel}>
				{tab === 'online' ? (
					<>
						<PaneSection title="Search" actions={<ProviderTokenDialog />}>
							<CatalogSearchBar />
						</PaneSection>
						<DownloadsSection />
						<PaneSection title="Results">
							<ModelResultList />
						</PaneSection>
					</>
				) : (
					<LocalLibraryView />
				)}
			</div>
		</PaneContent>
	);
}
