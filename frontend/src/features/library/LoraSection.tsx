// LoRA library list: default selection checkboxes with the weight of each selected LoRA, prompt links (sub-prompt
// extraLoraIds), removal. Rows and summary are derived by the library store (useLoraRows / useLoraSummary).
import { Badge, Body1, Button, Caption1, Checkbox, makeStyles, SpinButton, tokens, Tooltip } from '@fluentui/react-components';
import { Delete20Regular, DocumentAdd20Regular, Eraser20Regular, FolderAdd20Regular, LinkDismiss20Regular } from '@fluentui/react-icons';
import { LORA_WEIGHT_DEFAULTS } from '../../api/defaults.gen';
import { formatLoraWeight } from '../../domain/loraSelection';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { selectSelectedLoras, useLibraryStore, useLoraRows, useLoraSummary, type LoraRow } from '../../stores/libraryStore';
import { PaneSection } from '../../ui/PaneLayout';
import { spinButtonValue } from '../../ui/spinButtonValue';

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
	weight: {
		flexShrink: 0,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

/** Characters shown by the weight field (e.g. '-9.95'): sizes the input without a hard-coded width. */
const WEIGHT_INPUT_CHARS = 5;

type LoraWeightInputProps = { loraId: string; loraName: string; weight: number };

/** Weight of a selected LoRA: steppers/arrow keys move by LORA_WEIGHT_DEFAULTS.step, typed values are committed on
 *  Enter/blur; the store clamps to the accepted range. */
function LoraWeightInput({ loraId, loraName, weight }: LoraWeightInputProps): JSX.Element {
	const styles = useStyles();
	const setLoraWeight = useLibraryStore((state) => state.setLoraWeight);
	return (
		<SpinButton
			className={styles.weight}
			size="small"
			value={weight}
			displayValue={formatLoraWeight(weight)}
			min={LORA_WEIGHT_DEFAULTS.min}
			max={LORA_WEIGHT_DEFAULTS.max}
			step={LORA_WEIGHT_DEFAULTS.step}
			aria-label={`Weight of ${loraName}`}
			input={{ size: WEIGHT_INPUT_CHARS }}
			onChange={(_event, data) => {
				const next = spinButtonValue(data);
				if (next !== null) {
					setLoraWeight(loraId, next);
				}
			}}
		/>
	);
}

function LoraListRow({ row }: { row: LoraRow }): JSX.Element {
	const styles = useStyles();
	const setLoraSelected = useLibraryStore((state) => state.setLoraSelected);
	const removeLora = useLibraryStore((state) => state.removeLora);
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
			{weight !== null ? <LoraWeightInput loraId={lora.id} loraName={lora.name} weight={weight} /> : null}
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
