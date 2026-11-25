// Reference images section of the Characters pane (IP-Adapter store): the reference support of the selected model per
// focus (ReferenceSupportHint: ready, downloading with Cancel, failed with Retry, or the reason with Download), every
// IP-Adapter variant in a bordered list with the status of each file (the shared VersionStatusBadge: on disk,
// downloading, failed, to download) and the folders the files are found in and downloaded to. Spinner while the
// status loads, error with Retry. Refreshes the status on mount and when the selected model changes. References are
// optional: generation works without them.
import {
	Badge,
	Body1,
	Body1Strong,
	Button,
	Caption1,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	Spinner,
	tokens,
	useId,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, CheckmarkCircleRegular } from '@fluentui/react-icons';
import type { IpAdapterFile, IpAdapterFileRole, IpAdapterStatus, IpAdapterVariant } from '../../api/types';
import { REFERENCE_FOCUS_LABELS } from '../../domain/characterDrafts';
import { ipAdapterFileStatus, selectFileFailure, useIpAdapterStore } from '../../stores/ipAdapterStore';
import { selectSelectedModel, useLibraryStore } from '../../stores/libraryStore';
import { PaneSection } from '../../ui/PaneLayout';
import { formatBytes } from '../models/format';
import { VersionStatusBadge } from '../models/VersionStatusBadge';
import { ReferenceSupportHint } from './ReferenceSupportHint';
import { useIpAdapterStatusRefresh } from './useIpAdapterStatusRefresh';

/** Every IpAdapterFileRole with its UI label (exhaustive: the type-check fails when the backend adds one). */
const FILE_ROLE_LABELS: Record<IpAdapterFileRole, string> = {
	adapter: 'Adapter',
	image_encoder: 'Image encoder',
};

const useStyles = makeStyles({
	group: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	heading: {
		margin: 0,
		overflowWrap: 'anywhere',
	},
	column: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
	},
	supportList: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	variants: {
		display: 'flex',
		flexDirection: 'column',
		margin: 0,
		padding: 0,
		listStyleType: 'none',
		border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		borderRadius: tokens.borderRadiusMedium,
	},
	variant: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalM,
		paddingRight: tokens.spacingHorizontalM,
		':not(:first-child)': {
			borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		},
	},
	files: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	line: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		columnGap: tokens.spacingHorizontalS,
		rowGap: tokens.spacingVerticalXXS,
		minWidth: 0,
	},
	name: {
		flex: '1 1 12em',
		minWidth: 0,
		overflowWrap: 'anywhere',
	},
	fileFacts: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		marginLeft: 'auto',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
	size: {
		color: tokens.colorNeutralForeground3,
		fontVariantNumeric: 'tabular-nums',
		whiteSpace: 'nowrap',
	},
	folders: {
		display: 'grid',
		gridTemplateColumns: 'max-content minmax(0, 1fr)',
		columnGap: tokens.spacingHorizontalL,
		rowGap: tokens.spacingVerticalXS,
		margin: 0,
	},
	folderRow: {
		display: 'contents',
	},
	term: {
		color: tokens.colorNeutralForeground3,
	},
	value: {
		margin: 0,
		overflowWrap: 'anywhere',
	},
});

function VariantFile({ file }: { file: IpAdapterFile }): JSX.Element {
	const styles = useStyles();
	const failure = useIpAdapterStore(selectFileFailure(file.id));
	return (
		<li className={styles.line}>
			<Body1 className={styles.name}>{file.name}</Body1>
			<span className={styles.fileFacts}>
				<Caption1 className={styles.size}>
					{FILE_ROLE_LABELS[file.role]} · {formatBytes(file.size_bytes)}
				</Caption1>
				<VersionStatusBadge kind={ipAdapterFileStatus(file, failure)} />
			</span>
		</li>
	);
}

