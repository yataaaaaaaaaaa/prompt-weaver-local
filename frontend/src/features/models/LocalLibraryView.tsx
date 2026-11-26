// The Models section's local library: the checkpoints and LoRAs of the library store as card grids, with their
// provenance (preview, base model, version, trigger words) or a 'Local file' badge, their file path (wrapping between
// folder names), 'Use' of a checkpoint (catalog store applyLibraryCheckpoint: the current model, with 'Go to Create'),
// 'Use by default' and Remove (danger action) of a LoRA; and the model folders reported by the backend (catalog
// store info), shown in the detail panel next to the grids (ModelFolders).
import { Body1, Button, Checkbox, makeStyles, Subtitle1, tokens, Tooltip } from '@fluentui/react-components';
import { CheckmarkRegular, DeleteRegular } from '@fluentui/react-icons';
import type { ModelDirs, ModelKind, ModelSource, ModelSpec } from '../../api/types';
import { MODEL_KIND_LABELS } from '../../domain/modelCatalog';
import { selectIsEntrySelected, useLibraryStore, useLoraRows, type LoraRow } from '../../stores/libraryStore';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { FactList } from '../../ui/FactList';
import { PaneSection } from '../../ui/PaneLayout';
import { useActionClasses } from '../../ui/stateStyles';
import { BaseModelBadge, LocalFileBadge, SelectedBadge, VersionNameBadge } from './ModelBadges';
import { ModelEntryCard } from './ModelEntryCard';
import { RESULT_CARD_MIN_WIDTH } from './ModelResultsGrid';
import { PathText } from './PathText';
import { TriggerWords } from './TriggerWords';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		minWidth: 0,
	},
	list: {
		display: 'grid',
		gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${RESULT_CARD_MIN_WIDTH}), 1fr))`,
		gap: tokens.spacingHorizontalM,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	item: {
		minWidth: 0,
	},
	folderPanel: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
		minWidth: 0,
	},
	folderTitle: {
		margin: 0,
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
		marginTop: 'auto',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

/** Provenance badges (base model, version) or 'Local file' for entries added from disk. */
function SourceBadges({ source }: { source: ModelSource | null }): JSX.Element {
	if (!source) {
		return <LocalFileBadge />;
	}
	return (
		<>
			{source.base_model ? <BaseModelBadge baseModel={source.base_model} /> : null}
			{source.version_name ? <VersionNameBadge name={source.version_name} /> : null}
		</>
	);
}

type LibraryEntryProps = {
	entry: { name: string; path: string; source: ModelSource | null };
	actions: JSX.Element;
};

function LibraryEntry({ entry, actions }: LibraryEntryProps): JSX.Element {
	const styles = useStyles();
	return (
		<li className={styles.item}>
			<ModelEntryCard
				name={entry.name}
				description={<PathText path={entry.path} />}
				previewUrl={entry.source?.preview_url ?? null}
				badges={<SourceBadges source={entry.source} />}
			>
				{entry.source ? <TriggerWords words={entry.source.trigger_words} /> : null}
				<div className={styles.actions}>{actions}</div>
			</ModelEntryCard>
		</li>
	);
}

function CheckpointEntry({ model }: { model: ModelSpec }): JSX.Element {
	const selected = useLibraryStore(selectIsEntrySelected('checkpoint', model.id));
	const applyLibraryCheckpoint = useModelCatalogStore((state) => state.applyLibraryCheckpoint);
	return (
		<LibraryEntry
			entry={model}
			actions={
				selected ? (
					<SelectedBadge />
				) : (
					<Button appearance="primary" icon={<CheckmarkRegular />} onClick={() => applyLibraryCheckpoint(model.id)}>
						Use
					</Button>
				)
			}
		/>
	);
}

function LoraEntry({ row }: { row: LoraRow }): JSX.Element {
	const actionClasses = useActionClasses();
	const setLoraSelected = useLibraryStore((state) => state.setLoraSelected);
	const removeLora = useLibraryStore((state) => state.removeLora);
	const { lora, selected } = row;
	const removeLabel = `Remove ${lora.name} from the library`;
	return (
		<LibraryEntry
			entry={lora}
			actions={
				<>
					<Checkbox label="Use by default" checked={selected} onChange={(_event, data) => setLoraSelected(lora.id, data.checked === true)} />
					<Tooltip content={removeLabel} relationship="label">
						<Button
							appearance="subtle"
							className={actionClasses.subtle.danger}
							icon={<DeleteRegular />}
							aria-label={removeLabel}
							onClick={() => removeLora(lora.id)}
						/>
					</Tooltip>
				</>
			}
		/>
	);
}

/** The model folders of the backend (detail panel of the local library): where the files are looked for and where
 *  downloads go. */
export function ModelFolders(): JSX.Element {
	const styles = useStyles();
	const modelDirs = useModelCatalogStore((state) => state.info?.model_dirs ?? null);
	return (
		<div className={styles.folderPanel}>
			<Subtitle1 as="h2" className={styles.folderTitle}>
				Model folders
			</Subtitle1>
			<Body1 className={styles.muted}>
				Downloads are saved in these folders, and files already there are found and used instead of being downloaded
				again.
			</Body1>
			<FolderList modelDirs={modelDirs} />
		</div>
	);
}

function FolderList({ modelDirs }: { modelDirs: ModelDirs | null }): JSX.Element {
	const styles = useStyles();
	if (!modelDirs) {
		return <Body1 className={styles.muted}>The model folders are shown once the model providers are loaded.</Body1>;
	}
	const kinds = Object.entries(MODEL_KIND_LABELS) as Array<[ModelKind, string]>;
	return <FactList label="Model folders" facts={kinds.map(([kind, label]) => ({ term: label, value: <PathText path={modelDirs[kind]} /> }))} />;
}

export function LocalLibraryView(): JSX.Element {
	const styles = useStyles();
	const models = useLibraryStore((state) => state.models);
	const loraRows = useLoraRows();
	return (
		<div className={styles.root}>
			<PaneSection title="Checkpoints">
				{models.length > 0 ? (
					<ul className={styles.list} aria-label="Checkpoints">
						{models.map((model) => (
							<CheckpointEntry key={model.id} model={model} />
						))}
					</ul>
				) : (
					<Body1 className={styles.muted}>No checkpoint in the library.</Body1>
				)}
			</PaneSection>
			<PaneSection title="LoRAs">
				{loraRows.length > 0 ? (
					<ul className={styles.list} aria-label="LoRAs">
						{loraRows.map((row) => (
							<LoraEntry key={row.lora.id} row={row} />
						))}
					</ul>
				) : (
					<Body1 className={styles.muted}>No LoRA in the library.</Body1>
				)}
			</PaneSection>
		</div>
	);
}
