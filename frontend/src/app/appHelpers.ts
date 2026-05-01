import { api } from '../api';
import type {
  AppState,
  BootstrapResponse,
  ForbiddenRule,
  LibraryState,
  OutputRecord,
  PaneKey,
  PromptCategory,
  SeedBehavior,
} from '../types';
import {
  areNameEquivalent,
  categoryIdFromName,
  cloneDeep,
  comparePriority,
  getStoredPromptState,
  makeRuntimePromptEndpoint,
  normalizeStateIds,
  promptToKey,
  ruleMatchesPrompt,
} from '../utils';
import type { ForbiddenHighlightState, PromptEndpoint } from './appTypes';
import { EMPTY_FORBIDDEN_HIGHLIGHT_STATE } from './appTypes';


export const DEFAULT_BROWSER_PANE = { x: 900, y: 24, width: 320, height: 320, z_index: 4 };
export const DEFAULT_USED_PANE = { x: 1210, y: 830, width: 360, height: 320, z_index: 6 };

export async function bootstrapWithRetry(
  signal: { cancelled: boolean },
  onRetryError?: (error: unknown) => void,
): Promise<BootstrapResponse> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (!signal.cancelled) {
    try {
      return await api.bootstrap();
    } catch (error) {
      lastError = error;
      onRetryError?.(error);
      if (Date.now() - startedAt >= 15000) {
        throw error;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error('Bootstrap cancelled.');
}

export function getMaxWindowZ(state: AppState): number {
  const panes = state.workspace;
  return Math.max(
    panes.image.z_index,
    panes.browser.z_index,
    panes.controls.z_index,
    panes.details.z_index,
    panes.used.z_index,
    ...state.categories.map((item) => item.z_index ?? 0),
    10,
  );
}

export function basenameFromPath(value: string): string {
  const parts = value.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

export function dirnameFromPath(value: string): string {
  const parts = value.split(/[/\\]+/).filter(Boolean);
  if (parts.length <= 1) {
    return value;
  }
  const prefix = /^[A-Za-z]:/.test(parts[0]) ? `${parts[0]}\\` : '/';
  return prefix + parts.slice(1, -1).join(prefix === '/' ? '/' : '\\');
}

export function splitBulkPrompts(value: string): string[] {
  const entries = value.split(/\n\|\n/g).map((item) => item.trim());
  return entries.length ? entries : [''];
}

export function matcherPromptKey(categoryName: string, promptText: string): string {
  return `${categoryIdFromName(categoryName)}::${promptToKey('', promptText)}`;
}

export function specificPairKey(left: Pick<PromptEndpoint, 'categoryName' | 'promptText'>, right: Pick<PromptEndpoint, 'categoryName' | 'promptText'>): string {
  const leftKey = matcherPromptKey(left.categoryName, left.promptText);
  const rightKey = matcherPromptKey(right.categoryName, right.promptText);
  return leftKey <= rightKey ? `${leftKey}||${rightKey}` : `${rightKey}||${leftKey}`;
}

export function selectionIdentityKey(selection: Pick<OutputRecord['selections'][number], 'category_name' | 'prompt_text'>): string {
  return matcherPromptKey(selection.category_name, selection.prompt_text);
}

export function computeForbiddenHighlightState(
  state: AppState | null,
  selectedPromptEndpoint: PromptEndpoint | null,
): ForbiddenHighlightState {
  if (!state || !selectedPromptEndpoint) {
    return EMPTY_FORBIDDEN_HIGHLIGHT_STATE;
  }

  const promptForbiddenKeys = new Set<string>();
  const promptForbiddenPurpleKeys = new Set<string>();
  const categoryForbiddenIds = new Set<string>();
  const categoryForbiddenPurpleIds = new Set<string>();
  const selectedKey = `${selectedPromptEndpoint.categoryId}::${selectedPromptEndpoint.promptId}`;

  for (const category of state.categories) {
    let categoryHasSpecificForbidden = false;
    let categoryHasLockedPrompt = false;

    for (const prompt of category.prompts) {
      const promptKey = `${category.id}::${prompt.id}`;
      const promptLocked = getStoredPromptState(category, prompt) === 'lock';
      if (promptLocked) {
        categoryHasLockedPrompt = true;
      }
      if (promptKey === selectedKey) {
        continue;
      }

      const endpoint = makeRuntimePromptEndpoint(category, prompt, promptLocked);
      let promptHasForbidden = false;
      let promptHasSpecificForbidden = false;
      for (const rule of state.forbidden_rules) {
        if (!ruleMatchesPrompt(rule, selectedPromptEndpoint, endpoint, state.categories)) {
          continue;
        }
        promptHasForbidden = true;
        if (rule.left.kind === 'specific' && rule.right.kind === 'specific') {
          promptHasSpecificForbidden = true;
          break;
        }
      }

      if (promptHasForbidden) {
        promptForbiddenKeys.add(promptKey);
        if (selectedPromptEndpoint.locked || promptLocked) {
          promptForbiddenPurpleKeys.add(promptKey);
        }
      }
      if (category.id !== selectedPromptEndpoint.categoryId && promptHasSpecificForbidden) {
        categoryHasSpecificForbidden = true;
      }
    }

    if (categoryHasSpecificForbidden) {
      categoryForbiddenIds.add(category.id);
      if (selectedPromptEndpoint.locked || categoryHasLockedPrompt) {
        categoryForbiddenPurpleIds.add(category.id);
      }
    }
  }

  return { promptForbiddenKeys, promptForbiddenPurpleKeys, categoryForbiddenIds, categoryForbiddenPurpleIds };
}

export function haveAllSpecificForbiddenPairs(
  leftEndpoints: PromptEndpoint[],
  rightEndpoints: PromptEndpoint[],
  specificForbiddenRuleKeys: Set<string>,
): boolean {
  let hasAnyPair = false;
  for (const left of leftEndpoints) {
    for (const right of rightEndpoints) {
      if (left.categoryId === right.categoryId && left.promptId === right.promptId) {
        continue;
      }
      hasAnyPair = true;
      if (!specificForbiddenRuleKeys.has(specificPairKey(left, right))) {
        return false;
      }
    }
  }
  return hasAnyPair;
}

export function parseOptionalSeed(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeLoadedState(state: AppState): AppState {
  const next = normalizeStateIds(cloneDeep(state));
  next.seed_mode = 'manual';
  next.prompt_seed_behavior = next.prompt_seed_behavior ?? (next.seed_advance_mode === 'increment' ? 'increment' : 'fixed');
  next.image_seed_behavior = next.image_seed_behavior ?? (next.seed_advance_mode === 'randomize' ? 'randomize' : next.seed_advance_mode === 'increment' ? 'increment' : 'fixed');
  next.editor.visibility_mode = next.editor.visibility_mode ?? (next.editor.overlays_hidden ? 'categories-only' : 'all');
  next.editor.overlays_hidden = next.editor.visibility_mode === 'categories-only';
  next.editor.edit_session_id = next.editor.edit_session_id ?? 0;
  next.workspace.browser = next.workspace.browser ?? { ...DEFAULT_BROWSER_PANE };
  next.workspace.used = next.workspace.used ?? { ...DEFAULT_USED_PANE };
  return next;
}

export function makeRandomSeed(): number {
  return Math.floor(Math.random() * 2147483646) + 1;
}

export type SeedPlan = {
  requestSeed: number;
  nextInput: string;
};

export function planSeed(mode: SeedBehavior, rawValue: string, actualSeed: number | null = null): SeedPlan {
  const parsed = parseOptionalSeed(rawValue);
  const usedSeed = mode === 'randomize' ? (actualSeed ?? makeRandomSeed()) : (parsed ?? actualSeed ?? makeRandomSeed());
  if (mode === 'increment') {
    return { requestSeed: usedSeed, nextInput: String(usedSeed + 1) };
  }
  if (mode === 'randomize') {
    return { requestSeed: usedSeed, nextInput: String(makeRandomSeed()) };
  }
  return { requestSeed: usedSeed, nextInput: String(usedSeed) };
}

export function cycleVisibilityMode(current: AppState['editor']['visibility_mode']): AppState['editor']['visibility_mode'] {
  if (current === 'all') {
    return 'categories-only';
  }
  if (current === 'categories-only') {
    return 'panes-only';
  }
  return 'all';
}

export function estimateCategorySize(category: AppState['categories'][number]): { width: number; height: number } {
  const maxScreenHeight = Math.max(220, Math.floor(window.innerHeight * 0.25));
  const longestText = Math.max(
    category.name.length,
    category.activation_text.length,
    ...category.prompts.map((prompt) => Math.max(prompt.text.length, 18)),
  );
  const width = Math.max(300, Math.min(760, 156 + longestText * 7));
  const headerLines = category.activation_text.trim() ? 2 : 1;
  const baseHeight = 88 + headerLines * 26 + category.prompts.length * 42 + 34;
  const height = Math.max(180, Math.min(maxScreenHeight, baseHeight));
  return { width, height };
}

export function reorganizeCategoriesInPlace(draft: AppState) {
  const ordered = [...draft.categories].sort((left, right) => comparePriority(left.priority, right.priority) || left.name.localeCompare(right.name));
  let cursorX = 24;
  let cursorY = 24;
  let rowHeight = 0;
  const maxWidth = Math.max(360, window.innerWidth - 24);
  const panes = draft.workspace;
  const maxPaneZ = Math.max(panes.image.z_index, panes.browser.z_index, panes.controls.z_index, panes.details.z_index, panes.used.z_index, 10);

  for (const [index, category] of ordered.entries()) {
    const size = estimateCategorySize(category);
    category.size.width = size.width;
    category.size.height = size.height;
    category.z_index = maxPaneZ + index + 1;

    if (cursorX + size.width > maxWidth && cursorX > 24) {
      cursorX = 24;
      cursorY += rowHeight + 12;
      rowHeight = 0;
    }

    category.position.x = cursorX;
    category.position.y = cursorY;
    cursorX += size.width + 12;
    rowHeight = Math.max(rowHeight, size.height);
  }

  for (const [index, category] of ordered.entries()) {
    category.priority = String(index + 1);
  }

  draft.categories = ordered;
}

export function stripMissingLoraReferences(state: AppState, library: LibraryState): AppState {
  const validLoraIds = new Set(library.loras.map((item) => item.id));
  const next = cloneDeep(state);

  next.last_lora_ids = next.last_lora_ids.filter((id) => validLoraIds.has(id));

  for (const category of next.categories) {
    for (const prompt of category.prompts) {
      prompt.extra_lora_ids = prompt.extra_lora_ids.filter((id) => validLoraIds.has(id));
    }
  }

  return next;
}

export function removeLoraReferencesFromState(state: AppState, loraId: string) {
  state.last_lora_ids = state.last_lora_ids.filter((item) => item !== loraId);
  for (const category of state.categories) {
    for (const prompt of category.prompts) {
      prompt.extra_lora_ids = prompt.extra_lora_ids.filter((item) => item !== loraId);
    }
  }
}

export function removeMissingLoraReferencesFromState(state: AppState, validLoraIds: Set<string>) {
  state.last_lora_ids = state.last_lora_ids.filter((id) => validLoraIds.has(id));
  for (const category of state.categories) {
    for (const prompt of category.prompts) {
      prompt.extra_lora_ids = prompt.extra_lora_ids.filter((id) => validLoraIds.has(id));
    }
  }
}

export function removeCategoryFromDraft(draft: AppState, categoryId: string) {
  const removedCategory = draft.categories.find((item) => item.id === categoryId);
  draft.categories = draft.categories.filter((item) => item.id !== categoryId);
  draft.forbidden_rules = draft.forbidden_rules.filter((rule) => {
    if (!removedCategory) {
      return true;
    }
    const matchesLeft = rule.left.category_name ? areNameEquivalent(rule.left.category_name, removedCategory.name) : false;
    const matchesRight = rule.right.category_name ? areNameEquivalent(rule.right.category_name, removedCategory.name) : false;
    return !matchesLeft && !matchesRight;
  });
  if (draft.editor.selected_category_id === categoryId) {
    draft.editor.selected_category_id = null;
    draft.editor.selected_prompt_id = null;
    draft.editor.editing_target = { kind: 'none', category_id: null, prompt_id: null };
  }
}

export function removePromptFromDraft(draft: AppState, categoryId: string, promptId: string) {
  const categoryItem = draft.categories.find((item) => item.id === categoryId);
  if (!categoryItem) {
    return;
  }
  const removedPrompt = categoryItem.prompts.find((item) => item.id === promptId);
  categoryItem.prompts = categoryItem.prompts.filter((item) => item.id !== promptId);
  if (removedPrompt) {
    draft.forbidden_rules = draft.forbidden_rules.filter((rule) => {
      const matchesLeft = rule.left.kind === 'specific'
        && areNameEquivalent(rule.left.category_name ?? '', categoryItem.name)
        && areNameEquivalent(rule.left.prompt_text ?? '', removedPrompt.text);
      const matchesRight = rule.right.kind === 'specific'
        && areNameEquivalent(rule.right.category_name ?? '', categoryItem.name)
        && areNameEquivalent(rule.right.prompt_text ?? '', removedPrompt.text);
      return !matchesLeft && !matchesRight;
    });
  }
  if (draft.editor.selected_prompt_id === promptId) {
    draft.editor.selected_prompt_id = null;
    draft.editor.editing_target = { kind: 'none', category_id: categoryId, prompt_id: null };
  }
}

export function focusNone(editor: AppState['editor'], keepSelection: boolean) {
  editor.editing_target = {
    kind: 'none',
    category_id: keepSelection ? editor.selected_category_id : null,
    prompt_id: keepSelection ? editor.selected_prompt_id : null,
  };
  if (!keepSelection) {
    editor.selected_category_id = null;
    editor.selected_prompt_id = null;
  }
}
