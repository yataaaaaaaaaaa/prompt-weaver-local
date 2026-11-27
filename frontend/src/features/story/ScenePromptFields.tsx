// The prompt part of the scene details: what this scene's pictures add to the prompt board, the characters and the
// model (the precedence is src/domain/stories.ts): its tags (the pinned 'Scene' category), its locked sub-prompts (one
// per category, each replacing that category's pick; a lock of a category the characters pin is marked as replaced),
// its negative tags, its characters (the story's by default, or its own: none at all is allowed) and its fixed seed
// (empty: a new seed for every picture; the shuffle button in the field clears it). Every field saves when the edit is
// done. Thin view over the story,
// categories and characters stores.
import {
	Button,
	Caption1,
	Combobox,
	Field,
	Input,
	makeStyles,
	Option,
	OptionGroup,
	Switch,
	tokens,
	Tooltip,
} from '@fluentui/react-components';
import { ArrowShuffleRegular, DismissRegular, LockClosedRegular } from '@fluentui/react-icons';
import { useMemo, useState } from 'react';
import type { Scene, Story } from '../../api/types';
import { nonNegativeSeedOf } from '../../domain/seeds';
import { isLockOverriddenByCast, sceneCast, sceneCastSource, sceneLockOptions } from '../../domain/stories';
import { joinPromptTags, splitPromptTags, textContains } from '../../domain/text';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { selectActiveCharacter, useCharactersStore } from '../../stores/charactersStore';
import { useStoryStore } from '../../stores/storyStore';
import { useActionClasses, useStateAccentClasses } from '../../ui/stateStyles';
import { CastPicker } from './CastPicker';
import { STORY_LABELS } from './storyLabels';
import { useCommitField } from './useCommitField';

