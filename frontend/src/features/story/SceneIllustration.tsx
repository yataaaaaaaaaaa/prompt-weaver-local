// The picture part of the scene details: the chosen variant (the output's picture, fitted, named 'Illustration of
// <title>'), its status, Generate / Regenerate (the primary action), Cancel while the scene is generated (with the
// generation progress), 'Use the current output' (the output shown in Create becomes a variant and the picture), and
// the variants (every output generated for or added to the scene; picking one makes it the picture). Thin view over
// the story, outputs and tasks stores.
import { Button, Caption1, makeStyles, mergeClasses, ProgressBar, tokens, Tooltip } from '@fluentui/react-components';
import { DismissRegular, ImageAddRegular, ImageArrowBackRegular } from '@fluentui/react-icons';
import { outputImageUrl, outputThumbnailUrl } from '../../api/config';
import type { Scene } from '../../api/types';
import { availableVariantIds, sceneIllustrationId } from '../../domain/stories';
import { useOutputsStore } from '../../stores/outputsStore';
import { useOutputIdSet, useSceneStatus, useStoryStore } from '../../stores/storyStore';
import { useGenerationProgress } from '../../stores/tasksStore';
import { useActionClasses, useStateFrameClasses } from '../../ui/stateStyles';
import { GenerateSceneButton } from './SceneActions';
import { SceneStatusBadge } from './SceneStatusBadge';
import { sceneIllustrationName, sceneVariantName, STORY_LABELS } from './storyLabels';

const VARIANT_SIZE = '56px';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		minWidth: 0,
	},
	canvas: {
		position: 'relative',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		height: '280px',
		borderRadius: tokens.borderRadiusMedium,
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground3,
		color: tokens.colorNeutralForeground3,
	},
	picture: {
		display: 'block',
		maxWidth: '100%',
		maxHeight: '100%',
		objectFit: 'contain',
	},
	placeholder: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'center',
		gap: tokens.spacingVerticalXS,
		fontSize: tokens.fontSizeHero800,
	},
	status: {
		position: 'absolute',
		top: tokens.spacingVerticalS,
		right: tokens.spacingHorizontalS,
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalS,
	},
	variantsLabel: {
		color: tokens.colorNeutralForeground2,
	},
	variants: {
		display: 'flex',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXS,
	},
	variant: {
		width: VARIANT_SIZE,
		height: VARIANT_SIZE,
		minWidth: VARIANT_SIZE,
		padding: 0,
		overflow: 'hidden',
		border: `${tokens.strokeWidthThick} solid transparent`,
		borderRadius: tokens.borderRadiusMedium,
		backgroundColor: tokens.colorNeutralBackground3,
	},
	variantPicture: {
		display: 'block',
		width: '100%',
		height: '100%',
		objectFit: 'cover',
	},
});

function SceneProgress(): JSX.Element {
	const progress = useGenerationProgress();
	return (
		<ProgressBar
			thickness="large"
			value={progress.value}
			aria-label="Generation progress"
			aria-valuetext={progress.total > 0 ? `Step ${progress.current} of ${progress.total}` : progress.message}
		/>
	);
}

function Variants({ storyId, scene }: { storyId: string; scene: Scene }): JSX.Element | null {
	const styles = useStyles();
	const frame = useStateFrameClasses();
	const outputIds = useOutputIdSet();
	const chooseVariant = useStoryStore((state) => state.chooseVariant);
	const ids = availableVariantIds(scene, outputIds);
	if (ids.length < 2) {
		return null;
	}
	return (
		<>
			<Caption1 className={styles.variantsLabel} id={`variants-${scene.id}`}>
				{STORY_LABELS.variants} ({ids.length})
			</Caption1>
			<div className={styles.variants} role="group" aria-labelledby={`variants-${scene.id}`}>
				{ids.map((outputId) => {
					const chosen = outputId === scene.chosen_output_id;
					return (
						<Tooltip key={outputId} content={chosen ? `#${outputId}, the scene's picture` : `Use #${outputId} as the scene's picture`} relationship="description">
							<Button
								className={mergeClasses(styles.variant, chosen && frame.card.current)}
								aria-label={sceneVariantName(outputId)}
								aria-pressed={chosen}
								onClick={() => (chosen ? undefined : void chooseVariant(storyId, scene.id, outputId))}
							>
								<img className={styles.variantPicture} src={outputThumbnailUrl(outputId)} alt="" loading="lazy" draggable={false} />
							</Button>
						</Tooltip>
					);
				})}
			</div>
		</>
	);
}

export function SceneIllustration({ storyId, scene }: { storyId: string; scene: Scene }): JSX.Element {
	const styles = useStyles();
	const actions = useActionClasses();
	const outputIds = useOutputIdSet();
	const status = useSceneStatus(storyId, scene);
	const currentOutputId = useOutputsStore((state) => state.currentId);
	const addVariant = useStoryStore((state) => state.addVariant);
	const cancelGeneration = useStoryStore((state) => state.cancelGeneration);
	const illustration = sceneIllustrationId(scene, outputIds);
	const busy = status === 'generating' || status === 'queued';

	return (
		<div className={styles.root}>
			<div className={styles.canvas}>
				{illustration ? (
					<img className={styles.picture} src={outputImageUrl(illustration)} alt={sceneIllustrationName(scene.title)} />
				) : (
					<span className={styles.placeholder}>
						<ImageAddRegular aria-hidden />
						<Caption1>No picture yet: generate it, or use an output.</Caption1>
					</span>
				)}
				<SceneStatusBadge status={status} className={styles.status} />
			</div>
			{status === 'generating' ? <SceneProgress /> : null}
			<div className={styles.actions}>
				<GenerateSceneButton storyId={storyId} scene={scene} size="medium" appearance="primary" />
				{busy ? (
					<Button className={actions.filled.warning} icon={<DismissRegular />} onClick={() => void cancelGeneration()}>
						{STORY_LABELS.cancelGeneration}
					</Button>
				) : null}
				<Tooltip
					content={currentOutputId ? `Use output #${currentOutputId} of Create as this scene's picture` : 'No output is shown in Create'}
					relationship="description"
				>
					<Button
						icon={<ImageArrowBackRegular />}
						disabled={currentOutputId === null || currentOutputId === scene.chosen_output_id}
						onClick={() => (currentOutputId ? void addVariant(storyId, scene.id, currentOutputId) : undefined)}
					>
						{STORY_LABELS.useCurrentOutput}
					</Button>
				</Tooltip>
			</div>
			<Variants storyId={storyId} scene={scene} />
		</div>
	);
}
