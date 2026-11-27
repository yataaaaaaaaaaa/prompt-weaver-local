// Stories (pure): how a story scene is illustrated through the EXISTING prompt engine (its prompt overrides become
// PINNED categories, like the characters' tags), which scenes still need an illustration, the prefill of a scene from
// an output ("Add to story"), the scene lock edits, scene moves, the reader's pages and the export file name. The story
// store (src/stores/storyStore.ts) holds the stories (the backend owns them: backend/app/services/stories.py, which
// also owns the variant rules); generation goes through buildGenerationRequest (src/domain/generationRequest.ts, its
// `scene` input) and the generation store, never through a second path.
//
// Precedence of a scene generation, documented once, here (README "Story" links to it):
// 1. Characters (the cast): the scene's characters when it names them (scene.character_ids; [] = no character), else
//    the story's characters, else the active character (like Create). Unknown ids are skipped (and reported). The
//    cast takes part like the active character in Create (src/domain/characters.ts, rule 9 for several characters).
// 2. Pinned categories, in this order, before every user category (scenePinnedCategories): the cast's ('Character',
//    'Character outfit', ...), then one per scene lock (named after the lock's category; its locked sub-prompt is the
//    lock's text, with the prompt-linked LoRAs of the user sub-prompt of that text when it still exists), then 'Scene'
//    (the scene's extra tags). A lock REPLACES the user category of the same key for that generation (the user
//    category is left out); a lock of a category the cast pins is ignored (the cast wins); the first lock of a
//    category wins. Forbidden rules apply like for any pinned category (src/domain/promptEngine.ts).
// 3. Negative tags: the cast's, then the scene's, each appended once (appendNegativeTags).
// 4. LoRAs (resolveLoraSelection): the cast's, then the scene's own (scene.loras), then the selected LoRAs, then the
//    prompt-linked ones. A scene LoRA uses the scene's weight, also when the cast or the selection has it (weight 0
//    turns a LoRA off for that scene); a cast LoRA uses the character's weight over the selected one; a LoRA that is
//    only prompt-linked gets the default weight. Scene LoRAs missing from the library are skipped with a warning.
// 5. Seeds: the image seed is the scene's fixed seed, else the cast's locked seed, else a new random seed (so every
//    regeneration is a new variant). The prompt seed follows the Create prompt seed field (planSeed of its behavior; with
//    the per-category cycle a random seed is drawn instead and the counters are neither read nor advanced). A scene
//    generation never changes the seed fields and pushes no undo entry.
// 6. The request names the scene (GenerateRequest.story): the backend records OutputRecord.story and makes the output
//    the scene's chosen variant. The output is a normal output (listed in Create's filmstrip).
// The flow notes (the story's logline, synopsis and style notes; a scene's beat, shot, setting and mood) plan the story
// and are never added to a prompt: the tags, locks, LoRAs, cast and seed are what a picture is made from.
import type { Character, LoraWeight, OutputRecord, Scene, SceneCreateRequest, SceneLock, ScenePatch, Story, StoryCreateRequest } from '../api/types';
import { boardMoveTarget, moveKeyNextTo, type BoardMove, type Placement } from './board';
import { categoryKeyOf, makeCategory, makeSubPrompt, sortCategories, subPromptKeyOf, type Category } from './categories';
import { castCategories, lockedCastSeed, type CharacterGenerationInput } from './characters';
import { clamp } from './guards';
import { joinPromptTags, uniqueDisplayName, uniqueKey } from './text';

/** Name of the pinned category holding a scene's extra tags (made unique against the other categories). */
export const SCENE_CATEGORY_NAME = 'Scene';

/** What a scene generation adds to the regular generation inputs (buildGenerationRequest `scene`). */
export type SceneGenerationInput = {
	storyId: string;
	sceneId: string;
	/** The scene's characters, in order (sceneCast); they replace the active character. */
	cast: readonly CharacterGenerationInput[];
	locks: readonly SceneLock[];
	extraTags: readonly string[];
	negativeTags: readonly string[];
	/** Fixed image seed (null: the cast's locked seed, else random). */
	seed: number | null;
	/** The scene's own LoRAs with their weights (rule 4). */
	loras: readonly LoraWeight[];
};

/** The flow notes of a new scene (empty) and the text: what a SceneCreateRequest needs besides its overrides. */
export const EMPTY_SCENE_NOTES = { text: '', beat: '', shot: '', setting: '', mood: '' } as const;

