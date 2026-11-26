// THE generation progress view (the generation panel's sticky action area, and `compact` in the collapsed generation
// strip). Reads the shared progress derivation of the tasks store (message, step count, outcome, bar fill); no logic
// beyond presentation. The outcome sets the Fluent Field validation state, which colors the bar (brand while running,
// success when complete, warning when cancelled, error on failure); the text always names the state too, and a failure
// shows its message with Fluent's error icon. The compact variant keeps the colored bar and the step count only.
import { Caption1, Field, makeStyles, mergeClasses, ProgressBar, tokens, type FieldProps } from '@fluentui/react-components';
import { GENERATION_FAILED_TITLE } from '../../stores/generationStore';
import { selectSelectedModel, useLibraryStore } from '../../stores/libraryStore';
import { useGenerationProgress, type GenerationOutcome } from '../../stores/tasksStore';
import { GENERATION_LABELS } from './generationLabels';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
	},
	compact: {
		alignItems: 'center',
		width: '100%',
	},
	header: {
		display: 'flex',
		justifyContent: 'space-between',
		gap: tokens.spacingHorizontalS,
		color: tokens.colorNeutralForeground2,
	},
	message: {
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	count: {
		flexShrink: 0,
		fontVariantNumeric: 'tabular-nums',
		color: tokens.colorNeutralForeground2,
	},
	field: {
		minWidth: 0,
		width: '100%',
		overflowWrap: 'anywhere',
	},
});

const FIELD_STATES: Record<GenerationOutcome, NonNullable<FieldProps['validationState']>> = {
	idle: 'none',
	running: 'none',
	complete: 'success',
	cancelled: 'warning',
	error: 'error',
};

/** What the idle progress says: ready, or what is missing to generate. */
export const IDLE_MESSAGES = {
	ready: 'Ready to generate',
	noModel: 'Pick a checkpoint to generate',
} as const;

export type GenerationProgressProps = {
	/** The bar and the step count only (the collapsed generation strip). */
	compact?: boolean;
};

export function GenerationProgress({ compact = false }: GenerationProgressProps): JSX.Element {
	const styles = useStyles();
	const progress = useGenerationProgress();
	const hasModel = useLibraryStore((state) => selectSelectedModel(state) !== null);
	const failed = progress.outcome === 'error';
	const idleMessage = hasModel ? IDLE_MESSAGES.ready : IDLE_MESSAGES.noModel;
	const headline = failed ? GENERATION_FAILED_TITLE : progress.outcome === 'idle' ? idleMessage : progress.message || idleMessage;
	const count =
		progress.total > 0 ? (
			<Caption1 className={styles.count}>
				{progress.current}/{progress.total}
			</Caption1>
		) : null;

	return (
		<div className={mergeClasses(styles.root, compact && styles.compact)} data-generation-outcome={progress.outcome}>
			{compact ? null : (
				<div className={styles.header}>
					<Caption1 className={styles.message}>{headline}</Caption1>
					{count}
				</div>
			)}
			<Field
				className={styles.field}
				validationState={FIELD_STATES[progress.outcome]}
				validationMessage={failed && !compact ? progress.message || undefined : undefined}
			>
				<ProgressBar
					aria-label={GENERATION_LABELS.progress}
					aria-valuetext={compact ? headline : undefined}
					thickness={compact ? 'medium' : 'large'}
					value={progress.value}
					max={1}
				/>
			</Field>
			{compact ? count : null}
		</div>
	);
}
