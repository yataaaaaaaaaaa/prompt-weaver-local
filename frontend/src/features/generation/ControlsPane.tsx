// Generation pane: a composition of small sections, each a thin view over its owning store. The active character
// is shown right under the actions.
import { ActiveCharacterSection } from '../characters/ActiveCharacterSection';
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
			<ActiveCharacterSection />
			<GenerationSettingsSection />
			<SeedSection />
			<ModelSection />
			<LoraSection />
			<NegativePromptSection />
		</PaneContent>
	);
}