/** A scene to add: `fields` over empty notes and text. */
export function newSceneRequest(fields: Partial<SceneCreateRequest> = {}): SceneCreateRequest {
	return { ...EMPTY_SCENE_NOTES, ...fields };
}

/** The flow of a new story (empty). */
export const EMPTY_STORY_FLOW = { logline: '', synopsis: '', style_notes: '' } as const;

/** A story to create: `fields` over an empty flow and no characters. */
export function newStoryRequest(fields: Partial<StoryCreateRequest> & Pick<StoryCreateRequest, 'title'>): StoryCreateRequest {
	return { character_ids: [], ...EMPTY_STORY_FLOW, ...fields };
}

// ---------------------------------------------------------------------------
// Prompt building (pinned categories)
// ---------------------------------------------------------------------------

/** The pinned categories of a scene generation (rule 2: cast, locks, 'Scene') and the user categories left for the
 *  prompt engine (those replaced by a lock removed). */
export function scenePinnedCategories(
	scene: Pick<SceneGenerationInput, 'cast' | 'locks' | 'extraTags'>,
	userCategories: readonly Category[],
): { pinned: Category[]; userCategories: Category[] } {
	const cast = castCategories(scene.cast, userCategories);
	const pinnedKeys = new Set(cast.map((category) => categoryKeyOf(category.text)));
	const replacedKeys = new Set<string>();
	const locked: Category[] = [];
	for (const lock of scene.locks) {
		const key = categoryKeyOf(lock.category_name);
		if (pinnedKeys.has(key) || replacedKeys.has(key)) {
			continue;
		}
		replacedKeys.add(key);
		const userCategory = userCategories.find((category) => categoryKeyOf(category.text) === key);
		const promptKey = subPromptKeyOf(lock.prompt_text);
		const userSubPrompt = userCategory?.subPrompts.find((subPrompt) => subPromptKeyOf(subPrompt.text) === promptKey);
		locked.push({
			...makeCategory(userCategory?.text ?? lock.category_name),
			subPrompts: [{ ...makeSubPrompt(lock.prompt_text), state: 'lock', extraLoraIds: [...(userSubPrompt?.extraLoraIds ?? [])] }],
		});
	}
	const remaining = userCategories.filter((category) => !replacedKeys.has(categoryKeyOf(category.text)));
	const tagsText = joinPromptTags(scene.extraTags);
	const sceneCategories: Category[] = [];
	if (tagsText) {
		const takenKeys = new Set([...remaining.map((category) => categoryKeyOf(category.text)), ...pinnedKeys, ...replacedKeys]);
		const name = takenKeys.has(categoryKeyOf(SCENE_CATEGORY_NAME)) ? uniqueKey(SCENE_CATEGORY_NAME, takenKeys) : SCENE_CATEGORY_NAME;
		sceneCategories.push({ ...makeCategory(name), subPrompts: [{ ...makeSubPrompt(tagsText), state: 'lock' }] });
	}
	return { pinned: [...cast, ...locked, ...sceneCategories], userCategories: remaining };
}

/** The image seed a scene imposes (rule 5): its fixed seed, else its cast's locked seed (lockedCastSeed), else null (a
 *  new random seed for every picture). */
export function sceneLockedSeed(scene: Pick<SceneGenerationInput, 'seed' | 'cast'>): number | null {
	return scene.seed ?? lockedCastSeed(scene.cast);
}

// ---------------------------------------------------------------------------
// Characters of a scene
// ---------------------------------------------------------------------------

/** Where a scene's characters come from (rule 1). */
export type SceneCastSource = 'scene' | 'story' | 'active';

export function sceneCastSource(story: Pick<Story, 'character_ids'>, scene: Pick<Scene, 'character_ids'>): SceneCastSource {
	if (scene.character_ids !== null) {
		return 'scene';
	}
	return story.character_ids.length > 0 ? 'story' : 'active';
}

/** The characters of a scene (rule 1), in order, and the ids naming no character (skipped). */
export function sceneCast(
	story: Pick<Story, 'character_ids'>,
	scene: Pick<Scene, 'character_ids'>,
	characters: readonly Character[],
	activeCharacter: Character | null,
): { cast: Character[]; missingIds: string[] } {
	const source = sceneCastSource(story, scene);
	if (source === 'active') {
		return { cast: activeCharacter ? [activeCharacter] : [], missingIds: [] };
	}
	return resolveCharacters(source === 'scene' ? (scene.character_ids ?? []) : story.character_ids, characters);
}

