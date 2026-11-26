// One online search result as a compact card of the results grid: preview of the picked version, name (opens the
// model in the detail panel), creator and download count, kind / base model / NSFW / status badges, and the
// status-dependent primary action (InstallAction), which works without opening the detail panel. The version picker,
// files and trigger words are in the detail panel (ModelDetail). Thin view over the catalog store (usePickedVersion,
// useVersionStatus, selectedModelKey, selectModel) and the library store (selection state of the matching library
// entry).
import { Caption1, makeStyles, tokens } from '@fluentui/react-components';
import type { RemoteModel, RemoteModelVersion } from '../../api/types';
import { modelKey } from '../../domain/modelCatalog';
import { selectIsEntrySelected, useLibraryStore } from '../../stores/libraryStore';
import { useModelCatalogStore, usePickedVersion, useVersionStatus, type VersionStatus } from '../../stores/modelCatalogStore';
import { formatDownloads } from './format';
import { InstallAction } from './InstallAction';
import { BaseModelBadge, ModelKindBadge, NsfwBadge, SelectedBadge } from './ModelBadges';
import { ModelEntryCard } from './ModelEntryCard';
import { VersionStatusBadge } from './VersionStatusBadge';

const useStyles = makeStyles({
	muted: {
		color: tokens.colorNeutralForeground3,
	},
	action: {
		marginTop: 'auto',
	},
});

/** 'by <creator> · <n> downloads' (the creator part only when known). */
export function modelDescriptionText(model: RemoteModel): string {
	const downloads = formatDownloads(model.download_count);
	return model.creator ? `by ${model.creator} · ${downloads}` : downloads;
}

/** The shared VersionStatusBadge, except: no badge for 'remote' (the card offers 'Download and use'), and 'Selected'
 *  for a library entry selected for generation. Shared by the result cards and the detail panel. */
export function ResultStatusBadge({ model, status }: { model: RemoteModel; status: VersionStatus }): JSX.Element | null {
	const selected = useLibraryStore(selectIsEntrySelected(model.kind, status.libraryEntryId));
	if (status.kind === 'remote') {
		return null;
	}
	if (status.kind === 'in_library' && selected) {
		return <SelectedBadge />;
	}
	return <VersionStatusBadge kind={status.kind} />;
}

/** Kind, base model, NSFW and status badges of the version shown for a model. */
export function ResultBadges({ model, version, status }: { model: RemoteModel; version: RemoteModelVersion; status: VersionStatus }): JSX.Element {
	return (
		<>
			<ModelKindBadge kind={model.kind} />
			{version.base_model ? <BaseModelBadge baseModel={version.base_model} /> : null}
			{model.nsfw ? <NsfwBadge /> : null}
			<ResultStatusBadge model={model} status={status} />
		</>
	);
}

type CardOpening = { onOpen: () => void; openerKey: string; selected: boolean };

function VersionCard({ model, version, opening }: { model: RemoteModel; version: RemoteModelVersion; opening: CardOpening }): JSX.Element {
	const styles = useStyles();
	const status = useVersionStatus(model, version);
	return (
		<ModelEntryCard
			name={model.name}
			description={modelDescriptionText(model)}
			previewUrl={version.images[0]?.url ?? null}
			badges={<ResultBadges model={model} version={version} status={status} />}
			{...opening}
		>
			<div className={styles.action}>
				<InstallAction model={model} version={version} status={status} />
			</div>
		</ModelEntryCard>
	);
}

export function ModelResultCard({ model }: { model: RemoteModel }): JSX.Element {
	const styles = useStyles();
	const version = usePickedVersion(model);
	const key = modelKey(model);
	const selected = useModelCatalogStore((state) => state.selectedModelKey === key);
	const selectModel = useModelCatalogStore((state) => state.selectModel);
	const opening: CardOpening = { onOpen: () => selectModel(key), openerKey: key, selected };
	if (!version) {
		return (
			<ModelEntryCard
				name={model.name}
				description={modelDescriptionText(model)}
				previewUrl={null}
				badges={
					<>
						<ModelKindBadge kind={model.kind} />
						{model.nsfw ? <NsfwBadge /> : null}
					</>
				}
				{...opening}
			>
				<Caption1 className={styles.muted}>No version available.</Caption1>
			</ModelEntryCard>
		);
	}
	return <VersionCard model={model} version={version} opening={opening} />;
}
