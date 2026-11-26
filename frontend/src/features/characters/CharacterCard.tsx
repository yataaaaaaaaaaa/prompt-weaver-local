// One character of the gallery (Fluent Card, a group named by the character's name): its picture (CharacterPicture,
// with an 'Active' badge on the active character), name, identity tags (at most three lines; the full text stays
// readable by assistive technology and in the details), and a footer with the one-click Active switch (toggleActive),
// Edit (startEdit) and Delete (DeleteCharacterButton). Clicking the card selects it (select: the detail panel shows
// it); from the keyboard, the picture is the button that selects it (named by the character, aria-current on the
// selected card). The selected card is framed in the brand color. The footer sits at the bottom of the card, so the
// cards of a gallery row line up whatever the length of their tags, and holds the switch and the (small) icon buttons
// on one line down to the narrowest gallery column. Its controls are disabled while a request runs for the character
// (busyIds).
import {
	Body1Strong,
	Button,
	Caption1,
	Card,
	CardFooter,
	CardHeader,
	createFocusOutlineStyle,
	makeStyles,
	mergeClasses,
	Switch,
	tokens,
	Tooltip,
	useId,
} from '@fluentui/react-components';
import { EditRegular } from '@fluentui/react-icons';
import type { Character } from '../../api/types';
import { joinPromptTags } from '../../domain/text';
import { selectIsCharacterBusy, useCharactersStore } from '../../stores/charactersStore';
import { ActiveBadge } from './ActiveBadge';
import { CharacterPicture } from './CharacterPicture';
import { DeleteCharacterButton } from './DeleteCharacterButton';

/** Lines of identity tags a card shows. */
const TAG_LINES = 3;

const useStyles = makeStyles({
	card: {
		height: '100%',
		minWidth: 0,
	},
	selected: {
		backgroundColor: tokens.colorNeutralBackground1Selected,
		outlineWidth: tokens.strokeWidthThick,
		outlineStyle: 'solid',
		outlineColor: tokens.colorBrandStroke1,
	},
	// The picture bleeds to the card's edges (like a Fluent CardPreview) and is the card's selection button.
	pictureButton: {
		position: 'relative',
		display: 'block',
		marginTop: 'calc(-1 * var(--fui-Card--size))',
		marginLeft: 'calc(-1 * var(--fui-Card--size))',
		marginRight: 'calc(-1 * var(--fui-Card--size))',
		padding: 0,
		border: 'none',
		borderTopLeftRadius: 'var(--fui-Card--border-radius)',
		borderTopRightRadius: 'var(--fui-Card--border-radius)',
		overflow: 'hidden',
		backgroundColor: 'transparent',
		cursor: 'pointer',
		...createFocusOutlineStyle({ style: { outlineOffset: `calc(-1 * ${tokens.strokeWidthThick})` } }),
	},
	activeBadge: {
		position: 'absolute',
		top: tokens.spacingVerticalS,
		left: tokens.spacingHorizontalS,
	},
	name: {
		overflowWrap: 'anywhere',
	},
	tags: {
		display: '-webkit-box',
		WebkitBoxOrient: 'vertical',
		WebkitLineClamp: TAG_LINES,
		overflow: 'hidden',
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
	footer: {
		alignItems: 'center',
		flexWrap: 'wrap',
		columnGap: tokens.spacingHorizontalS,
		marginTop: 'auto',
	},
	// The footer's gap separates the label from the buttons: no trailing padding (one line down to the narrowest
	// gallery column).
	switchLabel: {
		paddingRight: 0,
	},
	buttons: {
		display: 'flex',
		gap: tokens.spacingHorizontalXXS,
		marginLeft: 'auto',
	},
});

export function CharacterCard({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	const nameId = useId('character-name-');
	const tagsId = useId('character-tags-');
	const active = useCharactersStore((state) => state.activeId === character.id);
	const selected = useCharactersStore((state) => state.selectedId === character.id);
	const busy = useCharactersStore(selectIsCharacterBusy(character.id));
	const toggleActive = useCharactersStore((state) => state.toggleActive);
	const startEdit = useCharactersStore((state) => state.startEdit);
	const select = useCharactersStore((state) => state.select);
	const editLabel = `Edit ${character.name}`;
	const tags = joinPromptTags(character.identity_tags);

	return (
		<Card
			className={mergeClasses(styles.card, selected && styles.selected)}
			aria-labelledby={nameId}
			// A click anywhere selects the card (its own controls included); the card itself is not a Tab stop: the
			// picture button is.
			focusMode="off"
			onClick={() => select(character.id)}
		>
			<button
				type="button"
				className={styles.pictureButton}
				aria-labelledby={nameId}
				aria-describedby={tagsId}
				aria-current={selected ? 'true' : undefined}
				onClick={() => select(character.id)}
			>
				<CharacterPicture character={character}>
					{active ? <ActiveBadge className={styles.activeBadge} /> : null}
				</CharacterPicture>
			</button>
			<CardHeader
				header={
					<Body1Strong id={nameId} className={styles.name}>
						{character.name}
					</Body1Strong>
				}
				description={
					<Caption1 id={tagsId} className={styles.tags}>
						{tags || 'No identity tags'}
					</Caption1>
				}
			/>
			<CardFooter className={styles.footer}>
				<Switch label={{ children: 'Active', className: styles.switchLabel }} checked={active} disabled={busy} onChange={() => void toggleActive(character.id)} />
				<div className={styles.buttons}>
					<Tooltip content={editLabel} relationship="label">
						<Button appearance="subtle" size="small" icon={<EditRegular />} aria-label={editLabel} disabled={busy} onClick={() => startEdit(character.id)} />
					</Tooltip>
					<DeleteCharacterButton character={character} />
				</div>
			</CardFooter>
		</Card>
	);
}
