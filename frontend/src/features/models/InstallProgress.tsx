// Progress of a running install (modelCatalogStore InstallEntry + tasks store DownloadProgress): progress bar
// (indeterminate while checking/registering or while the size is unknown), the transferred bytes or the phase
// text, and Cancel (enabled while the download task runs). Shared by the result cards and the downloads section.
import { Button, Caption1, makeStyles, ProgressBar, tokens } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';
import type { InstallPhase } from '../../domain/modelCatalog';
import { useModelCatalogStore, type InstallEntry } from '../../stores/modelCatalogStore';
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

const PHASE_TEXT: Record<Exclude<InstallPhase, 'downloading'>, string> = {
	checking: 'Checking for a local copy…',
	registering: 'Adding to the library…',
	failed: 'Install failed',
};

function progressText(phase: InstallPhase, progress: DownloadProgress | null): string {
	if (phase !== 'downloading') {
		return PHASE_TEXT[phase];
	}
	if (progress && progress.total > 0) {
		return formatTransfer(progress.current, progress.total);
	}
	return progress?.message || 'Starting the download…';
}

export type InstallProgressProps = {
	install: InstallEntry;
	progress: DownloadProgress | null;
	/** What is installed (accessible name of the progress bar). */
	title: string;
};

export function InstallProgress({ install, progress, title }: InstallProgressProps): JSX.Element {
	const styles = useStyles();
	const cancelInstall = useModelCatalogStore((state) => state.cancelInstall);
	const downloading = install.phase === 'downloading';
	const text = progressText(install.phase, progress);
	// Indeterminate (value undefined) while checking/registering or while the size is unknown.
	const value = downloading && progress?.ratio != null ? progress.ratio : undefined;

	return (
		<div className={styles.root}>
			<div className={styles.progress}>
				<ProgressBar aria-label={`Installing ${title}`} aria-valuetext={text} thickness="large" value={value} max={1} />
				<Caption1 className={styles.text}>{text}</Caption1>
			</div>
			<Button
				size="small"
				icon={<DismissRegular />}
				disabled={!downloading || install.taskId == null}
				onClick={() => void cancelInstall(install.key)}
			>
				Cancel
			</Button>
		</div>
	);
}
