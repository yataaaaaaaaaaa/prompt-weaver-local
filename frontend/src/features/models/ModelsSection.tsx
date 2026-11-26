// The Models section (navigation rail): find, download and pick checkpoints, LoRAs and embeddings. Full page
// (src/ui/SectionLayout.tsx): the toolbar (Online | Local library, search, filters, API token), the results (the
// online result cards, or the local library's checkpoints and LoRAs) and the detail panel (the selected online model,
// or the model folders next to the local library). Thin view over the catalog store (view, selection, search) and the
// library store; activates the catalog store on its first mount (the section mounts on its first visit).
import { CubeRegular } from '@fluentui/react-icons';
import { useEffect } from 'react';
import { SECTION_LABELS } from '../../app/sections';
import { modelKey } from '../../domain/modelCatalog';
import { selectSelectedRemoteModel, useModelCatalogStore } from '../../stores/modelCatalogStore';
import { EmptyState } from '../../ui/EmptyState';
import { SectionLayout } from '../../ui/SectionLayout';
import { LocalLibraryView, ModelFolders } from './LocalLibraryView';
import { ModelDetail } from './ModelDetail';
import { ModelResultsGrid } from './ModelResultsGrid';
import { ModelsToolbar } from './ModelsToolbar';

function NoModelSelected(): JSX.Element {
	return (
		<EmptyState icon={CubeRegular} title="Pick a model to see its versions, files and trigger words">
			<p>Select the name of a model in the results.</p>
			<p>
				A card's own button works without opening it: “Download and use” makes a checkpoint the current model and
				adds a LoRA to the LoRAs of Create.
			</p>
		</EmptyState>
	);
}

export function ModelsSection(): JSX.Element {
	const online = useModelCatalogStore((state) => state.view === 'online');
	const selected = useModelCatalogStore(selectSelectedRemoteModel);
	const closeModel = useModelCatalogStore((state) => state.closeModel);

	useEffect(() => {
		// Once per mount (idempotent in the store anyway).
		void useModelCatalogStore.getState().activate();
	}, []);

	return (
		<SectionLayout
			title={SECTION_LABELS.models}
			toolbar={<ModelsToolbar />}
			results={online ? <ModelResultsGrid /> : <LocalLibraryView />}
			resultsLabel={online ? 'Model search results' : 'Local library'}
			detail={online ? selected ? <ModelDetail key={modelKey(selected)} model={selected} onClose={closeModel} /> : null : <ModelFolders />}
			detailLabel={online ? 'Model details' : 'Model folders'}
			emptyDetail={<NoModelSelected />}
		/>
	);
}
