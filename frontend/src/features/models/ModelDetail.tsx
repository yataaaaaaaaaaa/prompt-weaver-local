// Detail panel of the model selected in the Models section's results (catalog store selectedModelKey): the picked
// version's preview, creator and download count, badges, the version picker, its trigger words (copy), the install
// action of the version with its progress, Cancel, Retry / Dismiss or the reason it cannot be installed (the same
// InstallAction as the result card), the provider page link, and the version's files with their sizes (the default
// file, the one an install downloads, marked). Thin view over the catalog store (usePickedVersion, useVersionStatus, pickVersion).
import {
	Badge,
	Body1,
	Caption1,
	Dropdown,
	Field,
	Image,
	Link,
	makeStyles,
	Option,
	tokens,
} from '@fluentui/react-components';
import { OpenRegular } from '@fluentui/react-icons';
import type { RemoteFile, RemoteModel, RemoteModelVersion } from '../../api/types';
import { modelKey } from '../../domain/modelCatalog';
import { useModelCatalogStore, usePickedVersion, useVersionStatus } from '../../stores/modelCatalogStore';
import { PaneSection } from '../../ui/PaneLayout';
import { siteName } from '../images/imageLabels';
import { DetailPanel } from '../../ui/DetailPanel';
import { formatBytes } from './format';
import { InstallAction } from './InstallAction';
import { modelDescriptionText, ResultBadges } from './ModelResultCard';
import { TriggerWords } from './TriggerWords';

const useStyles = makeStyles({
	preview: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		minWidth: 0,
		overflow: 'hidden',
		borderRadius: tokens.borderRadiusLarge,
		backgroundColor: tokens.colorNeutralBackground3,
	},
	previewImage: {
		width: '100%',
		height: 'auto',
		maxHeight: 'min(360px, 40vh)',
	},
	facts: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	badges: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
	link: {
		display: 'inline-flex',
		alignItems: 'center',
		alignSelf: 'flex-start',
		gap: tokens.spacingHorizontalXXS,
	},
	dropdown: {
		minWidth: 0,
		width: '100%',
	},
	files: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	file: {
		display: 'flex',
		alignItems: 'baseline',
		flexWrap: 'wrap',
		columnGap: tokens.spacingHorizontalS,
		rowGap: tokens.spacingVerticalXXS,
		minWidth: 0,
	},
	fileName: {
		flex: '1 1 auto',
		minWidth: 0,
		overflowWrap: 'anywhere',
	},
	size: {
		color: tokens.colorNeutralForeground2,
		fontVariantNumeric: 'tabular-nums',
	},
});

function VersionPicker({ model, version }: { model: RemoteModel; version: RemoteModelVersion }): JSX.Element {
	const styles = useStyles();
	const pickVersion = useModelCatalogStore((state) => state.pickVersion);
	return (
		<Field label="Version">
			<Dropdown
				className={styles.dropdown}
				value={version.name}
				selectedOptions={[version.id]}
				onOptionSelect={(_event, data) => {
					if (data.optionValue && data.optionValue !== version.id) {
						pickVersion(modelKey(model), data.optionValue);
					}
				}}
			>
				{model.versions.map((item) => (
					<Option key={item.id} value={item.id}>
						{item.name}
					</Option>
				))}
			</Dropdown>
		</Field>
	);
}

/** 'SafeTensor · fp16 · pruned' (the known parts only). */
function fileFacts(file: RemoteFile): string {
	return [file.format, file.precision, file.variant].filter((part): part is string => Boolean(part)).join(' · ');
}

function FilesSection({ version }: { version: RemoteModelVersion }): JSX.Element {
	const styles = useStyles();
	return (
		<PaneSection title="Files">
			{version.files.length > 0 ? (
				<ul className={styles.files} aria-label="Files of this version">
					{version.files.map((file) => {
						const facts = fileFacts(file);
						return (
							<li key={file.id} className={styles.file}>
								<Body1 className={styles.fileName}>{file.name}</Body1>
								<Caption1 className={styles.size}>{formatBytes(file.size_bytes)}</Caption1>
								{file.id === version.default_file_id ? (
									<Badge appearance="tint" color="brand">
										Default file
									</Badge>
								) : null}
								{facts ? <Caption1 className={styles.muted}>{facts}</Caption1> : null}
							</li>
						);
					})}
				</ul>
			) : (
				<Body1 className={styles.muted}>This version publishes no file.</Body1>
			)}
		</PaneSection>
	);
}

function VersionDetail({ model, version }: { model: RemoteModel; version: RemoteModelVersion }): JSX.Element {
	const styles = useStyles();
	const status = useVersionStatus(model, version);
	const preview = version.images[0] ?? null;
	const pageUrl = version.page_url ?? model.page_url;
	return (
		<>
			{preview ? (
				<div className={styles.preview}>
					<Image
						className={styles.previewImage}
						src={preview.url}
						alt={`Preview of ${model.name} ${version.name}`}
						fit="contain"
						width={preview.width ?? undefined}
						height={preview.height ?? undefined}
					/>
				</div>
			) : null}
			<div className={styles.facts}>
				<Body1>{modelDescriptionText(model)}</Body1>
				<div className={styles.badges}>
					<ResultBadges model={model} version={version} status={status} />
				</div>
				<VersionPicker model={model} version={version} />
				<TriggerWords words={version.trigger_words} />
				<InstallAction model={model} version={version} status={status} />
				{pageUrl ? (
					<Link className={styles.link} href={pageUrl} target="_blank" rel="noopener noreferrer">
						Open on {siteName(pageUrl)}
						<OpenRegular aria-hidden />
					</Link>
				) : null}
			</div>
			<FilesSection version={version} />
		</>
	);
}

export type ModelDetailProps = {
	model: RemoteModel;
	/** Clears the selection (catalog store closeModel). */
	onClose: () => void;
};

export function ModelDetail({ model, onClose }: ModelDetailProps): JSX.Element {
	const styles = useStyles();
	const version = usePickedVersion(model);
	return (
		<DetailPanel itemKey={modelKey(model)} title={model.name} onClose={onClose}>
			{version ? <VersionDetail model={model} version={version} /> : <Body1 className={styles.muted}>No version available.</Body1>}
		</DetailPanel>
	);
}