/** The characters named by `ids`, in order (unique), and the ids naming no character. */
export function resolveCharacters(ids: readonly string[], characters: readonly Character[]): { cast: Character[]; missingIds: string[] } {
	const byId = new Map(characters.map((character) => [character.id, character]));
	const cast: Character[] = [];
	const missingIds: string[] = [];
	for (const id of new Set(ids)) {
		const character = byId.get(id);
		if (character) {
			cast.push(character);
		} else {
			missingIds.push(id);
		}
	}
	return { cast, missingIds };
}

/** The generation input of a scene (SceneGenerationInput) and the character ids that were skipped. */
export function sceneGenerationInput(
	story: Story,
	scene: Scene,
	characters: readonly Character[],
	activeCharacter: Character | null,
): { input: SceneGenerationInput; missingCharacterIds: string[] } {
	const { cast, missingIds } = sceneCast(story, scene, characters, activeCharacter);
	return {
		input: {
			storyId: story.id,
			sceneId: scene.id,
			cast,
			locks: scene.locks,
			extraTags: scene.extra_tags,
			negativeTags: scene.negative_tags,
			seed: scene.seed,
			loras: scene.loras,
		},
		missingCharacterIds: missingIds,
	};
}

// ---------------------------------------------------------------------------
// Illustration state
// ---------------------------------------------------------------------------

/** The output illustrating the scene: its chosen variant while that output still exists (`outputIds`: the outputs on
 *  disk), else null. */
export function sceneIllustrationId(scene: Pick<Scene, 'chosen_output_id'>, outputIds: ReadonlySet<string>): string | null {
	return scene.chosen_output_id !== null && outputIds.has(scene.chosen_output_id) ? scene.chosen_output_id : null;
}

/** The scenes without an illustration (sceneIllustrationId null), in story order: what "Generate missing" generates. */
export function missingSceneIds(story: Pick<Story, 'scenes'>, outputIds: ReadonlySet<string>): string[] {
	return story.scenes.filter((scene) => sceneIllustrationId(scene, outputIds) === null).map((scene) => scene.id);
}

/** The cover of a story: the illustration of its first illustrated scene (null: none). */
export function storyCoverId(story: Pick<Story, 'scenes'>, outputIds: ReadonlySet<string>): string | null {
	for (const scene of story.scenes) {
		const illustration = sceneIllustrationId(scene, outputIds);
		if (illustration !== null) {
			return illustration;
		}
	}
	return null;
}

/** How far a story is illustrated: its scene count and how many of them have an illustration. */
export function storyProgress(story: Pick<Story, 'scenes'>, outputIds: ReadonlySet<string>): { scenes: number; illustrated: number } {
	return { scenes: story.scenes.length, illustrated: story.scenes.length - missingSceneIds(story, outputIds).length };
}

/** 'No scenes', '1 scene · not illustrated', '3 scenes · 2 illustrated', '3 scenes · all illustrated'. */
export function storyProgressText({ scenes, illustrated }: { scenes: number; illustrated: number }): string {
	if (scenes === 0) {
		return 'No scenes';
	}
	const count = scenes === 1 ? '1 scene' : `${scenes} scenes`;
	const state = illustrated === 0 ? 'not illustrated' : illustrated === scenes ? 'all illustrated' : `${illustrated} illustrated`;
	return `${count} · ${state}`;
}

/** The variants of a scene whose output still exists, oldest first. */
export function availableVariantIds(scene: Pick<Scene, 'variants'>, outputIds: ReadonlySet<string>): string[] {
	return scene.variants.map((variant) => variant.output_id).filter((outputId) => outputIds.has(outputId));
}

/** The state of a scene's illustration, in precedence order: being generated, waiting in a "Generate missing" run,
 *  illustrated, not illustrated. */
export type SceneStatus = 'generating' | 'queued' | 'illustrated' | 'missing';

export type StoryGenerationProgress = {
	/** The scene being generated (null between two scenes). */
	currentSceneId: string | null;
	/** The scenes still waiting, in order. */
	queuedSceneIds: readonly string[];
};

export function sceneStatus(
	scene: Pick<Scene, 'id' | 'chosen_output_id'>,
	outputIds: ReadonlySet<string>,
	generation: StoryGenerationProgress | null,
): SceneStatus {
	if (generation?.currentSceneId === scene.id) {
		return 'generating';
	}
	if (generation?.queuedSceneIds.includes(scene.id)) {
		return 'queued';
	}
	return sceneIllustrationId(scene, outputIds) === null ? 'missing' : 'illustrated';
}

