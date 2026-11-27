// One scene of the storyboard (a Fluent Card, a group named 'Scene <n>: <title>'): its reorder handle (drag, or the
// arrow keys / Home / End: the board's ReorderHandle), its position and title, its picture (the chosen variant's
// thumbnail, or a placeholder) with the illustration status, the beginning of its text, and Generate / Regenerate,
// Duplicate and Delete. Clicking the card selects it (the detail panel shows it); from the keyboard the picture is the
// button that selects it (aria-current on the selected card, the detail panel's opener). The reorder handle and the
// actions keep their click to themselves: selecting would open the details, whose heading takes the focus (from the
// handle being moved, from a confirmation dialog). While the scene is being generated the card shows the generation
// progress. Thin view over the story store.
import {
	Body1Strong,
	Caption1,
	Caption1Strong,
	Card,
	CardFooter,
	createFocusOutlineStyle,
	makeStyles,
	mergeClasses,
	ProgressBar,
	tokens,
	useId,
} from '@fluentui/react-components';
import { ImageAddRegular } from '@fluentui/react-icons';
import { outputThumbnailUrl } from '../../api/config';
import type { MouseEvent } from 'react';
import type { Scene } from '../../api/types';
import { sceneIllustrationId } from '../../domain/stories';
import { useGenerationProgress } from '../../stores/tasksStore';
import { useOutputIdSet, useSceneStatus, useStoryStore } from '../../stores/storyStore';
import { detailOpenerProps } from '../../ui/DetailPanel';
import { ReorderHandle } from '../categories/ReorderHandle';
import { DeleteSceneButton, DuplicateSceneButton, GenerateSceneButton } from './SceneActions';
import { SceneStatusBadge } from './SceneStatusBadge';
import { sceneCardName } from './storyLabels';

/** Lines of text a card shows. */
const TEXT_LINES = 3;
/** Height of a card's picture. */
export const SCENE_PICTURE_HEIGHT = '168px';

const useStyles = makeStyles({
	card: {
		height: '100%',
		minWidth: 0,
		rowGap: tokens.spacingVerticalS,
	},
	selected: {
		backgroundColor: tokens.colorNeutralBackground1Selected,
		outlineWidth: tokens.strokeWidthThick,
		outlineStyle: 'solid',
		outlineColor: tokens.colorBrandStroke1,
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXS,
		minWidth: 0,
	},
	position: {
		flexShrink: 0,
		minWidth: '20px',
		textAlign: 'center',
		color: tokens.colorNeutralForeground3,
		fontVariantNumeric: 'tabular-nums',
	},
	title: {
		flex: 1,
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	pictureButton: {
		position: 'relative',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: '100%',
		height: SCENE_PICTURE_HEIGHT,
		padding: 0,
		border: 'none',
		borderRadius: tokens.borderRadiusMedium,
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground3,
		color: tokens.colorNeutralForeground3,
		cursor: 'pointer',
		...createFocusOutlineStyle({ style: { outlineOffset: tokens.strokeWidthThin } }),
	},
	picture: {
		display: 'block',
		width: '100%',
		height: '100%',
		objectFit: 'contain',
	},
	placeholder: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalXS,
		fontSize: tokens.fontSizeHero700,
	},
	placeholderText: {
		color: tokens.colorNeutralForeground3,
	},
	status: {
		position: 'absolute',
		top: tokens.spacingVerticalS,
		right: tokens.spacingHorizontalS,
	},
	text: {
		display: '-webkit-box',
		WebkitBoxOrient: 'vertical',
		WebkitLineClamp: TEXT_LINES,
		overflow: 'hidden',
		overflowWrap: 'anywhere',
		minHeight: `calc(${TEXT_LINES} * ${tokens.lineHeightBase200})`,
		color: tokens.colorNeutralForeground2,
	},
	empty: {
		fontStyle: 'italic',
		color: tokens.colorNeutralForeground3,
	},
	footer: {
		alignItems: 'center',
		flexWrap: 'wrap',
		columnGap: tokens.spacingHorizontalS,
		marginTop: 'auto',
	},
	buttons: {
		display: 'flex',
		gap: tokens.spacingHorizontalXXS,
		marginLeft: 'auto',
	},
});

/** Keeps a click inside a card's controls from selecting the card. */
const keepClick = (event: MouseEvent) => event.stopPropagation();

function GeneratingProgress(): JSX.Element {
	const progress = useGenerationProgress();
	return <ProgressBar thickness="large" value={progress.value} aria-label="Generation progress" />;
}

export function SceneCard({ storyId, scene, position }: { storyId: string; scene: Scene; position: number }): JSX.Element {
	const styles = useStyles();
	const titleId = useId('scene-title-');
	const textId = useId('scene-text-');
	const statusId = useId('scene-status-');
	const outputIds = useOutputIdSet();
	const status = useSceneStatus(storyId, scene);
	const selected = useStoryStore((state) => state.selectedStoryId === storyId && state.selectedSceneId === scene.id);
	const selectScene = useStoryStore((state) => state.selectScene);
	const moveScene = useStoryStore((state) => state.moveScene);
	const illustration = sceneIllustrationId(scene, outputIds);

	return (
		<Card
			className={mergeClasses(styles.card, selected && styles.selected)}
			aria-label={sceneCardName(position, scene.title)}
			focusMode="off"
			onClick={() => selectScene(scene.id)}
		>
			<div className={styles.header}>
				<span onClick={keepClick}>
					<ReorderHandle itemKey={scene.id} name={scene.title} onMove={(move) => moveScene(storyId, scene.id, move)} />
				</span>
				<Caption1Strong className={styles.position} aria-hidden>
					{position}
				</Caption1Strong>
				<Body1Strong id={titleId} className={styles.title} title={scene.title}>
					{scene.title}
				</Body1Strong>
			</div>
			<button
				type="button"
				className={styles.pictureButton}
				aria-labelledby={titleId}
				aria-describedby={`${statusId} ${textId}`}
				aria-current={selected ? 'true' : undefined}
				onClick={() => selectScene(scene.id)}
				{...detailOpenerProps(scene.id)}
			>
				{illustration ? (
					<img className={styles.picture} src={outputThumbnailUrl(illustration)} alt="" loading="lazy" decoding="async" draggable={false} />
				) : (
					<span className={styles.placeholder} aria-hidden>
						<ImageAddRegular />
						<Caption1 className={styles.placeholderText}>No picture yet</Caption1>
					</span>
				)}
				<SceneStatusBadge id={statusId} status={status} className={styles.status} />
			</button>
			{status === 'generating' ? <GeneratingProgress /> : null}
			<Caption1 id={textId} className={mergeClasses(styles.text, !scene.text.trim() && styles.empty)}>
				{scene.text.trim() || 'No text yet'}
			</Caption1>
			<CardFooter className={styles.footer} onClick={keepClick}>
				<GenerateSceneButton storyId={storyId} scene={scene} />
				<div className={styles.buttons}>
					<DuplicateSceneButton storyId={storyId} scene={scene} />
					<DeleteSceneButton storyId={storyId} scene={scene} />
				</div>
			</CardFooter>
		</Card>
	);
}
