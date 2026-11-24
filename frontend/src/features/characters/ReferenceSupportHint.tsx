// Whether the reference images of a character can be applied with the selected model for a focus (IP-Adapter store
// selectReferenceSupport): ready (success), or the backend's reason (warning) with Download when the variant's files
// are missing, then the progress of each file download (tasks store) and Cancel. Nothing while the status is unknown.
// Refreshes the status on mount and when the selected model changes (useIpAdapterStatusRefresh).
import { Button, makeStyles, MessageBar, MessageBarActions, MessageBarBody, tokens } from '@fluentui/react-components';
import { ArrowDownloadRegular, DismissRegular } from '@fluentui/react-icons';
import type { IpAdapterFile, IpAdapterVariant, ReferenceFocus, ReferenceSupport } from '../../api/types';
import { selectIpAdapterVariant, selectIsVariantInstalling, selectReferenceSupport, useIpAdapterStore } from '../../stores/ipAdapterStore';
import { useDownloadProgress } from '../../stores/tasksStore';
import { downloadProgressText, downloadProgressValue, TransferProgress } from '../models/TransferProgress';
import { useIpAdapterStatusRefresh } from './useIpAdapterStatusRefresh';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	downloads: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'flex-start',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
	},
	files: {
		display: 'flex',
		flexDirection: 'column',
		alignSelf: 'stretch',
		gap: tokens.spacingVerticalXS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
});

function FileDownloadProgress({ file }: { file: IpAdapterFile }): JSX.Element {
	const progress = useDownloadProgress(file.task_id);
	return <TransferProgress label={`Downloading ${file.name}`} text={downloadProgressText(progress)} value={downloadProgressValue(progress)} />;
}

/** The running install of a variant: one progress bar per file being downloaded (indeterminate before the backend
 *  answered with the download tasks) and Cancel (every download of the variant). */
function VariantDownloads({ variant }: { variant: IpAdapterVariant }): JSX.Element {
	const styles = useStyles();
	const cancelInstall = useIpAdapterStore((state) => state.cancelInstall);
	const downloading = variant.files.filter((file) => file.task_id !== null);
	return (
		<div className={styles.downloads}>
			{downloading.length > 0 ? (
				<ul className={styles.files} aria-label={`Downloads of ${variant.label}`}>
					{downloading.map((file) => (
						<li key={file.id}>
							<FileDownloadProgress file={file} />
						</li>
					))}
				</ul>
			) : (
				<TransferProgress label={`Downloading ${variant.label}`} text="Starting the download…" value={undefined} />
			)}
			<Button size="small" icon={<DismissRegular />} disabled={downloading.length === 0} onClick={() => void cancelInstall(variant.id)}>
				Cancel
			</Button>
		</div>
	);
}

function MissingSupport({ support }: { support: ReferenceSupport }): JSX.Element {
	const styles = useStyles();
	const variant = useIpAdapterStore(selectIpAdapterVariant(support.variant_id));
	const installing = useIpAdapterStore((state) => (support.variant_id === null ? false : selectIsVariantInstalling(support.variant_id)(state)));
	const install = useIpAdapterStore((state) => state.install);
	const downloadable = variant !== null && !variant.ready;
	return (
		<div className={styles.root}>
			<MessageBar intent="warning" layout="multiline">
				<MessageBarBody>{support.reason ?? 'Reference images cannot be applied with this model.'}</MessageBarBody>
				{downloadable && !installing ? (
					<MessageBarActions>
						<Button size="small" icon={<ArrowDownloadRegular />} onClick={() => void install(variant.id)}>
							Download
						</Button>
					</MessageBarActions>
				) : null}
			</MessageBar>
			{variant !== null && installing ? <VariantDownloads variant={variant} /> : null}
		</div>
	);
}

function ReadySupport({ support }: { support: ReferenceSupport }): JSX.Element {
	const variant = useIpAdapterStore(selectIpAdapterVariant(support.variant_id));
	return (
		<MessageBar intent="success">
			<MessageBarBody>{variant ? `Reference images apply with ${variant.label}.` : 'Reference images apply.'}</MessageBarBody>
		</MessageBar>
	);
}

export function ReferenceSupportHint({ focus }: { focus: ReferenceFocus }): JSX.Element | null {
	useIpAdapterStatusRefresh();
	const support = useIpAdapterStore(selectReferenceSupport(focus));
	if (support === null) {
		return null;
	}
	return support.ready ? <ReadySupport support={support} /> : <MissingSupport support={support} />;
}
