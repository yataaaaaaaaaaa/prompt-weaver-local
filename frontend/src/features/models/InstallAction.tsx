// Action area of a result card, chosen by the version status (useVersionStatus of the catalog store):
// remote -> 'Download and use'; on_disk / in_library -> 'Use' (+ 'Copy prompt token' for local embeddings);
// installing -> progress + Cancel; failed -> error with Retry / Dismiss; unavailable -> disabled with the reason.
// Every action is a catalog store action (install also registers and selects the model).
import { Button, Caption1, makeStyles, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, tokens } from '@fluentui/react-components';
import { ArrowDownloadRegular, CheckmarkRegular, CopyRegular } from '@fluentui/react-icons';
import type { RemoteModel, RemoteModelVersion } from '../../api/types';
import { installFile } from '../../domain/modelCatalog';
import { useModelCatalogStore, type VersionStatus } from '../../stores/modelCatalogStore';
import { InstallProgress } from './InstallProgress';

const useStyles = makeStyles({
	row: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	column: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'flex-start',
		gap: tokens.spacingVerticalXS,
	},
	reason: {
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
});

export type InstallActionProps = {
	model: RemoteModel;
	version: RemoteModelVersion;
	status: VersionStatus;
};

export function InstallAction({ model, version, status }: InstallActionProps): JSX.Element | null {
	const styles = useStyles();
	const install = useModelCatalogStore((state) => state.install);
	const dismissInstallError = useModelCatalogStore((state) => state.dismissInstallError);
	const copyEmbeddingToken = useModelCatalogStore((state) => state.copyEmbeddingToken);
	const runInstall = () => void install(model, version);

	switch (status.kind) {
		case 'remote':
			return (
				<div className={styles.row}>
					<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={runInstall}>
						Download and use
					</Button>
				</div>
			);
		case 'on_disk':
		case 'in_library': {
			const localPath = model.kind === 'embedding' ? (installFile(version)?.local_path ?? null) : null;
			return (
				<div className={styles.row}>
					<Button appearance="primary" icon={<CheckmarkRegular />} onClick={runInstall}>
						Use
					</Button>
					{localPath ? (
						<Button icon={<CopyRegular />} onClick={() => void copyEmbeddingToken(localPath)}>
							Copy prompt token
						</Button>
					) : null}
				</div>
			);
		}
		case 'installing':
			return status.install ? <InstallProgress install={status.install} progress={status.progress} title={status.progress?.title || model.name} /> : null;
		case 'failed':
			return (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>
						<MessageBarTitle>Install failed</MessageBarTitle>
						{status.reason}
					</MessageBarBody>
					<MessageBarActions>
						<Button size="small" onClick={runInstall}>
							Retry
						</Button>
						<Button size="small" appearance="subtle" onClick={() => dismissInstallError(status.installKey)}>
							Dismiss
						</Button>
					</MessageBarActions>
				</MessageBar>
			);
		case 'unavailable':
			return (
				<div className={styles.column}>
					<Button appearance="primary" icon={<ArrowDownloadRegular />} disabled>
						Download and use
					</Button>
					<Caption1 className={styles.reason}>{status.reason}</Caption1>
				</div>
			);
	}
}
