// Progress of a running install (modelCatalogStore InstallEntry + tasks store DownloadProgress): progress bar
// (indeterminate while checking/registering or while the size is unknown), the transferred bytes or the phase
// text, and Cancel (enabled while the download task runs). Shared by the result cards, the detail panel, the Downloads
// area and the image resources; the presentation is the shared TransferProgress.
import type { InstallPhase } from '../../domain/modelCatalog';
import { useModelCatalogStore, type InstallEntry } from '../../stores/modelCatalogStore';
import type { DownloadProgress } from '../../stores/tasksStore';
import { downloadProgressText, downloadProgressValue, TransferProgress } from './TransferProgress';

const PHASE_TEXT: Record<Exclude<InstallPhase, 'downloading'>, string> = {
	checking: 'Checking for a local copy…',
	registering: 'Adding to the library…',
	failed: 'Install failed',
};

export type InstallProgressProps = {
	install: InstallEntry;
	progress: DownloadProgress | null;
	/** What is installed (accessible name of the progress bar). */
	title: string;
};

export function InstallProgress({ install, progress, title }: InstallProgressProps): JSX.Element {
	const cancelInstall = useModelCatalogStore((state) => state.cancelInstall);
	const downloading = install.phase === 'downloading';
	return (
		<TransferProgress
			label={`Installing ${title}`}
			text={install.phase === 'downloading' ? downloadProgressText(progress) : PHASE_TEXT[install.phase]}
			// Indeterminate (undefined) while checking/registering or while the size is unknown.
			value={downloading ? downloadProgressValue(progress) : undefined}
			cancelDisabled={!downloading || install.taskId == null}
			onCancel={() => void cancelInstall(install.key)}
		/>
	);
}
