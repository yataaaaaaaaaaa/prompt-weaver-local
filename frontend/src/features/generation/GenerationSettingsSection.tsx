// Image size, steps and CFG of the generation settings store (2-column grid of Fluent SpinButtons).
import { Field, SpinButton } from '@fluentui/react-components';
import { useGenerationSettingsStore } from '../../stores/generationSettingsStore';
import { PaneGrid, PaneSection } from '../../ui/PaneLayout';
import { spinButtonValue } from '../../ui/spinButtonValue';

type NumberSettingProps = {
	label: string;
	value: number;
	min: number;
	max?: number;
	step?: number;
	onCommit: (value: number) => void;
};

function NumberSetting({ label, value, min, max, step = 1, onCommit }: NumberSettingProps): JSX.Element {
	return (
		<Field label={label}>
			<SpinButton
				value={value}
				min={min}
				max={max}
				step={step}
				onChange={(_event, data) => {
					const next = spinButtonValue(data);
					if (next !== null) {
						onCommit(next);
					}
				}}
			/>
		</Field>
	);
}

export function GenerationSettingsSection(): JSX.Element {
	const width = useGenerationSettingsStore((state) => state.width);
	const height = useGenerationSettingsStore((state) => state.height);
	const steps = useGenerationSettingsStore((state) => state.steps);
	const guidanceScale = useGenerationSettingsStore((state) => state.guidanceScale);
	const setWidth = useGenerationSettingsStore((state) => state.setWidth);
	const setHeight = useGenerationSettingsStore((state) => state.setHeight);
	const setSteps = useGenerationSettingsStore((state) => state.setSteps);
	const setGuidanceScale = useGenerationSettingsStore((state) => state.setGuidanceScale);

	return (
		<PaneSection title="Image settings">
			<PaneGrid>
				<NumberSetting label="Width" value={width} min={256} step={64} onCommit={setWidth} />
				<NumberSetting label="Height" value={height} min={256} step={64} onCommit={setHeight} />
				<NumberSetting label="Steps" value={steps} min={1} max={100} onCommit={setSteps} />
				<NumberSetting label="CFG" value={guidanceScale} min={1} max={20} step={0.5} onCommit={setGuidanceScale} />
			</PaneGrid>
		</PaneSection>
	);
}
