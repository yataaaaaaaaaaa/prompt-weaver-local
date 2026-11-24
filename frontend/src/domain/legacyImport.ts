// Legacy import: maps the backend's legacy app_state.json / library.json (BootstrapResponse.legacy_state /
// legacy_library) to the state of the stores that were never persisted. Pure; the session store applies
// the results through each store's replaceAll/replaceWindows action (same mapping as the pre-refactor app).
import type { AppState, LegacyPaneLayout, LegacyPromptCategory, LegacyPromptEntry, LibraryState as LegacyLibrary } from '../api/types';
import { categoryKeyOf, priorityOr, type Category, type SubPromptState } from './categories';
import type { ForbiddenRule } from './forbiddenRules';
import { generationSettingsFromBackend, type GenerationSettings } from './generationRequest';
import { categoryWindowKey, isCompleteRect, paneWindowKey, sanitizeWindowLayout, type WindowLayouts } from './layout';
import { lorasFromLegacyIds, type LibraryData } from './library';

function subPromptState(category: LegacyPromptCategory, prompt: LegacyPromptEntry): SubPromptState {
	const lockedById = category.locked_prompt_id != null && category.locked_prompt_id !== '' && prompt.id === category.locked_prompt_id;
	const lockedByText = category.locked_prompt_text != null && prompt.text === category.locked_prompt_text;
	if (lockedById || lockedByText) {
		return 'lock';
	}
	return prompt.skipped ? 'skip' : 'normal';
}

/** Categories (name -> text, priority string -> number (DEFAULT_PRIORITY when not a number), muted -> 'skip', locked
 *  prompt id/text -> 'lock', skipped -> 'skip'); extra LoRA ids are limited to `libraryLoraIds`.
 *  Uniqueness and the single lock are enforced by the categories store's replaceAll. */
export function legacyCategories(state: Pick<AppState, 'categories'>, libraryLoraIds: ReadonlySet<string>): Category[] {
	return state.categories.map((category) => ({
		text: category.name,
		activation_text: category.activation_text,
		priority: priorityOr(category.priority),
		state: category.muted ? 'skip' : 'normal',
		subPrompts: category.prompts.map((prompt) => ({
			text: prompt.text,
			state: subPromptState(category, prompt),
			extraLoraIds: prompt.extra_lora_ids.filter((id) => libraryLoraIds.has(id)),
		})),
	}));
}

export function legacyForbiddenRules(state: Pick<AppState, 'forbidden_rules'>): ForbiddenRule[] {
	return state.forbidden_rules;
}

/** Library models/LoRAs plus the last model/LoRA selection (LoRAs at the default weight: app_state.json has no
 *  weights) and dialog directories of app_state.json. */
export function legacyLibrary(
	state: Pick<AppState, 'last_model_id' | 'last_lora_ids' | 'last_model_dir' | 'last_lora_dir'>,
	library: LegacyLibrary,
): LibraryData {
	return {
		models: library.models,
		loras: library.loras,
		selectedModelId: state.last_model_id ?? library.models[0]?.id ?? '',
		selectedLoras: lorasFromLegacyIds(state.last_lora_ids),
		lastModelDir: state.last_model_dir,
		lastLoraDir: state.last_lora_dir,
	};
}

/** app_state.json generation fields -> settings (same mapping as the backend defaults). */
export function legacyGenerationSettings(state: AppState): GenerationSettings {
	return generationSettingsFromBackend(state);
}

/** Legacy app_state workspace entry -> pane id of src/workspace/paneRegistry.tsx. */
export const LEGACY_WORKSPACE_PANES = { image: 'image', controls: 'controls', used: 'used' } as const;

type LegacyWorkspace = Partial<Record<keyof typeof LEGACY_WORKSPACE_PANES, LegacyPaneLayout | null>>;

/** Legacy geometry has no backend defaults: incomplete rects import nothing (the frontend defaults apply). */
function windowFrom(rect: Partial<Record<'x' | 'y' | 'width' | 'height', number | null>>, z: number | null | undefined) {
	return isCompleteRect(rect) ? sanitizeWindowLayout({ ...rect, z: z ?? undefined }) : null;
}

/** Pane layouts (image/controls/used) and every category's position/size/z_index -> workspace windows.
 *  Entries with non-finite coordinates are skipped. */
export function legacyWorkspaceWindows(state: Pick<AppState, 'categories'> & { workspace?: LegacyWorkspace | null }): WindowLayouts {
	const windows: WindowLayouts = {};
	const workspace: LegacyWorkspace = state.workspace ?? {};
	for (const [legacyName, paneId] of Object.entries(LEGACY_WORKSPACE_PANES) as [keyof LegacyWorkspace, string][]) {
		const pane = workspace[legacyName];
		const layout = pane ? windowFrom(pane, pane.z_index) : null;
		if (layout) {
			windows[paneWindowKey(paneId)] = layout;
		}
	}
	for (const category of state.categories) {
		const layout = windowFrom({ ...category.position, ...category.size }, category.z_index);
		if (layout) {
			windows[categoryWindowKey(categoryKeyOf(category.name))] = layout;
		}
	}
	return windows;
}
