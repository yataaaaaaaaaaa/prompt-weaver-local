// LoRAs and checkpoint of the image in the detail view. Rows come from the image library store hooks
// (useImageLoraRows / useImageCheckpointRow: resolution + library + installs); each row shows its name (linked to the
// provider page), weight, status (reason in a tooltip) and, while it downloads, the shared InstallProgress of the
// catalog store install. 'Use these LoRAs' and 'Use this checkpoint' call the store actions, which own the install
// and selection flow.
import {
	Badge,
	Body1,
	Body1Strong,
	Button,
	Caption1,
	createFocusOutlineStyle,
	Link,
	makeStyles,
	MessageBar,
	MessageBarActions,
	MessageBarBody,
	MessageBarTitle,
	Spinner,
	tokens,
	Tooltip,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, ArrowSyncRegular, CheckmarkCircleRegular, QuestionCircleRegular } from '@fluentui/react-icons';
import type { ImageResourceRow, ImageResourceStatusKind } from '../../domain/imageLibrary';
import { formatWeight } from '../../domain/text';
import { useImageCheckpointRow, useImageLibraryStore, useImageLoraRows } from '../../stores/imageLibraryStore';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { useDownloadProgress } from '../../stores/tasksStore';
import { PaneSection } from '../../ui/PaneLayout';
import { InstallProgress } from '../models/InstallProgress';
import { StatusBadge, VERSION_STATUS_BADGES, type StatusBadgeLook } from '../models/VersionStatusBadge';

/** Badge of every resource status (exhaustive: the type-check fails when a status is added): the shared version
 *  statuses (VERSION_STATUS_BADGES) plus the resolution states of the image library. */
const STATUS_BADGES: Record<ImageResourceStatusKind, StatusBadgeLook> = {
	...VERSION_STATUS_BADGES,
	unresolved: { label: 'Not identified', color: 'subtle', icon: QuestionCircleRegular },
	resolving: { label: 'Resolving', color: 'informative', icon: ArrowSyncRegular },
};

/** Statuses whose checkpoint cannot be switched to (yet). */
const CHECKPOINT_BLOCKED: ReadonlySet<ImageResourceStatusKind> = new Set<ImageResourceStatusKind>([
	'unavailable',
	'unresolved',
	'resolving',
	'installing',
]);

const useStyles = makeStyles({
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	row: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
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
	badges: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
	},
	focusableBadge: {
		...createFocusOutlineStyle(),
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
});

function ResourceStatus({ row }: { row: ImageResourceRow }): JSX.Element {
	const styles = useStyles();
	const badge = (
		<StatusBadge
			look={STATUS_BADGES[row.status]}
			// Focusable when it has a reason, so the tooltip also opens from the keyboard.
			tabIndex={row.reason ? 0 : undefined}
			className={row.reason ? styles.focusableBadge : undefined}
		/>
	);
	return row.reason ? (
		<Tooltip content={row.reason} relationship="description">
			{badge}
		</Tooltip>
	) : (
		badge
	);
}

function ResourceName({ row }: { row: ImageResourceRow }): JSX.Element {
	const styles = useStyles();
	return row.pageUrl ? (
		<Link className={styles.name} href={row.pageUrl} target="_blank" rel="noopener noreferrer">
			{row.name}
		</Link>
	) : (
		<Body1Strong className={styles.name}>{row.name}</Body1Strong>
	);
}

/** Progress of the catalog store install of the row's model while it downloads. */
function ResourceInstall({ row }: { row: ImageResourceRow }): JSX.Element | null {
	const install = useModelCatalogStore((state) => (row.installKey ? state.installs[row.installKey] : undefined));
	const progress = useDownloadProgress(install?.taskId ?? null);
	if (!install || row.status !== 'installing') {
		return null;
	}
	return <InstallProgress install={install} progress={progress} title={progress?.title || row.name} />;
}