// ---------------------------------------------------------------------------
// Add to story: a scene prefilled from an output
// ---------------------------------------------------------------------------

function sameIds(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** The characters of a NEW story made from an output: the output's character (none without one). */
export function storyCharacterIdsFromOutput(record: Pick<OutputRecord, 'character'>): string[] {
	return record.character ? [record.character.id] : [];
}

/** "Add to story": a new scene illustrated by the output (its first, chosen variant), reproducing it:
 * - characters: none of its own when the story's characters (`storyCharacterIds`) are exactly the output's character
 *   (or the output had none and the story names none); else the output's character, or [] (no character);
 * - locks: every selection of the output, in order (the first one of a category), except those of the categories the
 *   scene's characters pin (rule 2: the cast wins; computed with castCategories against `userCategories`);
 * - seed: the output's image seed (fixed, so a regeneration reproduces it); no extra or negative tags; the backend
 *   titles it 'Scene <n>'. */
export function sceneFromOutput(
	record: Pick<OutputRecord, 'output_id' | 'selections' | 'character' | 'image_seed' | 'seed'>,
	storyCharacterIds: readonly string[],
	characters: readonly Character[],
	userCategories: readonly Category[],
): SceneCreateRequest {
	const outputCast = storyCharacterIdsFromOutput(record);
	const character_ids = sameIds(outputCast, storyCharacterIds) ? null : outputCast;
	const castIds = character_ids ?? storyCharacterIds;
	const pinnedKeys = new Set(
		castCategories(resolveCharacters(castIds, characters).cast, userCategories).map((category) => categoryKeyOf(category.text)),
	);
	let locks: SceneLock[] = [];
	for (const selection of record.selections) {
		if (selection.prompt_text.trim() && !pinnedKeys.has(categoryKeyOf(selection.category_name))) {
			locks = withSceneLock(locks, selection.category_name, selection.prompt_text, { replace: false });
		}
	}
	return newSceneRequest({ output_id: record.output_id, character_ids, locks, seed: record.image_seed ?? record.seed });
}

// ---------------------------------------------------------------------------
// Scene locks (chosen sub-prompts)
// ---------------------------------------------------------------------------

/** `locks` with `promptText` locked for `categoryName`: the lock of that category (by key) is replaced in place, else
 *  the new lock is appended. `replace: false` keeps an existing lock of the category instead. */
export function withSceneLock(
	locks: readonly SceneLock[],
	categoryName: string,
	promptText: string,
	{ replace = true }: { replace?: boolean } = {},
): SceneLock[] {
	const key = categoryKeyOf(categoryName);
	const index = locks.findIndex((lock) => categoryKeyOf(lock.category_name) === key);
	const lock: SceneLock = { category_name: categoryName, prompt_text: promptText };
	if (index < 0) {
		return [...locks, lock];
	}
	return replace ? locks.map((item, position) => (position === index ? lock : item)) : [...locks];
}

/** `locks` without the lock of `categoryName` (by key). */
export function withoutSceneLock(locks: readonly SceneLock[], categoryName: string): SceneLock[] {
	const key = categoryKeyOf(categoryName);
	return locks.filter((lock) => categoryKeyOf(lock.category_name) !== key);
}

/** The sub-prompts a scene can lock, per user category in generation order (sortCategories), blank ones left out;
 *  categories without any are omitted. */
export function sceneLockOptions(userCategories: readonly Category[]): { categoryName: string; prompts: string[] }[] {
	return sortCategories(userCategories)
		.map((category) => ({ categoryName: category.text, prompts: category.subPrompts.map((subPrompt) => subPrompt.text).filter((text) => text.trim()) }))
		.filter((group) => group.prompts.length > 0);
}

/** Whether a lock applies to a scene generation with these characters (rule 2: a lock of a category the cast pins is
 *  ignored), for the scene editor. */
export function isLockOverriddenByCast(lock: SceneLock, cast: readonly CharacterGenerationInput[], userCategories: readonly Category[]): boolean {
	const key = categoryKeyOf(lock.category_name);
	return castCategories(cast, userCategories).some((category) => categoryKeyOf(category.text) === key);
}

// ---------------------------------------------------------------------------
// Local copies (the story store shows a scene change at once, then the backend's answer replaces it)
// ---------------------------------------------------------------------------

/** `story` with the fields `patch` sends (undefined ones left out) applied to its scene `sceneId`; the same story when
 *  it has no such scene. The backend's answer (services/stories.py) is the truth: this is the optimistic copy. */
export function withScenePatch(story: Story, sceneId: string, patch: ScenePatch): Story {
	const sent = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<Scene>;
	if (!story.scenes.some((scene) => scene.id === sceneId)) {
		return story;
	}
	return { ...story, scenes: story.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...sent } : scene)) };
}

