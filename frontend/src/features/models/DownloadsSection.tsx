// Installs of the catalog store that no result card shows (selectDetachedInstallKeys: e.g. resumed after a
// reload, started before the search changed or for another version): title and progress from the tasks store,
// Cancel, or the error with Dismiss. Hidden when there is none.
import { Body1Strong, Button, makeStyles, MessageBar, MessageBarActions, MessageBarBody, tokens } from '@fluentui/react-components';
import { useShallow } from 'zustand/react/shallow';
import { MODEL_KIND_LABELS } from '../../domain/modelCatalog';
import { selectDetachedInstallKeys, useModelCatalogStore } from '../../stores/modelCatalogStore';
import { useDownloadProgress } from '../../stores/tasksStore';
import { PaneSection } from '../../ui/PaneLayout';
import { InstallProgress } from './InstallProgress';

const useStyles = makeStyles({
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	item: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
	},
	title: {
		overflowWrap: 'anywhere',
	},
});

function DownloadItem({ installKey }: { installKey: string }): JSX.Element | null {
	const styles = useStyles();
	const install = useModelCatalogStore((state) => state.installs[installKey] ?? null);
	const dismissInstallError = useModelCatalogStore((state) => state.dismissInstallError);
	const progress = useDownloadProgress(install?.taskId ?? null);
	if (!install) {
		return null;
	}
	const title = progress?.title || `${MODEL_KIND_LABELS[install.kind]} download`;
	return (
		<li className={styles.item} aria-label={title}>
			<Body1Strong className={styles.title}>{title}</Body1Strong>
			{install.phase === 'failed' ? (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>{install.error}</MessageBarBody>
					<MessageBarActions>
						<Button size="small" appearance="subtle" onClick={() => dismissInstallError(install.key)}>
							Dismiss
						</Button>
					</MessageBarActions>
				</MessageBar>
			) : (
				<InstallProgress install={install} progress={progress} title={title} />
			)}
		</li>
	);
}

export function DownloadsSection(): JSX.Element | null {
	const styles = useStyles();
	const keys = useModelCatalogStore(useShallow(selectDetachedInstallKeys));
	if (keys.length === 0) {
		return null;
	}
	return (
		<PaneSection title="Downloads">
			<ul className={styles.list} aria-label="Downloads">
				{keys.map((key) => (
					<DownloadItem key={key} installKey={key} />
				))}
			</ul>
		</PaneSection>
	);
}
