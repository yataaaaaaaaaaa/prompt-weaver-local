// The actions on one scene shared by its card and its details: Generate (or Regenerate once illustrated; disabled
// while it cannot run: no model, another generation running), Duplicate and Delete (red, after a confirmation; its
// outputs are kept). Thin views over the story store.
import { Button, Tooltip, useRestoreFocusTarget, type ButtonProps } from '@fluentui/react-components';
import { CopyRegular, DeleteRegular, SparkleRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { Scene } from '../../api/types';
import { sceneIllustrationId } from '../../domain/stories';
import { useCanGenerateScenes, useOutputIdSet, useStoryStore } from '../../stores/storyStore';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { useActionClasses } from '../../ui/stateStyles';
import { STORY_LABELS } from './storyLabels';

type SceneActionProps = {
	storyId: string;
	scene: Scene;
	size?: ButtonProps['size'];
	/** Show the action's name next to its icon (the scene details); icon-only otherwise (the cards). */
	labeled?: boolean;
};

export function GenerateSceneButton({ storyId, scene, size = 'small', appearance = 'secondary' }: SceneActionProps & { appearance?: ButtonProps['appearance'] }): JSX.Element {
	const outputIds = useOutputIdSet();
	const canGenerate = useCanGenerateScenes();
	const generateScene = useStoryStore((state) => state.generateScene);
	const illustrated = sceneIllustrationId(scene, outputIds) !== null;
	const label = illustrated ? STORY_LABELS.regenerate : STORY_LABELS.generate;
	return (
		<Tooltip
			content={illustrated ? 'Make another picture of this scene (the current one stays a variant)' : 'Make the picture of this scene'}
			relationship="description"
		>
			<Button size={size} appearance={appearance} icon={<SparkleRegular />} disabled={!canGenerate} onClick={() => void generateScene(storyId, scene.id)}>
				{label}
			</Button>
		</Tooltip>
	);
}

export function DuplicateSceneButton({ storyId, scene, size = 'small', labeled = false }: SceneActionProps): JSX.Element {
	const duplicateScene = useStoryStore((state) => state.duplicateScene);
	const label = `${STORY_LABELS.duplicateScene} ${scene.title}`;
	return (
		<Tooltip content={label} relationship={labeled ? 'description' : 'label'}>
			<Button
				appearance="subtle"
				size={size}
				icon={<CopyRegular />}
				aria-label={labeled ? undefined : label}
				onClick={() => void duplicateScene(storyId, scene.id)}
			>
				{labeled ? STORY_LABELS.duplicateScene : undefined}
			</Button>
		</Tooltip>
	);
}

export function DeleteSceneButton({ storyId, scene, size = 'small', labeled = false }: SceneActionProps): JSX.Element {
	const actions = useActionClasses();
	const deleteScene = useStoryStore((state) => state.deleteScene);
	const [confirming, setConfirming] = useState(false);
	const restoreFocusTarget = useRestoreFocusTarget();
	const label = `${STORY_LABELS.deleteScene} ${scene.title}`;
	return (
		<>
			<Tooltip content={label} relationship={labeled ? 'description' : 'label'}>
				<Button
					appearance="subtle"
					size={size}
					className={actions.subtle.danger}
					icon={<DeleteRegular />}
					aria-label={labeled ? undefined : label}
					onClick={() => setConfirming(true)}
					{...restoreFocusTarget}
				>
					{labeled ? STORY_LABELS.deleteScene : undefined}
				</Button>
			</Tooltip>
			<ConfirmDialog
				open={confirming}
				title={`Delete scene '${scene.title}'?`}
				confirmLabel="Delete"
				onConfirm={() => {
					setConfirming(false);
					void deleteScene(storyId, scene.id);
				}}
				onDismiss={() => setConfirming(false)}
			>
				Its text and prompt settings are deleted. Its pictures stay in your outputs.
			</ConfirmDialog>
		</>
	);
}
