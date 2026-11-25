// LoRA library list: default selection checkboxes with the weight of each selected LoRA, prompt links (sub-prompt
// extraLoraIds), removal. Rows and summary are derived by the library store (useLoraRows / useLoraSummary).
//
// Layout: one grid for the whole list (rows are subgrids), so the weight fields and the delete buttons line up in
// columns whatever the name lengths; a long name is truncated with an ellipsis and shown in full in a tooltip. Clear
// is a warning action (src/ui/stateColors.ts: it changes what generation uses without deleting anything).
import { Badge, Body1, Button, Caption1, Checkbox, makeStyles, mergeClasses, tokens, Tooltip } from '@fluentui/react-components';
import { Delete20Regular, DocumentAdd20Regular, Eraser20Regular, FolderAdd20Regular, Link12Regular, LinkDismiss20Regular } from '@fluentui/react-icons';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { selectSelectedLoras, useLibraryStore, useLoraRows, useLoraSummary, type LoraRow } from '../../stores/libraryStore';
import { PaneSection } from '../../ui/PaneLayout';
import { useActionClasses } from '../../ui/stateStyles';
import { LoraWeightField } from './LoraWeightField';

const useStyles = makeStyles({
	list: {
		display: 'grid',
		// name (+ prompt link) | weight | delete
		gridTemplateColumns: 'minmax(0, 1fr) auto auto',
		columnGap: tokens.spacingHorizontalXS,
		rowGap: tokens.spacingVerticalXXS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	row: {
		display: 'grid',
		gridColumn: '1 / -1',
		gridTemplateColumns: 'subgrid',
		alignItems: 'center',
		minWidth: 0,
		minHeight: '32px',
		borderRadius: tokens.borderRadiusMedium,
		':hover': {
			backgroundColor: tokens.colorSubtleBackgroundHover,
		},
	},
	// The name keeps the room it needs: the prompt link mark wraps under it when both do not fit on one line, and
	// only a name longer than the whole cell is truncated.
	main: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'center',
		columnGap: tokens.spacingHorizontalXS,
		minWidth: 0,
	},
	// Without a weight (not selected) the name cell also takes the weight column.
	mainWithoutWeight: {
		gridColumn: '1 / span 2',
	},
	checkbox: {
		display: 'flex',
		flex: '0 1 auto',
		minWidth: 0,
		maxWidth: '100%',
	},
	checkboxRoot: {
		minWidth: 0,
	},
	checkboxLabel: {
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	link: {
		display: 'flex',
		alignItems: 'center',
		flexShrink: 0,
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
			<div className={mergeClasses(styles.main, weight === null && styles.mainWithoutWeight)}>
				{/* The full name of a truncated label (the accessible name already is the full name). */}
				<Tooltip content={lora.name} relationship="inaccessible">
					<span className={styles.checkbox}>
						<Checkbox
							className={styles.checkboxRoot}
							label={{ children: lora.name, className: styles.checkboxLabel }}
							checked={selected}
							onChange={(_event, data) => setLoraSelected(lora.id, data.checked === true)}
						/>
					</span>
				</Tooltip>
				{promptLinked ? (
					<span className={styles.link}>
						<Badge appearance="tint" color="brand" size="small" icon={<Link12Regular />}>
							Prompt-linked
						</Badge>
						<Tooltip content={unlinkLabel} relationship="label">
							<Button appearance="subtle" size="small" icon={<LinkDismiss20Regular />} aria-label={unlinkLabel} onClick={() => unlinkLora(lora.id)} />
						</Tooltip>
					</span>
				) : null}
			</div>
			{weight !== null ? <LoraWeightField value={weight} name={lora.name} onCommit={(next) => setLoraWeight(lora.id, next)} /> : null}
			<Tooltip content={removeLabel} relationship="label">
				<Button appearance="subtle" size="small" icon={<Delete20Regular />} aria-label={removeLabel} onClick={() => removeLora(lora.id)} />
			</Tooltip>
		</li>
	);
}

export function LoraSection(): JSX.Element {
	const styles = useStyles();
	const actions = useActionClasses();
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
						<Button
							appearance="subtle"
							size="small"
							className={actions.subtle.warning}
							icon={<Eraser20Regular />}
							disabled={!hasSelection}
							onClick={() => clearSelectedLoras()}
						>
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
