import { useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { api } from '../api';
import type { BootstrapResponse, OutputRecord, OutputSummary } from '../types';
import { useLatestRef } from './useLatestRef';

export type OutputBrowserState = {
  outputs: OutputSummary[];
  setOutputs: Dispatch<SetStateAction<OutputSummary[]>>;
  currentOutput: OutputRecord | null;
  setCurrentOutput: Dispatch<SetStateAction<OutputRecord | null>>;
  currentOutputRef: MutableRefObject<OutputRecord | null>;
  currentOutputIndex: number;
  hydrateFromBootstrap: (payload: BootstrapResponse, preferredOutputId: string | null) => Promise<void>;
  refreshOutputs: (preferredOutputId?: string | null) => Promise<void>;
  selectOutput: (outputId: string) => Promise<OutputRecord | null>;
  navigateOutput: (direction: -1 | 1) => Promise<OutputRecord | null>;
  deleteCachedOutput: (outputId: string) => void;
  cacheOutput: (output: OutputRecord) => void;
};

export function useOutputBrowserState(params: {
  onError: (message: string | null) => void;
  onLastOutputIdChange: (outputId: string | null) => void;
}): OutputBrowserState {
  const { onError, onLastOutputIdChange } = params;
  const [outputs, setOutputs] = useState<OutputSummary[]>([]);
  const [currentOutput, setCurrentOutput] = useState<OutputRecord | null>(null);
  const outputCacheRef = useRef<Record<string, OutputRecord>>({});

  const currentOutputRef = useLatestRef(currentOutput);
  const outputsRef = useLatestRef(outputs);

  const currentOutputIndex = useMemo(
    () => (currentOutput ? outputs.findIndex((item) => item.output_id === currentOutput.output_id) : -1),
    [currentOutput, outputs],
  );
  const currentOutputIndexRef = useLatestRef(currentOutputIndex);

  async function selectOutput(outputId: string): Promise<OutputRecord | null> {
    if (outputCacheRef.current[outputId]) {
      const cached = outputCacheRef.current[outputId];
      setCurrentOutput(cached);
      currentOutputRef.current = cached;
      onLastOutputIdChange(outputId);
      return cached;
    }
    try {
      const output = await api.getOutput(outputId);
      outputCacheRef.current[output.output_id] = output;
      setCurrentOutput(output);
      currentOutputRef.current = output;
      onLastOutputIdChange(outputId);
      return output;
    } catch (requestError) {
      onError(String(requestError));
      return null;
    }
  }

  async function hydrateFromBootstrap(payload: BootstrapResponse, preferredOutputId: string | null) {
    setOutputs(payload.outputs);

    const bootstrapOutput = payload.current_output;
    if (bootstrapOutput) {
      outputCacheRef.current[bootstrapOutput.output_id] = bootstrapOutput;
    }

    if (preferredOutputId && bootstrapOutput?.output_id === preferredOutputId) {
      setCurrentOutput(bootstrapOutput);
      currentOutputRef.current = bootstrapOutput;
      return;
    }

    if (preferredOutputId && payload.outputs.some((item) => item.output_id === preferredOutputId)) {
      const resolved = await selectOutput(preferredOutputId);
      if (resolved) {
        return;
      }
      setCurrentOutput(bootstrapOutput);
      currentOutputRef.current = bootstrapOutput;
      return;
    }

    setCurrentOutput(bootstrapOutput);
    currentOutputRef.current = bootstrapOutput;
  }

  async function refreshOutputs(preferredOutputId?: string | null) {
    const latestOutputs = await api.listOutputs();
    setOutputs(latestOutputs);
    const nextId = preferredOutputId ?? (latestOutputs.length ? latestOutputs[Math.max(0, latestOutputs.length - 1)].output_id : null);
    if (!nextId) {
      setCurrentOutput(null);
      currentOutputRef.current = null;
      return;
    }
    await selectOutput(nextId);
  }

  async function navigateOutput(direction: -1 | 1) {
    const currentOutputs = outputsRef.current;
    if (!currentOutputs.length) {
      return null;
    }
    const startIndex = currentOutputIndexRef.current >= 0 ? currentOutputIndexRef.current : currentOutputs.length - 1;
    const nextIndex = startIndex + direction;
    if (nextIndex < 0 || nextIndex >= currentOutputs.length) {
      return null;
    }
    return selectOutput(currentOutputs[nextIndex].output_id);
  }

  function deleteCachedOutput(outputId: string) {
    delete outputCacheRef.current[outputId];
  }

  function cacheOutput(output: OutputRecord) {
    outputCacheRef.current[output.output_id] = output;
  }

  return {
    outputs,
    setOutputs,
    currentOutput,
    setCurrentOutput,
    currentOutputRef,
    currentOutputIndex,
    hydrateFromBootstrap,
    refreshOutputs,
    selectOutput,
    navigateOutput,
    deleteCachedOutput,
    cacheOutput,
  };
}
