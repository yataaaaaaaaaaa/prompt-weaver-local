// LoRAs of the character editor form, a group labelled 'LoRAs': the shared WeightedLorasField over the editor form's
// LoRAs (addFormLora at the default weight, setFormLoraWeight, removeFormLora).
import type { LoraWeight } from '../../api/types';
import { useCharactersStore } from '../../stores/charactersStore';
import { WeightedLorasField } from '../library/WeightedLorasField';

const NO_LORAS: LoraWeight[] = [];

export function CharacterLorasField(): JSX.Element {
	const formLoras = useCharactersStore((state) => state.editor?.form.loras ?? NO_LORAS);
	const addFormLora = useCharactersStore((state) => state.addFormLora);
	const removeFormLora = useCharactersStore((state) => state.removeFormLora);
	const setFormLoraWeight = useCharactersStore((state) => state.setFormLoraWeight);
	return (
		<WeightedLorasField
			label="LoRAs"
			listLabel="Character LoRAs"
			hint="Character LoRAs apply first while the character is active; their weight wins over the selected weight."
			items={formLoras}
			onAdd={addFormLora}
			onRemove={removeFormLora}
			onWeight={setFormLoraWeight}
		/>
	);
}
