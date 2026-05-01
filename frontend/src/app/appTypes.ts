import type { AppState, CategoryUiState, OutputRecord, PromptUiState, SeedBehavior } from '../types';
import type { ReachabilitySnapshot, RuntimePromptEndpoint } from '../utils';

export type UndoEntry =
  | {
      type: 'generate';
      previousOutputId: string | null;
      previousPromptSeedInput: string;
      previousPromptSeedBehavior: SeedBehavior;
      previousSeedInput: string;
      previousImageSeedBehavior: SeedBehavior;
    }
  | {
      type: 'delete-output';
      outputId: string;
      previousOutputId: string | null;
    };

export type PromptEndpoint = RuntimePromptEndpoint;

export type TextEditBuffer = {
  kind: AppState['editor']['editing_target']['kind'];
  categoryId: string;
  promptId: string | null;
  value: string;
};

export type ForbiddenHighlightState = {
  promptForbiddenKeys: Set<string>;
  promptForbiddenPurpleKeys: Set<string>;
  categoryForbiddenIds: Set<string>;
  categoryForbiddenPurpleIds: Set<string>;
};

export const EMPTY_FORBIDDEN_HIGHLIGHT_STATE: ForbiddenHighlightState = {
  promptForbiddenKeys: new Set<string>(),
  promptForbiddenPurpleKeys: new Set<string>(),
  categoryForbiddenIds: new Set<string>(),
  categoryForbiddenPurpleIds: new Set<string>(),
};

export const EMPTY_REACHABILITY_SNAPSHOT: ReachabilitySnapshot = {
  categoryUiStateById: new Map<string, CategoryUiState>(),
  promptUiStateById: new Map<string, PromptUiState>(),
};
