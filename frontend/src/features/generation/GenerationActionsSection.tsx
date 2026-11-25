// Top of the Generation pane: Generate / Continuous / Cancel, Copy prompt, Add category, progress and session captions.
// Action intents (src/ui/stateColors.ts): Generate is the primary action; Cancel is a warning action (it interrupts
// what is running without deleting anything); a running continuous loop shows the checked toggle in the primary
// color. A disabled button keeps the Fluent disabled look (the intent classes color enabled buttons only).
import { Button, Caption1, makeStyles, ToggleButton, tokens, Tooltip } from '@fluentui/react-components';
import { Add20Regular, ArrowRepeatAll20Regular, Copy20Regular, Dismiss20Regular, Sparkle20Regular } from '@fluentui/react-icons';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useCanGenerate, useCanToggleContinuous, useGenerationStore } from '../../stores/generationStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { PaneSection } from '../../ui/PaneLayout';
import { useActionClasses } from '../../ui/stateStyles';
import { GenerationProgress } from './GenerationProgress';

const useStyles = makeStyles({
	buttons: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	captions: {
		display: 'flex',
		flexDirection: 'column',
		minWidth: 0,
		color: tokens.colorNeutralForeground3,
	},
	// One line whatever the path length (the full path is in the tooltip): the pane layout does not depend on where
	// the data lives.
	singleLine: {
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
});

export function GenerationActionsSection(): JSX.Element {
	const styles = useStyles();
	const actions = useActionClasses();
	const canGenerate = useCanGenerate();
	const generating = useGenerationStore((state) => state.generating);
	const continuous = useGenerationStore((state) => state.continuous);
	const generate = useGenerationStore((state) => state.generate);
	const toggleContinuous = useGenerationStore((state) => state.toggleContinuous);
	const cancel = useGenerationStore((state) => state.cancel);
	const canToggleContinuous = useCanToggleContinuous();
	const canCancel = generating || continuous;
	const hasCurrentPrompt = useOutputsStore((state) => Boolean(state.record?.prompt));
	const copyCurrentPrompt = useOutputsStore((state) => state.copyCurrentPrompt);
	const addCategory = useCategoriesStore((state) => state.addCategory);
	const categoryCount = useCategoriesStore((state) => state.categories.length);
	const dataDir = useSessionStore((state) => state.dataDir);
	const dataDirText = `Data directory: ${dataDir || '—'}`;

	return (
		<PaneSection
			title="Current generation"
			actions={
				<>
					<Button appearance="subtle" size="small" icon={<Copy20Regular />} disabled={!hasCurrentPrompt} onClick={() => void copyCurrentPrompt()}>
						Copy prompt
					</Button>
					<Button appearance="subtle" size="small" icon={<Add20Regular />} onClick={() => addCategory()}>
						Add category
					</Button>
				</>
			}
		>
			<div className={styles.buttons}>
				<Button
					appearance="primary"
					className={actions.filled.primary}
					icon={<Sparkle20Regular />}
					disabled={!canGenerate}
					onClick={() => void generate()}
				>
					{generating ? 'Generating…' : 'Generate'}
				</Button>
				<ToggleButton
					appearance={continuous ? 'primary' : 'secondary'}
					className={continuous ? actions.filled.primary : undefined}
					icon={<ArrowRepeatAll20Regular />}
					checked={continuous}
					disabled={!canToggleContinuous}
					onClick={() => void toggleContinuous()}
				>
					Continuous
				</ToggleButton>
				<Button
					appearance="subtle"
					className={actions.subtle.warning}
					icon={<Dismiss20Regular />}
					disabled={!canCancel}
					onClick={() => void cancel()}
				>
					Cancel
				</Button>
			</div>
			<GenerationProgress />
			<div className={styles.captions}>
				<Tooltip content={dataDirText} relationship="inaccessible">
					<Caption1 className={styles.singleLine}>{dataDirText}</Caption1>
				</Tooltip>
				<Caption1>Categories: {categoryCount}</Caption1>
			</div>
		</PaneSection>
	);
}
