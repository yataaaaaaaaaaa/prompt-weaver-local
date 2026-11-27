// The co-writer's tools, as this window runs them (the backend sends the calls of a turn to the window that sent the
// message: src/stores/codexStore.ts runCall). THE single path of every tool: it reads the stores and acts through their
// action APIs (story: createStory, addScenes, updateScenes, setSceneOrder, generateScenes, chooseVariant, previewScene,
// ...; characters: createCharacter, updateCharacter, addReferenceImage, removeReference, setActive, remove; IP-Adapter:
// refresh, install; outputs: readRecord), so no rule exists twice and the UI shows each change because it made it.
// Previews and the consistency report read the request THE request builder makes (storyStore.previewScene ->
// generationStore.previewScene -> buildGenerationRequest). The tool names and their arguments are the backend's
// (schemas.py CODEX_TOOL_ARGUMENTS, validated there); what Codex reads about them is services/codex/tools.py; what the
// answers contain is src/domain/coWriterViews.ts.
//
// Every tool answers a CodexToolResult (never throws): `text` for Codex (data as JSON, or why it failed, with what to
// do and the valid choices), `summary` for the conversation ('Added Scene 3 · The storm'), the story / scene /
// character it acted on (the links of its activity row) and, for view_images, the pictures. Batch tools check every
// part first and change nothing when one is wrong. A failure the stores reported (a notification) is quoted.
import { REFERENCE_DEFAULTS } from '../api/defaults.gen';
import type {
	CharacterImageSource,
	CodexToolArguments,
	CodexToolCall,
	CodexToolImage,
	CodexToolName,
	CodexToolResult,
	LoraWeight,
	Scene,
	SceneCreateRequest,
	SceneLock,
	ScenePatch,
	Story,
	StoryPatch,
} from '../api/types';
import { characterValuesFromOutput, emptyCharacterValues, newCharacterName, type CharacterValues } from '../domain/characterDrafts';
import { sceneLabel } from '../domain/coWriter';
import {
	categoriesForCodex,
	characterForCodex,
	charactersForCodex,
	consistencyReportForCodex,
	generationSetupForCodex,
	lorasForCodex,
	referenceSupportForCodex,
	resolveLock,
	resolveLora,
	sceneForCodex,
	scenePreviewForCodex,
	storiesForCodex,
	storyForCodex,
	type ConsistencySceneInput,
	type StoryViewContext,
} from '../domain/coWriterViews';
import type { BuiltGenerationRequest } from '../domain/generationRequest';
import { withLora } from '../domain/loraSelection';
import {
	missingSceneIds,
	newSceneRequest,
	sceneIllustrationId,
	sceneOrderWithSceneAt,
	withSceneLock,
	withoutSceneLock,
} from '../domain/stories';
import { editTags } from '../domain/text';
import { selectReachability, useCategoriesStore } from './categoriesStore';
import { selectActiveCharacter, selectCharacter, useCharactersStore } from './charactersStore';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { selectGenerationSettings, useGenerationSettingsStore } from './generationSettingsStore';
import { GENERATION_BUSY_MESSAGE, useGenerationStore } from './generationStore';
import { selectIpAdapterVariant, selectReferenceSupport, useIpAdapterStore } from './ipAdapterStore';
import { selectSelectedModel, useLibraryStore } from './libraryStore';
import { describeError, useNotificationsStore } from './notificationsStore';
import { selectOutputIdSet, useOutputsStore } from './outputsStore';
import { useStoryStore } from './storyStore';

const SUMMARY_LIMIT = 500;
const TEXT_LIMIT = 200_000;
/** At most this many pictures per view_images answer (the backend's CODEX_MAX_IMAGES_PER_CALL). */
export const VIEW_IMAGES_LIMIT = 8;
/** How long install_ip_adapter waits for the downloads to start before answering. */
const INSTALL_START_WAIT_MS = 5_000;

export const NO_MODEL_MESSAGE =
	'No checkpoint is selected, so no picture can be generated or previewed. Ask the user to pick a model (Create: generation panel, or the Models section).';

type Target = { storyId?: string | null; sceneId?: string | null; characterId?: string | null };

