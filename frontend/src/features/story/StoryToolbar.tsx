// The commands of the Story section (its header, next to the title; a Fluent toolbar 'Story commands', arrow keys move
// between its buttons): New story (the section's primary action), Add scene, Generate missing (the scenes without a
// picture, one after the other; its count is in its name), Read (a toggle: the picture-book reader of the selected
// story) and Export (one HTML file: a save dialog in the desktop app, a download in the browser). While scenes are
// being generated, the run's progress (which scene of how many, the step bar) and Cancel replace Generate missing.
// Thin view over the story store.
import {
	Caption1,
	makeStyles,
	ProgressBar,
	Toolbar,
	ToolbarButton,
	ToolbarDivider,
	ToolbarToggleButton,
	tokens,
	Tooltip,
} from '@fluentui/react-components';
import { AddRegular, ArrowExportRegular, BookAddRegular, BookOpenRegular, DismissRegular, SparkleRegular } from '@fluentui/react-icons';
import { selectSelectedStory, useCanGenerateScenes, useMissingSceneIds, useStoryStore, type StoryGeneration } from '../../stores/storyStore';
import { useGenerationProgress } from '../../stores/tasksStore';
import { useActionClasses } from '../../ui/stateStyles';
import { STORY_LABELS } from './storyLabels';

const MODE = { name: 'story-mode', read: 'read' } as const;

const useStyles = makeStyles({
	root: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalM,
		flex: 1,
		minWidth: 0,
	},
	toolbar: {
		flexWrap: 'wrap',
		minWidth: 0,
	},
	progress: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		width: '240px',
		maxWidth: '100%',
		minWidth: '160px',
	},
	progressText: {
		color: tokens.colorNeutralForeground2,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
});

/** 'Scene 2 of 5 · The storm' (the scene of the run being generated). */
export function storyGenerationText(generation: StoryGeneration, sceneTitle: string | null): string {
	const position = Math.min(generation.completed + 1, generation.total);
	return `Scene ${position} of ${generation.total}${sceneTitle ? ` · ${sceneTitle}` : ''}`;
}

function RunProgress({ generation }: { generation: StoryGeneration }): JSX.Element {
	const styles = useStyles();
	const progress = useGenerationProgress();
	const sceneTitle = useStoryStore(
		(state) => state.stories.find((story) => story.id === generation.storyId)?.scenes.find((scene) => scene.id === generation.currentSceneId)?.title ?? null,
	);
	const stepRatio = progress.active ? (progress.ratio ?? 0) : 0;
	const text = storyGenerationText(generation, sceneTitle);
	return (
		<div className={styles.progress} role="status" aria-label={`Generating: ${text}`}>
			<Caption1 className={styles.progressText}>{text}</Caption1>
			<ProgressBar thickness="large" value={Math.min(1, (generation.completed + stepRatio) / generation.total)} aria-label="Story generation progress" />
		</div>
	);
}

export function StoryToolbar(): JSX.Element {
	const styles = useStyles();
	const actions = useActionClasses();
	const story = useStoryStore(selectSelectedStory);
	const reading = useStoryStore((state) => state.reader !== null);
	const generation = useStoryStore((state) => state.generation);
	const exporting = useStoryStore((state) => (story ? state.exportingIds[story.id] === true : false));
	const missing = useMissingSceneIds(story?.id ?? null);
	const canGenerate = useCanGenerateScenes();
	const createStory = useStoryStore((state) => state.createStory);
	const addScene = useStoryStore((state) => state.addScene);
	const generateMissing = useStoryStore((state) => state.generateMissing);
	const cancelGeneration = useStoryStore((state) => state.cancelGeneration);
	const openReader = useStoryStore((state) => state.openReader);
	const closeReader = useStoryStore((state) => state.closeReader);
	const exportStory = useStoryStore((state) => state.exportStory);

	return (
		<div className={styles.root}>
			<Toolbar
				aria-label={STORY_LABELS.commands}
				className={styles.toolbar}
				checkedValues={{ [MODE.name]: reading ? [MODE.read] : [] }}
				onCheckedValueChange={(_event, data) => {
					if (data.name === MODE.name) {
						if (data.checkedItems.includes(MODE.read)) {
							openReader();
						} else {
							closeReader();
						}
					}
				}}
			>
				<ToolbarButton appearance="primary" icon={<BookAddRegular />} onClick={() => void createStory()}>
					{STORY_LABELS.newStory}
				</ToolbarButton>
				<ToolbarDivider />
				<ToolbarButton icon={<AddRegular />} disabled={!story || reading} onClick={() => (story ? void addScene(story.id) : undefined)}>
					{STORY_LABELS.addScene}
				</ToolbarButton>
				{generation ? (
					<ToolbarButton className={actions.subtle.warning} icon={<DismissRegular />} onClick={() => void cancelGeneration()}>
						{STORY_LABELS.cancelGeneration}
					</ToolbarButton>
				) : (
					<Tooltip
						content={missing.length > 0 ? 'Generate the pictures of the scenes that have none, one after the other' : 'Every scene has its picture'}
						relationship="description"
					>
						<ToolbarButton
							icon={<SparkleRegular />}
							disabled={!story || missing.length === 0 || !canGenerate}
							onClick={() => (story ? void generateMissing(story.id) : undefined)}
						>
							{`${STORY_LABELS.generateMissing} (${missing.length})`}
						</ToolbarButton>
					</Tooltip>
				)}
				<ToolbarDivider />
				<Tooltip content="Read the story as a picture book (arrow keys turn the pages, Esc closes)" relationship="description">
					<ToolbarToggleButton
						icon={<BookOpenRegular />}
						name={MODE.name}
						value={MODE.read}
						disabled={!story || (!reading && story.scenes.length === 0)}
						appearance="subtle"
					>
						{STORY_LABELS.read}
					</ToolbarToggleButton>
				</Tooltip>
				<Tooltip content="Save the story as one web page, its pictures included" relationship="description">
					<ToolbarButton icon={<ArrowExportRegular />} disabled={!story || exporting} onClick={() => (story ? void exportStory(story.id) : undefined)}>
						{STORY_LABELS.exportStory}
					</ToolbarButton>
				</Tooltip>
			</Toolbar>
			{generation ? <RunProgress generation={generation} /> : null}
		</div>
	);
}
