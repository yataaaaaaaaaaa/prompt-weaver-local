// The co-writer's tools, as this window runs them (the backend sends the calls of a turn to the window that sent the
// message: src/stores/codexStore.ts runCall). THE single path of every tool: it reads the stores and acts through the
// story store's action API (createStory, addScene, updateScene, lockSubPrompt, setSceneOrder, generateScene, ...), so
// no story rule exists twice and the UI shows each change because it made it. The tool names and their arguments are
// the backend's (schemas.py CODEX_TOOL_ARGUMENTS, validated there); what Codex reads about them is services/codex/tools.py.
//
// Every tool answers a CodexToolResult (never throws): `text` for Codex (data as JSON, or why it failed, with what to
// do), `summary` for the conversation ('Added Scene 3 · The storm'), and the story / scene it acted on (the link of
// its activity row). A failure the store reported (a notification) is quoted in the answer.
import type { Character, CodexToolArguments, CodexToolCall, CodexToolName, CodexToolResult, Scene, ScenePatch, Story } from '../api/types';
import { sameCategoryName, subPromptKeyOf } from '../domain/categories';
import {
	categoriesForCodex,
	charactersForCodex,
	sceneLabel,
	storiesForCodex,
	storyForCodex,
} from '../domain/coWriter';
import { missingSceneIds, sceneOrderWithSceneAt } from '../domain/stories';
import { useCategoriesStore } from './categoriesStore';
import { useCharactersStore } from './charactersStore';
import { GENERATION_BUSY_MESSAGE, useGenerationStore } from './generationStore';
import { selectSelectedModel, useLibraryStore } from './libraryStore';
import { describeError, useNotificationsStore } from './notificationsStore';
import { selectOutputIdSet, useOutputsStore } from './outputsStore';
import { useStoryStore } from './storyStore';

const SUMMARY_LIMIT = 500;
const TEXT_LIMIT = 200_000;

export const NO_MODEL_MESSAGE =
	'No checkpoint is selected, so no picture can be generated. Ask the user to pick a model (Create: generation panel, or the Models section).';

type Target = { storyId?: string | null; sceneId?: string | null };