/** `stories` with `story` replacing the story of the same id, or appended. */
export function withStory(stories: readonly Story[], story: Story): Story[] {
	const index = stories.findIndex((item) => item.id === story.id);
	return index < 0 ? [...stories, story] : stories.map((item, position) => (position === index ? story : item));
}

// ---------------------------------------------------------------------------
// Scene order (the moves of the prompt board's cards: src/domain/board.ts)
// ---------------------------------------------------------------------------

/** The scene order after a keyboard move of `sceneId` (boardMoveTarget among every scene); null when it does not
 *  change. */
export function sceneOrderAfterMove(sceneIds: readonly string[], sceneId: string, move: BoardMove): string[] | null {
	const target = boardMoveTarget(sceneIds, sceneId, move);
	return target ? moveKeyNextTo(sceneIds, sceneId, target.target, target.placement) : null;
}

/** The scene order with `sceneId` at the 1-based `position` (clamped to the story); null when it does not change or the
 *  story has no such scene. */
export function sceneOrderWithSceneAt(sceneIds: readonly string[], sceneId: string, position: number): string[] | null {
	if (!sceneIds.includes(sceneId)) {
		return null;
	}
	const rest = sceneIds.filter((id) => id !== sceneId);
	const index = Math.max(0, Math.min(rest.length, Math.floor(position) - 1));
	const order = [...rest.slice(0, index), sceneId, ...rest.slice(index)];
	return order.every((id, at) => id === sceneIds[at]) ? null : order;
}

/** The scene order after `sceneId` was dropped before / after `targetId`; null when it does not change. */
export function sceneOrderAfterDrop(sceneIds: readonly string[], sceneId: string, targetId: string, placement: Placement): string[] | null {
	const order = moveKeyNextTo(sceneIds, sceneId, targetId, placement);
	return order.every((id, index) => id === sceneIds[index]) ? null : order;
}

// ---------------------------------------------------------------------------
// Names, reader, export
// ---------------------------------------------------------------------------

/** Default title of a new story. */
export const NEW_STORY_TITLE = 'New story';

/** Title of a new story: 'New story', else 'New story 2', 3, ... (uniqueDisplayName). */
export function newStoryTitle(stories: readonly Pick<Story, 'title'>[]): string {
	return uniqueDisplayName(NEW_STORY_TITLE, stories.map((story) => story.title));
}

/** A reader page (0-based scene index) kept within the story's scenes (0 without scenes). */
export function clampReaderPage(page: number, sceneCount: number): number {
	return sceneCount <= 0 || !Number.isFinite(page) ? 0 : clamp(Math.trunc(page), 0, sceneCount - 1);
}

/** The reader keys: ArrowLeft / ArrowUp / PageUp = previous page, ArrowRight / ArrowDown / PageDown / Space = next,
 *  Home / End = first / last. */
const READER_KEYS: ReadonlyMap<string, BoardMove> = new Map([
	['ArrowLeft', 'previous'],
	['ArrowUp', 'previous'],
	['PageUp', 'previous'],
	['ArrowRight', 'next'],
	['ArrowDown', 'next'],
	['PageDown', 'next'],
	[' ', 'next'],
	['Home', 'first'],
	['End', 'last'],
]);

/** The page a reader key leads to from `page` (null for any other key). */
export function readerPageForKey(key: string, page: number, sceneCount: number): number | null {
	const move = READER_KEYS.get(key);
	if (move === undefined) {
		return null;
	}
	const target = { previous: page - 1, next: page + 1, first: 0, last: sceneCount - 1 }[move];
	return clampReaderPage(target, sceneCount);
}

/** Characters Windows forbids in file names (and control characters). */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]+/g;
const MAX_FILE_NAME_LENGTH = 120;

/** The file name of a story's HTML export: its title without characters file systems forbid, at most 120 characters,
 *  '.html' appended ('Story.html' for a title with nothing usable). */
export function storyExportFileName(title: string): string {
	const cleaned = title
		.replace(FORBIDDEN_FILE_NAME_CHARACTERS, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_FILE_NAME_LENGTH)
		.replace(/[. ]+$/, '');
	return `${cleaned || 'Story'}.html`;
}
