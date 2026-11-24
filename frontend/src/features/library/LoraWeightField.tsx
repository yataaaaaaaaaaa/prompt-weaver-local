// Weight of a LoRA (presentational SpinButton): steppers / arrow keys move by LORA_WEIGHT_DEFAULTS.step, typed values
// are committed on Enter / blur (spinButtonValue; unparseable text is ignored) and shown with formatWeight. The
// owner's store action clamps to the accepted range. Shared by the LoRA selection (LoraSection) and the character
// editor (CharacterLorasField).
import { makeStyles, SpinButton } from '@fluentui/react-components';
import { LORA_WEIGHT_DEFAULTS } from '../../api/defaults.gen';
import { formatWeight } from '../../domain/text';
import { spinButtonValue } from '../../ui/spinButtonValue';

const useStyles = makeStyles({
	weight: {
		flexShrink: 0,
	},
});

/** Characters shown by the weight field (e.g. '-9.95'): sizes the input without a hard-coded width. */
const WEIGHT_INPUT_CHARS = 5;

export type LoraWeightFieldProps = {
	value: number;
	/** LoRA name (accessible name 'Weight of <name>'). */
	name: string;
	onCommit: (weight: number) => void;
	disabled?: boolean;
};

export function LoraWeightField({ value, name, onCommit, disabled }: LoraWeightFieldProps): JSX.Element {
	const styles = useStyles();
	return (
		<SpinButton
			className={styles.weight}
			size="small"
			value={value}
			displayValue={formatWeight(value)}
			min={LORA_WEIGHT_DEFAULTS.min}
			max={LORA_WEIGHT_DEFAULTS.max}
			step={LORA_WEIGHT_DEFAULTS.step}
			disabled={disabled}
			aria-label={`Weight of ${name}`}
			input={{ size: WEIGHT_INPUT_CHARS }}
			onChange={(_event, data) => {
				const next = spinButtonValue(data);
				if (next !== null) {
					onCommit(next);
				}
			}}
		/>
	);
}
