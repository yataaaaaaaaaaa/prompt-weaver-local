// LoRA library list: default selection checkboxes with the weight of each selected LoRA, prompt links (sub-prompt
// extraLoraIds), removal. Rows and summary are derived by the library store (useLoraRows / useLoraSummary).
import { Badge, Body1, Button, Caption1, Checkbox, makeStyles, tokens, Tooltip } from '@fluentui/react-components';
import { Delete20Regular, DocumentAdd20Regular, Eraser20Regular, FolderAdd20Regular, LinkDismiss20Regular } from '@fluentui/react-icons';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { selectSelectedLoras, useLibraryStore, useLoraRows, useLoraSummary, type LoraRow } from '../../stores/libraryStore';
import { PaneSection } from '../../ui/PaneLayout';
import { LoraWeightField } from './LoraWeightField';

const useStyles = makeStyles({
	list: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	row: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXS,
		minWidth: 0,
		borderRadius: tokens.borderRadiusMedium,
		':hover': {
			backgroundColor: tokens.colorSubtleBackgroundHover,
		},
	},
	checkbox: {
		flex: '1 1 auto',
		minWidth: 0,
		overflowWrap: 'anywhere',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

function LoraListRow({ row }: { row: LoraRow }): JSX.Element {
	const styles = useStyles();
	const setLoraSelected = useLibraryStore((state) => state.setLoraSelected);
	const removeLora = useLibraryStore((state) => state.removeLora);
	const setLoraWeight = useLibraryStore((state) => state.setLoraWeight);
	const unlinkLora = useCategoriesStore((state) => state.unlinkLora);
	const { lora, selected, weight, promptLinked } = row;
	const unlinkLabel = `Remove prompt links to ${lora.name}`;
	const removeLabel = `Delete ${lora.name} from the library`;

	return (
		<li className={styles.row}>
			<Checkbox
				className={styles.checkbox}
				label={lora.name}
				checked={selected}
				onChange={(_event, data) => setLoraSelected(lora.id, data.checked === true)}
			/>
			{promptLinked ? (
				<>
					<Badge appearance="tint" color="brand" size="small">
						Prompt-linked
					</Badge>
					<Tooltip content={unlinkLabel} relationship="label">
						<Button appearance="subtle" size="small" icon={<LinkDismiss20Regular />} aria-label={unlinkLabel} onClick={() => unlinkLora(lora.id)} />
					</Tooltip>
				</>
			) : null}
			{weight !== null ? <LoraWeightField value={weight} name={lora.name} onCommit={(next) => setLoraWeight(lora.id, next)} /> : null}
			<Tooltip content={removeLabel} relationship="label">
				<Button appearance="subtle" size="small" icon={<Delete20Regular />} aria-label={removeLabel} onClick={() => removeLora(lora.id)} />
			</Tooltip>
		</li>
	);
}

export function LoraSection(): JSX.Element {
	const styles = useStyles();
	const rows = useLoraRows();
	const summary = useLoraSummary();
	const hasSelection = useLibraryStore((state) => selectSelectedLoras(state).length > 0);
	const clearSelectedLoras = useLibraryStore((state) => state.clearSelectedLoras);
	const addLoraFiles = useLibraryStore((state) => state.addLoraFiles);
	const addLoraDirectory = useLibraryStore((state) => state.addLoraDirectory);

	return (
		<PaneSection
			title="LoRAs"
			actions={
				<>
					<Tooltip content="Unselect every LoRA (prompt links are kept)" relationship="description">
						<Button appearance="subtle" size="small" icon={<Eraser20Regular />} disabled={!hasSelection} onClick={() => clearSelectedLoras()}>
							Clear
						</Button>
					</Tooltip>
					<Button appearance="subtle" size="small" icon={<DocumentAdd20Regular />} onClick={() => void addLoraFiles()}>
						Add files
					</Button>
					<Button appearance="subtle" size="small" icon={<FolderAdd20Regular />} onClick={() => void addLoraDirectory()}>
						Add folder
					</Button>
				</>
			}
		>
			{rows.length > 0 ? (
				<ul className={styles.list} aria-label="LoRA library">
					{rows.map((row) => (
						<LoraListRow key={row.lora.id} row={row} />
					))}
				</ul>
			) : (
				<Body1 className={styles.muted}>No LoRAs loaded.</Body1>
			)}
			<Caption1 className={styles.muted}>
				Default selected: {summary.selected} · Prompt-linked: {summary.promptLinked} · Possible active: {summary.possibleActive}
			</Caption1>
		</PaneSection>
	);
}
