// Delete of a character (gallery card, character details): a subtle icon button in the danger color, named and with
// a tooltip, that asks for a confirmation (ConfirmDialog) before calling remove. Disabled while a request runs for
// the character (busyIds). The focus returns to the button when the confirmation closes (a Fluent restore focus
// target: the dialog is controlled, without DialogTrigger). Local (ephemeral) state: the confirmation dialog.
import { Button, Tooltip, useRestoreFocusTarget } from '@fluentui/react-components';
import { DeleteRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { Character } from '../../api/types';
import { selectIsCharacterBusy, useCharactersStore } from '../../stores/charactersStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useActionClasses } from '../../ui/stateStyles';

export function DeleteCharacterButton({ character }: { character: Pick<Character, 'id' | 'name'> }): JSX.Element {
	const actions = useActionClasses();
	const busy = useCharactersStore(selectIsCharacterBusy(character.id));
	const remove = useCharactersStore((state) => state.remove);
	const [confirming, setConfirming] = useState(false);
	const restoreFocusTarget = useRestoreFocusTarget();
	const label = `Delete ${character.name}`;
	return (
		<>
			<Tooltip content={label} relationship="label">
				<Button
					appearance="subtle"
					size="small"
					className={actions.subtle.danger}
					icon={<DeleteRegular />}
					aria-label={label}
					disabled={busy}
					onClick={() => setConfirming(true)}
					{...restoreFocusTarget}
				/>
			</Tooltip>
			<ConfirmDialog
				open={confirming}
				title={`Delete character '${character.name}'?`}
				confirmLabel="Delete"
				onConfirm={() => {
					setConfirming(false);
					void remove(character.id);
				}}
				onDismiss={() => setConfirming(false)}
			>
				Its reference images and thumbnail are deleted too. Outputs generated with it are kept.
			</ConfirmDialog>
		</>
	);
}
