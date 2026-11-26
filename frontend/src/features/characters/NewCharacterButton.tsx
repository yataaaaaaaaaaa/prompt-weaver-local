// THE 'New character' button (Characters toolbar, empty gallery, Character section of the generation panel): opens
// the editor on a new character (startCreate), in the Characters section.
import { Button, type ButtonProps } from '@fluentui/react-components';
import { PersonAddRegular } from '@fluentui/react-icons';
import { useCharactersStore } from '../../stores/charactersStore';
import { focusTarget, type CharacterFocusTarget } from './useCharactersSectionFocus';

export type NewCharacterButtonProps = {
	appearance?: ButtonProps['appearance'];
	className?: string;
	/** Marks the button as a focus target of the Characters section (useCharactersSectionFocus). */
	focus?: CharacterFocusTarget;
};

export function NewCharacterButton({ appearance, className, focus }: NewCharacterButtonProps): JSX.Element {
	const startCreate = useCharactersStore((state) => state.startCreate);
	return (
		<Button
			appearance={appearance}
			className={className}
			icon={<PersonAddRegular />}
			onClick={() => startCreate()}
			{...(focus ? focusTarget(focus) : {})}
		>
			New character
		</Button>
	);
}
