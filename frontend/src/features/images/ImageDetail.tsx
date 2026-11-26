// Detail panel of the image selected in the Images section (selectImage of the store), next to the grid: its heading
// with Close (also Escape; the focus returns to its thumbnail: DetailPanel.tsx), the large preview, author and base
// model, Favorite / Copy prompt / Create character / provider page link, then its tags, LoRAs, checkpoint and
// generation parameters. Thin view: every action is an image library store action, except Create character
// (characters store startCreateFromImage). The section renders it keyed by the image, only while the image is listed.
import {
	Body1,
	Button,
	Caption1Strong,
	Image,
	Link,
	makeStyles,
	mergeClasses,
	Spinner,
	tokens,
	ToggleButton,
	Tooltip,
	useId,
} from '@fluentui/react-components';
import { CopyRegular, OpenRegular, PersonAddRegular, StarFilled, StarRegular } from '@fluentui/react-icons';
import type { ImageGenerationParams, RemoteImage } from '../../api/types';
import { useCharactersStore } from '../../stores/charactersStore';
import { selectImage, selectIsFavorite, useImageLibraryStore } from '../../stores/imageLibraryStore';
import { PaneGrid, PaneSection } from '../../ui/PaneLayout';
import { DetailPanel } from '../../ui/DetailPanel';
import { BaseModelBadge, NotSupportedLocallyBadge, NsfwBadge } from '../models/ModelBadges';
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
	overview: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		minWidth: 0,
	},
	preview: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		minWidth: 0,
		overflow: 'hidden',
		borderRadius: tokens.borderRadiusLarge,
		backgroundColor: tokens.colorNeutralBackground3,
	},
	// Short enough that the facts and the first actions show under it in a small window.
	previewImage: {
		width: 'auto',
		maxWidth: '100%',
		height: 'auto',
		maxHeight: 'min(480px, 42vh)',
	},
	facts: {
		display: 'flex',
		flexDirection: 'column',
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
		alignSelf: 'flex-start',
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

/** "Create character" from this image (tags, LoRAs, seed, the image as reference); busy while its LoRAs are collected. */
function CreateCharacterButton({ imageKey }: { imageKey: string }): JSX.Element {
	const preparing = useCharactersStore((state) => state.preparingImageKey === imageKey);
	const startCreateFromImage = useCharactersStore((state) => state.startCreateFromImage);
	return (
		<Tooltip content="New character prefilled with this image's tags, LoRAs and seed; the image becomes its reference" relationship="description">
			<Button
				icon={preparing ? <Spinner size="tiny" /> : <PersonAddRegular />}
				disabled={preparing}
				onClick={() => void startCreateFromImage(imageKey)}
			>
				Create character
			</Button>
		</Tooltip>
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
					{image.base_model ? <BaseModelBadge baseModel={image.base_model} /> : null}
					{image.architecture == null ? <NotSupportedLocallyBadge /> : null}
					{image.nsfw ? <NsfwBadge /> : null}
				</div>
				<div className={styles.actions}>
					<FavoriteButton imageKey={imageKey} />
					<Button icon={<CopyRegular />} disabled={!image.params?.prompt} onClick={() => void copyPrompt(imageKey)}>
						Copy prompt
					</Button>
					<CreateCharacterButton imageKey={imageKey} />
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
	/** Clears the selection (image library store closeImage); the panel returns the focus to the thumbnail. */
	onClose: () => void;
};

export function ImageDetail({ imageKey, onClose }: ImageDetailProps): JSX.Element | null {
	const image = useImageLibraryStore(selectImage(imageKey));
	if (!image) {
		return null;
	}
	return (
		<DetailPanel itemKey={imageKey} title={imageLabel(image)} onClose={onClose}>
			<Overview image={image} imageKey={imageKey} />
			<ImageTagsSection imageKey={imageKey} />
			<ImageLorasSection imageKey={imageKey} />
			<ImageCheckpointSection imageKey={imageKey} />
			<ParamsSection params={image.params} />
		</DetailPanel>
	);
}
