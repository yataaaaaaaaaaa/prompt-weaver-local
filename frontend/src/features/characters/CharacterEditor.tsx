// Character editor (characters store `editor`): name, identity / outfit / negative tags (comma-separated; the outfit
// is kept separate from the identity), LoRAs with weights, seed with its lock, reference focus with its support for
// the selected model, reference strength and reference images; Save (primary intent; disabled while the form has
// errors or saves) and Cancel, in an action bar that stays visible at the bottom of the pane while the form scrolls.
// When the editor closes with the focus inside, the focus returns to what opened it (the openers are Fluent restore
// focus targets: New character, Edit). Every field is bound to the store form (updateForm); validation messages come
// from useCharacterFormErrors. The name field takes the focus when the editor opens.
import {
	Button,
	Field,
	Input,
	makeStyles,
	mergeClasses,
	MessageBar,
	MessageBarBody,
	MessageBarTitle,
	Radio,
	RadioGroup,
	Spinner,
	Switch,
	Textarea,
	tokens,
	useRestoreFocusSource,
} from '@fluentui/react-components';
import { DismissRegular, SaveRegular } from '@fluentui/react-icons';
import { useEffect, useRef } from 'react';
import { REFERENCE_DEFAULTS } from '../../api/defaults.gen';
import type { ReferenceFocus } from '../../api/types';
import { REFERENCE_FOCUS_LABELS, type CharacterForm } from '../../domain/characterDrafts';
import { selectCharacter, useCharacterFormErrors, useCharactersStore } from '../../stores/charactersStore';
import { PaneSection } from '../../ui/PaneLayout';
import { useActionClasses } from '../../ui/stateStyles';
import { CharacterLorasField } from './CharacterLorasField';
import { CharacterReferenceImages } from './CharacterReferenceImages';
import { ReferenceStrengthField } from './ReferenceStrengthField';
import { ReferenceSupportHint } from './ReferenceSupportHint';

/** The focuses, in REFERENCE_FOCUS_LABELS order (exhaustive record of ReferenceFocus). */
const REFERENCE_FOCUSES = Object.keys(REFERENCE_FOCUS_LABELS) as ReferenceFocus[];

type TagsTextField = 'identityText' | 'outfitText' | 'negativeText';

const TAG_FIELDS: ReadonlyArray<{ field: TagsTextField; label: string; hint: string }> = [
	{
		field: 'identityText',
		label: 'Identity tags',
		hint: 'Comma-separated appearance tags (face, hair, eyes, body). While the character is active, they are the locked prompt of its pinned Character category.',
	},
	{
		field: 'outfitText',
		label: 'Outfit tags',
		hint: 'Comma-separated, kept separate from the identity: its own pinned Character outfit category.',
	},
	{
		field: 'negativeText',
		label: 'Negative tags',
		hint: 'Comma-separated; appended to the negative prompt while the character is active.',
	},
];

const useStyles = makeStyles({
	// No box of its own: the section keeps its place in the pane's layout.
	root: {
		display: 'contents',
	},
	// Sticks to the bottom of the pane's scrolling body while the editor is taller than the pane.
	actions: {
		position: 'sticky',
		bottom: 0,
		zIndex: 1,
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		backgroundColor: tokens.colorNeutralBackground1,
		borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
	// The fields keep the section's layout (no box of their own). A control focused or scrolled into view stops above
	// the sticky actions instead of under them: about their height (a button and its padding) plus a gap.
	fields: {
		display: 'contents',
		'& *': {
			scrollMarginBottom: `calc(2 * ${tokens.spacingVerticalXXXL})`,
		},
	},
});

function NameField(): JSX.Element {
	const name = useCharactersStore((state) => state.editor?.form.name ?? '');
	const error = useCharacterFormErrors().name;
	const updateForm = useCharactersStore((state) => state.updateForm);
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		inputRef.current?.focus();
	}, []);
	return (
		<Field label="Name" required validationState={error ? 'error' : 'none'} validationMessage={error}>
			<Input ref={inputRef} value={name} onChange={(_event, data) => updateForm({ name: data.value })} />
		</Field>
	);
}

function TagsField({ field, label, hint }: { field: TagsTextField; label: string; hint: string }): JSX.Element {
	const value = useCharactersStore((state) => state.editor?.form[field] ?? '');
	const updateForm = useCharactersStore((state) => state.updateForm);
	return (
		<Field label={label} hint={hint}>
			<Textarea
				value={value}
				resize="vertical"
				onChange={(_event, data) => {
					const patch: Partial<CharacterForm> = {};
					patch[field] = data.value;
					updateForm(patch);
				}}
			/>
		</Field>
	);
}

