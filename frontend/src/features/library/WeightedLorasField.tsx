// A list of LoRAs with their weights, as a labelled group: one row per LoRA (its library name, the shared
// LoraWeightField, Remove with the danger intent) and a Combobox 'Add a LoRA' over the library LoRAs (Fluent
// useComboboxFilter on the typed text; LoRAs already listed show but cannot be picked again). Presentational: the owner
// passes the items and its store actions (the character editor's form LoRAs, a story scene's LoRAs). Local (ephemeral)
// state: the Combobox text.
import { Body1, Button, Combobox, Field, Label, makeStyles, Option, tokens, Tooltip, useComboboxFilter, useId } from '@fluentui/react-components';
import { DeleteRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import type { LoraWeight } from '../../api/types';
import { useLibraryStore, useLoraName } from '../../stores/libraryStore';
import { useActionClasses } from '../../ui/stateStyles';
import { LoraWeightField } from './LoraWeightField';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
	},
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
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
		paddingLeft: tokens.spacingHorizontalS,
		borderRadius: tokens.borderRadiusMedium,
		':hover': {
			backgroundColor: tokens.colorSubtleBackgroundHover,
		},
	},
	name: {
		flex: '1 1 auto',
		minWidth: 0,
		overflowWrap: 'anywhere',
	},
	combobox: {
		minWidth: 0,
		width: '100%',
	},
});

export type WeightedLorasFieldProps = {
	/** The group's label ('LoRAs'). */
	label: string;
	/** The list's accessible name ('Character LoRAs'). */
	listLabel: string;
	hint: string;
	items: readonly LoraWeight[];
	onAdd: (loraId: string) => void;
	onRemove: (loraId: string) => void;
	onWeight: (loraId: string, weight: number) => void;
};

function LoraRow({ item, onRemove, onWeight }: { item: LoraWeight } & Pick<WeightedLorasFieldProps, 'onRemove' | 'onWeight'>): JSX.Element {
	const styles = useStyles();
	const intents = useActionClasses();
	// A LoRA no longer in the library shows its id.
	const name = useLoraName(item.id);
	const removeLabel = `Remove ${name}`;
	return (
		<li className={styles.row}>
			<Body1 className={styles.name}>{name}</Body1>
			<LoraWeightField value={item.weight} name={name} onCommit={(weight) => onWeight(item.id, weight)} />
			<Tooltip content={removeLabel} relationship="label">
				<Button appearance="subtle" size="small" className={intents.subtle.danger} icon={<DeleteRegular />} aria-label={removeLabel} onClick={() => onRemove(item.id)} />
			</Tooltip>
		</li>
	);
}

export function WeightedLorasField({ label, listLabel, hint, items, onAdd, onRemove, onWeight }: WeightedLorasFieldProps): JSX.Element {
	const styles = useStyles();
	const labelId = useId('weighted-loras-');
	const libraryLoras = useLibraryStore((state) => state.loras);
	const [query, setQuery] = useState('');
	const options = useMemo(() => libraryLoras.map((lora) => ({ value: lora.id, children: lora.name })), [libraryLoras]);
	const filtered = useComboboxFilter(query, options, {
		optionToText: (option) => option.children,
		noOptionsMessage: 'No LoRA matches.',
		renderOption: (option) => (
			<Option key={option.value} value={option.value} disabled={items.some((item) => item.id === option.value)}>
				{option.children}
			</Option>
		),
	});
	const empty = libraryLoras.length === 0;

	return (
		<div className={styles.root} role="group" aria-labelledby={labelId}>
			<Label id={labelId}>{label}</Label>
			{items.length > 0 ? (
				<ul className={styles.list} aria-label={listLabel}>
					{items.map((item) => (
						<LoraRow key={item.id} item={item} onRemove={onRemove} onWeight={onWeight} />
					))}
				</ul>
			) : null}
			<Field hint={hint}>
				<Combobox
					aria-label="Add a LoRA"
					className={styles.combobox}
					disabled={empty}
					placeholder={empty ? 'No LoRAs in the library' : 'Add a LoRA: search the library'}
					value={query}
					selectedOptions={[]}
					onChange={(event) => setQuery(event.target.value)}
					onOptionSelect={(_event, data) => {
						if (data.optionValue) {
							onAdd(data.optionValue);
						}
						setQuery('');
					}}
				>
					{filtered}
				</Combobox>
			</Field>
		</div>
	);
}
