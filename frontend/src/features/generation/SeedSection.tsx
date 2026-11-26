// Prompt-selection and image seeds with their after-generation behaviors (generation settings store).
// Option lists and labels come from src/domain/seeds.ts. Two columns (seed | behavior) when the panel is wide enough,
// one column in a narrow panel.
import { Caption1, Dropdown, Field, Input, makeStyles, Option, tokens } from '@fluentui/react-components';
import { IMAGE_SEED_BEHAVIORS, PROMPT_SEED_BEHAVIORS, SEED_BEHAVIOR_LABELS, type SeedBehavior } from '../../domain/seeds';
import { selectPromptSeedManagedPerCategory, useGenerationSettingsStore } from '../../stores/generationSettingsStore';
import { PaneGrid, PaneSection } from '../../ui/PaneLayout';

/** Narrowest column of the seed grid: below two of these the fields stack (one column), so labels such as
 *  'Prompt seed behavior' and values such as 'Auto increment' never wrap or get cut in a narrow panel. */
const SEED_COLUMN_MIN_WIDTH = '160px';

const useStyles = makeStyles({
	dropdown: {
		minWidth: 0,
	},
	caption: {
		color: tokens.colorNeutralForeground3,
	},
});

type SeedBehaviorFieldProps = {
	label: string;
	value: SeedBehavior;
	options: readonly SeedBehavior[];
	onChange: (value: SeedBehavior) => void;
};

function SeedBehaviorField({ label, value, options, onChange }: SeedBehaviorFieldProps): JSX.Element {
	const styles = useStyles();
	return (
		<Field label={label}>
			<Dropdown
				className={styles.dropdown}
				value={SEED_BEHAVIOR_LABELS[value]}
				selectedOptions={[value]}
				onOptionSelect={(_event, data) => {
					const selected = options.find((option) => option === data.optionValue);
					if (selected) {
						onChange(selected);
					}
				}}
			>
				{options.map((option) => (
					<Option key={option} value={option}>
						{SEED_BEHAVIOR_LABELS[option]}
					</Option>
				))}
			</Dropdown>
		</Field>
	);
}

export function SeedSection(): JSX.Element {
	const styles = useStyles();
	const promptSeedInput = useGenerationSettingsStore((state) => state.promptSeedInput);
	const seedInput = useGenerationSettingsStore((state) => state.seedInput);
	const promptSeedBehavior = useGenerationSettingsStore((state) => state.promptSeedBehavior);
	const imageSeedBehavior = useGenerationSettingsStore((state) => state.imageSeedBehavior);
	const managedPerCategory = useGenerationSettingsStore(selectPromptSeedManagedPerCategory);
	const setPromptSeedInput = useGenerationSettingsStore((state) => state.setPromptSeedInput);
	const setSeedInput = useGenerationSettingsStore((state) => state.setSeedInput);
	const setPromptSeedBehavior = useGenerationSettingsStore((state) => state.setPromptSeedBehavior);
	const setImageSeedBehavior = useGenerationSettingsStore((state) => state.setImageSeedBehavior);

	return (
		<PaneSection title="Seeds">
			<PaneGrid minColumnWidth={SEED_COLUMN_MIN_WIDTH}>
				<Field label="Prompt seed">
					<Input
						value={promptSeedInput}
						placeholder={managedPerCategory ? 'Managed automatically per category' : 'Prompt selection seed'}
						disabled={managedPerCategory}
						onChange={(_event, data) => setPromptSeedInput(data.value)}
					/>
				</Field>
				<SeedBehaviorField
					label="Prompt seed behavior"
					value={promptSeedBehavior}
					options={PROMPT_SEED_BEHAVIORS}
					onChange={setPromptSeedBehavior}
				/>
				<Field label="Image seed">
					<Input value={seedInput} placeholder="Image seed" onChange={(_event, data) => setSeedInput(data.value)} />
				</Field>
				<SeedBehaviorField label="Image seed behavior" value={imageSeedBehavior} options={IMAGE_SEED_BEHAVIORS} onChange={setImageSeedBehavior} />
			</PaneGrid>
			<Caption1 className={styles.caption}>Seed behaviors apply after each generation; an empty seed is random.</Caption1>
			{managedPerCategory ? (
				<Caption1 className={styles.caption}>
					Each active category advances on its own counter. It starts from a random value, walks one full cycle, then restarts from a
					new random value. Locked prompts are still used for active categories unless they are forbidden.
				</Caption1>
			) : null}
		</PaneSection>
	);
}
