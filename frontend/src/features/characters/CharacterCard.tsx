// One character of the gallery (Fluent Card): thumbnail (a placeholder without one), name, identity tags (at most
// three lines; the full text stays readable by assistive technology and in the editor), the one-click Active switch
// (toggleActive), Edit (startEdit) and Delete (danger intent) after a confirmation (remove). The footer sits at the
// bottom of the card, so the cards of a gallery row line up whatever the length of their tags, and holds the switch
// and the (small) icon buttons on one line down to the narrowest gallery column. Its controls are disabled while a
// request runs for the character (busyIds); the focus returns to Delete when the confirmation closes, to Edit when the
// editor it opened closes. Local (ephemeral) state: the confirmation dialog.
import {
	Body1Strong,
	Button,
	Caption1,
	Card,
	CardFooter,
	CardHeader,
	CardPreview,
	Image,
	makeStyles,
	mergeClasses,
	Switch,
	tokens,
	Tooltip,
	useId,
	useRestoreFocusTarget,
} from '@fluentui/react-components';
import { DeleteRegular, EditRegular, PersonRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { characterImageUrl } from '../../api/config';
import type { Character } from '../../api/types';
import { joinPromptTags } from '../../domain/text';
import { selectIsCharacterBusy, useCharactersStore } from '../../stores/charactersStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useActionClasses } from '../../ui/stateStyles';

/** Lines of identity tags a card shows. */
const TAG_LINES = 3;

const useStyles = makeStyles({
	card: {
		height: '100%',
		minWidth: 0,
	},
	active: {
		outlineWidth: tokens.strokeWidthThick,
		outlineStyle: 'solid',
		outlineColor: tokens.colorBrandStroke1,
	},
	// CardPreview forces `display: block; width: 100%; height: auto` on its children: the frame keeps the 3:4 ratio
	// through aspect-ratio and positions its content itself.
	frame: {
		position: 'relative',
		aspectRatio: '3 / 4',
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground3,
	},
	fill: {
		position: 'absolute',
		top: 0,
		right: 0,
		bottom: 0,
		left: 0,
		width: '100%',
		height: '100%',
	},
	image: {
		objectPosition: 'top',
	},
	placeholder: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		color: tokens.colorNeutralForeground3,
		fontSize: tokens.fontSizeHero1000,
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

function CardThumbnail({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	return (
		<div className={styles.frame}>
			{character.thumbnail ? (
				<Image
					className={mergeClasses(styles.fill, styles.image)}
					src={characterImageUrl(character.id, character.thumbnail.id)}
					alt={`Thumbnail of ${character.name}`}
					fit="cover"
					loading="lazy"
				/>
			) : (
				<div className={mergeClasses(styles.fill, styles.placeholder)} role="img" aria-label={`No thumbnail for ${character.name}`}>
					<PersonRegular aria-hidden />
				</div>
			)}
		</div>
	);
}

export function CharacterCard({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	const actions = useActionClasses();
	const nameId = useId('character-name-');
	const active = useCharactersStore((state) => state.activeId === character.id);
	const busy = useCharactersStore(selectIsCharacterBusy(character.id));
	const toggleActive = useCharactersStore((state) => state.toggleActive);
	const startEdit = useCharactersStore((state) => state.startEdit);
	const remove = useCharactersStore((state) => state.remove);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	// The focus returns to Delete when the confirmation (a controlled dialog: no DialogTrigger) closes, and to Edit when
	// the editor closes.
	const restoreFocusTarget = useRestoreFocusTarget();
	const editLabel = `Edit ${character.name}`;
	const deleteLabel = `Delete ${character.name}`;
	const tags = joinPromptTags(character.identity_tags);

	return (
		<Card className={mergeClasses(styles.card, active && styles.active)} aria-labelledby={nameId}>
			<CardPreview>
				<CardThumbnail character={character} />
			</CardPreview>
			<CardHeader
				header={
					<Body1Strong id={nameId} className={styles.name}>
						{character.name}
					</Body1Strong>
				}
				description={<Caption1 className={styles.tags}>{tags || 'No identity tags'}</Caption1>}
			/>
			<CardFooter className={styles.footer}>
				<Switch label={{ children: 'Active', className: styles.switchLabel }} checked={active} disabled={busy} onChange={() => void toggleActive(character.id)} />
				<div className={styles.buttons}>
					<Tooltip content={editLabel} relationship="label">
						<Button
							appearance="subtle"
							size="small"
							icon={<EditRegular />}
							aria-label={editLabel}
							disabled={busy}
							onClick={() => startEdit(character.id)}
							{...restoreFocusTarget}
						/>
					</Tooltip>
					<Tooltip content={deleteLabel} relationship="label">
						<Button
							appearance="subtle"
							size="small"
							className={actions.subtle.danger}
							icon={<DeleteRegular />}
							aria-label={deleteLabel}
							disabled={busy}
							onClick={() => setConfirmingDelete(true)}
							{...restoreFocusTarget}
						/>
					</Tooltip>
				</div>
			</CardFooter>
			<ConfirmDialog
				open={confirmingDelete}
				title={`Delete character '${character.name}'?`}
				confirmLabel="Delete"
				onConfirm={() => {
					setConfirmingDelete(false);
					void remove(character.id);
				}}
				onDismiss={() => setConfirmingDelete(false)}
			>
				Its reference images and thumbnail are deleted too. Outputs generated with it are kept.
			</ConfirmDialog>
		</Card>
	);
}
