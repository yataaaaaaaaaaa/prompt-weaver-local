// The character active for generation, in the controls (characters store selectActiveCharacter). Active: thumbnail
// and name, its identity tags and locked seed (lockedCharacterSeed, with a lock icon), Deactivate (toggleActive), and,
// when it has reference images, the strength (setReferenceStrength) with the reference support of its focus for the
// selected model. None: a Dropdown of the characters to activate (setActive) and New character (startCreate, the
// focus returns to it when the editor closes).
import {
	Avatar,
	Body1Strong,
	Button,
	Caption1,
	Dropdown,
	Field,
	makeStyles,
	mergeClasses,
	Option,
	tokens,
	useRestoreFocusTarget,
} from '@fluentui/react-components';
import { LockClosedRegular, PersonAddRegular, PersonDeleteRegular } from '@fluentui/react-icons';
import { characterImageUrl } from '../../api/config';
import type { Character } from '../../api/types';
import { lockedCharacterSeed } from '../../domain/characters';
import { joinPromptTags } from '../../domain/text';
import { selectActiveCharacter, selectIsCharacterBusy, useCharactersStore, useSortedCharacters } from '../../stores/charactersStore';
import { PaneSection } from '../../ui/PaneLayout';
import { ReferenceStrengthField } from './ReferenceStrengthField';
import { ReferenceSupportHint } from './ReferenceSupportHint';

const useStyles = makeStyles({
	identity: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalM,
		minWidth: 0,
	},
	text: {
		display: 'flex',
		flexDirection: 'column',
		flex: '1 1 auto',
		minWidth: 0,
	},
	wrap: {
		overflowWrap: 'anywhere',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
	seed: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXXS,
	},
	picker: {
		display: 'flex',
		alignItems: 'flex-end',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	pickerField: {
		flex: '1 1 160px',
		minWidth: 0,
	},
	dropdown: {
		minWidth: 0,
		width: '100%',
	},
});

function ActiveCharacter({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	const busy = useCharactersStore(selectIsCharacterBusy(character.id));
	const toggleActive = useCharactersStore((state) => state.toggleActive);
	const setReferenceStrength = useCharactersStore((state) => state.setReferenceStrength);
	const tags = joinPromptTags(character.identity_tags);
	const lockedSeed = lockedCharacterSeed(character);
	return (
		<>
			<div className={styles.identity}>
				<Avatar
					shape="square"
					size={56}
					name={character.name}
					image={character.thumbnail ? { src: characterImageUrl(character.id, character.thumbnail.id) } : undefined}
				/>
				<div className={styles.text}>
					<Body1Strong className={styles.wrap}>{character.name}</Body1Strong>
					<Caption1 className={styles.muted}>{tags || 'No identity tags'}</Caption1>
					{lockedSeed !== null ? (
						<Caption1 className={mergeClasses(styles.muted, styles.seed)}>
							<LockClosedRegular aria-hidden />
							Seed locked to {lockedSeed}
						</Caption1>
					) : null}
				</div>
				<Button icon={<PersonDeleteRegular />} disabled={busy} onClick={() => void toggleActive(character.id)}>
					Deactivate
				</Button>
			</div>
			{character.reference_images.length > 0 ? (
				<>
					<ReferenceStrengthField value={character.reference_strength} onCommit={(strength) => setReferenceStrength(character.id, strength)} />
					<ReferenceSupportHint focus={character.reference_focus} />
				</>
			) : (
				<Caption1 className={styles.muted}>No reference images: add some in the Characters pane for a stronger likeness.</Caption1>
			)}
		</>
	);
}

function CharacterPicker(): JSX.Element {
	const styles = useStyles();
	const characters = useSortedCharacters();
	const setActive = useCharactersStore((state) => state.setActive);
	const startCreate = useCharactersStore((state) => state.startCreate);
	// The focus comes back here when the editor it opened (in the Characters pane) closes.
	const restoreFocusTarget = useRestoreFocusTarget();
	const empty = characters.length === 0;
	return (
		<>
			<div className={styles.picker}>
				<Field label="Active character" className={styles.pickerField}>
					<Dropdown
						className={styles.dropdown}
						disabled={empty}
						placeholder={empty ? 'No characters yet' : 'None'}
						value=""
						selectedOptions={[]}
						onOptionSelect={(_event, data) => {
							if (data.optionValue) {
								void setActive(data.optionValue);
							}
						}}
					>
						{characters.map((character) => (
							<Option key={character.id} value={character.id}>
								{character.name}
							</Option>
						))}
					</Dropdown>
				</Field>
				<Button icon={<PersonAddRegular />} onClick={() => startCreate()} {...restoreFocusTarget}>
					New character
				</Button>
			</div>
			<Caption1 className={styles.muted}>
				An active character keeps the same person across generations: its tags, LoRAs, seed lock and reference images apply.
			</Caption1>
		</>
	);
}

export function ActiveCharacterSection(): JSX.Element {
	const active = useCharactersStore(selectActiveCharacter);
	return <PaneSection title="Character">{active ? <ActiveCharacter character={active} /> : <CharacterPicker />}</PaneSection>;
}
