// LoRAs of the character editor form, a group labelled 'LoRAs': one row per LoRA (library name, the shared
// LoraWeightField -> setFormLoraWeight, Remove (danger intent) -> removeFormLora) and a Combobox 'Add a LoRA' of the
// library LoRAs (Fluent useComboboxFilter on the typed text) that adds the picked one (addFormLora, default weight).
// Local (ephemeral) state: the Combobox text.
import {
	Body1,
	Button,
	Combobox,
	Field,
	Label,
	makeStyles,
	Option,
	tokens,
	Tooltip,
	useComboboxFilter,
	useId,
} from '@fluentui/react-components';
import { DeleteRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import type { LoraWeight } from '../../api/types';
import { useCharactersStore } from '../../stores/charactersStore';
import { useLibraryStore, useLoraName } from '../../stores/libraryStore';
import { useActionClasses } from '../../ui/stateStyles';
import { LoraWeightField } from '../library/LoraWeightField';

const NO_LORAS: LoraWeight[] = [];

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

function FormLoraRow({ item }: { item: LoraWeight }): JSX.Element {
	const styles = useStyles();
	const intents = useActionClasses();
	// A LoRA no longer in the library shows its id.
	const name = useLoraName(item.id);
	const setFormLoraWeight = useCharactersStore((state) => state.setFormLoraWeight);
	const removeFormLora = useCharactersStore((state) => state.removeFormLora);
	const removeLabel = `Remove ${name}`;
	return (
		<li className={styles.row}>
			<Body1 className={styles.name}>{name}</Body1>
			<LoraWeightField value={item.weight} name={name} onCommit={(weight) => setFormLoraWeight(item.id, weight)} />
			<Tooltip content={removeLabel} relationship="label">
				<Button
					appearance="subtle"
					size="small"
					className={intents.subtle.danger}
					icon={<DeleteRegular />}
					aria-label={removeLabel}
					onClick={() => removeFormLora(item.id)}
				/>
			</Tooltip>
		</li>
	);
}

export function CharacterLorasField(): JSX.Element {
	const styles = useStyles();
	const labelId = useId('character-loras-');
	const formLoras = useCharactersStore((state) => state.editor?.form.loras ?? NO_LORAS);
	const libraryLoras = useLibraryStore((state) => state.loras);
	const addFormLora = useCharactersStore((state) => state.addFormLora);
	const [query, setQuery] = useState('');
	const options = useMemo(() => libraryLoras.map((lora) => ({ value: lora.id, children: lora.name })), [libraryLoras]);
	const filtered = useComboboxFilter(query, options, {
		optionToText: (option) => option.children,
		noOptionsMessage: 'No LoRA matches.',
		renderOption: (option) => (
			// Already a character LoRA: listed but not pickable again.
			<Option key={option.value} value={option.value} disabled={formLoras.some((item) => item.id === option.value)}>
				{option.children}
			</Option>
		),
	});
	const empty = libraryLoras.length === 0;

	return (
		<div className={styles.root} role="group" aria-labelledby={labelId}>
			<Label id={labelId}>LoRAs</Label>
			{formLoras.length > 0 ? (
				<ul className={styles.list} aria-label="Character LoRAs">
					{formLoras.map((item) => (
						<FormLoraRow key={item.id} item={item} />
					))}
				</ul>
			) : null}
			<Field hint="Character LoRAs apply first while the character is active; their weight wins over the selected weight.">
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
							addFormLora(data.optionValue);
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
