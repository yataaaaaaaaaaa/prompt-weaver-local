import { useEffect, useMemo, useState } from 'react';
import type { AppState } from '../types';
import { getStoredPromptState } from '../utils';
import type { ForbiddenHighlightState, PromptEndpoint, TextEditBuffer } from './appTypes';
import { EMPTY_FORBIDDEN_HIGHLIGHT_STATE, EMPTY_REACHABILITY_SNAPSHOT } from './appTypes';
import { computeForbiddenHighlightState } from './appHelpers';

export function useEditorPanelState(params: {
  state: AppState | null;
  selectedCategory: AppState['categories'][number] | null;
  selectedPrompt: AppState['categories'][number]['prompts'][number] | null;
}) {
  const { state, selectedCategory, selectedPrompt } = params;
  const [textEditBuffer, setTextEditBuffer] = useState<TextEditBuffer | null>(null);
  const [computedReachabilitySnapshot, setComputedReachabilitySnapshot] = useState<import('../utils').ReachabilitySnapshot | null>(null);
  const [forbiddenHighlightState, setForbiddenHighlightState] = useState<ForbiddenHighlightState>(EMPTY_FORBIDDEN_HIGHLIGHT_STATE);

  const reachabilitySnapshot = useMemo(
    () => computedReachabilitySnapshot ?? EMPTY_REACHABILITY_SNAPSHOT,
    [computedReachabilitySnapshot],
  );

  const selectedPromptEndpoint: PromptEndpoint | null = useMemo(() => {
    if (!selectedCategory || !selectedPrompt || !state) {
      return null;
    }
    return {
      categoryId: selectedCategory.id,
      categoryName: selectedCategory.name,
      promptId: selectedPrompt.id,
      promptText: selectedPrompt.text,
      locked: (computedReachabilitySnapshot?.promptUiStateById.get(selectedPrompt.id) ?? getStoredPromptState(selectedCategory, selectedPrompt)) === 'lock',
    };
  }, [computedReachabilitySnapshot, selectedCategory, selectedPrompt, state]);

  useEffect(() => {
    if (!state || !selectedPromptEndpoint) {
      setForbiddenHighlightState(EMPTY_FORBIDDEN_HIGHLIGHT_STATE);
      return;
    }
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      if (!cancelled) {
        setForbiddenHighlightState(computeForbiddenHighlightState(state, selectedPromptEndpoint));
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [selectedPromptEndpoint, state?.categories, state?.forbidden_rules]);

  return {
    textEditBuffer,
    setTextEditBuffer,
    computedReachabilitySnapshot,
    setComputedReachabilitySnapshot,
    forbiddenHighlightState,
    reachabilitySnapshot,
    selectedPromptEndpoint,
  };
}
