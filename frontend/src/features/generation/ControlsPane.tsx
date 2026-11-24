// Generation pane: a composition of small sections, each a thin view over its owning store.
import { LoraSection } from '../library/LoraSection';
import { ModelSection } from '../library/ModelSection';
import { GenerationActionsSection } from './GenerationActionsSection';
import { GenerationSettingsSection } from './GenerationSettingsSection';
import { NegativePromptSection } from './NegativePromptSection';
import { PaneContent } from '../../ui/PaneLayout';
import { SeedSection } from './SeedSection';

export function ControlsPane(): JSX.Element {
	return (
		<PaneContent>
			<GenerationActionsSection />
			<GenerationSettingsSection />
			<SeedSection />
			<ModelSection />
			<LoraSection />
			<NegativePromptSection />
		</PaneContent>
	);
}
