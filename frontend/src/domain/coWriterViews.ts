// What the co-writer's tools answer Codex (pure): the stories, scenes, characters, prompt board, LoRAs, generation
// setup, prompt previews and the consistency report as compact JSON-ready data (ids for the next calls, names for
// people, empty values left out), and the resolution of what Codex names (a LoRA by id or name, a category and one of
// its sub-prompts) with actionable errors (the valid choices). Nothing here computes a prompt: previews read the
// request THE request builder made (src/domain/generationRequest.ts through the generation store), casts and seeds come
// from src/domain/stories.ts and src/domain/characters.ts. The tools run in src/stores/coWriterTools.ts.
import type {
	Character,
	ForbiddenRule,
	GenerationSelection,
	IpAdapterStatus,
	LoraWeight,
	LoRASpec,
	ModelSpec,
	OutputRecord,
	Scene,
	SceneLock,
	Story,
} from '../api/types';
import type { Category } from './categories';
import { categoryKeyOf, sameCategoryName, sortCategories, subPromptKeyOf } from './categories';
import { sceneLabel } from './coWriter';
import { isCategoryWideMatcher } from './forbiddenRules';
import type { BuiltGenerationRequest, GenerationSettings } from './generationRequest';
import { loraSourceOf, type LoraSource } from './loraSelection';
import { categoryUiStateOf, subPromptUiStateOf, type ReachabilitySnapshot } from './reachability';
import {
	availableVariantIds,
	isLockOverriddenByCast,
	sceneCast,
	sceneCastSource,
	sceneIllustrationId,
	sceneLockedSeed,
	sceneStatus,
	type StoryGenerationProgress,
} from './stories';
import { formatWeight, normalizeTagId } from './text';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Keys whose empty value means something (characters []: no character) and stays in compact answers. */
const MEANINGFUL_EMPTY = new Set(['characters']);

/** `value` without its empty entries ('', [] and null; 0 and false stay, and so does an empty MEANINGFUL_EMPTY key):
 *  compact answers. */
export function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter(
			([key, item]) => item !== null && item !== undefined && item !== '' && !(Array.isArray(item) && item.length === 0 && !MEANINGFUL_EMPTY.has(key)),
		),
	) as Partial<T>;
}

/** The library LoRA a weighted LoRA names (null: not in the library). */
function loraEntry(library: readonly LoRASpec[], loraId: string): LoRASpec | null {
	return library.find((item) => item.id === loraId) ?? null;
}

/** LoRAs with their names: [{lora_id, name, weight}] ('(not in the library)' for a missing one). */
export function namedLoras(items: readonly LoraWeight[], library: readonly LoRASpec[]) {
	return items.map((item) => ({ lora_id: item.id, name: loraEntry(library, item.id)?.name ?? '(not in the library)', weight: item.weight }));
}

/** Everything the views of the stories need from the other stores. */
export type StoryViewContext = {
	/** The user categories (the names the cast's pinned categories get). */
	categories: readonly Category[];
	characters: readonly Character[];
	activeCharacter: Character | null;
	library: readonly LoRASpec[];
	/** The outputs on disk (which pictures exist). */
	outputIds: ReadonlySet<string>;
	/** A running "generate scenes" run (the scenes' status). */
	generation: StoryGenerationProgress | null;
};

const STATUS_TEXT = { generating: 'generating', queued: 'queued', illustrated: 'illustrated', missing: 'not illustrated' } as const;

function locksForCodex(locks: readonly SceneLock[]) {
	return locks.map((lock) => ({ category: lock.category_name, sub_prompt: lock.prompt_text }));
}

// ---------------------------------------------------------------------------
// Stories and scenes
// ---------------------------------------------------------------------------

/** A scene as Codex reads it: its text, flow notes, per-frame settings (with the cast they give) and status. */
export function sceneForCodex(story: Story, scene: Scene, context: StoryViewContext) {
	const position = story.scenes.indexOf(scene) + 1;
	const { cast } = sceneCast(story, scene, context.characters, context.activeCharacter);
	const variants = availableVariantIds(scene, context.outputIds);
	return compact({
		scene_id: scene.id,
		position,
		title: scene.title,
		beat: scene.beat,
		text: scene.text,
		shot: scene.shot,
		setting: scene.setting,
		mood: scene.mood,
		extra_tags: scene.extra_tags,
		negative_tags: scene.negative_tags,
		locks: locksForCodex(scene.locks),
		loras: namedLoras(scene.loras, context.library),
		characters: scene.character_ids === null ? 'story' : scene.character_ids,
		cast: cast.map((character) => character.name),
		seed: scene.seed ?? 'random',
		status: STATUS_TEXT[sceneStatus(scene, context.outputIds, context.generation)],
		picture: sceneIllustrationId(scene, context.outputIds),
		variants: variants.length > 1 ? variants : [],
	});
}

