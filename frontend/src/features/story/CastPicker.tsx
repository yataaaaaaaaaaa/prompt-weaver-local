// Picks the characters of a story or of a scene (the Characters section's characters, never a new concept): a Fluent
// multiselect dropdown listing every character in the gallery order, showing the picked names in order (the first one's
// reference images apply). Ids naming no character any more are shown as 'Unknown character' until changed. Thin view
// over the characters store; the caller saves the new ids (a story store action).
import { Caption1, Dropdown, Field, makeStyles, Option, tokens } from '@fluentui/react-components';
import { useSortedCharacters } from '../../stores/charactersStore';

const useStyles = makeStyles({
	dropdown: {
		minWidth: 0,
		width: '100%',
	},
	hint: {
		color: tokens.colorNeutralForeground3,
	},
});

export type CastPickerProps = {
	label: string;
	selectedIds: readonly string[];
	onChange: (ids: string[]) => void;
	disabled?: boolean;
	/** Shown under the field. */
	hint?: string;
};

export function CastPicker({ label, selectedIds, onChange, disabled = false, hint }: CastPickerProps): JSX.Element {
	const styles = useStyles();
	const characters = useSortedCharacters();
	const names = selectedIds.map((id) => characters.find((character) => character.id === id)?.name ?? 'Unknown character');
	const noCharacters = characters.length === 0;
	return (
		<Field
			label={label}
			hint={noCharacters ? 'Create characters in the Characters section to use them here.' : hint ? <Caption1 className={styles.hint}>{hint}</Caption1> : undefined}
		>
			<Dropdown
				className={styles.dropdown}
				multiselect
				disabled={disabled || noCharacters}
				placeholder="No character"
				value={names.join(', ')}
				selectedOptions={[...selectedIds]}
				onOptionSelect={(_event, data) => onChange(data.selectedOptions)}
			>
				{characters.map((character) => (
					<Option key={character.id} value={character.id}>
						{character.name}
					</Option>
				))}
			</Dropdown>
		</Field>
	);
}
