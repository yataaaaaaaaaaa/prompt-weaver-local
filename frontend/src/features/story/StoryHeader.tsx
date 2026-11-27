// The settings of the selected story, above its scenes: its title (saved when the edit is done; a blank title is
// refused), its characters (CastPicker: applied to every scene that does not name its own), its flow (the logline,
// and in a disclosure the synopsis and the style and tone notes: they plan the story, never part of a prompt), how far
// it is illustrated, and Delete story (red, after a confirmation; its outputs are kept). Thin view over the story
// store; the disclosure's open state is local.
import {
	Accordion,
	AccordionHeader,
	AccordionItem,
	AccordionPanel,
	Button,
	Caption1,
	Field,
	Input,
	makeStyles,
	Textarea,
	tokens,
	Tooltip,
	useRestoreFocusTarget,
} from '@fluentui/react-components';
import { DeleteRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { Story, StoryPatch } from '../../api/types';
import { storyProgress, storyProgressText } from '../../domain/stories';
import { useOutputIdSet, useStoryStore } from '../../stores/storyStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useActionClasses } from '../../ui/stateStyles';
import { CastPicker } from './CastPicker';
import { STORY_LABELS } from './storyLabels';
import { useCommitField } from './useCommitField';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'flex-start',
		columnGap: tokens.spacingHorizontalM,
		rowGap: tokens.spacingVerticalS,
		padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
		marginBottom: tokens.spacingVerticalM,
		borderRadius: tokens.borderRadiusLarge,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground1,
	},
	field: {
		flex: '1 1 240px',
		minWidth: 0,
	},
	footer: {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: tokens.spacingHorizontalS,
		flexBasis: '100%',
	},
	progress: {
		color: tokens.colorNeutralForeground3,
	},
	wide: {
		flexBasis: '100%',
		minWidth: 0,
	},
	flowPanel: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
	},
	note: {
		minHeight: '72px',
	},
});

type FlowNote = 'logline' | 'synopsis' | 'style_notes';

/** Commit-field props of one flow note of the story (saved trimmed when the edit is done). */
function useFlowNote(story: Story, field: FlowNote, multiline = false) {
	const updateStory = useStoryStore((state) => state.updateStory);
	return useCommitField(
		story[field],
		(draft) => {
			const next = draft.trim();
			if (next === story[field]) {
				return false; // nothing to save: the field shows the saved text again
			}
			const patch: StoryPatch = { [field]: next };
			void updateStory(story.id, patch);
			return true;
		},
		{ multiline },
	);
}

function StoryFlow({ story }: { story: Story }): JSX.Element {
	const styles = useStyles();
	const logline = useFlowNote(story, 'logline');
	const synopsis = useFlowNote(story, 'synopsis', true);
	const styleNotes = useFlowNote(story, 'style_notes', true);
	const filled = [story.synopsis, story.style_notes].filter((note) => note.trim()).length;
	return (
		<>
			<Field label={STORY_LABELS.logline} className={styles.wide}>
				<Input {...logline} placeholder="The story in one sentence" />
			</Field>
			<Accordion collapsible className={styles.wide}>
				<AccordionItem value="flow">
					<AccordionHeader size="small">
						{STORY_LABELS.storyFlow}
						{filled > 0 ? ` (${filled} of 2)` : ''}
					</AccordionHeader>
					<AccordionPanel className={styles.flowPanel}>
						<Field label={STORY_LABELS.synopsis} hint="The whole story, beginning to end: the scenes' beats follow it.">
							<Textarea {...synopsis} className={styles.note} resize="vertical" placeholder="What happens in the story" />
						</Field>
						<Field label={STORY_LABELS.styleNotes} hint="The look and tone of the pictures and texts (Ctrl+Enter saves).">
							<Textarea {...styleNotes} className={styles.note} resize="vertical" placeholder="e.g. soft watercolor, warm light, for children" />
						</Field>
					</AccordionPanel>
				</AccordionItem>
			</Accordion>
		</>
	);
}

function DeleteStoryButton({ story }: { story: Story }): JSX.Element {
	const actions = useActionClasses();
	const deleteStory = useStoryStore((state) => state.deleteStory);
	const [confirming, setConfirming] = useState(false);
	const restoreFocusTarget = useRestoreFocusTarget();
	return (
		<>
			<Tooltip content={STORY_LABELS.deleteStory} relationship="label">
				<Button
					appearance="subtle"
					className={actions.subtle.danger}
					icon={<DeleteRegular />}
					aria-label={STORY_LABELS.deleteStory}
					onClick={() => setConfirming(true)}
					{...restoreFocusTarget}
				/>
			</Tooltip>
			<ConfirmDialog
				open={confirming}
				title={`Delete story '${story.title}'?`}
				confirmLabel="Delete"
				onConfirm={() => {
					setConfirming(false);
					void deleteStory(story.id);
				}}
				onDismiss={() => setConfirming(false)}
			>
				Its scenes and their texts are deleted. The pictures stay in your outputs.
			</ConfirmDialog>
		</>
	);
}

export function StoryHeader({ story }: { story: Story }): JSX.Element {
	const styles = useStyles();
	const outputIds = useOutputIdSet();
	const updateStory = useStoryStore((state) => state.updateStory);
	const title = useCommitField(story.title, (draft) => {
		const next = draft.trim();
		if (!next) {
			return false;
		}
		void updateStory(story.id, { title: next });
		return true;
	});
	return (
		<section className={styles.root} aria-label={`${story.title} settings`}>
			<Field label={STORY_LABELS.storyTitle} className={styles.field}>
				<Input {...title} />
			</Field>
			<div className={styles.field}>
				<CastPicker
					label={STORY_LABELS.storyCharacters}
					selectedIds={story.character_ids}
					onChange={(ids) => void updateStory(story.id, { character_ids: ids })}
					hint="In every scene without its own characters (none: the active character)"
				/>
			</div>
			<StoryFlow story={story} />
			<div className={styles.footer}>
				<Caption1 className={styles.progress}>{storyProgressText(storyProgress(story, outputIds))}</Caption1>
				<DeleteStoryButton story={story} />
			</div>
		</section>
	);
}