/** The seed, then its lock (a Switch never goes inside the seed's Field: Fluent controls take the id and label of the
 *  Field they are in). */
function SeedFields(): JSX.Element {
	const seedText = useCharactersStore((state) => state.editor?.form.seedText ?? '');
	const seedLocked = useCharactersStore((state) => state.editor?.form.seedLocked ?? false);
	const error = useCharacterFormErrors().seed;
	const updateForm = useCharactersStore((state) => state.updateForm);
	return (
		<>
			<Field
				label="Seed"
				hint="Locked, it replaces the image seed while the character is active (the seed field is left unchanged)."
				validationState={error ? 'error' : 'none'}
				validationMessage={error}
			>
				<Input value={seedText} inputMode="numeric" placeholder="None" onChange={(_event, data) => updateForm({ seedText: data.value })} />
			</Field>
			<Switch label="Lock seed" checked={seedLocked} onChange={(_event, data) => updateForm({ seedLocked: data.checked })} />
		</>
	);
}

function FocusField(): JSX.Element {
	const focus = useCharactersStore((state) => state.editor?.form.referenceFocus ?? REFERENCE_DEFAULTS.focus);
	const updateForm = useCharactersStore((state) => state.updateForm);
	return (
		<>
			<Field label="Reference focus" hint={REFERENCE_FOCUS_LABELS[focus].description}>
				<RadioGroup
					layout="horizontal"
					value={focus}
					onChange={(_event, data) => {
						const next = REFERENCE_FOCUSES.find((item) => item === data.value);
						if (next) {
							updateForm({ referenceFocus: next });
						}
					}}
				>
					{REFERENCE_FOCUSES.map((item) => (
						<Radio key={item} value={item} label={REFERENCE_FOCUS_LABELS[item].label} />
					))}
				</RadioGroup>
			</Field>
			<ReferenceSupportHint focus={focus} />
		</>
	);
}

function StrengthField(): JSX.Element {
	const strength = useCharactersStore((state) => state.editor?.form.referenceStrength ?? REFERENCE_DEFAULTS.strength);
	const updateForm = useCharactersStore((state) => state.updateForm);
	return <ReferenceStrengthField value={strength} onCommit={(referenceStrength) => updateForm({ referenceStrength })} />;
}

function EditorActions(): JSX.Element {
	const styles = useStyles();
	const intents = useActionClasses();
	const saving = useCharactersStore((state) => state.editor?.saving ?? false);
	const error = useCharactersStore((state) => state.editor?.error ?? null);
	const hasErrors = Object.keys(useCharacterFormErrors()).length > 0;
	const saveDisabled = saving || hasErrors;
	const saveEditor = useCharactersStore((state) => state.saveEditor);
	const cancelEdit = useCharactersStore((state) => state.cancelEdit);
	return (
		<>
			{error ? (
				<MessageBar intent="error" layout="multiline">
					<MessageBarBody>
						<MessageBarTitle>Could not save the character</MessageBarTitle>
						{error}
					</MessageBarBody>
				</MessageBar>
			) : null}
			<div className={styles.actions} role="group" aria-label="Character editor actions">
				<Button
					appearance="primary"
					className={intents.filled.primary}
					icon={saving ? <Spinner size="tiny" /> : <SaveRegular />}
					disabled={saveDisabled}
					// Saving: still focusable, so the focus stays in the editor until it closes (then returns to its opener).
					disabledFocusable={saving}
					onClick={() => void saveEditor()}
				>
					Save
				</Button>
				<Button icon={<DismissRegular />} disabled={saving} onClick={() => cancelEdit()}>
					Cancel
				</Button>
			</div>
		</>
	);
}

export function CharacterEditor(): JSX.Element {
	const styles = useStyles();
	const restoreFocusSource = useRestoreFocusSource();
	const characterId = useCharactersStore((state) => state.editor?.characterId ?? null);
	const savedName = useCharactersStore((state) => selectCharacter(characterId)(state)?.name ?? null);
	return (
		<div className={styles.root} {...restoreFocusSource}>
			<PaneSection title={characterId === null ? 'New character' : `Edit ${savedName ?? 'character'}`}>
				<div className={styles.fields}>
					<NameField />
					{TAG_FIELDS.map((item) => (
						<TagsField key={item.field} {...item} />
					))}
					<CharacterLorasField />
					<SeedFields />
					<FocusField />
					<StrengthField />
					<CharacterReferenceImages />
				</div>
				<EditorActions />
			</PaneSection>
		</div>
	);
}
