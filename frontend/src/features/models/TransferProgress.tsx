// Presentational progress of a file transfer: progress bar (indeterminate without a value), the status text under it
// and, when the owner passes onCancel, a Cancel button. Shared by the catalog installs (InstallProgress) and the
// IP-Adapter file downloads (characters views): each owner passes the texts and the cancel action of its store.
import { Button, Caption1, makeStyles, ProgressBar, tokens } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import type { DownloadProgress } from '../../stores/tasksStore';
import { formatTransfer } from './format';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
	},
	progress: {
		display: 'flex',
		flexDirection: 'column',
		flex: '1 1 auto',
		gap: tokens.spacingVerticalXXS,
		minWidth: 0,
	},
	text: {
		color: tokens.colorNeutralForeground2,
		fontVariantNumeric: 'tabular-nums',
		overflowWrap: 'anywhere',
	},
});

/** Text of a running download (tasks store DownloadProgress): the transferred bytes when the size is known, else the
 *  task message, else 'Starting the download…' (no event yet). */
export function downloadProgressText(progress: DownloadProgress | null): string {
	if (progress && progress.total > 0) {
		return formatTransfer(progress.current, progress.total);
	}
	return progress?.message || 'Starting the download…';
}

/** The bar value of a running download: its ratio, or undefined (indeterminate) while the size is unknown. */
export function downloadProgressValue(progress: DownloadProgress | null): number | undefined {
	return progress?.ratio ?? undefined;
}

export type TransferProgressProps = {
	/** Accessible name of the progress bar ('Installing <title>', 'Downloading <file>'). */
	label: string;
	/** Status text shown under the bar (also its aria-valuetext). */
	text: string;
	/** 0..1; undefined: indeterminate. */
	value: number | undefined;
	/** Cancel button action (no button without it). */
	onCancel?: () => void;
	/** Cancel is shown but disabled (e.g. no download task yet). */
	cancelDisabled?: boolean;
};

export function TransferProgress({ label, text, value, onCancel, cancelDisabled = false }: TransferProgressProps): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.root}>
			<div className={styles.progress}>
				<ProgressBar aria-label={label} aria-valuetext={text} thickness="large" value={value} max={1} />
				<Caption1 className={styles.text}>{text}</Caption1>
			</div>
			{onCancel ? (
				<Button size="small" icon={<DismissRegular />} disabled={cancelDisabled} onClick={onCancel}>
					Cancel
				</Button>
			) : null}
		</div>
	);
}
