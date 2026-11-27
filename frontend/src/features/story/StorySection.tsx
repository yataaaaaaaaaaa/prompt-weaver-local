// The Story section (navigation rail, Ctrl+5): illustrated storyboards. Full page on the shared SectionLayout:
// - header: the section title and StoryToolbar (New story, Add scene, Generate missing / the run's progress and
//   Cancel, Read, Export);
// - storyboard (default): the navigation pane 'Stories' (StoryList), the results 'Scenes' (SceneBoard: the story's
//   settings and its scene cards) and the detail panel 'Scene details' (SceneDetail: the selected scene's picture,
//   text and prompt);
// - read mode (Read): the results 'Reader' (StoryReader: one scene per page), no list nor detail panel;
// - in both: the dock, when a panel is registered in STORY_DOCK_PANELS (src/features/story/storyDock.ts), e.g. a
//   co-writer chat panel; `dock` overrides the registry (tests).
// Thin views over the story store.
import { makeStyles } from '@fluentui/react-components';
import { useStoryStore } from '../../stores/storyStore';
import { SectionLayout } from '../../ui/SectionLayout';
import { SceneBoard } from './SceneBoard';
import { SceneDetail } from './SceneDetail';
import { STORY_DOCK_PANELS, type StoryDockPanel } from './storyDock';
import { StoryList } from './StoryList';
import { StoryReader } from './StoryReader';
import { StoryToolbar } from './StoryToolbar';
import { STORY_LABELS } from './storyLabels';

const useStyles = makeStyles({
	// No box of its own: the layout fills the section.
	root: {
		display: 'contents',
	},
});

export type StorySectionProps = {
	/** The panel of the dock (default: the first registered one, none when nothing is registered). */
	dock?: StoryDockPanel | null;
};

export function StorySection({ dock = STORY_DOCK_PANELS[0] ?? null }: StorySectionProps): JSX.Element {
	const styles = useStyles();
	const reading = useStoryStore((state) => state.reader !== null && state.selectedStoryId !== null);
	const Dock = dock?.component ?? null;
	const dockProps = Dock ? { dock: <Dock />, dockLabel: dock?.label } : {};
	return (
		<div className={styles.root}>
			{reading ? (
				<SectionLayout title="Story" toolbar={<StoryToolbar />} results={<StoryReader />} resultsLabel={STORY_LABELS.reader} {...dockProps} />
			) : (
				<SectionLayout
					title="Story"
					toolbar={<StoryToolbar />}
					navigation={<StoryList />}
					navigationLabel={STORY_LABELS.storyList}
					results={<SceneBoard />}
					resultsLabel={STORY_LABELS.scenes}
					detail={<SceneDetail />}
					detailLabel={STORY_LABELS.sceneDetails}
					{...dockProps}
				/>
			)}
		</div>
	);
}
