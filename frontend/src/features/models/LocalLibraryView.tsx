// Local library tab: checkpoints and LoRAs of the library store with their provenance (preview, base model,
// version, trigger words) or a 'Local file' badge, selection for generation, LoRA removal, and the model
// folders reported by the backend (catalog store info).
import { Badge, Body1, Button, Checkbox, makeStyles, tokens, Tooltip } from '@fluentui/react-components';
import { CheckmarkRegular, DeleteRegular } from '@fluentui/react-icons';
import type { ModelKind, ModelSource, ModelSpec } from '../../api/types';
import { MODEL_KIND_LABELS } from '../../domain/modelCatalog';
import { selectIsEntrySelected, useLibraryStore, useLoraRows, type LoraRow } from '../../stores/libraryStore';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { PaneSection } from '../../ui/PaneLayout';
import { ModelEntryCard } from './ModelEntryCard';
import { TriggerWords } from './TriggerWords';

const useStyles = makeStyles({
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
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
		fontSize: tokens.fontSizeBase200,
		lineHeight: tokens.lineHeightBase300,
	},
	value: {
		margin: 0,
		fontSize: tokens.fontSizeBase300,
		lineHeight: tokens.lineHeightBase300,
		overflowWrap: 'anywhere',
	},
});

/** Provenance badges (base model, version) or 'Local file' for entries added from disk. */
function SourceBadges({ source }: { source: ModelSource | null }): JSX.Element {
	if (!source) {
		return (
			<Badge appearance="outline" color="subtle">
				Local file
			</Badge>
		);
	}
	return (
		<>
			{source.base_model ? (
				<Badge appearance="outline" color="informative">
					{source.base_model}
				</Badge>
			) : null}
			{source.version_name ? (
				<Badge appearance="outline" color="subtle">
					{source.version_name}
				</Badge>
			) : null}
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
		<li>
			<ModelEntryCard
				name={entry.name}
				description={entry.path}
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
	const selectModel = useLibraryStore((state) => state.selectModel);
	return (
		<LibraryEntry
			entry={model}
			actions={
				selected ? (
					<Badge appearance="filled" color="brand" icon={<CheckmarkRegular />}>
						Selected
					</Badge>
				) : (
					<Button appearance="primary" icon={<CheckmarkRegular />} onClick={() => selectModel(model.id)}>
						Use
					</Button>
				)
			}
		/>
	);
}

function LoraEntry({ row }: { row: LoraRow }): JSX.Element {
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
						<Button appearance="subtle" icon={<DeleteRegular />} aria-label={removeLabel} onClick={() => removeLora(lora.id)} />
					</Tooltip>
				</>
			}
		/>
	);
}

function ModelFolders(): JSX.Element {
	const styles = useStyles();
	const modelDirs = useModelCatalogStore((state) => state.info?.model_dirs ?? null);
	if (!modelDirs) {
		return <Body1 className={styles.muted}>The model folders are shown once the model library is loaded.</Body1>;
	}
	const kinds = Object.entries(MODEL_KIND_LABELS) as Array<[ModelKind, string]>;
	return (
		<dl className={styles.folders} aria-label="Model folders">
			{kinds.map(([kind, label]) => (
				<div key={kind} className={styles.folderRow}>
					<dt className={styles.term}>{label}</dt>
					<dd className={styles.value}>{modelDirs[kind]}</dd>
				</div>
			))}
		</dl>
	);
}

export function LocalLibraryView(): JSX.Element {
	const styles = useStyles();
	const models = useLibraryStore((state) => state.models);
	const loraRows = useLoraRows();
	return (
		<>
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
			<PaneSection title="Model folders">
				<ModelFolders />
			</PaneSection>
		</>
	);
}
