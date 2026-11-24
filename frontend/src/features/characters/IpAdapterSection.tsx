// Reference images section of the Characters pane (IP-Adapter store): the reference support of the selected model per
// focus (ReferenceSupportHint: ready, or the reason with Download / progress / Cancel), every IP-Adapter variant with
// the status of each file (the shared VersionStatusBadge: on disk, downloading, to download) and the folders the
// files are found in and downloaded to. Spinner while the status loads, error with Retry. Refreshes the status on
// mount and when the selected model changes. References are optional: generation works without them.
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
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import type { IpAdapterFile, IpAdapterFileRole, IpAdapterStatus, IpAdapterVariant } from '../../api/types';
import { REFERENCE_FOCUS_LABELS } from '../../domain/characterDrafts';
import { ipAdapterFileStatus, useIpAdapterStore } from '../../stores/ipAdapterStore';
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
	column: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
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
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
	},
	name: {
		flex: '1 1 auto',
		minWidth: 0,
		overflowWrap: 'anywhere',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
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
	return (
		<li className={styles.line}>
			<Body1 className={styles.name}>{file.name}</Body1>
			<Caption1 className={styles.muted}>
				{FILE_ROLE_LABELS[file.role]} · {formatBytes(file.size_bytes)}
			</Caption1>
			<VersionStatusBadge kind={ipAdapterFileStatus(file)} />
		</li>
	);
}

function VariantItem({ variant }: { variant: IpAdapterVariant }): JSX.Element {
	const styles = useStyles();
	const labelId = useId('ip-adapter-variant-');
	return (
		<li className={styles.column} aria-labelledby={labelId}>
			<div className={styles.line}>
				<Body1Strong id={labelId} className={styles.name}>
					{variant.label}
				</Body1Strong>
				{variant.ready ? (
					<Badge appearance="filled" color="success">
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

/** The reference support of the selected model for every focus (one entry per focus; none without a model). */
function SupportList(): JSX.Element {
	const styles = useStyles();
	const support = useIpAdapterStore((state) => state.status?.support ?? null);
	const hasModel = useLibraryStore((state) => selectSelectedModel(state) !== null);
	if (!support || support.length === 0) {
		return (
			<Body1 className={styles.muted}>
				{hasModel ? 'Checking the selected model…' : 'Select a model to check whether reference images can be used with it.'}
			</Body1>
		);
	}
	return (
		<ul className={styles.list} aria-label="Reference support">
			{support.map(({ focus }) => (
				<li key={focus} className={styles.column}>
					<Body1Strong>{REFERENCE_FOCUS_LABELS[focus].label}</Body1Strong>
					<ReferenceSupportHint focus={focus} />
				</li>
			))}
		</ul>
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
					<ul className={styles.list} aria-label="IP-Adapter variants">
						{status.variants.map((variant) => (
							<VariantItem key={variant.id} variant={variant} />
						))}
					</ul>
					<Folders folders={status.folders} />
				</>
			) : null}
		</PaneSection>
	);
}
