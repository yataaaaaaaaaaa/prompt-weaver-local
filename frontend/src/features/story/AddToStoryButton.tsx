// "Add to story" of the Create viewer's output actions: a menu button listing New story and every story; picking one
// adds the output shown as a new scene of it (storyStore.addSceneFromOutput: its picture, its sub-prompts as the
// scene's locks, its seed), announced with 'Go to Story'. Disabled while no output is shown. Thin view over the story
// and outputs stores.
import { Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuList, MenuPopover, MenuTrigger, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { BookAdd20Regular, BookAddRegular, BookOpenRegular } from '@fluentui/react-icons';
import { forwardRef, type ComponentProps } from 'react';
import { useOutputsStore } from '../../stores/outputsStore';
import { useStoryStore } from '../../stores/storyStore';
import { STORY_LABELS } from './storyLabels';

/** The toolbar button (a menu trigger: Fluent passes its props and ref through). */
const AddToStoryTrigger = forwardRef<HTMLButtonElement, ComponentProps<typeof ToolbarButton>>(function AddToStoryTrigger(props, ref) {
	return (
		<Tooltip content="Add this output to a story as a new scene (its picture, sub-prompts and seed)" relationship="description">
			<ToolbarButton {...props} ref={ref} aria-label={STORY_LABELS.addToStory} appearance="subtle" icon={<BookAdd20Regular />} />
		</Tooltip>
	);
});

export function AddToStoryButton(): JSX.Element {
	const hasRecord = useOutputsStore((state) => state.record !== null);
	const stories = useStoryStore((state) => state.stories);
	const addSceneFromOutput = useStoryStore((state) => state.addSceneFromOutput);
	return (
		<Menu positioning="below-end">
			<MenuTrigger disableButtonEnhancement>
				<AddToStoryTrigger disabled={!hasRecord} />
			</MenuTrigger>
			<MenuPopover>
				<MenuList>
					<MenuItem icon={<BookAddRegular />} onClick={() => void addSceneFromOutput(null)}>
						{STORY_LABELS.addToNewStory}
					</MenuItem>
					{stories.length > 0 ? (
						<>
							<MenuDivider />
							<MenuGroup>
								<MenuGroupHeader>Add a scene to</MenuGroupHeader>
								{stories.map((story) => (
									<MenuItem key={story.id} icon={<BookOpenRegular />} onClick={() => void addSceneFromOutput(story.id)}>
										{story.title}
									</MenuItem>
								))}
							</MenuGroup>
						</>
					) : null}
				</MenuList>
			</MenuPopover>
		</Menu>
	);
}