function VariantItem({ variant }: { variant: IpAdapterVariant }): JSX.Element {
	const styles = useStyles();
	const labelId = useId('ip-adapter-variant-');
	return (
		<li className={styles.variant} aria-labelledby={labelId}>
			<div className={styles.line}>
				<Body1Strong id={labelId} className={styles.name}>
					{variant.label}
				</Body1Strong>
				{variant.ready ? (
					<Badge appearance="filled" color="success" icon={<CheckmarkCircleRegular />}>
						Ready
					</Badge>
				) : null}
			</div>
			<ul className={styles.files} aria-label={`Files of ${variant.label}`}>
				{variant.files.map((file) => (
					<VariantFile key={file.id} file={file} />
				))}
			</ul>
		</li>
	);
}

function Folders({ folders }: { folders: IpAdapterStatus['folders'] }): JSX.Element {
	const styles = useStyles();
	const rows: Array<[string, string]> = [
		['Adapter folder', folders.adapter],
		['Image encoder folder', folders.image_encoder],
	];
	return (
		<dl className={styles.folders} aria-label="IP-Adapter folders">
			{rows.map(([term, value]) => (
				<div key={term} className={styles.folderRow}>
					<dt className={styles.term}>
						<Caption1>{term}</Caption1>
					</dt>
					<dd className={styles.value}>
						<Caption1>{value}</Caption1>
					</dd>
				</div>
			))}
		</dl>
	);
}

/** The reference support of the selected model for every focus (one entry per focus; none without a model), under
 *  a heading naming the model. */
function SupportList(): JSX.Element {
	const styles = useStyles();
	const support = useIpAdapterStore((state) => state.status?.support ?? null);
	const modelName = useLibraryStore((state) => selectSelectedModel(state)?.name ?? null);
	if (!support || support.length === 0) {
		return (
			<Body1 className={styles.muted}>
				{modelName !== null ? 'Checking the selected model…' : 'Select a model to check whether reference images can be used with it.'}
			</Body1>
		);
	}
	return (
		<div className={styles.group}>
			<Body1Strong as="h4" className={styles.heading}>
				{modelName !== null ? `With the selected model ${modelName}` : 'With the selected model'}
			</Body1Strong>
			<ul className={styles.supportList} aria-label="Reference support">
				{support.map(({ focus }) => (
					<li key={focus} className={styles.column}>
						<Body1>{REFERENCE_FOCUS_LABELS[focus].label}</Body1>
						<ReferenceSupportHint focus={focus} />
					</li>
				))}
			</ul>
		</div>
	);
}

function VariantsList({ status }: { status: IpAdapterStatus }): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.group}>
			<Body1Strong as="h4" className={styles.heading}>
				IP-Adapter files
			</Body1Strong>
			<ul className={styles.variants} aria-label="IP-Adapter variants">
				{status.variants.map((variant) => (
					<VariantItem key={variant.id} variant={variant} />
				))}
			</ul>
			<Folders folders={status.folders} />
		</div>
	);
}

export function IpAdapterSection(): JSX.Element {
	const styles = useStyles();
	useIpAdapterStatusRefresh();
	const status = useIpAdapterStore((state) => state.status);
	const loadStatus = useIpAdapterStore((state) => state.loadStatus);
	const loadError = useIpAdapterStore((state) => state.loadError);
	const refresh = useIpAdapterStore((state) => state.refresh);
	const loading = loadStatus === 'loading' || loadStatus === 'idle';

	return (
		<PaneSection title="Reference images (IP-Adapter)">
			<Caption1 className={styles.muted}>
				An IP-Adapter keeps the face or the whole look of a character's reference images. It is optional: without it,
				generation works and only the tags, LoRAs and seed of the character apply.
			</Caption1>
			{loadStatus === 'failed' ? (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>
						<MessageBarTitle>Could not check the IP-Adapter files</MessageBarTitle>
						{loadError}
					</MessageBarBody>
					<MessageBarActions>
						<Button size="small" icon={<ArrowClockwiseRegular />} onClick={() => void refresh({ force: true })}>
							Retry
						</Button>
					</MessageBarActions>
				</MessageBar>
			) : null}
			{loading ? <Spinner size="tiny" label="Checking the IP-Adapter files…" /> : null}
			{status !== null ? (
				<>
					<SupportList />
					<VariantsList status={status} />
				</>
			) : null}
		</PaneSection>
	);
}
