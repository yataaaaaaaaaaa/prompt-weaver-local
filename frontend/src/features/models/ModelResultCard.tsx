// One online search result: preview of the picked version, name and creator, kind / base model / status
// badges, version picker, install file size, trigger words and the status-dependent install action.
// Thin view over the catalog store (usePickedVersion, useVersionStatus, pickVersion) and the library store
// (selection state of the matching library entry).
import { Badge, Caption1, Dropdown, Field, makeStyles, Option, tokens } from '@fluentui/react-components';
import type { RemoteModel, RemoteModelVersion } from '../../api/types';
import { MODEL_KIND_LABELS, modelKey } from '../../domain/modelCatalog';
import { selectIsEntrySelected, useLibraryStore } from '../../stores/libraryStore';
import { useModelCatalogStore, usePickedVersion, useVersionStatus, type VersionStatus } from '../../stores/modelCatalogStore';
import { formatBytes } from './format';
import { InstallAction } from './InstallAction';
import { ModelEntryCard } from './ModelEntryCard';
import { TriggerWords } from './TriggerWords';

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

function creatorText(model: RemoteModel): string | null {
	return model.creator ? `by ${model.creator}` : null;
}

function StatusBadge({ model, status }: { model: RemoteModel; status: VersionStatus }): JSX.Element | null {
	const selected = useLibraryStore(selectIsEntrySelected(model.kind, status.libraryEntryId));
	switch (status.kind) {
		case 'remote':
			return null;
		case 'on_disk':
			return (
				<Badge appearance="tint" color="success">
					Local
				</Badge>
			);
		case 'in_library':
			return (
				<Badge appearance={selected ? 'filled' : 'tint'} color={selected ? 'brand' : 'success'}>
					{selected ? 'Selected' : 'In library'}
				</Badge>
			);
		case 'installing':
			return (
				<Badge appearance="tint" color="informative">
					Downloading
				</Badge>
			);
		case 'failed':
			return (
				<Badge appearance="tint" color="danger">
					Failed
				</Badge>
			);
		case 'unavailable':
			return (
				<Badge appearance="tint" color="warning">
					Not supported
				</Badge>
			);
	}
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
			description={creatorText(model)}
			previewUrl={version.images[0]?.url ?? null}
			badges={
				<>
					<Badge appearance="outline" color="informative">
						{MODEL_KIND_LABELS[model.kind]}
					</Badge>
					{version.base_model ? (
						<Badge appearance="outline" color="subtle">
							{version.base_model}
						</Badge>
					) : null}
					<StatusBadge model={model} status={status} />
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
				description={creatorText(model)}
				previewUrl={null}
				badges={
					<Badge appearance="outline" color="informative">
						{MODEL_KIND_LABELS[model.kind]}
					</Badge>
				}
			>
				<Caption1 className={styles.muted}>No version available.</Caption1>
			</ModelEntryCard>
		);
	}
	return <VersionCard model={model} version={version} />;
}
