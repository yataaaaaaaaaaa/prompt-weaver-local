// The LoRAs of the generation panel: the LoRA library list (default selection checkboxes, the weight of each selected
// LoRA, the prompt-linked mark, removal from the library) with Clear, plus what the panel's advanced options show: adding
// LoRA files and folders (LoraFileActions) and the prompt link details (PromptLinkedLoras: the summary and unlinking).
// Rows and summary are derived by the library store (useLoraRows / useLoraSummary / usePromptLinkedLoras).
//
// Layout: one grid for the whole list (rows are subgrids), so the weight fields and the delete buttons line up in
// columns whatever the name lengths; a long name is truncated with an ellipsis and shown in full in a tooltip. Clear is
// a warning action (src/ui/stateColors.ts: it changes what generation uses without deleting anything).
import { Badge, Body1, Button, Caption1, Checkbox, makeStyles, mergeClasses, tokens, Tooltip } from '@fluentui/react-components';
import { Delete20Regular, DocumentAdd20Regular, Eraser20Regular, FolderAdd20Regular, Link12Regular, LinkDismiss20Regular } from '@fluentui/react-icons';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { selectSelectedLoras, useLibraryStore, useLoraRows, useLoraSummary, usePromptLinkedLoras, type LoraRow } from '../../stores/libraryStore';
import { PaneSection } from '../../ui/PaneLayout';
import { useActionClasses } from '../../ui/stateStyles';
import { LoraWeightField } from './LoraWeightField';

/** DOM id of the LoRA list's container ("Edit LoRAs" of the Create command bar scrolls it into view). */
export const LORA_LIST_ID = 'generation-lora-list';

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
		flexShrink: 0,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
	buttons: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	linked: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	linkedRow: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
	},
	linkedName: {
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
});

function LoraListRow({ row }: { row: LoraRow }): JSX.Element {
	const styles = useStyles();
	const setLoraSelected = useLibraryStore((state) => state.setLoraSelected);
	const removeLora = useLibraryStore((state) => state.removeLora);
	const setLoraWeight = useLibraryStore((state) => state.setLoraWeight);
	const { lora, selected, weight, promptLinked } = row;
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
					<Badge className={styles.link} appearance="tint" color="brand" size="small" icon={<Link12Regular />}>
						Prompt-linked
					</Badge>
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
	const hasSelection = useLibraryStore((state) => selectSelectedLoras(state).length > 0);
	const clearSelectedLoras = useLibraryStore((state) => state.clearSelectedLoras);

	return (
		<PaneSection
			title="LoRAs"
			actions={
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
			}
		>
			<div id={LORA_LIST_ID}>
				{rows.length > 0 ? (
					<ul className={styles.list} aria-label="LoRA library">
						{rows.map((row) => (
							<LoraListRow key={row.lora.id} row={row} />
						))}
					</ul>
				) : (
					<Body1 className={styles.muted}>No LoRAs yet: add files in More options, or find some in Models.</Body1>
				)}
			</div>
		</PaneSection>
	);
}

/** Advanced options: add LoRA files (several at once) or a LoRA folder from disk; they are selected at weight 1. */
export function LoraFileActions(): JSX.Element {
	const styles = useStyles();
	const addLoraFiles = useLibraryStore((state) => state.addLoraFiles);
	const addLoraDirectory = useLibraryStore((state) => state.addLoraDirectory);
	return (
		<div className={styles.buttons}>
			<Button icon={<DocumentAdd20Regular />} onClick={() => void addLoraFiles()}>
				Add LoRA files
			</Button>
			<Button icon={<FolderAdd20Regular />} onClick={() => void addLoraDirectory()}>
				Add LoRA folder
			</Button>
		</div>
	);
}

/** Advanced options: which LoRAs the sub-prompts pull in, the selection summary, and unlinking a LoRA from every
 *  sub-prompt. */
export function PromptLinkedLoras(): JSX.Element {
	const styles = useStyles();
	const summary = useLoraSummary();
	const linked = usePromptLinkedLoras();
	const unlinkLora = useCategoriesStore((state) => state.unlinkLora);
	return (
		<>
			<Caption1 className={styles.muted}>
				Default selected: {summary.selected} · Prompt-linked: {summary.promptLinked} · Possible active: {summary.possibleActive}
			</Caption1>
			{linked.length > 0 ? (
				<ul className={styles.linked} aria-label="Prompt-linked LoRAs">
					{linked.map((lora) => {
						const unlinkLabel = `Remove prompt links to ${lora.name}`;
						return (
							<li key={lora.id} className={styles.linkedRow}>
								<Tooltip content={lora.name} relationship="inaccessible">
									<Body1 className={styles.linkedName}>{lora.name}</Body1>
								</Tooltip>
								<Tooltip content={unlinkLabel} relationship="label">
									<Button appearance="subtle" size="small" icon={<LinkDismiss20Regular />} aria-label={unlinkLabel} onClick={() => unlinkLora(lora.id)} />
								</Tooltip>
							</li>
						);
					})}
				</ul>
			) : (
				<Caption1 className={styles.muted}>No sub-prompt pulls in a LoRA.</Caption1>
			)}
		</>
	);
}