function clip(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function done(summary: string, data: unknown, target: Target = {}): CodexToolResult {
	return {
		ok: true,
		text: clip(JSON.stringify(data), TEXT_LIMIT),
		summary: clip(summary, SUMMARY_LIMIT),
		story_id: target.storyId ?? null,
		scene_id: target.sceneId ?? null,
	};
}

function failed(summary: string, text: string = summary, target: Target = {}): CodexToolResult {
	return { ok: false, text: clip(text, TEXT_LIMIT), summary: clip(summary, SUMMARY_LIMIT), story_id: target.storyId ?? null, scene_id: target.sceneId ?? null };
}

/** Runs a store action and collects the errors and warnings it notified (the reason of a null answer). */
async function reporting<T>(run: () => Promise<T>): Promise<{ value: T; problems: string[] }> {
	const before = new Set(useNotificationsStore.getState().notifications.map((item) => item.id));
	const value = await run();
	const problems = useNotificationsStore
		.getState()
		.notifications.filter((item) => !before.has(item.id) && (item.intent === 'error' || item.intent === 'warning'))
		.map((item) => (item.title ? `${item.title}: ${item.message}` : item.message));
	return { value, problems };
}

function becauseOf(problems: string[], fallback: string): string {
	return problems.length > 0 ? problems.join(' ') : fallback;
}

/** The story, read again from the backend once when this window does not know it (another window created it). */
async function findStory(storyId: string): Promise<Story | null> {
	const known = useStoryStore.getState().stories.find((story) => story.id === storyId);
	if (known) {
		return known;
	}
	await useStoryStore.getState().load();
	return useStoryStore.getState().stories.find((story) => story.id === storyId) ?? null;
}

type Found = { story: Story; scene: Scene } | { error: CodexToolResult };

const unknownStory = (storyId: string) => failed(`No story ${storyId}`, `There is no story ${storyId}. Call list_stories for the story ids.`);

async function findScene(storyId: string, sceneId: string): Promise<Found> {
	const story = await findStory(storyId);
	if (!story) {
		return { error: unknownStory(storyId) };
	}
	const scene = story.scenes.find((item) => item.id === sceneId);
	return scene
		? { story, scene }
		: { error: failed(`No scene ${sceneId} in ${story.title}`, `${story.title} has no scene ${sceneId}. Call get_story for its scene ids.`, { storyId }) };
}

/** The current copy of a story (after an action changed it). */
function current(storyId: string): Story | null {
	return useStoryStore.getState().stories.find((story) => story.id === storyId) ?? null;
}

function labelOf(storyId: string, sceneId: string, fallback: string): string {
	const story = current(storyId);
	return (story && sceneLabel(story, sceneId)) ?? fallback;
}

function unknownCharacters(ids: readonly string[], characters: readonly Character[]): CodexToolResult | null {
	const missing = ids.filter((id) => !characters.some((character) => character.id === id));
	return missing.length > 0
		? failed(`Unknown characters: ${missing.join(', ')}`, `These characters do not exist: ${missing.join(', ')}. Call list_characters for the character ids.`)
		: null;
}

/** Why no picture can be generated now (no model, a generation running), or null. */
function generationRefusal(target: Target): CodexToolResult | null {
	if (!selectSelectedModel(useLibraryStore.getState())) {
		return failed('No model selected', NO_MODEL_MESSAGE, target);
	}
	const generation = useGenerationStore.getState();
	if (useStoryStore.getState().generation || generation.generating || generation.continuous) {
		return failed('A generation is already running', GENERATION_BUSY_MESSAGE, target);
	}
	return null;
}

const PATCH_FIELD_NAMES: Readonly<Record<keyof ScenePatch, string>> = {
	title: 'title',
	text: 'text',
	extra_tags: 'tags',
	negative_tags: 'negative tags',
	locks: 'locked sub-prompts',
	character_ids: 'characters',
	seed: 'seed',
};

/** The ScenePatch of update_scene's arguments (null: unchanged; characters 'story' / seed 'random' clear). */
function scenePatchOf(args: CodexToolArguments<'update_scene'>): ScenePatch {
	const patch: ScenePatch = {};
	if (args.title !== null) patch.title = args.title;
	if (args.text !== null) patch.text = args.text;
	if (args.extra_tags !== null) patch.extra_tags = args.extra_tags;
	if (args.negative_tags !== null) patch.negative_tags = args.negative_tags;
	if (args.characters !== null) patch.character_ids = args.characters === 'story' ? null : args.characters;
	if (args.seed !== null) patch.seed = args.seed === 'random' ? null : args.seed;
	return patch;
}

type ToolHandlers = { [T in CodexToolName]: (args: CodexToolArguments<T>) => Promise<CodexToolResult> };

const TOOLS: ToolHandlers = {
	list_stories: async () => {
		const { stories, selectedStoryId } = useStoryStore.getState();
		return done('Read the stories', storiesForCodex(stories, selectedStoryId, selectOutputIdSet(useOutputsStore.getState())));
	},

	get_story: async ({ story_id }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		return done(`Read ${story.title}`, storyForCodex(story, useCharactersStore.getState().characters, selectOutputIdSet(useOutputsStore.getState())), { storyId: story.id });
	},

	list_characters: async () => {
		const { characters, activeId } = useCharactersStore.getState();
		return done('Read the characters', charactersForCodex(characters, activeId));
	},

	list_categories: async ({ query }) => done('Read the prompt categories', categoriesForCodex(useCategoriesStore.getState().categories, query)),

	create_story: async ({ title, character_ids }) => {
		const refusal = unknownCharacters(character_ids, useCharactersStore.getState().characters);
		if (refusal) {
			return refusal;
		}
		const { value: story, problems } = await reporting(() => useStoryStore.getState().createStory({ title, characterIds: character_ids }));
		if (!story) {
			return failed('Could not create the story', becauseOf(problems, 'The story could not be created.'));
		}
		return done(`Created ${story.title}`, { story_id: story.id, title: story.title }, { storyId: story.id });
	},

	update_story: async ({ story_id, title, character_ids }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const refusal = character_ids ? unknownCharacters(character_ids, useCharactersStore.getState().characters) : null;
		if (refusal) {
			return refusal;
		}
		const patch = { ...(title !== null ? { title } : {}), ...(character_ids !== null ? { character_ids } : {}) };
		if (Object.keys(patch).length === 0) {
			return failed('Nothing to change', 'Give a title or character_ids to change.', { storyId: story_id });
		}
		const { value: saved, problems } = await reporting(() => useStoryStore.getState().updateStory(story_id, patch));
		if (!saved) {
			return failed(`Could not edit ${story.title}`, becauseOf(problems, 'The story could not be saved.'), { storyId: story_id });
		}
		return done(`Edited ${saved.title}`, { story_id: saved.id, title: saved.title, character_ids: saved.character_ids }, { storyId: saved.id });
	},

	add_scene: async ({ story_id, title, text, extra_tags, negative_tags, characters, position }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const characterIds = characters === 'story' ? null : characters;
		const refusal = characterIds ? unknownCharacters(characterIds, useCharactersStore.getState().characters) : null;
		if (refusal) {
			return refusal;
		}
		const { value: scene, problems } = await reporting(() =>
			useStoryStore.getState().addScene(story_id, {
				title,
				text,
				extra_tags,
				negative_tags,
				character_ids: characterIds,
				index: position === null ? null : position - 1,
			}),
		);
		if (!scene) {
			return failed(`Could not add a scene to ${story.title}`, becauseOf(problems, 'The scene could not be added.'), { storyId: story_id });
		}
		const saved = current(story_id);
		const at = (saved?.scenes.findIndex((item) => item.id === scene.id) ?? -1) + 1;
		return done(`Added ${labelOf(story_id, scene.id, scene.title)}`, { scene_id: scene.id, position: at, title: scene.title }, { storyId: story_id, sceneId: scene.id });
	},

	update_scene: async (args) => {
		const found = await findScene(args.story_id, args.scene_id);
		if ('error' in found) {
			return found.error;
		}
		const patch = scenePatchOf(args);
		const fields = Object.keys(patch) as (keyof ScenePatch)[];
		if (fields.length === 0) {
			return failed('Nothing to change', 'Give at least one field to change.', { storyId: args.story_id, sceneId: args.scene_id });
		}
		if (patch.character_ids) {
			const refusal = unknownCharacters(patch.character_ids, useCharactersStore.getState().characters);
			if (refusal) {
				return refusal;
			}
		}
		const { value: saved, problems } = await reporting(() => useStoryStore.getState().updateScene(args.story_id, args.scene_id, patch));
		const target = { storyId: args.story_id, sceneId: args.scene_id };
		if (!saved) {
			return failed(`Could not edit ${found.scene.title}`, becauseOf(problems, 'The scene could not be saved.'), target);
		}
		const label = labelOf(args.story_id, args.scene_id, found.scene.title);
		return done(`Edited ${label} (${fields.map((field) => PATCH_FIELD_NAMES[field]).join(', ')})`, { scene_id: args.scene_id, changed: fields }, target);
	},

	lock_sub_prompt: async ({ story_id, scene_id, category, sub_prompt }) => {
		const found = await findScene(story_id, scene_id);
		if ('error' in found) {
			return found.error;
		}
		const target = { storyId: story_id, sceneId: scene_id };
		const categories = useCategoriesStore.getState().categories;
		const match = categories.find((item) => sameCategoryName(item.text, category));
		if (!match) {
			const names = categories.map((item) => item.text).slice(0, 40).join(', ');
			return failed(`No category ${category}`, `There is no prompt category "${category}". The categories: ${names}.`, target);
		}
		const prompt = match.subPrompts.find((item) => subPromptKeyOf(item.text) === subPromptKeyOf(sub_prompt));
		if (!prompt) {
			return failed(
				`No such sub-prompt of ${match.text}`,
				`"${sub_prompt}" is not a sub-prompt of ${match.text}. Call list_categories with query "${match.text}" for its sub-prompts.`,
				target,
			);
		}
		const { value: saved, problems } = await reporting(() => useStoryStore.getState().lockSubPrompt(story_id, scene_id, match.text, prompt.text));
		if (!saved) {
			return failed(`Could not lock ${match.text}`, becauseOf(problems, 'The scene could not be saved.'), target);
		}
		return done(`Locked ${match.text} in ${labelOf(story_id, scene_id, found.scene.title)}: ${clip(prompt.text, 60)}`, { category: match.text, sub_prompt: prompt.text }, target);
	},

	unlock_category: async ({ story_id, scene_id, category }) => {
		const found = await findScene(story_id, scene_id);
		if ('error' in found) {
			return found.error;
		}
		const target = { storyId: story_id, sceneId: scene_id };
		const lock = found.scene.locks.find((item) => sameCategoryName(item.category_name, category));
		if (!lock) {
			return failed(`${found.scene.title} has no lock of ${category}`, `${found.scene.title} has no locked sub-prompt of "${category}".`, target);
		}
		const { value: saved, problems } = await reporting(() => useStoryStore.getState().unlockCategory(story_id, scene_id, lock.category_name));
		if (!saved) {
			return failed(`Could not unlock ${lock.category_name}`, becauseOf(problems, 'The scene could not be saved.'), target);
		}
		return done(`Unlocked ${lock.category_name} in ${labelOf(story_id, scene_id, found.scene.title)}`, { category: lock.category_name }, target);
	},

	move_scene: async ({ story_id, scene_id, position }) => {
		const found = await findScene(story_id, scene_id);
		if ('error' in found) {
			return found.error;
		}
		const target = { storyId: story_id, sceneId: scene_id };
		const order = sceneOrderWithSceneAt(found.story.scenes.map((scene) => scene.id), scene_id, position);
		if (order === null) {
			return done(`${found.scene.title} stays at position ${found.story.scenes.indexOf(found.scene) + 1}`, { scene_id, moved: false }, target);
		}
		const { value: saved, problems } = await reporting(() => useStoryStore.getState().setSceneOrder(story_id, order));
		if (!saved) {
			return failed(`Could not move ${found.scene.title}`, becauseOf(problems, 'The scenes could not be reordered.'), target);
		}
		const at = saved.scenes.findIndex((scene) => scene.id === scene_id) + 1;
		return done(`Moved ${found.scene.title} to position ${at}`, { scene_id, position: at, order: saved.scenes.map((scene) => scene.id) }, target);
	},

	duplicate_scene: async ({ story_id, scene_id }) => {
		const found = await findScene(story_id, scene_id);
		if ('error' in found) {
			return found.error;
		}
		const { value: copy, problems } = await reporting(() => useStoryStore.getState().duplicateScene(story_id, scene_id));
		if (!copy) {
			return failed(`Could not duplicate ${found.scene.title}`, becauseOf(problems, 'The scene could not be duplicated.'), { storyId: story_id, sceneId: scene_id });
		}
		return done(`Duplicated ${found.scene.title} as ${labelOf(story_id, copy.id, copy.title)}`, { scene_id: copy.id, title: copy.title }, { storyId: story_id, sceneId: copy.id });
	},

	delete_scene: async ({ story_id, scene_id, user_confirmed }) => {
		const found = await findScene(story_id, scene_id);
		if ('error' in found) {
			return found.error;
		}
		const label = sceneLabel(found.story, scene_id) ?? found.scene.title;
		if (!user_confirmed) {
			return failed('Deletion not confirmed', `Ask the user to confirm that ${label} should be deleted, then call delete_scene with user_confirmed true.`, { storyId: story_id, sceneId: scene_id });
		}
		const { value: deleted, problems } = await reporting(() => useStoryStore.getState().deleteScene(story_id, scene_id));
		if (!deleted) {
			return failed(`Could not delete ${found.scene.title}`, becauseOf(problems, 'The scene could not be deleted.'), { storyId: story_id, sceneId: scene_id });
		}
		return done(`Deleted ${label}`, { scene_id, deleted: true }, { storyId: story_id });
	},

	generate_scene: async ({ story_id, scene_id }) => {
		const found = await findScene(story_id, scene_id);
		if ('error' in found) {
			return found.error;
		}
		const target = { storyId: story_id, sceneId: scene_id };
		const refusal = generationRefusal(target);
		if (refusal) {
			return refusal;
		}
		const label = sceneLabel(found.story, scene_id) ?? found.scene.title;
		const { value: record, problems } = await reporting(() => useStoryStore.getState().generateScene(story_id, scene_id));
		if (!record) {
			return failed(`Could not illustrate ${label}`, becauseOf(problems, 'The generation was cancelled.'), target);
		}
		return done(`Illustrated ${label}`, { scene_id, output_id: record.output_id, seed: record.seed }, target);
	},

	generate_missing_scenes: async ({ story_id }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const missing = missingSceneIds(story, selectOutputIdSet(useOutputsStore.getState()));
		if (missing.length === 0) {
			return done(`Every scene of ${story.title} has a picture`, { generated: 0 }, { storyId: story_id });
		}
		const refusal = generationRefusal({ storyId: story_id });
		if (refusal) {
			return refusal;
		}
		const { value: records, problems } = await reporting(() => useStoryStore.getState().generateMissing(story_id));
		const summary = `Illustrated ${records.length} of ${missing.length} scenes of ${story.title}`;
		const data = { generated: records.length, missing: missing.length, output_ids: records.map((record) => record.output_id) };
		if (records.length < missing.length) {
			return failed(summary, `${JSON.stringify(data)} ${becauseOf(problems, 'The run was cancelled.')}`, { storyId: story_id });
		}
		return done(summary, data, { storyId: story_id });
	},
};

/** Runs one tool call (never rejects). */
export async function runCoWriterTool(call: CodexToolCall): Promise<CodexToolResult> {
	const handler = TOOLS[call.tool] as (args: unknown) => Promise<CodexToolResult>;
	try {
		return await handler(call.arguments);
	} catch (error) {
		return failed(`${call.tool} failed`, `${call.tool} failed: ${describeError(error)}`);
	}
}