function clip(text: string, limit: number): string {
	return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function done(summary: string, data: unknown, target: Target = {}, images: CodexToolImage[] = []): CodexToolResult {
	return {
		ok: true,
		text: clip(JSON.stringify(data), TEXT_LIMIT),
		summary: clip(summary, SUMMARY_LIMIT),
		story_id: target.storyId ?? null,
		scene_id: target.sceneId ?? null,
		character_id: target.characterId ?? null,
		images,
	};
}

function failed(summary: string, text: string = summary, target: Target = {}): CodexToolResult {
	return {
		ok: false,
		text: clip(text, TEXT_LIMIT),
		summary: clip(summary, SUMMARY_LIMIT),
		story_id: target.storyId ?? null,
		scene_id: target.sceneId ?? null,
		character_id: target.characterId ?? null,
		images: [],
	};
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

/** "Scene 2 · The storm", "Scene 2 · The storm and Scene 3 · Morning calm", "3 scenes". */
function scenesText(labels: readonly string[]): string {
	if (labels.length <= 2) {
		return labels.join(' and ');
	}
	return `${labels.length} scenes`;
}

// ---------------------------------------------------------------------------
// Reading the stores
// ---------------------------------------------------------------------------

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

function unknownScenes(story: Story, sceneIds: readonly string[]): CodexToolResult | null {
	const missing = sceneIds.filter((id) => !story.scenes.some((scene) => scene.id === id));
	if (missing.length === 0) {
		return null;
	}
	const valid = story.scenes.map((scene) => `${scene.id} (${sceneLabel(story, scene.id)})`).join(', ');
	return failed(
		`No scene ${missing.join(', ')} in ${story.title}`,
		`${story.title} has no scene ${missing.join(', ')}. Its scenes: ${valid || 'none'}.`,
		{ storyId: story.id },
	);
}

async function findScene(storyId: string, sceneId: string): Promise<Found> {
	const story = await findStory(storyId);
	if (!story) {
		return { error: unknownStory(storyId) };
	}
	const refusal = unknownScenes(story, [sceneId]);
	return refusal ? { error: refusal } : { story, scene: story.scenes.find((item) => item.id === sceneId)! };
}

/** The current copy of a story (after an action changed it). */
function current(storyId: string): Story | null {
	return useStoryStore.getState().stories.find((story) => story.id === storyId) ?? null;
}

function labelOf(storyId: string, sceneId: string, fallback: string): string {
	const story = current(storyId);
	return (story && sceneLabel(story, sceneId)) ?? fallback;
}

function viewContext(): StoryViewContext {
	const characters = useCharactersStore.getState();
	return {
		categories: useCategoriesStore.getState().categories,
		characters: characters.characters,
		activeCharacter: selectActiveCharacter(characters),
		library: useLibraryStore.getState().loras,
		outputIds: selectOutputIdSet(useOutputsStore.getState()),
		generation: useStoryStore.getState().generation,
	};
}

function sceneView(storyId: string, sceneId: string) {
	const story = current(storyId);
	const scene = story?.scenes.find((item) => item.id === sceneId);
	return story && scene ? sceneForCodex(story, scene, viewContext()) : null;
}

function unknownCharacters(ids: readonly string[]): CodexToolResult | null {
	const characters = useCharactersStore.getState().characters;
	const missing = ids.filter((id) => !characters.some((character) => character.id === id));
	if (missing.length === 0) {
		return null;
	}
	const valid = characters.map((character) => `${character.name} (${character.id})`).join(', ');
	return failed(`Unknown characters: ${missing.join(', ')}`, `These characters do not exist: ${missing.join(', ')}. The characters: ${valid || 'none yet (create_character)'}.`);
}

function unknownOutputs(outputIds: readonly string[]): CodexToolResult | null {
	const existing = selectOutputIdSet(useOutputsStore.getState());
	const missing = outputIds.filter((id) => !existing.has(id));
	return missing.length > 0 ? failed(`No output ${missing.join(', ')}`, `These outputs do not exist: ${missing.join(', ')}. get_story lists each scene's picture and variants.`) : null;
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

/** The IP-Adapter status for the selected model (read when needed; null without a model or when it cannot be read). */
async function ipAdapterStatus() {
	if (!selectSelectedModel(useLibraryStore.getState())) {
		return null;
	}
	await useIpAdapterStore.getState().refresh();
	const state = useIpAdapterStore.getState();
	return state.loadStatus === 'ready' ? state.status : null;
}

// ---------------------------------------------------------------------------
// What Codex names: LoRAs, locks, scenes and their changes (checked before anything changes)
// ---------------------------------------------------------------------------

type Checked<T> = { value: T } | { error: string };

function resolveLoras(specs: readonly { lora: string; weight: number }[]): Checked<LoraWeight[]> {
	const library = useLibraryStore.getState().loras;
	let loras: LoraWeight[] = [];
	for (const spec of specs) {
		const found = resolveLora(spec.lora, library);
		if ('error' in found) {
			return found;
		}
		loras = withLora(loras, found.lora.id, spec.weight);
	}
	return { value: loras };
}

function resolveLocks(specs: readonly { category: string; sub_prompt: string }[]): Checked<SceneLock[]> {
	const categories = useCategoriesStore.getState().categories;
	let locks: SceneLock[] = [];
	for (const spec of specs) {
		const found = resolveLock(spec.category, spec.sub_prompt, categories);
		if ('error' in found) {
			return found;
		}
		locks = withSceneLock(locks, found.lock.category_name, found.lock.prompt_text);
	}
	return { value: locks };
}

type SceneSpec = CodexToolArguments<'add_scenes'>['scenes'][number];

/** The SceneCreateRequest of a new scene Codex describes. */
function sceneRequestOf(spec: SceneSpec, where: string): Checked<SceneCreateRequest> {
	const characterIds = spec.characters === 'story' ? null : spec.characters;
	const refusal = characterIds ? unknownCharacters(characterIds) : null;
	if (refusal) {
		return { error: `${where}: ${refusal.text}` };
	}
	const locks = resolveLocks(spec.locks);
	if ('error' in locks) {
		return { error: `${where}: ${locks.error}` };
	}
	const loras = resolveLoras(spec.loras);
	if ('error' in loras) {
		return { error: `${where}: ${loras.error}` };
	}
	return {
		value: newSceneRequest({
			title: spec.title,
			text: spec.text,
			beat: spec.beat,
			shot: spec.shot,
			setting: spec.setting,
			mood: spec.mood,
			extra_tags: spec.extra_tags,
			negative_tags: spec.negative_tags,
			locks: locks.value,
			loras: loras.value,
			character_ids: characterIds,
			seed: spec.seed,
		}),
	};
}

function sceneRequestsOf(specs: readonly SceneSpec[]): Checked<SceneCreateRequest[]> {
	const requests: SceneCreateRequest[] = [];
	for (const [index, spec] of specs.entries()) {
		const request = sceneRequestOf(spec, `Scene ${index + 1} of the call (${spec.title ?? 'untitled'})`);
		if ('error' in request) {
			return request;
		}
		requests.push(request.value);
	}
	return { value: requests };
}

type SceneChange = CodexToolArguments<'update_scenes'>['changes'][number];

/** The scene fields a change can edit. */
type EditableScene = Pick<
	Scene,
	'title' | 'text' | 'beat' | 'shot' | 'setting' | 'mood' | 'extra_tags' | 'negative_tags' | 'locks' | 'loras' | 'character_ids' | 'seed'
>;

const EDITABLE_FIELDS: readonly (keyof EditableScene)[] = [
	'title',
	'text',
	'beat',
	'shot',
	'setting',
	'mood',
	'extra_tags',
	'negative_tags',
	'locks',
	'loras',
	'character_ids',
	'seed',
];

const FIELD_NAMES: Readonly<Record<keyof EditableScene, string>> = {
	title: 'title',
	text: 'text',
	beat: 'beat',
	shot: 'shot',
	setting: 'setting',
	mood: 'mood',
	extra_tags: 'tags',
	negative_tags: 'negative tags',
	locks: 'locked sub-prompts',
	loras: 'LoRAs',
	character_ids: 'characters',
	seed: 'seed',
};

/** A change with what it names resolved (its LoRAs and locks). */
type ResolvedChange = { change: SceneChange; sceneIds: string[]; locks: SceneLock[] | null; lock: SceneLock[]; loras: LoraWeight[] | null; setLoras: LoraWeight[]; removeLoraIds: string[] };

function resolveChange(story: Story, change: SceneChange, index: number): Checked<ResolvedChange> {
	const where = `Change ${index + 1}`;
	const sceneIds = change.scene_id !== null ? [change.scene_id] : change.scene_ids === 'all' ? story.scenes.map((scene) => scene.id) : (change.scene_ids ?? []);
	const missingScenes = unknownScenes(story, sceneIds);
	if (missingScenes) {
		return { error: `${where}: ${missingScenes.text}` };
	}
	const characterIds = change.characters !== null && change.characters !== 'story' ? change.characters : null;
	const missingCharacters = characterIds ? unknownCharacters(characterIds) : null;
	if (missingCharacters) {
		return { error: `${where}: ${missingCharacters.text}` };
	}
	const locks = change.locks === null ? { value: null } : resolveLocks(change.locks);
	const lock = resolveLocks(change.lock);
	const loras = change.loras === null ? { value: null } : resolveLoras(change.loras);
	const setLoras = resolveLoras(change.set_loras);
	for (const checked of [locks, lock, loras, setLoras]) {
		if ('error' in checked) {
			return { error: `${where}: ${checked.error}` };
		}
	}
	const library = useLibraryStore.getState().loras;
	const removeLoraIds: string[] = [];
	for (const ref of change.remove_loras) {
		const found = resolveLora(ref, library);
		const inScene = story.scenes.some((scene) => sceneIds.includes(scene.id) && scene.loras.some((item) => item.id === ref));
		if ('error' in found && !inScene) {
			return { error: `${where}: ${found.error}` };
		}
		removeLoraIds.push('lora' in found ? found.lora.id : ref);
	}
	return {
		value: {
			change,
			sceneIds,
			locks: 'value' in locks ? locks.value : null,
			lock: 'value' in lock ? lock.value : [],
			loras: 'value' in loras ? loras.value : null,
			setLoras: 'value' in setLoras ? setLoras.value : [],
			removeLoraIds,
		},
	};
}

function editableOf(scene: Scene): EditableScene {
	return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, scene[field]])) as EditableScene;
}