/** Separates a lock option's category name from its sub-prompt in the option value. */
const LOCK_VALUE_SEPARATOR = '\u0000';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalM,
		minWidth: 0,
	},
	locks: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXS,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	lock: {
		display: 'grid',
		gridTemplateColumns: 'auto minmax(0, 1fr) auto',
		alignItems: 'center',
		columnGap: tokens.spacingHorizontalS,
		padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalS}`,
		borderRadius: tokens.borderRadiusMedium,
		backgroundColor: tokens.colorNeutralBackground2,
	},
	lockText: {
		display: 'flex',
		flexDirection: 'column',
		minWidth: 0,
		overflowWrap: 'anywhere',
	},
	lockCategory: {
		color: tokens.colorNeutralForeground3,
	},
	replaced: {
		color: tokens.colorNeutralForeground3,
		fontStyle: 'italic',
	},
	combobox: {
		minWidth: 0,
		width: '100%',
	},
	castNames: {
		color: tokens.colorNeutralForeground2,
	},
});

type FieldsProps = { story: Story; scene: Scene };

function TagsField({ label, hint, tags, onCommit }: { label: string; hint: string; tags: readonly string[]; onCommit: (tags: string[]) => void }): JSX.Element {
	const field = useCommitField(joinPromptTags(tags), (draft) => {
		onCommit(splitPromptTags(draft));
	});
	return (
		<Field label={label} hint={hint}>
			<Input {...field} placeholder="Comma-separated tags" />
		</Field>
	);
}

function LockedSubPrompts({ story, scene }: FieldsProps): JSX.Element {
	const styles = useStyles();
	const accent = useStateAccentClasses();
	const actions = useActionClasses();
	const categories = useCategoriesStore((state) => state.categories);
	const characters = useCharactersStore((state) => state.characters);
	const active = useCharactersStore(selectActiveCharacter);
	const lockSubPrompt = useStoryStore((state) => state.lockSubPrompt);
	const unlockCategory = useStoryStore((state) => state.unlockCategory);
	const [query, setQuery] = useState('');
	const groups = useMemo(() => sceneLockOptions(categories), [categories]);
	const cast = useMemo(() => sceneCast(story, scene, characters, active).cast, [story, scene, characters, active]);
	const shown = groups
		.map((group) => ({
			...group,
			prompts: query.trim() ? group.prompts.filter((prompt) => textContains(prompt, query) || textContains(group.categoryName, query)) : group.prompts,
		}))
		.filter((group) => group.prompts.length > 0);

	return (
		<Field label={STORY_LABELS.lockedSubPrompts} hint="Chosen for this scene: each one replaces what its category would pick.">
			<>
				{scene.locks.length > 0 ? (
					<ul className={styles.locks}>
						{scene.locks.map((lock) => {
							const replaced = isLockOverriddenByCast(lock, cast, categories);
							const removeLabel = `Unlock ${lock.category_name}`;
							return (
								<li key={lock.category_name} className={styles.lock}>
									<LockClosedRegular className={accent.locked} aria-hidden />
									<span className={styles.lockText}>
										<Caption1 className={styles.lockCategory}>{lock.category_name}</Caption1>
										<span className={replaced ? styles.replaced : undefined}>{lock.prompt_text}</span>
										{replaced ? <Caption1 className={styles.replaced}>Replaced by the scene's character</Caption1> : null}
									</span>
									<Tooltip content={removeLabel} relationship="label">
										<Button
											appearance="subtle"
											size="small"
											className={actions.subtle.warning}
											icon={<DismissRegular />}
											aria-label={removeLabel}
											onClick={() => void unlockCategory(story.id, scene.id, lock.category_name)}
										/>
									</Tooltip>
								</li>
							);
						})}
					</ul>
				) : null}
				<Combobox
					className={styles.combobox}
					aria-label={STORY_LABELS.lockSubPrompt}
					placeholder={groups.length > 0 ? 'Lock a sub-prompt of a category' : 'No category has sub-prompts yet'}
					disabled={groups.length === 0}
					value={query}
					selectedOptions={[]}
					onChange={(event) => setQuery(event.target.value)}
					onOptionSelect={(_event, data) => {
						const [categoryName, promptText] = (data.optionValue ?? '').split(LOCK_VALUE_SEPARATOR);
						if (categoryName && promptText) {
							void lockSubPrompt(story.id, scene.id, categoryName, promptText);
						}
						setQuery('');
					}}
				>
					{shown.map((group) => (
						<OptionGroup key={group.categoryName} label={group.categoryName}>
							{group.prompts.map((prompt) => (
								<Option key={prompt} value={`${group.categoryName}${LOCK_VALUE_SEPARATOR}${prompt}`} text={prompt}>
									{prompt}
								</Option>
							))}
						</OptionGroup>
					))}
				</Combobox>
			</>
		</Field>
	);
}

function SceneCharacters({ story, scene }: FieldsProps): JSX.Element {
	const styles = useStyles();
	const characters = useCharactersStore((state) => state.characters);
	const active = useCharactersStore(selectActiveCharacter);
	const updateScene = useStoryStore((state) => state.updateScene);
	const source = sceneCastSource(story, scene);
	const cast = sceneCast(story, scene, characters, active).cast;
	const names = cast.map((character) => character.name).join(', ');
	const ownCharacters = scene.character_ids !== null;
	const sameLabel = story.character_ids.length > 0 ? STORY_LABELS.sameCharacters : `${STORY_LABELS.sameCharacters} (the active character)`;
	return (
		<div className={styles.root}>
			<Switch
				label={sameLabel}
				checked={!ownCharacters}
				onChange={(_event, data) => void updateScene(story.id, scene.id, { character_ids: data.checked ? null : cast.map((character) => character.id) })}
			/>
			{ownCharacters ? (
				<CastPicker
					label={STORY_LABELS.sceneCharacters}
					selectedIds={scene.character_ids ?? []}
					onChange={(ids) => void updateScene(story.id, scene.id, { character_ids: ids })}
					hint="None: no character in this scene"
				/>
			) : (
				<Caption1 className={styles.castNames}>
					{names ? `In this scene: ${names}` : source === 'active' ? 'No character is active: the scene has none.' : 'No character.'}
				</Caption1>
			)}
		</div>
	);
}

function SeedField({ story, scene }: FieldsProps): JSX.Element {
	const updateScene = useStoryStore((state) => state.updateScene);
	const [error, setError] = useState<string | null>(null);
	const field = useCommitField(scene.seed === null ? '' : String(scene.seed), (draft) => {
		if (!draft.trim()) {
			setError(null);
			void updateScene(story.id, scene.id, { seed: null });
			return true;
		}
		const seed = nonNegativeSeedOf(draft);
		if (seed === null) {
			setError('The seed must be a whole number of 0 or more.');
			return false;
		}
		setError(null);
		void updateScene(story.id, scene.id, { seed });
		return true;
	});
	return (
		<Field
			label={STORY_LABELS.seed}
			hint={error ? undefined : 'Empty: a new seed for every picture. Fixed: the same picture again.'}
			validationMessage={error ?? undefined}
			validationState={error ? 'error' : 'none'}
		>
			<Input
				{...field}
				inputMode="numeric"
				placeholder="Random"
				contentAfter={
					<Tooltip content={STORY_LABELS.randomSeed} relationship="label">
						<Button
							appearance="transparent"
							size="small"
							icon={<ArrowShuffleRegular />}
							disabled={scene.seed === null}
							onClick={() => void updateScene(story.id, scene.id, { seed: null })}
						/>
					</Tooltip>
				}
			/>
		</Field>
	);
}

export function ScenePromptFields({ story, scene }: FieldsProps): JSX.Element {
	const styles = useStyles();
	const updateScene = useStoryStore((state) => state.updateScene);
	return (
		<div className={styles.root}>
			<TagsField
				label={STORY_LABELS.extraTags}
				hint="Added to the prompt of this scene (what happens, where, when)."
				tags={scene.extra_tags}
				onCommit={(tags) => void updateScene(story.id, scene.id, { extra_tags: tags })}
			/>
			<LockedSubPrompts story={story} scene={scene} />
			<TagsField
				label={STORY_LABELS.negativeTags}
				hint="Added to the negative prompt of this scene."
				tags={scene.negative_tags}
				onCommit={(tags) => void updateScene(story.id, scene.id, { negative_tags: tags })}
			/>
			<SceneCharacters story={story} scene={scene} />
			<SeedField story={story} scene={scene} />
		</div>
	);
}
