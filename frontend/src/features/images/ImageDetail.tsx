// Detail view of the image picked in the image library (selectImage of the store): Back (also Escape), large
// preview, author and base model, Favorite / Copy prompt / provider page link, then its tags, LoRAs, checkpoint and
// generation parameters. Thin view: every action is an image library store action. The pane renders it keyed by
// the image, and moves the focus to Back when it opens.
import {
	Badge,
	Body1,
	Button,
	Caption1,
	Caption1Strong,
	Image,
	Link,
	makeStyles,
	mergeClasses,
	Subtitle2,
	tokens,
	ToggleButton,
	useId,
} from '@fluentui/react-components';
import { ArrowLeftRegular, CopyRegular, OpenRegular, StarFilled, StarRegular } from '@fluentui/react-icons';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { ImageGenerationParams, RemoteImage } from '../../api/types';
import { selectImage, selectIsFavorite, useImageLibraryStore } from '../../stores/imageLibraryStore';
import { PaneGrid, PaneSection } from '../../ui/PaneLayout';
import { imageLabel, siteName } from './imageLabels';
import { ImageCheckpointSection, ImageLorasSection } from './ImageResources';
import { ImageTagsSection } from './ImageTagsSection';

const MISSING = '—';

type ParamField = { label: string; value: (params: ImageGenerationParams) => string | number | null; wide?: boolean };

/** The generation parameters shown, in order (wide: a whole row). */
const PARAM_FIELDS: readonly ParamField[] = [
	{ label: 'Prompt', value: (params) => params.prompt, wide: true },
	{ label: 'Negative prompt', value: (params) => params.negative_prompt, wide: true },
	{ label: 'Sampler', value: (params) => params.sampler },
	{ label: 'Steps', value: (params) => params.steps },
	{ label: 'CFG scale', value: (params) => params.cfg_scale },
	{ label: 'Seed', value: (params) => params.seed },
	{ label: 'Size', value: (params) => (params.width != null && params.height != null ? `${params.width} × ${params.height}` : null) },
	{ label: 'Clip skip', value: (params) => params.clip_skip },
];

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		minWidth: 0,
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	title: {
		flex: '1 1 auto',
		minWidth: 0,
		margin: 0,
		overflowWrap: 'anywhere',
	},
	overview: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'flex-start',
		gap: tokens.spacingHorizontalL,
	},
	preview: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		flex: '3 1 320px',
		minWidth: 0,
		overflow: 'hidden',
		borderRadius: tokens.borderRadiusLarge,
		backgroundColor: tokens.colorNeutralBackground3,
	},
	previewImage: {
		width: '100%',
		height: 'auto',
		maxHeight: '560px',
	},
	facts: {
		display: 'flex',
		flexDirection: 'column',
		flex: '2 1 240px',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	badges: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	link: {
		display: 'inline-flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXXS,
	},
	param: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		minWidth: 0,
	},
	wide: {
		gridColumn: '1 / -1',
	},
	value: {
		overflowWrap: 'anywhere',
		whiteSpace: 'pre-wrap',
	},
	muted: {
		color: tokens.colorNeutralForeground3,
	},
});

function FavoriteButton({ imageKey }: { imageKey: string }): JSX.Element {
	const favorite = useImageLibraryStore(selectIsFavorite(imageKey));
	const toggleFavorite = useImageLibraryStore((state) => state.toggleFavorite);
	return (
		<ToggleButton checked={favorite} icon={favorite ? <StarFilled /> : <StarRegular />} onClick={() => void toggleFavorite(imageKey)}>
			Favorite
		</ToggleButton>
	);
}

function Overview({ image, imageKey }: { image: RemoteImage; imageKey: string }): JSX.Element {
	const styles = useStyles();
	const copyPrompt = useImageLibraryStore((state) => state.copyPrompt);
	return (
		<div className={styles.overview}>
			<div className={styles.preview}>
				<Image
					className={styles.previewImage}
					src={image.url}
					alt={imageLabel(image)}
					fit="contain"
					width={image.width ?? undefined}
					height={image.height ?? undefined}
				/>
			</div>
			<div className={styles.facts}>
				<Body1>{image.username ? `by ${image.username}` : 'Anonymous upload'}</Body1>
				<div className={styles.badges}>
					{image.base_model ? (
						<Badge appearance="outline" color="informative">
							{image.base_model}
						</Badge>
					) : null}
					{image.architecture == null ? (
						<Badge appearance="tint" color="warning">
							Not supported locally
						</Badge>
					) : null}
					{image.nsfw ? (
						<Badge appearance="tint" color="danger">
							NSFW
						</Badge>
					) : null}
				</div>
				<div className={styles.actions}>
					<FavoriteButton imageKey={imageKey} />
					<Button icon={<CopyRegular />} disabled={!image.params?.prompt} onClick={() => void copyPrompt(imageKey)}>
						Copy prompt
					</Button>
				</div>
				<Link className={styles.link} href={image.page_url} target="_blank" rel="noopener noreferrer">
					Open on {siteName(image.page_url)}
					<OpenRegular aria-hidden />
				</Link>
			</div>
		</div>
	);
}

function ParamValue({ field, params }: { field: ParamField; params: ImageGenerationParams }): JSX.Element {
	const styles = useStyles();
	const labelId = useId('image-param-');
	const value = field.value(params);
	return (
		<div role="group" aria-labelledby={labelId} className={mergeClasses(styles.param, field.wide && styles.wide)}>
			<Caption1Strong id={labelId}>{field.label}</Caption1Strong>
			<Body1 className={styles.value}>{value === null || value === '' ? MISSING : String(value)}</Body1>
		</div>
	);
}

function ParamsSection({ params }: { params: ImageGenerationParams | null }): JSX.Element {
	const styles = useStyles();
	return (
		<PaneSection title="Generation parameters">
			{params ? (
				<PaneGrid>
					{PARAM_FIELDS.map((field) => (
						<ParamValue key={field.label} field={field} params={params} />
					))}
				</PaneGrid>
			) : (
				<Body1 className={styles.muted}>This image publishes no generation data.</Body1>
			)}
		</PaneSection>
	);
}

export type ImageDetailProps = {
	imageKey: string;
	/** Back (button or Escape): the pane closes the image and restores the focus. */
	onBack: () => void;
};

export function ImageDetail({ imageKey, onBack }: ImageDetailProps): JSX.Element {
	const styles = useStyles();
	const image = useImageLibraryStore(selectImage(imageKey));
	const backRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		backRef.current?.focus();
	}, []);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Open menus and tooltips handle (and prevent) their own Escape first.
		if (event.key === 'Escape' && !event.defaultPrevented) {
			event.preventDefault();
			onBack();
		}
	};

	return (
		<div className={styles.root} onKeyDown={handleKeyDown}>
			<div className={styles.header}>
				<Button ref={backRef} appearance="subtle" icon={<ArrowLeftRegular />} onClick={onBack}>
					Back
				</Button>
				<Subtitle2 as="h3" className={styles.title}>
					{image ? imageLabel(image) : 'Image'}
				</Subtitle2>
			</div>
			{image ? (
				<>
					<Overview image={image} imageKey={imageKey} />
					<ImageTagsSection imageKey={imageKey} />
					<ImageLorasSection imageKey={imageKey} />
					<ImageCheckpointSection imageKey={imageKey} />
					<ParamsSection params={image.params} />
				</>
			) : (
				<Caption1 className={styles.muted}>This image is no longer listed. Go back to pick another one.</Caption1>
			)}
		</div>
	);
}
