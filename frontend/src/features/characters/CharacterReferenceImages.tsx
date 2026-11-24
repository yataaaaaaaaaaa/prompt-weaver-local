// Reference images of the character in the editor. A saved character: its images (characterImageUrl) with "Use as
// thumbnail" (setThumbnailFromReference) and Remove (removeReference), plus "Add current output"
// (addReferenceFromCurrentOutput) and "Add image file" (addReferenceFromFile) up to REFERENCE_DEFAULTS.max_images;
// disabled while a request runs for it. A new character: the images it will import when saved (editor
// pendingSources: imageSourcePreviewUrl previews, a file icon without one) with Remove (removePendingSource).
import {
	Body1,
	Body1Strong,
	Button,
	Caption1,
	Image,
	makeStyles,
	tokens,
	Tooltip,
	useId,
} from '@fluentui/react-components';
import { DeleteRegular, DocumentAddRegular, DocumentRegular, ImageAddRegular, ImageRegular } from '@fluentui/react-icons';
import { characterImageUrl } from '../../api/config';
import { REFERENCE_DEFAULTS } from '../../api/defaults.gen';
import type { CharacterImageSource } from '../../api/types';
import { imageSourcePreviewUrl } from '../../domain/characterDrafts';
import { basename } from '../../domain/paths';
import { selectCharacter, selectIsCharacterBusy, useCharactersStore } from '../../stores/charactersStore';
import { useOutputsStore } from '../../stores/outputsStore';

const NO_SOURCES: CharacterImageSource[] = [];

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	grid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
		gap: tokens.spacingHorizontalS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	tile: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		minWidth: 0,
	},
	preview: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		justifyContent: 'center',
		gap: tokens.spacingVerticalXXS,
		aspectRatio: '3 / 4',
		overflow: 'hidden',
		borderRadius: tokens.borderRadiusMedium,
		backgroundColor: tokens.colorNeutralBackground3,
		color: tokens.colorNeutralForeground3,
	},
	image: {
		width: '100%',
		height: '100%',
		objectPosition: 'top',
	},
	fileIcon: {
		fontSize: tokens.fontSizeHero700,
	},
	fileName: {
		maxWidth: '100%',
		paddingLeft: tokens.spacingHorizontalXS,
		paddingRight: tokens.spacingHorizontalXS,
		boxSizing: 'border-box',
		overflowWrap: 'anywhere',
		textAlign: 'center',
	},
	tileActions: {
		display: 'flex',
		justifyContent: 'flex-end',
		gap: tokens.spacingHorizontalXXS,
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

function SavedReferenceImages({ characterId }: { characterId: string }): JSX.Element | null {
	const styles = useStyles();
	const character = useCharactersStore(selectCharacter(characterId));
	const busy = useCharactersStore(selectIsCharacterBusy(characterId));
	const hasOutput = useOutputsStore((state) => state.currentId !== null);
	const addReferenceFromCurrentOutput = useCharactersStore((state) => state.addReferenceFromCurrentOutput);
	const addReferenceFromFile = useCharactersStore((state) => state.addReferenceFromFile);
	const removeReference = useCharactersStore((state) => state.removeReference);
	const setThumbnailFromReference = useCharactersStore((state) => state.setThumbnailFromReference);
	if (!character) {
		return null;
	}
	const images = character.reference_images;
	const full = images.length >= REFERENCE_DEFAULTS.max_images;

	return (
		<>
			{images.length > 0 ? (
				<ul className={styles.grid} aria-label="Saved reference images">
					{images.map((image, index) => {
						const name = `Reference image ${index + 1}`;
						return (
							<li key={image.id} className={styles.tile}>
								<div className={styles.preview}>
									<Image className={styles.image} src={characterImageUrl(characterId, image.id)} alt={name} fit="cover" loading="lazy" />
								</div>
								<div className={styles.tileActions}>
									<Tooltip content={`Use ${name.toLowerCase()} as thumbnail`} relationship="label">
										<Button
											appearance="subtle"
											size="small"
											icon={<ImageRegular />}
											aria-label={`Use ${name.toLowerCase()} as thumbnail`}
											disabled={busy}
											onClick={() => void setThumbnailFromReference(characterId, image.id)}
										/>
									</Tooltip>
									<Tooltip content={`Remove ${name.toLowerCase()}`} relationship="label">
										<Button
											appearance="subtle"
											size="small"
											icon={<DeleteRegular />}
											aria-label={`Remove ${name.toLowerCase()}`}
											disabled={busy}
											onClick={() => void removeReference(characterId, image.id)}
										/>
									</Tooltip>
								</div>
							</li>
						);
					})}
				</ul>
			) : (
				<Body1 className={styles.muted}>No reference images yet.</Body1>
			)}
			<div className={styles.actions}>
				<Button icon={<ImageAddRegular />} disabled={busy || full || !hasOutput} onClick={() => void addReferenceFromCurrentOutput(characterId)}>
					Add current output
				</Button>
				<Button icon={<DocumentAddRegular />} disabled={busy || full} onClick={() => void addReferenceFromFile(characterId)}>
					Add image file
				</Button>
				<Caption1 className={styles.muted}>
					{images.length} of {REFERENCE_DEFAULTS.max_images} images
				</Caption1>
			</div>
		</>
	);
}

function PendingPreview({ source, name }: { source: CharacterImageSource; name: string }): JSX.Element {
	const styles = useStyles();
	const url = imageSourcePreviewUrl(source);
	return (
		<div className={styles.preview}>
			{url ? (
				<Image className={styles.image} src={url} alt={name} fit="cover" />
			) : (
				<>
					<DocumentRegular className={styles.fileIcon} aria-hidden />
					<Caption1 className={styles.fileName}>{source.kind === 'file' ? basename(source.path) : name}</Caption1>
				</>
			)}
		</div>
	);
}

function PendingReferenceImages(): JSX.Element {
	const styles = useStyles();
	const sources = useCharactersStore((state) => state.editor?.pendingSources ?? NO_SOURCES);
	const removePendingSource = useCharactersStore((state) => state.removePendingSource);
	if (sources.length === 0) {
		return <Body1 className={styles.muted}>Save the character, then add reference images from the current output or from image files.</Body1>;
	}
	return (
		<>
			<ul className={styles.grid} aria-label="Pending reference images">
				{sources.map((source, index) => {
					const name = `Reference image ${index + 1}`;
					return (
						// Pending sources have no id; their order is their identity until saved.
						<li key={index} className={styles.tile}>
							<PendingPreview source={source} name={name} />
							<div className={styles.tileActions}>
								<Tooltip content={`Remove ${name.toLowerCase()}`} relationship="label">
									<Button
										appearance="subtle"
										size="small"
										icon={<DeleteRegular />}
										aria-label={`Remove ${name.toLowerCase()}`}
										onClick={() => removePendingSource(index)}
									/>
								</Tooltip>
							</div>
						</li>
					);
				})}
			</ul>
			<Caption1 className={styles.muted}>Imported when the character is saved; the first one becomes its thumbnail.</Caption1>
		</>
	);
}

export function CharacterReferenceImages(): JSX.Element {
	const styles = useStyles();
	const headingId = useId('character-references-');
	const characterId = useCharactersStore((state) => state.editor?.characterId ?? null);
	return (
		<div role="group" aria-labelledby={headingId} className={styles.root}>
			<Body1Strong id={headingId}>Reference images</Body1Strong>
			{characterId === null ? <PendingReferenceImages /> : <SavedReferenceImages characterId={characterId} />}
		</div>
	);
}