function LoraRow({ row }: { row: ImageResourceRow }): JSX.Element {
	const styles = useStyles();
	return (
		<li className={styles.row}>
			<div className={styles.line}>
				<ResourceName row={row} />
				<span className={styles.badges}>
					{row.weight !== null ? (
						<Badge appearance="outline" color={row.weightPublished ? 'brand' : 'informative'}>
							{row.weightPublished ? `Weight ${formatWeight(row.weight)}` : `Weight ${formatWeight(row.weight)} (unpublished, default)`}
						</Badge>
					) : null}
					<ResourceStatus row={row} />
				</span>
			</div>
			<ResourceInstall row={row} />
		</li>
	);
}

/** The resolution failed: error with Retry (resolveResources). */
function ResolutionError({ imageKey }: { imageKey: string }): JSX.Element | null {
	const failed = useImageLibraryStore((state) => state.resolutions[imageKey]?.status === 'failed');
	const error = useImageLibraryStore((state) => state.resolutions[imageKey]?.error ?? null);
	const resolveResources = useImageLibraryStore((state) => state.resolveResources);
	if (!failed) {
		return null;
	}
	return (
		<MessageBar intent="error" layout="multiline">
			<MessageBarBody>
				<MessageBarTitle>Could not identify the models</MessageBarTitle>
				{error}
			</MessageBarBody>
			<MessageBarActions>
				<Button size="small" icon={<ArrowClockwiseRegular />} onClick={() => void resolveResources(imageKey)}>
					Retry
				</Button>
			</MessageBarActions>
		</MessageBar>
	);
}

export function ImageLorasSection({ imageKey }: { imageKey: string }): JSX.Element {
	const styles = useStyles();
	const rows = useImageLoraRows(imageKey);
	const applying = useImageLibraryStore((state) => state.applyingLoras[imageKey] === true);
	const applyImageLoras = useImageLibraryStore((state) => state.applyImageLoras);

	return (
		<PaneSection title="LoRAs">
			<ResolutionError imageKey={imageKey} />
			{rows.length > 0 ? (
				<ul className={styles.list} aria-label="LoRAs of this image">
					{rows.map((row) => (
						<LoraRow key={row.index} row={row} />
					))}
				</ul>
			) : (
				<Body1 className={styles.muted}>This image publishes no LoRAs.</Body1>
			)}
			<div className={styles.actions}>
				<Button
					appearance="primary"
					icon={applying ? <Spinner size="tiny" /> : <CheckmarkCircleRegular />}
					disabled={applying || rows.length === 0}
					onClick={() => void applyImageLoras(imageKey)}
				>
					Use these LoRAs
				</Button>
				<Caption1 className={styles.muted}>Sets exactly these LoRAs with these weights; missing ones are downloaded first.</Caption1>
			</div>
		</PaneSection>
	);
}

export function ImageCheckpointSection({ imageKey }: { imageKey: string }): JSX.Element {
	const styles = useStyles();
	const row = useImageCheckpointRow(imageKey);
	const switching = useImageLibraryStore((state) => state.switchingCheckpoint[imageKey] === true);
	const switchToImageCheckpoint = useImageLibraryStore((state) => state.switchToImageCheckpoint);

	if (!row) {
		return (
			<PaneSection title="Checkpoint">
				<Body1 className={styles.muted}>This image publishes no checkpoint.</Body1>
			</PaneSection>
		);
	}
	const blocked = CHECKPOINT_BLOCKED.has(row.status);
	return (
		<PaneSection title="Checkpoint">
			<div className={styles.row}>
				<div className={styles.line}>
					<ResourceName row={row} />
					<ResourceStatus row={row} />
				</div>
				<ResourceInstall row={row} />
			</div>
			<div className={styles.actions}>
				<Button
					icon={switching ? <Spinner size="tiny" /> : <CheckmarkCircleRegular />}
					disabled={switching || blocked}
					onClick={() => void switchToImageCheckpoint(imageKey)}
				>
					Use this checkpoint
				</Button>
				{blocked && row.reason ? <Caption1 className={styles.muted}>{row.reason}</Caption1> : null}
			</div>
		</PaneSection>
	);
}
