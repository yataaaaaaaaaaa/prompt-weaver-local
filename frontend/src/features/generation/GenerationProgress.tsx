// The one generation progress view (reused by the Generation pane and the Output browser pane).
// Reads the shared progress derivation of the tasks store; no props, no logic beyond presentation.
import { Caption1, makeStyles, ProgressBar, tokens } from '@fluentui/react-components';
import { useOutputsStore } from '../../stores/outputsStore';
import { useGenerationProgress } from '../../stores/tasksStore';

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
});

export function GenerationProgress(): JSX.Element {
	const styles = useStyles();
	const progress = useGenerationProgress();
	const currentId = useOutputsStore((state) => state.currentId);
	const message = progress.message || (currentId ? `Viewing output #${currentId}` : 'Idle');
	const hasTotal = progress.total > 0;
	// Indeterminate (value undefined) while a task is active without a known total.
	const value = hasTotal ? progress.ratio : progress.active ? undefined : 0;

	return (
		<div className={styles.root}>
			<div className={styles.header}>
				<Caption1 className={styles.message}>{message}</Caption1>
				{hasTotal ? (
					<Caption1 className={styles.count}>
						{progress.current}/{progress.total}
					</Caption1>
				) : null}
			</div>
			<ProgressBar aria-label="Generation progress" thickness="large" value={value} max={1} />
		</div>
	);
}