/** The whole story in one answer (get_story, create_story). */
export function storyForCodex(story: Story, context: StoryViewContext) {
	return compact({
		story_id: story.id,
		title: story.title,
		logline: story.logline,
		synopsis: story.synopsis,
		style_notes: story.style_notes,
		characters: story.character_ids.map((id) => ({ character_id: id, name: context.characters.find((item) => item.id === id)?.name ?? '(deleted)' })),
		scenes: story.scenes.map((scene) => sceneForCodex(story, scene, context)),
	});
}

export function storiesForCodex(stories: readonly Story[], selectedId: string | null, outputIds: ReadonlySet<string>) {
	return stories.map((story) =>
		compact({
			story_id: story.id,
			title: story.title,
			logline: story.logline,
			scenes: story.scenes.length,
			illustrated: story.scenes.filter((scene) => sceneIllustrationId(scene, outputIds) !== null).length,
			viewing: story.id === selectedId,
		}),
	);
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** Every field of a character, LoRAs named. */
export function characterForCodex(character: Character, activeId: string | null, library: readonly LoRASpec[]) {
	return compact({
		character_id: character.id,
		name: character.name,
		identity_tags: character.identity_tags,
		outfit_tags: character.outfit_tags,
		negative_tags: character.negative_tags,
		loras: namedLoras(character.loras, library),
		seed: character.seed,
		seed_locked: character.seed_locked,
		reference_images: character.reference_images.map((image) => ({ image_id: image.id, from: image.source.kind === 'output' ? `output ${image.source.output_id}` : image.source.kind })),
		reference_focus: character.reference_focus,
		reference_strength: character.reference_strength,
		active_in_create: character.id === activeId,
	});
}

export function charactersForCodex(characters: readonly Character[], activeId: string | null, library: readonly LoRASpec[]) {
	return characters.map((character) => characterForCodex(character, activeId, library));
}

// ---------------------------------------------------------------------------
// The prompt board
// ---------------------------------------------------------------------------

/** At most this many sub-prompts per category, unless a query picks categories. */
export const CATEGORY_PROMPT_LIMIT = 30;

function matcherText(matcher: ForbiddenRule['left']): string {
	const where = matcher.category_name ? ` in ${matcher.category_name}` : '';
	if (matcher.kind === 'tag') {
		return `the tag "${matcher.tag_text ?? ''}"${where}`;
	}
	if (matcher.kind === 'contains') {
		return `sub-prompts containing "${matcher.contains_text ?? ''}"${where}`;
	}
	return isCategoryWideMatcher(matcher) ? `any sub-prompt of ${matcher.category_name}` : `${matcher.category_name ?? '?'}: ${matcher.prompt_text ?? ''}`;
}

/** A forbidden rule in words: 'Outfit: swimsuit never with Weather effects: lightning bolts'. */
export function forbiddenRuleText(rule: ForbiddenRule): string {
	return `${matcherText(rule.left)} never with ${matcherText(rule.right)}`;
}

/** The prompt board: categories in generation order with their state and sub-prompts (pickable ones, the locked one,
 *  the skipped and never-picked ones, their prompt-linked LoRAs), and the forbidden rules. Shortened unless `query`
 *  picks categories (names containing it). `reachability`: the board's indirectly disabled states. */
export function categoriesForCodex(
	categories: readonly Category[],
	rules: readonly ForbiddenRule[],
	reachability: ReachabilitySnapshot,
	library: readonly LoRASpec[],
	query: string | null,
) {
	const needle = query?.trim().toLowerCase() ?? '';
	const picked = sortCategories(categories).filter((category) => !needle || category.text.toLowerCase().includes(needle));
	const items = picked.map((category) => {
		const key = categoryKeyOf(category.text);
		const stateOf = (text: string) => subPromptUiStateOf(reachability, key, subPromptKeyOf(text)) ?? 'normal';
		const prompts = category.subPrompts.filter((subPrompt) => subPrompt.text.trim());
		const pickable = prompts.filter((subPrompt) => subPrompt.state !== 'skip' && stateOf(subPrompt.text) !== 'indirectly-disabled').map((item) => item.text);
		const limit = needle ? pickable.length : CATEGORY_PROMPT_LIMIT;
		const categoryState = category.state === 'skip' ? 'skipped' : categoryUiStateOf(reachability, key) === 'indirectly-disabled' ? 'never picked' : 'normal';
		return compact({
			category: category.text,
			state: categoryState,
			activation_text: category.activation_text,
			sub_prompts: pickable.slice(0, limit),
			more_sub_prompts: pickable.length > limit ? pickable.length - limit : null,
			locked: prompts.find((subPrompt) => subPrompt.state === 'lock')?.text ?? null,
			skipped: prompts.filter((subPrompt) => subPrompt.state === 'skip').map((item) => item.text),
			never_picked: prompts.filter((subPrompt) => subPrompt.state !== 'skip' && stateOf(subPrompt.text) === 'indirectly-disabled').map((item) => item.text),
			linked_loras: prompts
				.filter((subPrompt) => subPrompt.extraLoraIds.length > 0)
				.map((subPrompt) => ({ sub_prompt: subPrompt.text, loras: subPrompt.extraLoraIds.map((id) => loraEntry(library, id)?.name ?? id) })),
		});
	});
	return compact({ categories: items, forbidden_rules: rules.map(forbiddenRuleText) });
}

// ---------------------------------------------------------------------------
// LoRAs and the generation setup
// ---------------------------------------------------------------------------

export function lorasForCodex(
	library: readonly LoRASpec[],
	selected: readonly LoraWeight[],
	characters: readonly Character[],
	stories: readonly Story[],
	query: string | null,
) {
	const needle = query?.trim().toLowerCase() ?? '';
	return library
		.filter((lora) => !needle || lora.name.toLowerCase().includes(needle) || lora.id.toLowerCase().includes(needle))
		.map((lora) =>
			compact({
				lora_id: lora.id,
				name: lora.name,
				trigger_words: lora.source?.trigger_words ?? [],
				base_model: lora.source?.base_model ?? null,
				selected_weight: selected.find((item) => item.id === lora.id)?.weight ?? null,
				used_by_characters: characters.filter((character) => character.loras.some((item) => item.id === lora.id)).map((character) => character.name),
				used_in_scenes: stories.flatMap((story) =>
					story.scenes.filter((scene) => scene.loras.some((item) => item.id === lora.id)).map((scene) => `${story.title} · ${sceneLabel(story, scene.id)}`),
				),
			}),
		);
}

export type GenerationSetupInput = {
	model: ModelSpec | null;
	settings: GenerationSettings;
	selectedLoras: readonly LoraWeight[];
	library: readonly LoRASpec[];
	activeCharacter: Character | null;
	generating: boolean;
	/** The IP-Adapter status for the model (null: unknown). */
	ipAdapters: IpAdapterStatus | null;
};

function megabytes(bytes: number): string {
	return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

/** Whether reference images work with the model, per focus, and the files to install when they do not. */
export function referenceSupportForCodex(status: IpAdapterStatus | null) {
	if (!status) {
		return 'unknown (no model selected, or the IP-Adapter status could not be read)';
	}
	return status.support.map((support) => {
		const variant = status.variants.find((item) => item.id === support.variant_id) ?? null;
		const missing = variant?.files.filter((file) => file.local_path === null) ?? [];
		return compact({
			focus: support.focus,
			ready: support.ready,
			reason: support.reason,
			downloading: missing.some((file) => file.task_id !== null),
			install: !support.ready && variant && missing.length > 0 ? `${variant.label}: ${missing.map((file) => `${file.name} (${megabytes(file.size_bytes)})`).join(', ')}` : null,
		});
	});
}

export function generationSetupForCodex(input: GenerationSetupInput) {
	const { settings } = input;
	return compact({
		model: input.model ? { name: input.model.name, default_size: `${input.model.default_width}x${input.model.default_height}` } : 'none selected: no picture can be generated',
		size: `${settings.width}x${settings.height}`,
		steps: settings.steps,
		cfg: settings.guidanceScale,
		negative_prompt: settings.negativePrompt,
		prompt_seed: compact({ value: settings.promptSeedInput || 'random', behavior: settings.promptSeedBehavior }),
		selected_loras: namedLoras(input.selectedLoras, input.library),
		active_character: input.activeCharacter?.name ?? null,
		generating: input.generating,
		reference_images: referenceSupportForCodex(input.ipAdapters),
	});
}

// ---------------------------------------------------------------------------
// Previews (what generating a scene would use: the request THE builder made)
// ---------------------------------------------------------------------------

const SOURCE_TEXT: Readonly<Record<LoraSource, string>> = { character: 'character', scene: 'scene', selection: 'selected in Create', prompt: 'sub-prompt (default weight)' };

/** The LoRAs of a built request with their weights and where each comes from. */
export function requestLoras(built: BuiltGenerationRequest) {
	return (built.request.loras ?? []).map((lora) => ({ name: lora.name, weight: lora.weight, from: SOURCE_TEXT[loraSourceOf(built.loras, lora.id)] }));
}

/** Who gives the scene its image seed (rule 5 of src/domain/stories.ts). */
function seedSource(scene: Scene, cast: readonly Character[]): string {
	if (scene.seed !== null) {
		return 'the scene';
	}
	const locked = cast.find((character) => character.seed_locked && character.seed !== null);
	return locked ? `${locked.name}'s locked seed` : 'random: a new seed for every picture';
}

/** How the first character's reference images would apply (only the first one's apply). */
function referencesOf(cast: readonly Character[], status: IpAdapterStatus | null) {
	const first = cast[0];
	if (!first) {
		return null;
	}
	if (first.reference_images.length === 0) {
		return compact({ character: first.name, images: 0, applies: false, reason: 'no reference image' });
	}
	const support = status?.support.find((item) => item.focus === first.reference_focus) ?? null;
	return compact({
		character: first.name,
		images: first.reference_images.length,
		focus: first.reference_focus,
		strength: first.reference_strength,
		applies: support?.ready ?? false,
		reason: support ? support.reason : 'unknown (no model selected)',
	});
}

export type ScenePreviewInput = {
	story: Story;
	scene: Scene;
	/** The request generating the scene would send (null: none can be built: `error` says why). */
	built: BuiltGenerationRequest | null;
	error: string | null;
	missingCharacterIds: readonly string[];
	context: StoryViewContext;
	ipAdapters: IpAdapterStatus | null;
};

function selectionsText(selections: readonly Pick<GenerationSelection, 'category_name' | 'prompt_text' | 'locked'>[], locked: boolean): string[] {
	return selections.filter((selection) => selection.locked === locked && selection.prompt_text.trim()).map((selection) => selection.category_name);
}

/** One scene's preview (preview_scenes). */
export function scenePreviewForCodex({ story, scene, built, error, missingCharacterIds, context, ipAdapters }: ScenePreviewInput) {
	const { cast } = sceneCast(story, scene, context.characters, context.activeCharacter);
	const head = { scene_id: scene.id, scene: sceneLabel(story, scene.id) };
	if (!built) {
		return { ...head, error };
	}
	const { request } = built;
	const warnings = [
		...missingCharacterIds.map((id) => `Character ${id} no longer exists: it is left out.`),
		...built.missingLoraIds.map((id) => `LoRA ${id} is not in the library: it is left out.`),
		...scene.locks
			.filter((lock) => isLockOverriddenByCast(lock, cast, context.categories))
			.map((lock) => `The lock of ${lock.category_name} is replaced by a character's tags.`),
	];
	return compact({
		...head,
		prompt: request.prompt,
		negative_prompt: request.negative_prompt,
		loras: requestLoras(built),
		seed: built.imageSeedLocked ? request.seed : 'random (a new seed for every picture)',
		seed_from: seedSource(scene, cast),
		prompt_seed: request.prompt_seed,
		random_categories: selectionsText(request.selections ?? [], false),
		cast: cast.map((character) => character.name),
		reference_images: referencesOf(cast, ipAdapters),
		size: `${request.width}x${request.height}`,
		steps: request.steps,
		model: request.model.name,
		warnings,
	});
}

// ---------------------------------------------------------------------------
// The consistency report
// ---------------------------------------------------------------------------

export type ConsistencySceneInput = ScenePreviewInput & {
	/** The metadata of the scene's picture (null: none, or it could not be read). */
	picture: OutputRecord | null;
};

export type ConsistencyProblem = { scene: string | null; problem: string; fix: string };

function sameLoras(left: readonly LoraWeight[], right: readonly LoraWeight[]): boolean {
	const key = (items: readonly LoraWeight[]) =>
		items
			.map((item) => `${item.id}:${formatWeight(item.weight)}`)
			.sort()
			.join('|');
	return key(left) === key(right);
}

function castMemberForCodex(character: Character, library: readonly LoRASpec[]) {
	return compact({
		character_id: character.id,
		name: character.name,
		identity_tags: character.identity_tags,
		outfit_tags: character.outfit_tags,
		loras: namedLoras(character.loras, library).map(({ name, weight }) => ({ name, weight })),
		seed: character.seed,
		seed_locked: character.seed_locked,
		reference_images: character.reference_images.length,
	});
}

/** Per scene: the cast (and its source), each character's tags, LoRAs, seed and references, the LoRAs, seed and
 *  references generating it would use, and what its picture was made with; then the problems found, each with what to
 *  do. */
export function consistencyReportForCodex(story: Story, scenes: readonly ConsistencySceneInput[], context: StoryViewContext) {
	const problems: ConsistencyProblem[] = [];
	const report = scenes.map((input) => {
		const { scene, built, picture } = input;
		const label = sceneLabel(story, scene.id) ?? scene.title;
		const add = (problem: string, fix: string) => problems.push({ scene: label, problem, fix });
		const source = sceneCastSource(story, scene);
		const { cast } = sceneCast(story, scene, context.characters, context.activeCharacter);
		for (const id of input.missingCharacterIds) {
			add(`Character ${id} no longer exists.`, 'Set the characters of the scene or the story again (update_scenes characters / update_story).');
		}
		if (source === 'scene' && cast.length === 0 && story.character_ids.length > 0) {
			add('This scene has no character while the story has some.', 'If a character belongs in it, set characters "story" (update_scenes).');
		}
		const sceneTagIds = new Set(scene.extra_tags.map(normalizeTagId));
		for (const character of cast) {
			const repeated = character.identity_tags.filter((tag) => sceneTagIds.has(normalizeTagId(tag)));
			if (repeated.length > 0) {
				add(`The scene tags repeat ${character.name}'s appearance (${repeated.join(', ')}).`, 'Remove them from the scene (update_scenes remove_tags): the character adds them.');
			}
		}
		for (const lock of scene.locks.filter((item) => isLockOverriddenByCast(item, cast, context.categories))) {
			add(`The lock of ${lock.category_name} is replaced by a character's tags.`, `Unlock ${lock.category_name} (update_scenes unlock) or change the character.`);
		}
		for (const id of built?.missingLoraIds ?? []) {
			add(`LoRA ${id} is not in the library.`, 'Remove it from the scene or the character, or pick a LoRA of list_loras.');
		}
		const references = referencesOf(cast, input.ipAdapters);
		if (references && cast[0].reference_images.length > 0 && references.applies === false) {
			add(`${cast[0].name}'s reference images cannot apply: ${(references.reason ?? 'unknown').replace(/\.+$/, '')}.`, 'get_generation_setup says what to install (install_ip_adapter, after the user agrees).');
		}
		const plannedLoras = built ? (built.request.loras ?? []).map(({ id, weight }) => ({ id, weight })) : null;
		const pictureView = picture
			? compact({
					output_id: picture.output_id,
					seed: picture.image_seed ?? picture.seed,
					loras: namedLoras(picture.active_loras, context.library).map(({ name, weight }) => ({ name, weight })),
					character: picture.character?.name ?? 'none',
					references_applied: picture.character ? picture.character.reference.applied : null,
					references_reason: picture.character?.reference.reason ?? null,
				})
			: null;
		if (picture) {
			const pictureCharacter = picture.character?.id ?? null;
			if (pictureCharacter !== (cast[0]?.id ?? null)) {
				add(
					`Its picture was made with ${picture.character?.name ?? 'no character'}, but its first character is now ${cast[0]?.name ?? 'none'}.`,
					'Regenerate it (generate_scenes).',
				);
			}
			if (plannedLoras && !sameLoras(plannedLoras, picture.active_loras)) {
				add('Its picture was made with other LoRAs or weights than the scene would use now.', 'Regenerate it if the new LoRAs matter (generate_scenes).');
			}
			const fixed = sceneLockedSeed({ seed: scene.seed, cast });
			if (fixed !== null && fixed !== (picture.image_seed ?? picture.seed)) {
				add(`Its picture was made with seed ${picture.image_seed ?? picture.seed}, the scene now uses ${fixed}.`, 'Regenerate it (generate_scenes).');
			}
			if (picture.character && !picture.character.reference.applied && cast[0]?.reference_images.length) {
				add(`Its picture was made without reference images (${(picture.character.reference.reason ?? 'not applied').replace(/\.+$/, '')}).`, 'Regenerate it once reference images can apply.');
			}
		}
		return compact({
			scene_id: scene.id,
			scene: label,
			cast_from: source === 'active' ? 'the character active in Create' : source,
			cast: cast.map((character) => castMemberForCodex(character, context.library)),
			loras: built ? requestLoras(built) : namedLoras(scene.loras, context.library).map(({ name, weight }) => ({ name, weight, from: 'scene' })),
			seed: sceneLockedSeed({ seed: scene.seed, cast }) ?? 'random',
			seed_from: seedSource(scene, cast),
			references,
			picture: pictureView,
			preview_error: input.error,
		});
	});
	for (const character of context.characters.filter((item) => scenes.some((input) => sceneCast(story, input.scene, context.characters, context.activeCharacter).cast.includes(item)))) {
		if (!character.seed_locked && character.reference_images.length === 0) {
			problems.push({
				scene: null,
				problem: `${character.name} has neither a locked seed nor reference images: their look can change from scene to scene.`,
				fix: 'Lock a seed (update_character seed, seed_locked) or add reference images from a good picture (update_character add_reference_scenes).',
			});
		}
	}
	const weights = new Map<string, Map<string, string[]>>();
	for (const { scene } of scenes) {
		for (const lora of scene.loras) {
			const byWeight = weights.get(lora.id) ?? new Map<string, string[]>();
			byWeight.set(formatWeight(lora.weight), [...(byWeight.get(formatWeight(lora.weight)) ?? []), sceneLabel(story, scene.id) ?? scene.title]);
			weights.set(lora.id, byWeight);
		}
	}
	for (const [loraId, byWeight] of weights) {
		if (byWeight.size > 1) {
			const name = loraEntry(context.library, loraId)?.name ?? loraId;
			const where = [...byWeight].map(([weight, labels]) => `${weight} in ${labels.join(', ')}`).join('; ');
			problems.push({ scene: null, problem: `${name} has different weights: ${where}.`, fix: 'Use one weight in every scene unless the change is wanted (update_scenes set_loras).' });
		}
	}
	return { story: story.title, scenes: report, problems };
}

// ---------------------------------------------------------------------------
// Resolving what Codex names (actionable errors)
// ---------------------------------------------------------------------------

/** A library LoRA named by its id or its name (case-insensitive), or the error listing the valid ones. */
export function resolveLora(ref: string, library: readonly LoRASpec[]): { lora: LoRASpec } | { error: string } {
	const needle = ref.trim().toLowerCase();
	const lora =
		library.find((item) => item.id === ref) ??
		library.find((item) => item.name.toLowerCase() === needle) ??
		library.find((item) => item.source?.model_name.toLowerCase() === needle) ??
		null;
	if (lora) {
		return { lora };
	}
	const valid = library.map((item) => `${item.name} (${item.id})`).slice(0, 40);
	return { error: `There is no LoRA "${ref}" in the library. ${valid.length > 0 ? `The LoRAs: ${valid.join(', ')}.` : 'The library has no LoRA.'}` };
}

/** A category and one of its sub-prompts (sub-prompt identity: casing, spaces and tag order ignored), as a scene
 *  lock with their exact texts, or the error listing the valid choices. */
export function resolveLock(category: string, subPrompt: string, categories: readonly Category[]): { lock: SceneLock } | { error: string } {
	const match = categories.find((item) => sameCategoryName(item.text, category));
	if (!match) {
		const names = sortCategories(categories)
			.map((item) => item.text)
			.slice(0, 60);
		return { error: `There is no prompt category "${category}". The categories: ${names.join(', ')}.` };
	}
	const prompt = match.subPrompts.find((item) => item.text.trim() && subPromptKeyOf(item.text) === subPromptKeyOf(subPrompt));
	if (!prompt) {
		const valid = match.subPrompts
			.map((item) => item.text)
			.filter((text) => text.trim())
			.slice(0, CATEGORY_PROMPT_LIMIT);
		return { error: `"${subPrompt}" is not a sub-prompt of ${match.text}. Its sub-prompts: ${valid.map((text) => `"${text}"`).join(', ')}.` };
	}
	return { lock: { category_name: match.text, prompt_text: prompt.text } };
}
