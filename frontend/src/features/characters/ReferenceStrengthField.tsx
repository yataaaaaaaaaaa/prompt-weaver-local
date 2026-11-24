// IP-Adapter strength of a character's reference images (presentational Slider over REFERENCE_DEFAULTS min / max /
// step, with its value as text). While the thumb moves, the value is a local draft; it is committed once, when the
// pointer or the key is released or the slider loses the focus, so a drag sends one change. The committed value stays
// shown until the owner's action settles (it may answer a promise, e.g. a backend save), then the owner's value is
// shown again. Shared by the character editor and the active character section of the controls.
import { Body1, Field, makeStyles, Slider, tokens } from '@fluentui/react-components';
import { useRef, useState } from 'react';
import { REFERENCE_DEFAULTS } from '../../api/defaults.gen';
import { formatWeight } from '../../domain/text';

const useStyles = makeStyles({
	row: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalS,
		minWidth: 0,
	},
	slider: {
		flex: '1 1 auto',
		minWidth: 0,
	},
	value: {
		flexShrink: 0,
		fontVariantNumeric: 'tabular-nums',
	},
});

export type ReferenceStrengthFieldProps = {
	value: number;
	/** Saves a new strength; a returned promise keeps the committed value shown until it settles. */
	onCommit: (strength: number) => void | Promise<void>;
	label?: string;
};

type Draft = { value: number; committed: boolean };

export function ReferenceStrengthField({ value, onCommit, label = 'Reference strength' }: ReferenceStrengthFieldProps): JSX.Element {
	const styles = useStyles();
	const [draft, setDraftState] = useState<Draft | null>(null);
	// The latest draft, also for the release events handled before a re-render (pointer and key released together).
	const draftRef = useRef<Draft | null>(null);
	const setDraft = (next: Draft | null) => {
		draftRef.current = next;
		setDraftState(next);
	};
	const shown = draft?.value ?? value;
	// One weight formatter for the views (at most 2 decimals, no trailing zeros).
	const text = formatWeight(shown);
	const commit = () => {
		const current = draftRef.current;
		if (current === null || current.committed) {
			return;
		}
		if (current.value === value) {
			setDraft(null);
			return;
		}
		const committed: Draft = { value: current.value, committed: true };
		setDraft(committed);
		void Promise.resolve(onCommit(committed.value)).finally(() => {
			// Unless the thumb moved again meanwhile.
			if (draftRef.current === committed) {
				setDraft(null);
			}
		});
	};

	return (
		<Field label={label} hint="How strongly the reference images steer the image (0: not at all).">
			{(fieldProps) => (
				<div className={styles.row}>
					<Slider
						{...fieldProps}
						className={styles.slider}
						min={REFERENCE_DEFAULTS.min}
						max={REFERENCE_DEFAULTS.max}
						step={REFERENCE_DEFAULTS.step}
						value={shown}
						aria-valuetext={text}
						onChange={(_event, data) => setDraft({ value: data.value, committed: false })}
						onPointerUp={commit}
						onKeyUp={commit}
						onBlur={commit}
					/>
					<Body1 className={styles.value} aria-hidden>
						{text}
					</Body1>
				</div>
			)}
		</Field>
	);
}