/** `scene` with one resolved change applied: the fields it replaces, then its edits of the current values. */
function applyChange(scene: EditableScene, { change, locks, lock, loras, setLoras, removeLoraIds }: ResolvedChange): EditableScene {
	const next: EditableScene = { ...scene };
	for (const field of ['title', 'text', 'beat', 'shot', 'setting', 'mood'] as const) {
		const value = change[field];
		if (value !== null) {
			next[field] = value;
		}
	}
	next.extra_tags = editTags(change.extra_tags ?? next.extra_tags, { add: change.add_tags, remove: change.remove_tags });
	next.negative_tags = editTags(change.negative_tags ?? next.negative_tags, { add: change.add_negative_tags, remove: change.remove_negative_tags });
	let nextLocks = locks ?? next.locks;
	for (const category of change.unlock) {
		nextLocks = withoutSceneLock(nextLocks, category);
	}
	for (const item of lock) {
		nextLocks = withSceneLock(nextLocks, item.category_name, item.prompt_text);
	}
	next.locks = nextLocks;
	let nextLoras = (loras ?? next.loras).filter((item) => !removeLoraIds.includes(item.id));
	for (const item of setLoras) {
		nextLoras = withLora(nextLoras, item.id, item.weight);
	}
	next.loras = nextLoras;
	if (change.characters !== null) {
		next.character_ids = change.characters === 'story' ? null : change.characters;
	}
	if (change.seed !== null) {
		next.seed = change.seed === 'random' ? null : change.seed;
	}
	return next;
}

