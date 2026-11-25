// Character injection into prompt building (pure). The active character (src/stores/charactersStore.ts) takes part in
// generation through the existing prompt engine, never through a parallel path. Precedence, documented once, here
// (README "Characters" links to it):
// 1. Pinned categories first. The identity tags become the locked sub-prompt of a PINNED category 'Character', the
//    outfit tags (kept separate from the identity) the locked sub-prompt of a pinned 'Character outfit' category
//    (characterCategories; each one omitted when its tags are empty). The prompt engine (src/domain/promptEngine.ts)
//    selects pinned categories first, in this order, before every user category whatever the user priorities; they
//    are never sorted, never use or advance a per-category cycle counter and never draw from the prompt seed's random
//    sequence (the same prompt seed picks the same user sub-prompts with or without a character, rules aside). Their
//    selections are flagged `locked` and are listed like any category (Used sub-prompts pane, output metadata), so
//    rules can be created with them.
// 2. Forbidden rules: the character wins. A user sub-prompt forbidden together with the character's identity or
//    outfit (exact prompt, category-wide 'Character' / 'Character outfit', contains or tag rules) is never chosen:
//    another candidate of its category is, or the category is skipped (a forbidden user lock skips its category).
//    The outfit is skipped (with a warning) when a rule forbids it together with the identity. The reachability
//    snapshot (src/domain/reachability.ts) mirrors this: such user sub-prompts show as 'indirectly-disabled'.
// 3. Activation texts of user categories can be triggered by the character's tags (selected before them).
// 4. Negative tags are appended to the negative prompt, except those it already contains (characterNegativePrompt).
// 5. LoRAs (src/domain/loraSelection.ts resolveLoraSelection characterLoras): the character's LoRAs come first with
//    their weights, then the selected LoRAs, then the prompt-linked ones; a LoRA both in the character and in the
//    selection uses the character's weight. Character LoRAs missing from the library are reported (and ignored) like
//    missing selected LoRAs.
// 6. Seed: a locked seed replaces the image seed whatever the image seed behavior (lockedCharacterSeed), and the image
//    seed field is then left unchanged; the prompt seed and the cycle counters advance as usual.
// 7. Reference images are applied by the backend (GenerateRequest.character_id, IP-Adapter), which records
//    OutputRecord.character.
// 8. Names: a user category whose key is 'character' (or 'character-outfit') keeps its name; the pinned category is
//    then renamed with uniqueKey ('character-2').
import type { Character } from '../api/types';
import { categoryKeyOf, makeCategory, makeSubPrompt, type Category } from './categories';
import { joinPromptTags, normalizeTagId, promptTagIds, uniqueKey } from './text';

/** Id of the Characters pane (src/workspace/paneRegistry.tsx, through src/stores/charactersStore.ts): window layouts
 *  are persisted by id, never rename. */
export const CHARACTERS_PANE_ID = 'characters';

/** The character fields prompt building reads. */
export type CharacterGenerationInput = Pick<
	Character,
	'id' | 'name' | 'identity_tags' | 'outfit_tags' | 'negative_tags' | 'loras' | 'seed' | 'seed_locked'
>;

/** Name of the pinned identity category (made unique against the user categories, see characterCategories). */
export const CHARACTER_CATEGORY_NAME = 'Character';
/** Name of the pinned outfit category (made unique against the user categories, see characterCategories). */
export const CHARACTER_OUTFIT_CATEGORY_NAME = 'Character outfit';

/** The pinned categories of `character`, in selection order: 'Character' (one locked sub-prompt: joinPromptTags of
 *  identity_tags), then 'Character outfit' (joinPromptTags of outfit_tags); each one omitted when its tags are empty;
 *  no activation text, state 'normal', no induced LoRAs (priority irrelevant: pinned categories are never sorted). A
 *  name whose key is taken by a user category is made unique with uniqueKey (src/domain/text.ts). [] for null. */
export function characterCategories(character: CharacterGenerationInput | null, userCategories: readonly Category[]): Category[] {
	if (!character) {
		return [];
	}
	const takenKeys = new Set(userCategories.map((category) => categoryKeyOf(category.text)));
	const pinned: Category[] = [];
	const parts: [string, readonly string[]][] = [
		[CHARACTER_CATEGORY_NAME, character.identity_tags],
		[CHARACTER_OUTFIT_CATEGORY_NAME, character.outfit_tags],
	];
	for (const [baseName, tags] of parts) {
		const text = joinPromptTags(tags);
		if (!text) {
			continue;
		}
		const name = takenKeys.has(categoryKeyOf(baseName)) ? uniqueKey(baseName, takenKeys) : baseName;
		takenKeys.add(categoryKeyOf(name));
		pinned.push({ ...makeCategory(name), subPrompts: [{ ...makeSubPrompt(text), state: 'lock' }] });
	}
	return pinned;
}

/** `negativePrompt` followed by the character's negative tags that it does not contain yet (tag identity:
 *  normalizeTagId), joined with joinPromptTags. Unchanged for null or without new negative tags. */
export function characterNegativePrompt(negativePrompt: string, character: CharacterGenerationInput | null): string {
	if (!character) {
		return negativePrompt;
	}
	const presentIds = promptTagIds(negativePrompt);
	const added: string[] = [];
	for (const tag of character.negative_tags) {
		const tagId = normalizeTagId(tag);
		if (tagId && !presentIds.has(tagId)) {
			presentIds.add(tagId);
			added.push(tag);
		}
	}
	return added.length > 0 ? joinPromptTags([negativePrompt, ...added]) : negativePrompt;
}

/** The image seed the character imposes: `seed` when seed_locked (and set), else null (no lock; null for null). */
export function lockedCharacterSeed(character: CharacterGenerationInput | null): number | null {
	return character?.seed_locked && character.seed != null ? character.seed : null;
}
