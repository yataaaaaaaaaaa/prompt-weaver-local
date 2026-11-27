// The Story section's detail panel ('Scene details'): the selected scene in the shared DetailPanel frame (its title as
// the heading, Close / Escape back to its card) with, top to bottom, its picture and variants (SceneIllustration), its
// title and text (saved when the edit is done), its prompt (ScenePromptFields), then Duplicate and Delete. With nothing
// selected it says what to do. Thin view over the story store; the drafts of the fields are the only local state.
import { Field, Input, makeStyles, Textarea, tokens } from '@fluentui/react-components';
import { BookOpenRegular, CursorClickRegular } from '@fluentui/react-icons';
import type { Scene, Story } from '../../api/types';
import { selectSelectedScene, selectSelectedStory, useStoryStore } from '../../stores/storyStore';
import { DetailPanel } from '../../ui/DetailPanel';
import { EmptyState } from '../../ui/EmptyState';
import { PaneSection } from '../../ui/PaneLayout';
import { DeleteSceneButton, DuplicateSceneButton } from './SceneActions';
import { SceneIllustration } from './SceneIllustration';
import { ScenePromptFields } from './ScenePromptFields';
import { STORY_LABELS } from './storyLabels';
import { useCommitField } from './useCommitField';

const useStyles = makeStyles({
	text: {
		minHeight: '144px',
	},
	footer: {
		display: 'flex',
		gap: tokens.spacingHorizontalS,
	},
});

function SceneEditor({ story, scene }: { story: Story; scene: Scene }): JSX.Element {
	const styles = useStyles();
	const updateScene = useStoryStore((state) => state.updateScene);
	const title = useCommitField(scene.title, (draft) => {
		const next = draft.trim();
		if (!next) {
			return false;
		}
		void updateScene(story.id, scene.id, { title: next });
		return true;
	});
	const text = useCommitField(
		scene.text,
		(draft) => {
			void updateScene(story.id, scene.id, { text: draft });
		},
		{ multiline: true },
	);
	return (
		<>
			<SceneIllustration storyId={story.id} scene={scene} />
			<PaneSection title="Text">
				<Field label={STORY_LABELS.sceneTitle}>
					<Input {...title} />
				</Field>
				<Field label={STORY_LABELS.sceneText} hint="Saved when you leave the field (Ctrl+Enter saves too).">
					<Textarea {...text} className={styles.text} resize="vertical" placeholder="What happens in this scene?" />
				</Field>
			</PaneSection>
			<PaneSection title="Prompt">
				<ScenePromptFields story={story} scene={scene} />
			</PaneSection>
			<PaneSection title="Scene">
				<div className={styles.footer}>
					<DuplicateSceneButton storyId={story.id} scene={scene} size="medium" labeled />
					<DeleteSceneButton storyId={story.id} scene={scene} size="medium" labeled />
				</div>
			</PaneSection>
		</>
	);
}

export function SceneDetail(): JSX.Element {
	const story = useStoryStore(selectSelectedStory);
	const scene = useStoryStore(selectSelectedScene);
	const selectScene = useStoryStore((state) => state.selectScene);
	if (!story) {
		return (
			<EmptyState icon={BookOpenRegular} title="No story selected">
				The scenes of a story show here: their text, prompt and picture.
			</EmptyState>
		);
	}
	if (!scene) {
		return (
			<EmptyState icon={CursorClickRegular} title="No scene selected">
				{story.scenes.length > 0 ? 'Select a scene to edit its text, its prompt and its picture.' : 'Add a scene to start the story.'}
			</EmptyState>
		);
	}
	return (
		<DetailPanel itemKey={scene.id} title={scene.title} onClose={() => selectScene(null)}>
			<SceneEditor key={scene.id} story={story} scene={scene} />
		</DetailPanel>
	);
}
