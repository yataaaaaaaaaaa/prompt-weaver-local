// The generation panel of the Create section (the shell renders it inside the 'Generation' region,
// src/app/sections.ts): a scrolling body (model, character, LoRAs with weights, image settings, seeds, negative prompt,
// then "More options" disclosed progressively) above a sticky action area (Generate, Continuous, Cancel and the
// progress) that never scrolls away, whatever the window height. GenerationActionsCompact is what the collapsed region
// shows: the same actions, icon-only, with a compact progress bar. Each part is a thin view over its owning store.
import { makeStyles, tokens } from '@fluentui/react-components';
import { ActiveCharacterSection } from '../characters/ActiveCharacterSection';
import { LoraSection } from '../library/LoraSection';
import { ModelSection } from '../library/ModelSection';
import { PaneContent } from '../../ui/PaneLayout';
import { AdvancedOptions } from './AdvancedOptions';
import { GenerationActions } from './GenerationActions';
import { GenerationProgress } from './GenerationProgress';
import { GenerationSettingsSection } from './GenerationSettingsSection';
import { NegativePromptSection } from './NegativePromptSection';
import { GENERATION_LABELS } from './generationLabels';
import { SeedSection } from './SeedSection';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		flex: 1,
		minHeight: 0,
		minWidth: 0,
	},
	body: {
		flex: 1,
		minHeight: 0,
		overflowY: 'auto',
		overflowX: 'hidden',
	},
	actions: {
		display: 'flex',
		flexDirection: 'column',
		flexShrink: 0,
		gap: tokens.spacingVerticalS,
		padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
		borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
		boxShadow: tokens.shadow4,
	},
	compact: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalM,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		width: '100%',
		boxSizing: 'border-box',
	},
});

export function GenerationPanel(): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.root}>
			<div className={styles.body}>
				<PaneContent>
					<ModelSection />
					<ActiveCharacterSection />
					<LoraSection />
					<GenerationSettingsSection />
					<SeedSection />
					<NegativePromptSection />
					<AdvancedOptions />
				</PaneContent>
			</div>
			<div role="group" aria-label={GENERATION_LABELS.actions} className={styles.actions}>
				<GenerationActions />
				<GenerationProgress />
			</div>
		</div>
	);
}

/** The generation actions of the collapsed generation region: icon-only Generate / Continuous / Cancel stacked
 *  vertically with a compact progress bar, so generating never needs the panel expanded. */
export function GenerationActionsCompact(): JSX.Element {
	const styles = useStyles();
	return (
		<div role="group" aria-label={GENERATION_LABELS.actions} className={styles.compact}>
			<GenerationActions compact />
			<GenerationProgress compact />
		</div>
	);
}
