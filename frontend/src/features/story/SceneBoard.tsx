// The storyboard (the Story section's results region): the selected story's settings (StoryHeader), then its scenes
// in reading order as a responsive grid of cards (SceneCard) ending with an 'Add scene' tile. Reordering uses the
// prompt board's reorder kit (src/features/categories/reorderGrid.ts): drag a card's handle (the brand bar shows where
// it lands; the results scroll near their edges), or focus the handle and use the arrow keys, Home and End; the move
// goes to the story store, is announced in a polite live region and the focus stays on the handle. Empty states: no
// story (New story), a story without scenes (Add scene, or add an output from Create). Thin view over the story store;
// only the drag preview and the last announcement are local.
import { Button, makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { AddRegular, BookAddRegular, BookOpenRegular, SparkleRegular } from '@fluentui/react-icons';
import { useCallback, useMemo, useRef } from 'react';
import { F6_REGION_ATTRIBUTE } from '../../app/sections';
import type { Placement } from '../../domain/board';
import { goToSectionAction } from '../../stores/navigationStore';
import { selectSelectedStory, useStoryStore } from '../../stores/storyStore';
import { EmptyState } from '../../ui/EmptyState';
import { useVisuallyHiddenClass } from '../../ui/visuallyHidden';
import { BoardInteractionContext, type BoardInteraction } from '../categories/boardInteraction';
import { reorderItemClass, useReorderFeedback, useReorderGridStyles } from '../categories/reorderGrid';
import { useBoardDrag } from '../categories/useBoardDrag';
import { SCENE_PICTURE_HEIGHT, SceneCard } from './SceneCard';
import { StoryHeader } from './StoryHeader';
import { STORY_LABELS } from './storyLabels';

/** Marks the grid item of a scene card (value: the scene id): the drag controller finds the card under the pointer. */
export const SCENE_CARD_ATTRIBUTE = 'data-scene-card';
/** The narrowest a scene card gets. */
export const SCENE_CARD_MIN_WIDTH = '220px';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		minWidth: 0,
	},
	grid: {
		display: 'grid',
		gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${SCENE_CARD_MIN_WIDTH}), 1fr))`,
		alignItems: 'stretch',
		columnGap: tokens.spacingHorizontalM,
		rowGap: tokens.spacingVerticalM,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	item: {
		position: 'relative',
		minWidth: 0,
	},
	addTile: {
		width: '100%',
		height: '100%',
		minHeight: `calc(${SCENE_PICTURE_HEIGHT} + 120px)`,
		maxWidth: 'none',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		border: `${tokens.strokeWidthThick} dashed ${tokens.colorNeutralStroke1}`,
		borderRadius: tokens.borderRadiusLarge,
		color: tokens.colorNeutralForeground2,
	},
});

function NoStory(): JSX.Element {
	const hasStories = useStoryStore((state) => state.stories.length > 0);
	const loaded = useStoryStore((state) => state.loadStatus === 'ready');
	const createStory = useStoryStore((state) => state.createStory);
	if (!loaded && !hasStories) {
		return <></>;
	}
	return hasStories ? (
		<EmptyState icon={BookOpenRegular} title="No story selected">
			Pick a story in the list to see its scenes.
		</EmptyState>
	) : (
		<EmptyState
			icon={BookAddRegular}
			title="Tell a story, picture by picture"
			emphasis
			actions={
				<Button appearance="primary" icon={<BookAddRegular />} onClick={() => void createStory()}>
					{STORY_LABELS.newStory}
				</Button>
			}
		>
			<p>A story is a list of scenes. Each scene has its text and a picture made with your prompt board, your characters and your model.</p>
			<p>You can also add an output from Create to a story: its picture and sub-prompts become a scene.</p>
		</EmptyState>
	);
}

function NoScenes({ storyId }: { storyId: string }): JSX.Element {
	const addScene = useStoryStore((state) => state.addScene);
	const goToCreate = goToSectionAction('create');
	return (
		<EmptyState
			icon={SparkleRegular}
			title="No scenes yet"
			actions={
				<>
					<Button appearance="primary" icon={<AddRegular />} onClick={() => void addScene(storyId)}>
						{STORY_LABELS.addScene}
					</Button>
					<Button onClick={goToCreate.run}>{goToCreate.label}</Button>
				</>
			}
		>
			<p>Add a scene, write its text, then generate its picture.</p>
			<p>In Create, "Add to story" on an output adds it as a scene with its picture, sub-prompts and seed.</p>
		</EmptyState>
	);
}

export function SceneBoard(): JSX.Element {
	const styles = useStyles();
	const reorder = useReorderGridStyles();
	const visuallyHidden = useVisuallyHiddenClass();
	const story = useStoryStore(selectSelectedStory);
	const addScene = useStoryStore((state) => state.addScene);
	const moveSceneNextTo = useStoryStore((state) => state.moveSceneNextTo);
	const scrollRef = useRef<HTMLElement | null>(null);
	const gridRef = useRef<HTMLUListElement | null>(null);
	// The results region (SectionLayout) is what scrolls.
	const setGrid = useCallback((node: HTMLUListElement | null) => {
		gridRef.current = node;
		scrollRef.current = node?.closest<HTMLElement>(`[${F6_REGION_ATTRIBUTE}="results"]`) ?? null;
	}, []);
	const { announcement, moved } = useReorderFeedback(scrollRef, SCENE_CARD_ATTRIBUTE);
	const storyId = story?.id ?? null;

	const onDrop = useCallback(
		(sceneId: string, targetId: string, placement: Placement) => {
			if (storyId === null) {
				return;
			}
			const title = useStoryStore.getState().stories.find((item) => item.id === storyId)?.scenes.find((scene) => scene.id === sceneId)?.title ?? '';
			void moveSceneNextTo(storyId, sceneId, targetId, placement).then((result) => moved(sceneId, title, result));
		},
		[moveSceneNextTo, moved, storyId],
	);
	const { drag, startPointerDrag } = useBoardDrag({ scrollRef, gridRef, onDrop, itemAttribute: SCENE_CARD_ATTRIBUTE });
	const interaction = useMemo<BoardInteraction>(() => ({ startPointerDrag, moved }), [startPointerDrag, moved]);

	if (!story) {
		return <NoStory />;
	}
	return (
		<BoardInteractionContext.Provider value={interaction}>
			<div className={mergeClasses(styles.root, drag ? reorder.dragging : undefined)}>
				<StoryHeader key={story.id} story={story} />
				{story.scenes.length === 0 ? (
					<NoScenes storyId={story.id} />
				) : (
					<ul ref={setGrid} className={styles.grid} aria-label={STORY_LABELS.sceneList}>
						{story.scenes.map((scene, index) => (
							<li key={scene.id} className={mergeClasses(styles.item, reorderItemClass(reorder, drag, scene.id))} {...{ [SCENE_CARD_ATTRIBUTE]: scene.id }}>
								<SceneCard storyId={story.id} scene={scene} position={index + 1} />
							</li>
						))}
						<li className={styles.item}>
							<Button appearance="subtle" className={styles.addTile} icon={<AddRegular />} onClick={() => void addScene(story.id)}>
								{STORY_LABELS.addScene}
							</Button>
						</li>
					</ul>
				)}
				<div className={visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
					{announcement}
				</div>
			</div>
		</BoardInteractionContext.Provider>
	);
}
