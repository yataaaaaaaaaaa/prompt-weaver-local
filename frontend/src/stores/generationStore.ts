import { create } from 'zustand';
import type { ProgressEvent } from '../types';

type GenerationStore = {
    dataDir: string;
    loading: boolean;
    generating: boolean;
    continuousGenerating: boolean;
    error: string | null;
    progress: ProgressEvent | null;
    setDataDir: (value: string) => void;
    setLoading: (value: boolean) => void;
    setGenerating: (value: boolean) => void;
    setContinuousGenerating: (value: boolean) => void;
    setError: (value: string | null) => void;
    setProgress: (value: ProgressEvent | null) => void;
};

export const useGenerationStore = create<GenerationStore>((set) => ({
    dataDir: '',
    loading: true,
    generating: false,
    continuousGenerating: false,
    error: null,
    progress: null,
    setDataDir: (dataDir) => set({ dataDir }),
    setLoading: (loading) => set({ loading }),
    setGenerating: (generating) => set({ generating }),
    setContinuousGenerating: (continuousGenerating) => set({ continuousGenerating }),
    setError: (error) => set({ error }),
    setProgress: (progress) => set({ progress }),
}));
