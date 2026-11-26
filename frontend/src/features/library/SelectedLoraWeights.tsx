// The LoRAs selected for generation with their weights (the Create command bar's LoRA popover): one line per LoRA, the
// name truncated (full name in a tooltip) and the shared weight field (LoraWeightField). Rows come from the library
// store (useSelectedLoraRows), weights are set through setLoraWeight.
import { Body1, Caption1, makeStyles, tokens, Tooltip } from '@fluentui/react-components';
import { useLibraryStore, useSelectedLoraRows } from '../../stores/libraryStore';
import { LoraWeightField } from './LoraWeightField';

const useStyles = makeStyles({
	list: {
		display: 'grid',
		gridTemplateColumns: 'minmax(0, 1fr) auto',
		alignItems: 'center',
		columnGap: tokens.spacingHorizontalM,
		rowGap: tokens.spacingVerticalXS,
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
	},
	name: {
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

export function SelectedLoraWeights(): JSX.Element {
	const styles = useStyles();
	const rows = useSelectedLoraRows();
	const setLoraWeight = useLibraryStore((state) => state.setLoraWeight);
	if (rows.length === 0) {
		return <Caption1 className={styles.muted}>No LoRA selected: the generation uses the prompt-linked LoRAs only.</Caption1>;
	}
	return (
		<ul className={styles.list} aria-label="Selected LoRAs">
			{rows.map(({ lora, weight }) => (
				<li key={lora.id} className={styles.row}>
					<Tooltip content={lora.name} relationship="inaccessible">
						<Body1 className={styles.name}>{lora.name}</Body1>
					</Tooltip>
					<LoraWeightField value={weight} name={lora.name} onCommit={(next) => setLoraWeight(lora.id, next)} />
				</li>
			))}
		</ul>
	);
}
