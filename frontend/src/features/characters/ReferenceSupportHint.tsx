// Whether the reference images of a character can be applied with the selected model for a focus (IP-Adapter store
// selectReferenceSupport), one Fluent MessageBar per state:
// - ready (success);
// - downloading (info, while the variant installs): the backend's reason with Cancel, then the progress of each file
//   download (tasks store), each one named by its file;
// - failed (error): the last install of the variant failed (selectVariantFailure names each file and why) with Retry;
// - missing (warning): the backend's reason, with Download when the variant's files are missing.
// Nothing while the status is unknown. Refreshes the status on mount and when the selected model changes
// (useIpAdapterStatusRefresh).
import {
	Button,
	Caption1,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	tokens,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, ArrowDownloadRegular, DismissRegular } from '@fluentui/react-icons';
import type { IpAdapterFile, IpAdapterVariant, ReferenceFocus, ReferenceSupport } from '../../api/types';
import {
	selectIpAdapterVariant,
	selectIsVariantInstalling,
	selectReferenceSupport,
	selectVariantFailure,
	useIpAdapterStore,
} from '../../stores/ipAdapterStore';
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
	files: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		margin: 0,
		paddingTop: 0,
		paddingBottom: 0,
		paddingLeft: tokens.spacingHorizontalM,
		paddingRight: 0,
		listStyleType: 'none',
	},
	file: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		minWidth: 0,
	},
	fileName: {
		color: tokens.colorNeutralForeground2,
		overflowWrap: 'anywhere',
	},
});

function FileDownloadProgress({ file }: { file: IpAdapterFile }): JSX.Element {
	const styles = useStyles();
	const progress = useDownloadProgress(file.task_id);
	return (
		<li className={styles.file}>
			<Caption1 className={styles.fileName} aria-hidden>
				{file.name}
			</Caption1>
			<TransferProgress label={`Downloading ${file.name}`} text={downloadProgressText(progress)} value={downloadProgressValue(progress)} />
		</li>
	);
}

/** The running install of a variant: Cancel (every download of the variant; disabled until the backend answered
 *  with the download tasks), then one named progress bar per file being downloaded (one indeterminate bar before). */
function InstallingSupport({ variant }: { variant: IpAdapterVariant }): JSX.Element {
	const styles = useStyles();
	const cancelInstall = useIpAdapterStore((state) => state.cancelInstall);
	const downloading = variant.files.filter((file) => file.task_id !== null);
	return (
		<div className={styles.root}>
			<MessageBar intent="info" layout="multiline">
				<MessageBarBody>{`Downloading ${variant.label}: reference images apply once it is installed.`}</MessageBarBody>
				<MessageBarActions>
					<Button size="small" icon={<DismissRegular />} disabled={downloading.length === 0} onClick={() => void cancelInstall(variant.id)}>
						Cancel
					</Button>
				</MessageBarActions>
			</MessageBar>
			{downloading.length > 0 ? (
				<ul className={styles.files} aria-label={`Downloads of ${variant.label}`}>
					{downloading.map((file) => (
						<FileDownloadProgress key={file.id} file={file} />
					))}
				</ul>
			) : (
				<TransferProgress label={`Downloading ${variant.label}`} text="Starting the download…" value={undefined} />
			)}
		</div>
	);
}

function FailedSupport({ variant, failure }: { variant: IpAdapterVariant; failure: string }): JSX.Element {
	const install = useIpAdapterStore((state) => state.install);
	return (
		<MessageBar intent="error" layout="multiline">
			<MessageBarBody>
				<MessageBarTitle>{`${variant.label} could not be downloaded`}</MessageBarTitle>
				{failure}
			</MessageBarBody>
			<MessageBarActions>
				<Button size="small" icon={<ArrowClockwiseRegular />} onClick={() => void install(variant.id)}>
					Retry
				</Button>
			</MessageBarActions>
		</MessageBar>
	);
}

function MissingSupport({ support }: { support: ReferenceSupport }): JSX.Element {
	const variant = useIpAdapterStore(selectIpAdapterVariant(support.variant_id));
	const installing = useIpAdapterStore((state) => (support.variant_id === null ? false : selectIsVariantInstalling(support.variant_id)(state)));
	const failure = useIpAdapterStore(selectVariantFailure(support.variant_id));
	const install = useIpAdapterStore((state) => state.install);
	if (variant !== null && installing) {
		return <InstallingSupport variant={variant} />;
	}
	if (variant !== null && !variant.ready && failure !== null) {
		return <FailedSupport variant={variant} failure={failure} />;
	}
	const downloadable = variant !== null && !variant.ready;
	return (
		<MessageBar intent="warning" layout="multiline">
			<MessageBarBody>{support.reason ?? 'Reference images cannot be applied with this model.'}</MessageBarBody>
			{downloadable ? (
				<MessageBarActions>
					<Button size="small" icon={<ArrowDownloadRegular />} onClick={() => void install(variant.id)}>
						Download
					</Button>
				</MessageBarActions>
			) : null}
		</MessageBar>
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
