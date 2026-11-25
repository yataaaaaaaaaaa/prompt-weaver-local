// The one generation progress view (reused by the Generation pane and the Output browser pane).
// Reads the shared progress derivation of the tasks store (message, step count, outcome, bar fill); no props, no logic
// beyond presentation. The outcome sets the Fluent Field validation state, which colors the bar (brand while running,
// success when complete, warning when cancelled, error on failure); the text always names the state too, and a
// failure shows its message with Fluent's error icon.
import { Caption1, Field, makeStyles, ProgressBar, tokens, type FieldProps } from '@fluentui/react-components';
import { GENERATION_FAILED_TITLE } from '../../stores/generationStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { useGenerationProgress, type GenerationOutcome } from '../../stores/tasksStore';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
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
	},
	field: {
		minWidth: 0,
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

export function GenerationProgress(): JSX.Element {
	const styles = useStyles();
	const progress = useGenerationProgress();
	const currentId = useOutputsStore((state) => state.currentId);
	const failed = progress.outcome === 'error';
	const idleMessage = currentId ? `Viewing output #${currentId}` : 'Idle';
	const headline = failed ? GENERATION_FAILED_TITLE : progress.message || idleMessage;

	return (
		<div className={styles.root} data-generation-outcome={progress.outcome}>
			<div className={styles.header}>
				<Caption1 className={styles.message}>{headline}</Caption1>
				{progress.total > 0 ? (
					<Caption1 className={styles.count}>
						{progress.current}/{progress.total}
					</Caption1>
				) : null}
			</div>
			<Field
				className={styles.field}
				validationState={FIELD_STATES[progress.outcome]}
				validationMessage={failed ? progress.message || undefined : undefined}
			>
				<ProgressBar aria-label="Generation progress" thickness="large" value={progress.value} max={1} />
			</Field>
		</div>
	);
}