/** The fields of `next` that differ from `before`, as a ScenePatch. */
function patchOf(before: EditableScene, next: EditableScene): ScenePatch {
	const patch: Record<string, unknown> = {};
	for (const field of EDITABLE_FIELDS) {
		if (JSON.stringify(before[field]) !== JSON.stringify(next[field])) {
			patch[field] = next[field];
		}
	}
	return patch as ScenePatch;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** The output a picture reference names: an output id (checked) or a scene's picture. */
async function pictureOf(ref: { output_id: string } | { story_id: string; scene_id: string }): Promise<Checked<string>> {
	if ('output_id' in ref) {
		const refusal = unknownOutputs([ref.output_id]);
		return refusal ? { error: refusal.text } : { value: ref.output_id };
	}
	const found = await findScene(ref.story_id, ref.scene_id);
	if ('error' in found) {
		return { error: found.error.text };
	}
	const outputId = sceneIllustrationId(found.scene, selectOutputIdSet(useOutputsStore.getState()));
	return outputId ? { value: outputId } : { error: `${sceneLabel(found.story, found.scene.id)} of ${found.story.title} has no picture yet.` };
}

function characterNotFound(characterId: string): CodexToolResult {
	const valid = useCharactersStore
		.getState()
		.characters.map((character) => `${character.name} (${character.id})`)
		.join(', ');
	return failed(`No character ${characterId}`, `There is no character ${characterId}. The characters: ${valid || 'none yet (create_character)'}.`);
}

function characterView(characterId: string) {
	const { activeId } = useCharactersStore.getState();
	const character = selectCharacter(characterId)(useCharactersStore.getState());
	return character ? characterForCodex(character, activeId, useLibraryStore.getState().loras) : null;
}

/** 'outfit tags, seed, 1 reference image added': what an update_character call changed. */
function characterChanges(args: CodexToolArguments<'update_character'>, added: number, removed: number): string {
	const names: [keyof CodexToolArguments<'update_character'>, string][] = [
		['name', 'name'],
		['identity_tags', 'identity tags'],
		['outfit_tags', 'outfit tags'],
		['negative_tags', 'negative tags'],
		['loras', 'LoRAs'],
		['seed', 'seed'],
		['seed_locked', 'seed lock'],
		['reference_strength', 'reference strength'],
		['reference_focus', 'reference focus'],
	];
	const parts = names.filter(([field]) => args[field] !== null).map(([, name]) => name);
	if (added > 0) {
		parts.push(`${added} reference image${added === 1 ? '' : 's'} added`);
	}
	if (removed > 0) {
		parts.push(`${removed} reference image${removed === 1 ? '' : 's'} removed`);
	}
	if (args.active_in_create !== null) {
		parts.push(args.active_in_create ? 'active in Create' : 'not active in Create');
	}
	return parts.join(', ');
}

async function waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!condition() && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

type Preview = { built: BuiltGenerationRequest | null; error: string | null; missingCharacterIds: string[] };

function previewOf(storyId: string, sceneId: string): Preview {
	if (!selectSelectedModel(useLibraryStore.getState())) {
		return { built: null, error: NO_MODEL_MESSAGE, missingCharacterIds: [] };
	}
	try {
		const preview = useStoryStore.getState().previewScene(storyId, sceneId);
		return preview ? { ...preview, error: null } : { built: null, error: 'Unknown scene.', missingCharacterIds: [] };
	} catch (error) {
		return { built: null, error: describeError(error), missingCharacterIds: [] };
	}
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

/** What the window running a call learns from it as it runs (codexStore.runCall). */
export type ToolHooks = {
	/** A story was created by the call, before it is shown: the window shows it with the call's conversation. */
	storyCreated?: (storyId: string) => void;
};

type ToolHandlers = { [T in CodexToolName]: (args: CodexToolArguments<T>, hooks: ToolHooks) => Promise<CodexToolResult> };

const TOOLS: ToolHandlers = {
	// --- Reading ---

	list_stories: async () => {
		const { stories, selectedStoryId } = useStoryStore.getState();
		return done('Read the stories', storiesForCodex(stories, selectedStoryId, selectOutputIdSet(useOutputsStore.getState())));
	},

	get_story: async ({ story_id }) => {
		const story = await findStory(story_id);
		return story ? done(`Read ${story.title}`, storyForCodex(story, viewContext()), { storyId: story.id }) : unknownStory(story_id);
	},

	list_characters: async () => {
		const { characters, activeId } = useCharactersStore.getState();
		return done('Read the characters', charactersForCodex(characters, activeId, useLibraryStore.getState().loras));
	},

	list_categories: async ({ query }) => {
		const { categories } = useCategoriesStore.getState();
		const { rules } = useForbiddenRulesStore.getState();
		const board = categoriesForCodex(categories, rules, selectReachability(categories, rules), useLibraryStore.getState().loras, query);
		return done('Read the prompt board', board);
	},

	list_loras: async ({ query }) => {
		const library = useLibraryStore.getState();
		const data = lorasForCodex(library.loras, library.selectedLoras, useCharactersStore.getState().characters, useStoryStore.getState().stories, query);
		return done('Read the LoRAs', data.length > 0 ? data : { loras: [], note: query ? `No LoRA matches "${query}".` : 'The library has no LoRA.' });
	},

	get_generation_setup: async () => {
		const library = useLibraryStore.getState();
		const generation = useGenerationStore.getState();
		const data = generationSetupForCodex({
			model: selectSelectedModel(library),
			settings: selectGenerationSettings(useGenerationSettingsStore.getState()),
			selectedLoras: library.selectedLoras,
			library: library.loras,
			activeCharacter: selectActiveCharacter(useCharactersStore.getState()),
			generating: generation.generating || generation.continuous || useStoryStore.getState().generation !== null,
			ipAdapters: await ipAdapterStatus(),
		});
		return done('Read the generation setup', data);
	},

	preview_scenes: async ({ story_id, scene_ids }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const ids = scene_ids ?? story.scenes.map((scene) => scene.id);
		const refusal = unknownScenes(story, ids);
		if (refusal) {
			return refusal;
		}
		if (!selectSelectedModel(useLibraryStore.getState())) {
			return failed('No model selected', NO_MODEL_MESSAGE, { storyId: story_id });
		}
		const ipAdapters = await ipAdapterStatus();
		const context = viewContext();
		const previews = ids.map((sceneId) => {
			const scene = story.scenes.find((item) => item.id === sceneId)!;
			return scenePreviewForCodex({ story, scene, ...previewOf(story_id, sceneId), context, ipAdapters });
		});
		const labels = ids.map((sceneId) => sceneLabel(story, sceneId) ?? sceneId);
		const target = ids.length === 1 ? { storyId: story_id, sceneId: ids[0] } : { storyId: story_id };
		return done(`Previewed the prompt of ${scenesText(labels)}${ids.length > 2 ? ` of ${story.title}` : ''}`, { scenes: previews }, target);
	},

	consistency_report: async ({ story_id, scene_ids }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const ids = scene_ids ?? story.scenes.map((scene) => scene.id);
		const refusal = unknownScenes(story, ids);
		if (refusal) {
			return refusal;
		}
		const ipAdapters = await ipAdapterStatus();
		const context = viewContext();
		const inputs: ConsistencySceneInput[] = [];
		for (const sceneId of ids) {
			const scene = story.scenes.find((item) => item.id === sceneId)!;
			const pictureId = sceneIllustrationId(scene, context.outputIds);
			const picture = pictureId ? await useOutputsStore.getState().readRecord(pictureId) : null;
			inputs.push({ story, scene, ...previewOf(story_id, sceneId), context, ipAdapters, picture });
		}
		const report = consistencyReportForCodex(story, inputs, context);
		const count = report.problems.length;
		return done(`Checked ${story.title}: ${count === 0 ? 'no problem found' : `${count} problem${count === 1 ? '' : 's'} to look at`}`, report, { storyId: story_id });
	},

	view_images: async ({ story_id, scene_ids, output_ids, character_ids }) => {
		const images: CodexToolImage[] = [];
		const withoutPicture: string[] = [];
		const notes: string[] = [];
		let storyTitle: string | null = null;
		if (story_id !== null) {
			const story = await findStory(story_id);
			if (!story) {
				return unknownStory(story_id);
			}
			storyTitle = story.title;
			const ids = scene_ids ?? story.scenes.map((scene) => scene.id);
			const refusal = unknownScenes(story, ids);
			if (refusal) {
				return refusal;
			}
			const outputIds = selectOutputIdSet(useOutputsStore.getState());
			for (const sceneId of ids) {
				const scene = story.scenes.find((item) => item.id === sceneId)!;
				const pictureId = sceneIllustrationId(scene, outputIds);
				const label = sceneLabel(story, sceneId) ?? scene.title;
				if (pictureId) {
					images.push({ label: `${label}, its picture (output #${pictureId})`, output_id: pictureId, character_id: null, image_id: null });
				} else if (scene_ids !== null) {
					withoutPicture.push(label);
				}
			}
		}
		const missingOutputs = unknownOutputs(output_ids);
		if (missingOutputs) {
			return missingOutputs;
		}
		images.push(...output_ids.map((outputId) => ({ label: `Output #${outputId}`, output_id: outputId, character_id: null, image_id: null })));
		const missingCharacters = unknownCharacters(character_ids);
		if (missingCharacters) {
			return missingCharacters;
		}
		for (const characterId of character_ids) {
			const character = selectCharacter(characterId)(useCharactersStore.getState())!;
			if (character.reference_images.length === 0) {
				notes.push(`${character.name} has no reference image.`);
			}
			character.reference_images.forEach((image, index) =>
				images.push({
					label: `${character.name}, reference image ${index + 1} of ${character.reference_images.length} (${image.id})`,
					output_id: null,
					character_id: character.id,
					image_id: image.id,
				}),
			);
		}
		const shown = images.slice(0, VIEW_IMAGES_LIMIT);
		const data = {
			shown: shown.map((image) => image.label),
			not_shown: images.slice(VIEW_IMAGES_LIMIT).map((image) => image.label),
			without_picture: withoutPicture,
			notes,
		};
		const target = { storyId: story_id, sceneId: scene_ids?.length === 1 ? scene_ids[0] : null, characterId: character_ids.length === 1 ? character_ids[0] : null };
		if (shown.length === 0) {
			return done('No picture to look at', { ...data, note: 'Nothing to show: generate the scenes first (generate_scenes) or name outputs.' }, target);
		}
		const subject = storyTitle ? ` of ${storyTitle}` : character_ids.length === 1 ? ` of ${selectCharacter(character_ids[0])(useCharactersStore.getState())?.name}` : '';
		return done(`Looked at ${shown.length} picture${shown.length === 1 ? '' : 's'}${subject}`, data, target, shown);
	},

	// --- Stories and scenes ---

	create_story: async ({ title, character_ids, logline, synopsis, style_notes, scenes }, hooks) => {
		const refusal = unknownCharacters(character_ids);
		if (refusal) {
			return refusal;
		}
		const requests = sceneRequestsOf(scenes);
		if ('error' in requests) {
			return failed('Could not create the story', requests.error);
		}
		// Shown once its outline is in (addScenes selects it with its first scene).
		const { value: story, problems } = await reporting(() => useStoryStore.getState().createStory({ title, character_ids, logline, synopsis, style_notes }, { select: false }));
		if (!story) {
			return failed('Could not create the story', becauseOf(problems, 'The story could not be created.'));
		}
		hooks.storyCreated?.(story.id);
		const { value: added, problems: sceneProblems } = await reporting(() => useStoryStore.getState().addScenes(story.id, requests.value));
		if (added.length === 0) {
			useStoryStore.getState().selectStory(story.id);
		}
		const saved = current(story.id) ?? story;
		const data = storyForCodex(saved, viewContext());
		if (added.length < requests.value.length) {
			const text = `${JSON.stringify(data)} Only ${added.length} of ${requests.value.length} scenes were added: ${becauseOf(sceneProblems, 'a scene could not be saved.')}`;
			return failed(`Created ${story.title}, ${added.length} of ${requests.value.length} scenes`, text, { storyId: story.id });
		}
		const sceneCount = added.length === 0 ? '' : ` with ${added.length} scene${added.length === 1 ? '' : 's'}`;
		return done(`Created ${story.title}${sceneCount}`, data, { storyId: story.id, sceneId: added[0]?.id ?? null });
	},

	update_story: async ({ story_id, title, character_ids, logline, synopsis, style_notes }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const refusal = character_ids ? unknownCharacters(character_ids) : null;
		if (refusal) {
			return refusal;
		}
		const fields: [keyof StoryPatch, unknown, string][] = [
			['title', title, 'title'],
			['character_ids', character_ids, 'characters'],
			['logline', logline, 'logline'],
			['synopsis', synopsis, 'synopsis'],
			['style_notes', style_notes, 'style notes'],
		];
		const sent = fields.filter(([, value]) => value !== null);
		const patch = Object.fromEntries(sent.map(([field, value]) => [field, value])) as StoryPatch;
		const { value: saved, problems } = await reporting(() => useStoryStore.getState().updateStory(story_id, patch));
		if (!saved) {
			return failed(`Could not edit ${story.title}`, becauseOf(problems, 'The story could not be saved.'), { storyId: story_id });
		}
		const { scenes: _scenes, ...flow } = storyForCodex(saved, viewContext());
		return done(`Edited ${saved.title} (${sent.map(([, , name]) => name).join(', ')})`, flow, { storyId: saved.id });
	},

	delete_story: async ({ story_id, user_confirmed }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		if (!user_confirmed) {
			return failed('Deletion not confirmed', `Ask the user to confirm that the story ${story.title} (${story.scenes.length} scenes) should be deleted, then call delete_story with user_confirmed true.`, { storyId: story_id });
		}
		const { value: deleted, problems } = await reporting(() => useStoryStore.getState().deleteStory(story_id));
		return deleted
			? done(`Deleted ${story.title}`, { story_id, deleted: true })
			: failed(`Could not delete ${story.title}`, becauseOf(problems, 'The story could not be deleted.'), { storyId: story_id });
	},

	add_scenes: async ({ story_id, scenes, position }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const requests = sceneRequestsOf(scenes);
		if ('error' in requests) {
			return failed(`Could not add scenes to ${story.title}`, requests.error, { storyId: story_id });
		}
		const { value: added, problems } = await reporting(() => useStoryStore.getState().addScenes(story_id, requests.value, position === null ? null : position - 1));
		const views = added.map((scene) => sceneView(story_id, scene.id));
		const labels = added.map((scene) => labelOf(story_id, scene.id, scene.title));
		if (added.length < requests.value.length) {
			const text = `${JSON.stringify({ added: views })} Only ${added.length} of ${requests.value.length} scenes were added: ${becauseOf(problems, 'a scene could not be saved.')}`;
			return failed(`Added ${added.length} of ${requests.value.length} scenes to ${story.title}`, text, { storyId: story_id, sceneId: added[0]?.id ?? null });
		}
		const summary = added.length === 1 ? `Added ${labels[0]}` : `Added ${added.length} scenes to ${story.title}: ${labels.join(', ')}`;
		return done(summary, { scenes: views }, { storyId: story_id, sceneId: added[0]?.id ?? null });
	},

	update_scenes: async ({ story_id, changes }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const resolved: ResolvedChange[] = [];
		for (const [index, change] of changes.entries()) {
			const checked = resolveChange(story, change, index);
			if ('error' in checked) {
				return failed(`Could not edit the scenes of ${story.title}`, `Nothing was changed. ${checked.error}`, { storyId: story_id });
			}
			resolved.push(checked.value);
		}
		const working = new Map(story.scenes.map((scene) => [scene.id, editableOf(scene)]));
		for (const item of resolved) {
			for (const sceneId of item.sceneIds) {
				working.set(sceneId, applyChange(working.get(sceneId)!, item));
			}
		}
		const patches = story.scenes
			.map((scene) => ({ sceneId: scene.id, patch: patchOf(editableOf(scene), working.get(scene.id)!) }))
			.filter(({ patch }) => Object.keys(patch).length > 0);
		if (patches.length === 0) {
			return done(`Nothing to change in ${story.title}`, { changed: [], note: 'Every scene already had these values.' }, { storyId: story_id });
		}
		const { value: saved, problems } = await reporting(() => useStoryStore.getState().updateScenes(story_id, patches));
		const target = patches.length === 1 ? { storyId: story_id, sceneId: patches[0].sceneId } : { storyId: story_id };
		if (!saved) {
			return failed(`Could not edit the scenes of ${story.title}`, becauseOf(problems, 'A scene could not be saved.'), target);
		}
		const fieldNames = EDITABLE_FIELDS.filter((field) => patches.some(({ patch }) => field in patch)).map((field) => FIELD_NAMES[field]);
		const labels = patches.map(({ sceneId }) => labelOf(story_id, sceneId, sceneId));
		const summary =
			patches.length === 1 ? `Edited ${labels[0]} (${fieldNames.join(', ')})` : `Edited ${patches.length} scenes of ${saved.title} (${fieldNames.join(', ')})`;
		return done(summary, { changed: patches.map(({ sceneId }) => sceneView(story_id, sceneId)) }, target);
	},

	reorder_scenes: async ({ story_id, order, scene_id, position }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const ids = story.scenes.map((scene) => scene.id);
		let next: string[] | null;
		if (order !== null) {
			const permutation = order.length === ids.length && new Set(order).size === ids.length && order.every((id) => ids.includes(id));
			if (!permutation) {
				const listed = story.scenes.map((scene) => `${scene.id} (${sceneLabel(story, scene.id)})`).join(', ');
				return failed('Not a scene order', `order must list each of the ${ids.length} scenes of ${story.title} once: ${listed}.`, { storyId: story_id });
			}
			next = order.every((id, index) => id === ids[index]) ? null : order;
		} else {
			const refusal = unknownScenes(story, [scene_id!]);
			if (refusal) {
				return refusal;
			}
			next = sceneOrderWithSceneAt(ids, scene_id!, position!);
		}
		const orderView = (saved: Story) => saved.scenes.map((scene, index) => ({ scene_id: scene.id, position: index + 1, title: scene.title }));
		const target = { storyId: story_id, sceneId: scene_id };
		if (next === null) {
			return done(`The scenes of ${story.title} keep their order`, { moved: false, order: orderView(story) }, target);
		}
		const { value: saved, problems } = await reporting(() => useStoryStore.getState().setSceneOrder(story_id, next));
		if (!saved) {
			return failed(`Could not reorder ${story.title}`, becauseOf(problems, 'The scenes could not be reordered.'), target);
		}
		const moved = scene_id ? story.scenes.find((scene) => scene.id === scene_id)?.title : null;
		const summary = moved ? `Moved ${moved} to position ${saved.scenes.findIndex((scene) => scene.id === scene_id) + 1}` : `Reordered the scenes of ${saved.title}`;
		return done(summary, { moved: true, order: orderView(saved) }, target);
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
		return done(`Duplicated ${found.scene.title} as ${labelOf(story_id, copy.id, copy.title)}`, sceneView(story_id, copy.id), { storyId: story_id, sceneId: copy.id });
	},

	delete_scenes: async ({ story_id, scene_ids, user_confirmed }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const refusal = unknownScenes(story, scene_ids);
		if (refusal) {
			return refusal;
		}
		const ids = [...new Set(scene_ids)];
		const labels = ids.map((id) => sceneLabel(story, id) ?? id);
		const target = { storyId: story_id, sceneId: ids.length === 1 ? ids[0] : null };
		if (!user_confirmed) {
			return failed('Deletion not confirmed', `Ask the user to confirm that ${labels.join(', ')} should be deleted, then call delete_scenes with user_confirmed true.`, target);
		}
		const deleted: string[] = [];
		for (const [index, sceneId] of ids.entries()) {
			const { value, problems } = await reporting(() => useStoryStore.getState().deleteScene(story_id, sceneId));
			if (!value) {
				return failed(`Could not delete ${labels[index]}`, `${deleted.length > 0 ? `Deleted ${deleted.join(', ')}. ` : ''}${becauseOf(problems, 'The scene could not be deleted.')}`, { storyId: story_id });
			}
			deleted.push(labels[index]);
		}
		return done(ids.length === 1 ? `Deleted ${labels[0]}` : `Deleted ${ids.length} scenes of ${story.title}: ${labels.join(', ')}`, { deleted: ids }, { storyId: story_id });
	},

	// --- Pictures ---

	generate_scenes: async ({ story_id, scene_ids }) => {
		const story = await findStory(story_id);
		if (!story) {
			return unknownStory(story_id);
		}
		const ids = scene_ids ?? missingSceneIds(story, selectOutputIdSet(useOutputsStore.getState()));
		const refusal = unknownScenes(story, ids);
		if (refusal) {
			return refusal;
		}
		if (ids.length === 0) {
			return done(`Every scene of ${story.title} has a picture`, { generated: [] }, { storyId: story_id });
		}
		const target = ids.length === 1 ? { storyId: story_id, sceneId: ids[0] } : { storyId: story_id };
		const busy = generationRefusal(target);
		if (busy) {
			return busy;
		}
		const labels = ids.map((id) => sceneLabel(story, id) ?? id);
		const { value: records, problems } = await reporting(() => useStoryStore.getState().generateScenes(story_id, ids));
		const generated = records.map((record, index) => ({ scene: labels[index], scene_id: ids[index], output_id: record.output_id, seed: record.image_seed ?? record.seed }));
		const data = { generated, not_generated: labels.slice(records.length), next: 'Look at them with view_images, check them with consistency_report.' };
		const summary = ids.length === 1 ? `Illustrated ${labels[0]}` : `Illustrated ${records.length} of ${ids.length} scenes of ${story.title}`;
		if (records.length < ids.length) {
			return failed(ids.length === 1 ? `Could not illustrate ${labels[0]}` : summary, `${JSON.stringify(data)} ${becauseOf(problems, 'The run was cancelled.')}`, target);
		}
		return done(summary, data, target);
	},

	edit_variants: async ({ story_id, scene_id, add, choose, remove }) => {
		const found = await findScene(story_id, scene_id);
		if ('error' in found) {
			return found.error;
		}
		const target = { storyId: story_id, sceneId: scene_id };
		const label = sceneLabel(found.story, scene_id) ?? found.scene.title;
		const variants = found.scene.variants.map((variant) => variant.output_id);
		const missing = unknownOutputs(add);
		if (missing) {
			return missing;
		}
		const strangers = [...remove, ...(choose ? [choose] : [])].filter((id) => !variants.includes(id) && !add.includes(id));
		if (strangers.length > 0) {
			return failed(`Not variants of ${label}`, `${strangers.join(', ')} ${strangers.length === 1 ? 'is not a variant' : 'are not variants'} of ${label}. Its variants: ${variants.join(', ') || 'none'}.`, target);
		}
		const story = useStoryStore.getState();
		const steps: (() => Promise<Story | null>)[] = [
			...add.map((outputId) => () => story.addVariant(story_id, scene_id, outputId)),
			...remove.map((outputId) => () => story.removeVariant(story_id, scene_id, outputId)),
			...(choose ? [() => story.chooseVariant(story_id, scene_id, choose)] : []),
		];
		for (const step of steps) {
			const { value, problems } = await reporting(step);
			if (!value) {
				return failed(`Could not change the pictures of ${label}`, becauseOf(problems, 'The scene could not be saved.'), target);
			}
		}
		const view = sceneView(story_id, scene_id);
		const parts = [add.length > 0 ? `${add.length} added` : '', remove.length > 0 ? `${remove.length} removed` : '', view?.picture ? `picture #${view.picture}` : 'no picture'];
		return done(`Changed the pictures of ${label} (${parts.filter(Boolean).join(', ')})`, view, target);
	},

	// --- Characters ---

	create_character: async (args) => {
		const source = args.from_scene ?? (args.from_output_id ? { output_id: args.from_output_id } : null);
		let pictureId: string | null = null;
		let values: CharacterValues = emptyCharacterValues(newCharacterName(useCharactersStore.getState().characters));
		if (source) {
			const picture = await pictureOf(source);
			if ('error' in picture) {
				return failed('Could not create the character', picture.error);
			}
			pictureId = picture.value;
			const record = await useOutputsStore.getState().readRecord(pictureId);
			if (!record) {
				return failed('Could not create the character', `The metadata of output ${pictureId} cannot be read.`);
			}
			values = characterValuesFromOutput(record);
		}
		const loras = args.loras === null ? null : resolveLoras(args.loras);
		if (loras && 'error' in loras) {
			return failed('Could not create the character', loras.error);
		}
		const extra = unknownOutputs(args.reference_output_ids);
		if (extra) {
			return extra;
		}
		const seed = args.seed ?? values.seed;
		const seedLocked = args.seed_locked ?? values.seed_locked;
		if (seedLocked && seed === null) {
			return failed('Could not create the character', 'seed_locked needs a seed: give seed.');
		}
		const finalValues: CharacterValues = {
			...values,
			name: args.name ?? values.name,
			identity_tags: args.identity_tags ?? values.identity_tags,
			outfit_tags: args.outfit_tags ?? values.outfit_tags,
			negative_tags: args.negative_tags ?? values.negative_tags,
			loras: loras ? loras.value : values.loras,
			seed,
			seed_locked: seedLocked,
			reference_strength: args.reference_strength ?? values.reference_strength,
			reference_focus: args.reference_focus ?? values.reference_focus,
		};
		const outputIds = [...new Set([...(pictureId ? [pictureId] : []), ...args.reference_output_ids])];
		if (outputIds.length > REFERENCE_DEFAULTS.max_images) {
			return failed('Too many reference images', `A character holds at most ${REFERENCE_DEFAULTS.max_images} reference images.`);
		}
		const sources: CharacterImageSource[] = outputIds.map((outputId) => ({ kind: 'output', output_id: outputId }));
		const { value: character, problems } = await reporting(() => useCharactersStore.getState().createCharacter(finalValues, sources));
		if (!character) {
			return failed('Could not create the character', becauseOf(problems, 'The character could not be created.'));
		}
		return done(`Created ${character.name}`, characterView(character.id), { characterId: character.id });
	},

	update_character: async (args) => {
		const characters = useCharactersStore.getState();
		const character = selectCharacter(args.character_id)(characters);
		if (!character) {
			return characterNotFound(args.character_id);
		}
		const target = { characterId: character.id };
		const loras = args.loras === null ? null : resolveLoras(args.loras);
		if (loras && 'error' in loras) {
			return failed(`Could not edit ${character.name}`, loras.error, target);
		}
		const strangers = args.remove_reference_image_ids.filter((id) => !character.reference_images.some((image) => image.id === id));
		if (strangers.length > 0) {
			const valid = character.reference_images.map((image) => image.id).join(', ');
			return failed(`Not reference images of ${character.name}`, `${strangers.join(', ')} ${strangers.length === 1 ? 'is not a reference image' : 'are not reference images'} of ${character.name}. Its reference images: ${valid || 'none'}.`, target);
		}
		const additions: string[] = [];
		for (const ref of [...args.add_reference_output_ids.map((output_id) => ({ output_id })), ...args.add_reference_scenes]) {
			const picture = await pictureOf(ref);
			if ('error' in picture) {
				return failed(`Could not edit ${character.name}`, picture.error, target);
			}
			additions.push(picture.value);
		}
		const removals = [...new Set(args.remove_reference_image_ids)];
		const count = character.reference_images.length - removals.length + additions.length;
		if (count > REFERENCE_DEFAULTS.max_images) {
			return failed(
				`Too many reference images for ${character.name}`,
				`${character.name} would have ${count} reference images; a character holds at most ${REFERENCE_DEFAULTS.max_images}. Remove some first (remove_reference_image_ids).`,
				target,
			);
		}
		const patch: Partial<CharacterValues> = {};
		for (const field of ['name', 'identity_tags', 'outfit_tags', 'negative_tags', 'seed_locked', 'reference_strength', 'reference_focus'] as const) {
			if (args[field] !== null) {
				Object.assign(patch, { [field]: args[field] });
			}
		}
		if (loras) {
			patch.loras = loras.value;
		}
		if (args.seed !== null) {
			patch.seed = args.seed === 'none' ? null : args.seed;
			if (args.seed === 'none') {
				patch.seed_locked = false;
			}
		}
		if ((patch.seed_locked ?? character.seed_locked) && (patch.seed === undefined ? character.seed : patch.seed) === null) {
			return failed(`Could not edit ${character.name}`, 'seed_locked needs a seed: give seed.', target);
		}
		const store = useCharactersStore.getState();
		const steps: (() => Promise<unknown>)[] = [
			...removals.map((imageId) => async () => {
				await store.removeReference(character.id, imageId);
				return !selectCharacter(character.id)(useCharactersStore.getState())?.reference_images.some((image) => image.id === imageId);
			}),
			...(Object.keys(patch).length > 0 ? [() => store.updateCharacter(character.id, patch)] : []),
			...additions.map((outputId) => () => store.addReferenceImage(character.id, { kind: 'output', output_id: outputId })),
			...(args.active_in_create !== null
				? [
						async () => {
							await store.setActive(args.active_in_create ? character.id : null);
							return (useCharactersStore.getState().activeId === character.id) === args.active_in_create;
						},
					]
				: []),
		];
		for (const step of steps) {
			const { value, problems } = await reporting(step);
			if (!value) {
				return failed(`Could not edit ${character.name}`, becauseOf(problems, 'The character could not be saved.'), target);
			}
		}
		const saved = selectCharacter(character.id)(useCharactersStore.getState()) ?? character;
		return done(`Edited ${saved.name} (${characterChanges(args, additions.length, removals.length)})`, characterView(character.id), target);
	},

	delete_character: async ({ character_id, user_confirmed }) => {
		const character = selectCharacter(character_id)(useCharactersStore.getState());
		if (!character) {
			return characterNotFound(character_id);
		}
		if (!user_confirmed) {
			return failed('Deletion not confirmed', `Ask the user to confirm that ${character.name} should be deleted, then call delete_character with user_confirmed true.`, { characterId: character_id });
		}
		const { problems } = await reporting(() => useCharactersStore.getState().remove(character_id));
		if (selectCharacter(character_id)(useCharactersStore.getState())) {
			return failed(`Could not delete ${character.name}`, becauseOf(problems, 'The character could not be deleted.'), { characterId: character_id });
		}
		return done(`Deleted ${character.name}`, { character_id, deleted: true });
	},

	install_ip_adapter: async ({ focus, user_confirmed }) => {
		if (!selectSelectedModel(useLibraryStore.getState())) {
			return failed('No model selected', NO_MODEL_MESSAGE);
		}
		if (!user_confirmed) {
			return failed('Download not confirmed', 'Ask the user whether the IP-Adapter files may be downloaded (get_generation_setup says which files and how big), then call install_ip_adapter with user_confirmed true.');
		}
		await useIpAdapterStore.getState().refresh({ force: true });
		const support = selectReferenceSupport(focus)(useIpAdapterStore.getState());
		if (!support) {
			return failed('Could not read the IP-Adapter status', useIpAdapterStore.getState().loadError ?? 'The IP-Adapter status could not be read.');
		}
		if (support.ready) {
			return done(`Reference images are ready (${focus})`, { focus, ready: true });
		}
		const variantId = support.variant_id;
		if (variantId === null) {
			return failed('No IP-Adapter for this model', support.reason ?? 'Reference images cannot be used with this model.');
		}
		const { problems } = await reporting(async () => {
			const run = useIpAdapterStore.getState().install(variantId);
			await Promise.race([
				run,
				waitUntil(() => (selectIpAdapterVariant(variantId)(useIpAdapterStore.getState())?.files ?? []).every((file) => file.local_path !== null || file.task_id !== null), INSTALL_START_WAIT_MS),
			]);
		});
		const variant = selectIpAdapterVariant(variantId)(useIpAdapterStore.getState());
		if (problems.length > 0) {
			return failed(`Could not install ${variant?.label ?? variantId}`, problems.join(' '));
		}
		const status = referenceSupportForCodex(useIpAdapterStore.getState().status);
		const label = variant?.label ?? variantId;
		return done(`Downloading ${label}`, { variant: label, files: variant?.files.map((file) => ({ name: file.name, on_disk: file.local_path !== null, downloading: file.task_id !== null })), status, note: 'The user sees the progress in the app (Downloads).' });
	},
};

/** Runs one tool call (never rejects). */
export async function runCoWriterTool(call: CodexToolCall, hooks: ToolHooks = {}): Promise<CodexToolResult> {
	const handler = TOOLS[call.tool] as (args: unknown, hooks: ToolHooks) => Promise<CodexToolResult>;
	try {
		return await handler(call.arguments, hooks);
	} catch (error) {
		return failed(`${call.tool} failed`, `${call.tool} failed: ${describeError(error)}`);
	}
}
