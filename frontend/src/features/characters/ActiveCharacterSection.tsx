// The character active for generation, in the generation panel of the Create section (a section titled 'Character';
// readable from 300 px wide). Thin view over the characters store (selectActiveCharacter):
// - active: its thumbnail (Avatar) and name, its identity tags (at most 3 lines) and its locked seed
//   (lockedCharacterSeed, with a lock icon); Deactivate (toggleActive) and Edit (startEdit: the editor opens in the
//   Characters section; Cancel comes back here); with reference images, the strength (setReferenceStrength) and the
//   reference support of its focus for the selected model; without, how to add some;
// - none: a Dropdown of the characters to activate (setActive) and New character.
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
	Tooltip,
} from '@fluentui/react-components';
import { EditRegular, LockClosedRegular, PersonDeleteRegular } from '@fluentui/react-icons';
import { characterImageUrl } from '../../api/config';
import type { Character } from '../../api/types';
import { lockedCharacterSeed } from '../../domain/characters';
import { joinPromptTags } from '../../domain/text';
import { selectActiveCharacter, selectIsCharacterBusy, useCharactersStore, useSortedCharacters } from '../../stores/charactersStore';
import { PaneSection } from '../../ui/PaneLayout';
import { NewCharacterButton } from './NewCharacterButton';
import { ReferenceStrengthField } from './ReferenceStrengthField';
import { ReferenceSupportHint } from './ReferenceSupportHint';

/** Lines of identity tags the section shows. */
const TAG_LINES = 3;

const useStyles = makeStyles({
	identity: {
		display: 'flex',
		alignItems: 'flex-start',
		gap: tokens.spacingHorizontalM,
		minWidth: 0,
	},
	text: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
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
	tags: {
		display: '-webkit-box',
		WebkitBoxOrient: 'vertical',
		WebkitLineClamp: TAG_LINES,
		overflow: 'hidden',
	},
	seed: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXXS,
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
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
	const startEdit = useCharactersStore((state) => state.startEdit);
	const setReferenceStrength = useCharactersStore((state) => state.setReferenceStrength);
	const tags = joinPromptTags(character.identity_tags);
	const lockedSeed = lockedCharacterSeed(character);
	const editLabel = `Edit ${character.name}`;
	return (
		<>
			<div className={styles.identity}>
				<Avatar
					shape="square"
					size={48}
					name={character.name}
					image={character.thumbnail ? { src: characterImageUrl(character.id, character.thumbnail.id) } : undefined}
				/>
				<div className={styles.text}>
					<Body1Strong className={styles.wrap}>{character.name}</Body1Strong>
					<Caption1 className={mergeClasses(styles.muted, styles.tags)}>{tags || 'No identity tags'}</Caption1>
					{lockedSeed !== null ? (
						<Caption1 className={mergeClasses(styles.muted, styles.seed)}>
							<LockClosedRegular aria-hidden />
							Seed locked to {lockedSeed}
						</Caption1>
					) : null}
				</div>
			</div>
			<div className={styles.actions}>
				<Button icon={<PersonDeleteRegular />} disabled={busy} onClick={() => void toggleActive(character.id)}>
					Deactivate
				</Button>
				<Tooltip content={editLabel} relationship="label">
					<Button appearance="subtle" icon={<EditRegular />} aria-label={editLabel} disabled={busy} onClick={() => startEdit(character.id)} />
				</Tooltip>
			</div>
			{character.reference_images.length > 0 ? (
				<>
					<ReferenceStrengthField value={character.reference_strength} onCommit={(strength) => setReferenceStrength(character.id, strength)} />
					<ReferenceSupportHint focus={character.reference_focus} />
				</>
			) : (
				<Caption1 className={styles.muted}>No reference images: add some with Edit for a stronger likeness.</Caption1>
			)}
		</>
	);
}

function CharacterPicker(): JSX.Element {
	const styles = useStyles();
	const characters = useSortedCharacters();
	const setActive = useCharactersStore((state) => state.setActive);
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
				<NewCharacterButton />
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
