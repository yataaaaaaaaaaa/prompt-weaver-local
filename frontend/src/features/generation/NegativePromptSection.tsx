// Negative prompt of the generation settings store.
import { Textarea } from '@fluentui/react-components';
import { useGenerationSettingsStore } from '../../stores/generationSettingsStore';
import { PaneSection } from '../../ui/PaneLayout';

export function NegativePromptSection(): JSX.Element {
	const negativePrompt = useGenerationSettingsStore((state) => state.negativePrompt);
	const setNegativePrompt = useGenerationSettingsStore((state) => state.setNegativePrompt);

	return (
		<PaneSection title="Negative prompt">
			<Textarea
				aria-label="Negative prompt"
				rows={6}
				resize="vertical"
				value={negativePrompt}
				onChange={(_event, data) => setNegativePrompt(data.value)}
			/>
		</PaneSection>
	);
}
