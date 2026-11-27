// The settings of the selected story, above its scenes: its title (saved when the edit is done; a blank title is
// refused), its characters (CastPicker: applied to every scene that does not name its own), how far it is illustrated,
// and Delete story (red, after a confirmation; its outputs are kept). Thin view over the story store.
import { Button, Caption1, Field, Input, makeStyles, tokens, Tooltip, useRestoreFocusTarget } from '@fluentui/react-components';
import { DeleteRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { Story } from '../../api/types';
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
});

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
			<div className={styles.footer}>
				<Caption1 className={styles.progress}>{storyProgressText(storyProgress(story, outputIds))}</Caption1>
				<DeleteStoryButton story={story} />
			</div>
		</section>
	);
}
