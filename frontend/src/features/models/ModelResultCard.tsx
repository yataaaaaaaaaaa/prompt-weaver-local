// One online search result: preview of the picked version, name, creator and download count, kind / base model /
// NSFW / status badges, version picker, install file size, trigger words and the status-dependent install action.
// Thin view over the catalog store (usePickedVersion, useVersionStatus, pickVersion) and the library store
// (selection state of the matching library entry).
import { Caption1, Dropdown, Field, makeStyles, Option, tokens } from '@fluentui/react-components';
import type { RemoteModel, RemoteModelVersion } from '../../api/types';
import { modelKey } from '../../domain/modelCatalog';
import { selectIsEntrySelected, useLibraryStore } from '../../stores/libraryStore';
import { useModelCatalogStore, usePickedVersion, useVersionStatus, type VersionStatus } from '../../stores/modelCatalogStore';
import { formatBytes, formatDownloads } from './format';
import { InstallAction } from './InstallAction';
import { BaseModelBadge, ModelKindBadge, NsfwBadge, SelectedBadge } from './ModelBadges';
import { ModelEntryCard } from './ModelEntryCard';
import { TriggerWords } from './TriggerWords';
import { VersionStatusBadge } from './VersionStatusBadge';

const useStyles = makeStyles({
	versionRow: {
		display: 'flex',
		alignItems: 'flex-end',
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
	},
	versionField: {
		flex: '1 1 auto',
		minWidth: 0,
	},
	dropdown: {
		minWidth: 0,
		width: '100%',
	},
	size: {
		flexShrink: 0,
		paddingBottom: tokens.spacingVerticalXS,
		color: tokens.colorNeutralForeground2,
		fontVariantNumeric: 'tabular-nums',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

/** 'by <creator> · <n> downloads' (the creator part only when known). */
function descriptionText(model: RemoteModel): string {
	const downloads = formatDownloads(model.download_count);
	return model.creator ? `by ${model.creator} · ${downloads}` : downloads;
}

/** The shared VersionStatusBadge, except: no badge for 'remote' (the card offers 'Download and use'), and 'Selected'
 *  for a library entry selected for generation. */
function ResultStatusBadge({ model, status }: { model: RemoteModel; status: VersionStatus }): JSX.Element | null {
	const selected = useLibraryStore(selectIsEntrySelected(model.kind, status.libraryEntryId));
	if (status.kind === 'remote') {
		return null;
	}
	if (status.kind === 'in_library' && selected) {
		return <SelectedBadge />;
	}
	return <VersionStatusBadge kind={status.kind} />;
}

function VersionPicker({ model, version }: { model: RemoteModel; version: RemoteModelVersion }): JSX.Element {
	const styles = useStyles();
	const pickVersion = useModelCatalogStore((state) => state.pickVersion);
	return (
		<Field label="Version" size="small" className={styles.versionField}>
			<Dropdown
				size="small"
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

function VersionCard({ model, version }: { model: RemoteModel; version: RemoteModelVersion }): JSX.Element {
	const styles = useStyles();
	const status = useVersionStatus(model, version);
	return (
		<ModelEntryCard
			name={model.name}
			description={descriptionText(model)}
			previewUrl={version.images[0]?.url ?? null}
			badges={
				<>
					<ModelKindBadge kind={model.kind} />
					{version.base_model ? <BaseModelBadge baseModel={version.base_model} /> : null}
					{model.nsfw ? <NsfwBadge /> : null}
					<ResultStatusBadge model={model} status={status} />
				</>
			}
		>
			<div className={styles.versionRow}>
				<VersionPicker model={model} version={version} />
				{status.sizeBytes != null ? (
					<Caption1 className={styles.size}>{formatBytes(status.sizeBytes)}</Caption1>
				) : null}
			</div>
			<TriggerWords words={version.trigger_words} />
			<InstallAction model={model} version={version} status={status} />
		</ModelEntryCard>
	);
}

export function ModelResultCard({ model }: { model: RemoteModel }): JSX.Element {
	const styles = useStyles();
	const version = usePickedVersion(model);
	if (!version) {
		return (
			<ModelEntryCard
				name={model.name}
				description={descriptionText(model)}
				previewUrl={null}
				badges={
					<>
						<ModelKindBadge kind={model.kind} />
						{model.nsfw ? <NsfwBadge /> : null}
					</>
				}
			>
				<Caption1 className={styles.muted}>No version available.</Caption1>
			</ModelEntryCard>
		);
	}
	return <VersionCard model={model} version={version} />;
}
