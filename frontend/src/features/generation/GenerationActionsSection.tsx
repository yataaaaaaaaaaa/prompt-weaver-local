// Top of the Generation pane: Generate / Continuous / Cancel, Copy prompt, Add category, progress and session captions.
import { Button, Caption1, makeStyles, ToggleButton, tokens } from '@fluentui/react-components';
import { Add20Regular, ArrowRepeatAll20Regular, Copy20Regular, Dismiss20Regular, Sparkle20Regular } from '@fluentui/react-icons';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useCanGenerate, useCanToggleContinuous, useGenerationStore } from '../../stores/generationStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { GenerationProgress } from './GenerationProgress';
import { PaneSection } from '../../ui/PaneLayout';

const useStyles = makeStyles({
	buttons: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	captions: {
		display: 'flex',
		flexDirection: 'column',
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
});

export function GenerationActionsSection(): JSX.Element {
	const styles = useStyles();
	const canGenerate = useCanGenerate();
	const generating = useGenerationStore((state) => state.generating);
	const continuous = useGenerationStore((state) => state.continuous);
	const generate = useGenerationStore((state) => state.generate);
	const toggleContinuous = useGenerationStore((state) => state.toggleContinuous);
	const cancel = useGenerationStore((state) => state.cancel);
	const canToggleContinuous = useCanToggleContinuous();
	const hasCurrentPrompt = useOutputsStore((state) => Boolean(state.record?.prompt));
	const copyCurrentPrompt = useOutputsStore((state) => state.copyCurrentPrompt);
	const addCategory = useCategoriesStore((state) => state.addCategory);
	const categoryCount = useCategoriesStore((state) => state.categories.length);
	const dataDir = useSessionStore((state) => state.dataDir);

	return (
		<PaneSection
			title="Current generation"
			actions={
				<>
					<Button appearance="subtle" icon={<Copy20Regular />} disabled={!hasCurrentPrompt} onClick={() => void copyCurrentPrompt()}>
						Copy prompt
					</Button>
					<Button appearance="secondary" icon={<Add20Regular />} onClick={() => addCategory()}>
						Add category
					</Button>
				</>
			}
		>
			<div className={styles.buttons}>
				<Button appearance="primary" icon={<Sparkle20Regular />} disabled={!canGenerate} onClick={() => void generate()}>
					{generating ? 'Generating…' : 'Generate'}
				</Button>
				<ToggleButton
					icon={<ArrowRepeatAll20Regular />}
					checked={continuous}
					disabled={!canToggleContinuous}
					onClick={() => void toggleContinuous()}
				>
					Continuous
				</ToggleButton>
				<Button appearance="subtle" icon={<Dismiss20Regular />} disabled={!generating && !continuous} onClick={() => void cancel()}>
					Cancel
				</Button>
			</div>
			<GenerationProgress />
			<div className={styles.captions}>
				<Caption1>Data directory: {dataDir || '—'}</Caption1>
				<Caption1>Categories: {categoryCount}</Caption1>
			</div>
		</PaneSection>
	);
}
