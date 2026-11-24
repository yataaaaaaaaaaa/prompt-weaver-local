// One character of the gallery (Fluent Card): thumbnail (a placeholder without one), name, identity tags, the one-click
// Active switch (toggleActive), Edit (startEdit) and Delete after a confirmation (remove). Its controls are disabled
// while a request runs for the character (busyIds). Local (ephemeral) state: the confirmation dialog.
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
} from '@fluentui/react-components';
import { DeleteRegular, EditRegular, PersonRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { characterImageUrl } from '../../api/config';
import type { Character } from '../../api/types';
import { joinPromptTags } from '../../domain/text';
import { selectIsCharacterBusy, useCharactersStore } from '../../stores/charactersStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';

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
	preview: {
		aspectRatio: '3 / 4',
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground3,
	},
	image: {
		width: '100%',
		height: '100%',
		objectPosition: 'top',
	},
	placeholder: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		height: '100%',
		color: tokens.colorNeutralForeground4,
		fontSize: tokens.fontSizeHero800,
	},
	name: {
		overflowWrap: 'anywhere',
	},
	tags: {
		color: tokens.colorNeutralForeground3,
		overflowWrap: 'anywhere',
	},
	footer: {
		alignItems: 'center',
		flexWrap: 'wrap',
	},
	buttons: {
		display: 'flex',
		gap: tokens.spacingHorizontalXXS,
		marginLeft: 'auto',
	},
});

function CardThumbnail({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	return character.thumbnail ? (
		<Image
			className={styles.image}
			src={characterImageUrl(character.id, character.thumbnail.id)}
			alt={`Thumbnail of ${character.name}`}
			fit="cover"
			loading="lazy"
		/>
	) : (
		<div className={styles.placeholder}>
			<PersonRegular aria-hidden />
		</div>
	);
}

export function CharacterCard({ character }: { character: Character }): JSX.Element {
	const styles = useStyles();
	const nameId = useId('character-name-');
	const active = useCharactersStore((state) => state.activeId === character.id);
	const busy = useCharactersStore(selectIsCharacterBusy(character.id));
	const toggleActive = useCharactersStore((state) => state.toggleActive);
	const startEdit = useCharactersStore((state) => state.startEdit);
	const remove = useCharactersStore((state) => state.remove);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const editLabel = `Edit ${character.name}`;
	const deleteLabel = `Delete ${character.name}`;

	return (
		<Card className={mergeClasses(styles.card, active && styles.active)} aria-labelledby={nameId}>
			<CardPreview className={styles.preview}>
				<CardThumbnail character={character} />
			</CardPreview>
			<CardHeader
				header={
					<Body1Strong id={nameId} className={styles.name}>
						{character.name}
					</Body1Strong>
				}
				description={<Caption1 className={styles.tags}>{joinPromptTags(character.identity_tags) || 'No identity tags'}</Caption1>}
			/>
			<CardFooter className={styles.footer}>
				<Switch label="Active" checked={active} disabled={busy} onChange={() => void toggleActive(character.id)} />
				<div className={styles.buttons}>
					<Tooltip content={editLabel} relationship="label">
						<Button appearance="subtle" icon={<EditRegular />} aria-label={editLabel} disabled={busy} onClick={() => startEdit(character.id)} />
					</Tooltip>
					<Tooltip content={deleteLabel} relationship="label">
						<Button
							appearance="subtle"
							icon={<DeleteRegular />}
							aria-label={deleteLabel}
							disabled={busy}
							onClick={() => setConfirmingDelete(true)}
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
