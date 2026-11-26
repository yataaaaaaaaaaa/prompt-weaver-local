// Read-only details of the gallery's selected character (detail panel of the Characters section; a section named by
// the character): its picture (CharacterPicture) next to its name, an 'Active' badge and the actions: Activate /
// Deactivate (toggleActive; Activate is the primary action, the next step after creating a character, and the focus
// target of the section after a save), Edit (startEdit) and Delete (DeleteCharacterButton); then its values (tags,
// LoRAs with their weights, seed and its lock, reference focus and strength) and its reference images (whether they
// apply with the selected model: the IP-Adapter section right under the details). Changes go through the editor. Thin
// view over the characters store (and the library store for the LoRA names: useLoraName).
import { Body1, Button, Caption1, Image, makeStyles, tokens } from '@fluentui/react-components';
import { EditRegular, PersonAvailableRegular, PersonDeleteRegular } from '@fluentui/react-icons';
import { characterImageUrl } from '../../api/config';
import { REFERENCE_DEFAULTS } from '../../api/defaults.gen';
import type { Character, LoraWeight } from '../../api/types';
import { REFERENCE_FOCUS_LABELS } from '../../domain/characterDrafts';
import { formatWeight, joinPromptTags } from '../../domain/text';
import { selectIsCharacterBusy, useCharactersStore } from '../../stores/charactersStore';
import { useLoraName } from '../../stores/libraryStore';
import { PaneSection } from '../../ui/PaneLayout';
import { ActiveBadge } from './ActiveBadge';
import { CharacterPicture } from './CharacterPicture';
import { DeleteCharacterButton } from './DeleteCharacterButton';
import { FactList, type Fact } from '../../ui/FactList';
import { focusTarget } from './useCharactersSectionFocus';

const useStyles = makeStyles({
	summary: {
		display: 'flex',
		alignItems: 'flex-start',
		gap: tokens.spacingHorizontalM,
		minWidth: 0,
	},
	picture: {
		width: '96px',
		flexShrink: 0,
		borderRadius: tokens.borderRadiusMedium,
	},
	summaryText: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'flex-start',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
	group: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		minWidth: 0,
	},
	references: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, 56px)',
		gap: tokens.spacingHorizontalS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	reference: {
		display: 'block',
		width: '56px',
		aspectRatio: '3 / 4',
		borderRadius: tokens.borderRadiusSmall,
		backgroundColor: tokens.colorNeutralBackground3,
	},
	lineList: {
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
});

/** The tags as one line of text ('None' without any). */
function tagsText(tags: readonly string[]): string {
	return joinPromptTags(tags) || 'None';
}

function CharacterLora({ item }: { item: LoraWeight }): JSX.Element {
	// A LoRA no longer in the library shows its id.
	const name = useLoraName(item.id);
	return (
		<li>
			{name} · {formatWeight(item.weight)}
		</li>
	);
}

function CharacterLoras({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	if (character.loras.length === 0) {
		return <>None</>;
	}
	return (
		<ul className={styles.lineList} aria-label={`LoRAs of ${character.name}`}>
			{character.loras.map((item) => (
				<CharacterLora key={item.id} item={item} />
			))}
		</ul>
	);
}

function seedText(character: Character): string {
	if (character.seed === null) {
		return 'None';
	}
	return character.seed_locked ? `${character.seed} (locked)` : String(character.seed);
}

function ReferenceImages({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	const images = character.reference_images;
	return (
		<div className={styles.group}>
			<Body1>Reference images</Body1>
			{images.length > 0 ? (
				<>
					<ul className={styles.references} aria-label={`Reference images of ${character.name}`}>
						{images.map((image, index) => (
							<li key={image.id}>
								<Image
									className={styles.reference}
									src={characterImageUrl(character.id, image.id)}
									alt={`Reference image ${index + 1}`}
									fit="cover"
									loading="lazy"
								/>
							</li>
						))}
					</ul>
					<Caption1 className={styles.muted}>
						{images.length} of {REFERENCE_DEFAULTS.max_images} images
					</Caption1>
				</>
			) : (
				<Caption1 className={styles.muted}>None yet: Edit adds some (the current output or image files) for a stronger likeness.</Caption1>
			)}
		</div>
	);
}

export function CharacterDetails({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	const active = useCharactersStore((state) => state.activeId === character.id);
	const busy = useCharactersStore(selectIsCharacterBusy(character.id));
	const toggleActive = useCharactersStore((state) => state.toggleActive);
	const startEdit = useCharactersStore((state) => state.startEdit);
	const facts: Fact[] = [
		{ term: 'Identity tags', value: tagsText(character.identity_tags) },
		{ term: 'Outfit tags', value: tagsText(character.outfit_tags) },
		{ term: 'Negative tags', value: tagsText(character.negative_tags) },
		{ term: 'LoRAs', value: <CharacterLoras character={character} /> },
		{ term: 'Seed', value: seedText(character) },
		{ term: 'Reference focus', value: REFERENCE_FOCUS_LABELS[character.reference_focus].label },
		{ term: 'Reference strength', value: formatWeight(character.reference_strength) },
	];

	return (
		<PaneSection
			level={2}
			title={character.name}
			actions={active ? <ActiveBadge /> : null}
		>
			<div className={styles.summary}>
				<CharacterPicture character={character} className={styles.picture} />
				<div className={styles.summaryText}>
					<Caption1 className={styles.muted}>
						{active
							? 'Active: its tags, LoRAs, seed and reference images apply to every generation.'
							: 'Activate it to apply its tags, LoRAs, seed and reference images to the next generations.'}
					</Caption1>
					<div className={styles.actions} role="group" aria-label={`Actions of ${character.name}`}>
						<Button
							appearance={active ? 'secondary' : 'primary'}
							icon={active ? <PersonDeleteRegular /> : <PersonAvailableRegular />}
							// Still focusable while it saves: the focus stays on it (it then reads Deactivate / Activate).
							disabledFocusable={busy}
							onClick={() => void toggleActive(character.id)}
							{...focusTarget('details')}
						>
							{active ? 'Deactivate' : 'Activate'}
						</Button>
						<Button icon={<EditRegular />} disabled={busy} onClick={() => startEdit(character.id)}>
							Edit
						</Button>
						<DeleteCharacterButton character={character} />
					</div>
				</div>
			</div>
			<FactList label={`Values of ${character.name}`} facts={facts} size="small" />
			<ReferenceImages character={character} />
		</PaneSection>
	);
}
