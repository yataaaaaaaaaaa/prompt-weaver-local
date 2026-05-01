import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { api } from '../api';
import { CategoryId } from '../utils/CategoryId';
import { SubPromptId } from '../utils/SubPromptId';
import { STORE_ROOT_DIRECTORY, createFileBackedStorage, pathExists } from '../utils/createFileBackedStorage';
import { dirname, joinPath, readFileBase64, readFileUtf8, readdir, watchDirectory } from '../utils/electronFs';
import type { OutputRecord } from '../types';

export type CurrentImageSelection = {
    category_name: string;
    prompt_text: string;
    locked: boolean;
    induced_lora_ids: string[];
};

export type CurrentImageMetadata = {
    output_id: string;
    generated_at: string;
    prompt: string;
    negative_prompt: string;
    seed: number;
    prompt_seed: number;
    image_seed: number;
    width: number;
    height: number;
    steps: number;
    guidance_scale: number;
    model_id: string;
    active_lora_ids: string[];
    selections: CurrentImageSelection[];
    image_path: string;
    metadata_path: string;
};

export type CurrentImageData = string;

type CurrentImageStore = {
    currentName: number | null;

    availableNames: number[];
    metadata: CurrentImageMetadata | null;
    image: CurrentImageData | null;

    loadingList: boolean;
    loadingCurrent: boolean;
    error: string | null;

    refreshAvailableNames: () => Promise<number[]>;
    reloadCurrentFromDisk: () => Promise<boolean>;
    setCurrentName: (name: number | null) => Promise<boolean>;
    setCurrentOutputId: (outputId: string | null) => Promise<boolean>;
    setCurrentRecord: (record: OutputRecord | null) => boolean;
    registerOutputId: (outputId: string | null) => void;

    next: () => Promise<boolean>;
    previous: () => Promise<boolean>;
    first: () => Promise<boolean>;
    last: () => Promise<boolean>;
    deleteCurrent: () => Promise<boolean>;

    getNextAvailableName: () => Promise<number>;
    isSelected: (categoryId: CategoryId, subPromptId: SubPromptId) => boolean;

    clear: () => void;
};

type OutputPresence = {
    hasJson: boolean;
    hasPng: boolean;
};

const OUTPUT_DIRECTORY = joinPath(dirname(STORE_ROOT_DIRECTORY), 'output');
const STORE_NAME = 'current-image-store';
const STORE_FILE_PATH = STORE_NAME;
const OUTPUT_NAME_PATTERN = /^(\d+)\.(json|png)$/i;
const WatchFlushDelayMs = 80;

function getOutputFilePaths(name: number): { baseName: string; metadataPath: string; imagePath: string } {
    const baseName = String(name).padStart(10, '0');
    return {
        baseName,
        metadataPath: joinPath(OUTPUT_DIRECTORY, `${baseName}.json`),
        imagePath: joinPath(OUTPUT_DIRECTORY, `${baseName}.png`),
    };
}

function parseOutputId(outputId: string | null | undefined): number | null {
    if (!outputId) {
        return null;
    }

    const parsed = Number.parseInt(outputId, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseOutputFileName(fileName: string | null | undefined): { name: number; extension: 'json' | 'png' } | null {
    if (!fileName) {
        return null;
    }

    const match = OUTPUT_NAME_PATTERN.exec(fileName);
    if (!match) {
        return null;
    }

    const parsedName = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isSafeInteger(parsedName)) {
        return null;
    }

    const extension = (match[2] ?? '').toLowerCase();
    if (extension !== 'json' && extension !== 'png') {
        return null;
    }

    return { name: parsedName, extension };
}

function clonePresence(presence: OutputPresence | undefined): OutputPresence {
    return {
        hasJson: presence?.hasJson ?? false,
        hasPng: presence?.hasPng ?? false,
    };
}

function isOutputAvailable(name: number): boolean {
    const presence = outputPresenceByName.get(name);
    return Boolean(presence?.hasJson && presence?.hasPng);
}

function normalizeAvailableNames(names: number[]): number[] {
    return Array.from(
        new Set(names.filter((value) => Number.isInteger(value) && Number.isFinite(value))),
    ).sort((left, right) => left - right);
}

function insertAvailableName(names: number[], name: number): number[] {
    if (names.includes(name)) {
        return names;
    }

    const lastName = names[names.length - 1];
    if (lastName == null || name > lastName) {
        return [...names, name];
    }

    return normalizeAvailableNames([...names, name]);
}

function removeAvailableName(names: number[], name: number): number[] {
    if (!names.includes(name)) {
        return names;
    }
    return names.filter((item) => item !== name);
}

function findNextName(names: number[], currentName: number | null): number | null {
    if (names.length === 0) {
        return null;
    }
    if (currentName == null) {
        return names[0] ?? null;
    }

    for (const name of names) {
        if (name > currentName) {
            return name;
        }
    }
    return null;
}

function findPreviousName(names: number[], currentName: number | null): number | null {
    if (names.length === 0) {
        return null;
    }
    if (currentName == null) {
        return names[names.length - 1] ?? null;
    }

    for (let index = names.length - 1; index >= 0; index -= 1) {
        const name = names[index];
        if (name < currentName) {
            return name;
        }
    }
    return null;
}

function selectionMatches(
    selection: CurrentImageSelection,
    categoryId: CategoryId,
    subPromptId: SubPromptId,
): boolean {
    return (
        new CategoryId(selection.category_name).equals(categoryId) &&
        new SubPromptId(selection.prompt_text).equals(subPromptId)
    );
}

async function scanOutputDirectory(): Promise<number[]> {
    const entries = await readdir(OUTPUT_DIRECTORY);
    const nextPresenceByName = new Map<number, OutputPresence>();

    for (const entry of entries) {
        if (!entry.isFile) {
            continue;
        }

        const parsed = parseOutputFileName(entry.name);
        if (!parsed) {
            continue;
        }

        const presence = clonePresence(nextPresenceByName.get(parsed.name));
        if (parsed.extension === 'json') {
            presence.hasJson = true;
        } else {
            presence.hasPng = true;
        }
        nextPresenceByName.set(parsed.name, presence);
    }

    outputPresenceByName = nextPresenceByName;

    return Array.from(nextPresenceByName.entries())
        .filter(([, presence]) => presence.hasJson && presence.hasPng)
        .map(([name]) => name)
        .sort((left, right) => left - right);
}

async function readImageMetadataFromDisk(name: number): Promise<CurrentImageMetadata> {
    const { metadataPath, imagePath } = getOutputFilePaths(name);
    const raw = await readFileUtf8(metadataPath);
    const parsed = JSON.parse(raw) as Partial<CurrentImageMetadata>;

    return {
        output_id: parsed.output_id ?? String(name).padStart(10, '0'),
        generated_at: parsed.generated_at ?? '',
        prompt: parsed.prompt ?? '',
        negative_prompt: parsed.negative_prompt ?? '',
        seed: parsed.seed ?? 0,
        prompt_seed: parsed.prompt_seed ?? 0,
        image_seed: parsed.image_seed ?? 0,
        width: parsed.width ?? 0,
        height: parsed.height ?? 0,
        steps: parsed.steps ?? 0,
        guidance_scale: parsed.guidance_scale ?? 0,
        model_id: parsed.model_id ?? '',
        active_lora_ids: parsed.active_lora_ids ?? [],
        selections: parsed.selections ?? [],
        image_path: parsed.image_path ?? imagePath,
        metadata_path: parsed.metadata_path ?? metadataPath,
    };
}

async function readImageFromDisk(name: number): Promise<CurrentImageData> {
    const { imagePath } = getOutputFilePaths(name);
    const imageBase64 = await readFileBase64(imagePath);
    return `data:image/png;base64,${imageBase64}`;
}

function recordToMetadata(record: OutputRecord): CurrentImageMetadata {
    return {
        output_id: record.output_id,
        generated_at: record.generated_at,
        prompt: record.prompt,
        negative_prompt: record.negative_prompt,
        seed: record.seed,
        prompt_seed: record.prompt_seed ?? 0,
        image_seed: record.image_seed ?? 0,
        width: record.width,
        height: record.height,
        steps: record.steps,
        guidance_scale: record.guidance_scale,
        model_id: record.model_id,
        active_lora_ids: record.active_lora_ids,
        selections: record.selections,
        image_path: record.image_path,
        metadata_path: record.metadata_path,
    };
}

function recordToImage(record: OutputRecord): CurrentImageData | null {
    if (!record.image_base64) {
        return null;
    }

    return record.image_base64.startsWith('data:')
        ? record.image_base64
        : `data:image/png;base64,${record.image_base64}`;
}

function applyAvailableNamesState(names: number[]): void {
    const state = useCurrentImageStore.getState();
    const hasCurrentName = state.currentName != null && names.includes(state.currentName);

    useCurrentImageStore.setState({
        availableNames: names,
        currentName: hasCurrentName ? state.currentName : null,
        metadata: hasCurrentName ? state.metadata : null,
        image: hasCurrentName ? state.image : null,
        loadingList: false,
    });
}

function applyOutputAvailabilityChange(name: number, isAvailable: boolean): void {
    const state = useCurrentImageStore.getState();
    const nextAvailableNames = isAvailable
        ? insertAvailableName(state.availableNames, name)
        : removeAvailableName(state.availableNames, name);

    if (
        nextAvailableNames === state.availableNames
        || (nextAvailableNames.length === state.availableNames.length
            && nextAvailableNames.every((value, index) => value === state.availableNames[index]))
    ) {
        return;
    }

    const currentStillAvailable = state.currentName == null || nextAvailableNames.includes(state.currentName);
    useCurrentImageStore.setState({
        availableNames: nextAvailableNames,
        currentName: currentStillAvailable ? state.currentName : null,
        metadata: currentStillAvailable ? state.metadata : null,
        image: currentStillAvailable ? state.image : null,
    });
}

function registerKnownOutputName(name: number): void {
    outputPresenceByName.set(name, { hasJson: true, hasPng: true });
    applyOutputAvailabilityChange(name, true);
}

function unregisterKnownOutputName(name: number): void {
    outputPresenceByName.delete(name);
    applyOutputAvailabilityChange(name, false);
}

async function reconcileChangedOutputFile(fileName: string): Promise<void> {
    const parsed = parseOutputFileName(fileName);
    if (!parsed) {
        return;
    }

    const presence = clonePresence(outputPresenceByName.get(parsed.name));
    const targetPath = joinPath(OUTPUT_DIRECTORY, fileName);
    const exists = await pathExists(targetPath).catch(() => false);

    if (parsed.extension === 'json') {
        presence.hasJson = exists;
    } else {
        presence.hasPng = exists;
    }

    if (!presence.hasJson && !presence.hasPng) {
        outputPresenceByName.delete(parsed.name);
        applyOutputAvailabilityChange(parsed.name, false);
        return;
    }

    outputPresenceByName.set(parsed.name, presence);
    applyOutputAvailabilityChange(parsed.name, presence.hasJson && presence.hasPng);
}

function scheduleWatchedFileRefresh(fileName: string): void {
    if (!fileName) {
        return;
    }

    pendingWatchedFileNames.add(fileName);
    if (watchFlushHandle != null) {
        return;
    }

    watchFlushHandle = window.setTimeout(() => {
        const pending = Array.from(pendingWatchedFileNames);
        pendingWatchedFileNames.clear();
        watchFlushHandle = null;
        void Promise.allSettled(pending.map((name) => reconcileChangedOutputFile(name)));
    }, WatchFlushDelayMs);
}

function ensureOutputDirectoryWatchStarted(): void {
    if (stopWatchingOutputDirectory) {
        return;
    }

    try {
        stopWatchingOutputDirectory = watchDirectory(OUTPUT_DIRECTORY, (event) => {
            scheduleWatchedFileRefresh(event.fileName);
        }) ?? null;
    } catch {
        stopWatchingOutputDirectory = null;
    }
}

let currentLoadToken = 0;
let currentNavigationToken = 0;
let refreshAvailableNamesPromise: Promise<number[]> | null = null;
let outputPresenceByName = new Map<number, OutputPresence>();
let stopWatchingOutputDirectory: (() => void) | null = null;
let watchFlushHandle: number | null = null;
const pendingWatchedFileNames = new Set<string>();

export const useCurrentImageStore = create<CurrentImageStore>()(
    persist(
        (set, get) => ({
            currentName: null,

            availableNames: [],
            metadata: null,
            image: null,

            loadingList: false,
            loadingCurrent: false,
            error: null,

            refreshAvailableNames: async () => {
                ensureOutputDirectoryWatchStarted();
                set({ loadingList: true, error: null });

                if (!refreshAvailableNamesPromise) {
                    refreshAvailableNamesPromise = scanOutputDirectory()
                        .then((names) => {
                            applyAvailableNamesState(names);
                            return names;
                        })
                        .finally(() => {
                            refreshAvailableNamesPromise = null;
                        });
                }

                try {
                    return await refreshAvailableNamesPromise;
                } catch (error) {
                    set({
                        loadingList: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return get().availableNames;
                }
            },

            reloadCurrentFromDisk: async () => {
                const name = get().currentName;
                if (name == null) {
                    set({
                        metadata: null,
                        image: null,
                        loadingCurrent: false,
                        error: null,
                    });
                    return false;
                }

                const { metadataPath, imagePath } = getOutputFilePaths(name);
                const [hasMetadata, hasImage] = await Promise.all([
                    pathExists(metadataPath),
                    pathExists(imagePath),
                ]);

                if (!hasMetadata || !hasImage) {
                    unregisterKnownOutputName(name);
                    set({
                        loadingCurrent: false,
                        error: `Missing files for ${String(name).padStart(10, '0')}.`,
                    });
                    return false;
                }

                const myToken = ++currentLoadToken;
                set({
                    loadingCurrent: true,
                    error: null,
                });

                try {
                    const [metadata, image] = await Promise.all([
                        readImageMetadataFromDisk(name),
                        readImageFromDisk(name),
                    ]);

                    if (myToken !== currentLoadToken || get().currentName !== name) {
                        return false;
                    }

                    set({
                        metadata,
                        image,
                        loadingCurrent: false,
                        error: null,
                    });
                    return true;
                } catch (error) {
                    if (myToken !== currentLoadToken || get().currentName !== name) {
                        return false;
                    }

                    set({
                        loadingCurrent: false,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return false;
                }
            },

            setCurrentName: async (name) => {
                if (name == null) {
                    set({
                        currentName: null,
                        metadata: null,
                        image: null,
                        loadingCurrent: false,
                        error: null,
                    });
                    return true;
                }

                ensureOutputDirectoryWatchStarted();
                set({
                    currentName: name,
                    loadingCurrent: true,
                    error: null,
                });

                return get().reloadCurrentFromDisk();
            },

            setCurrentOutputId: async (outputId) => {
                return get().setCurrentName(parseOutputId(outputId));
            },

            setCurrentRecord: (record) => {
                if (!record) {
                    set({
                        currentName: null,
                        metadata: null,
                        image: null,
                        loadingCurrent: false,
                        error: null,
                    });
                    return true;
                }

                const name = parseOutputId(record.output_id);
                if (name == null) {
                    return false;
                }

                ensureOutputDirectoryWatchStarted();
                registerKnownOutputName(name);
                set({
                    currentName: name,
                    metadata: recordToMetadata(record),
                    image: recordToImage(record),
                    loadingCurrent: false,
                    error: null,
                });
                return true;
            },

            registerOutputId: (outputId) => {
                const name = parseOutputId(outputId);
                if (name == null) {
                    return;
                }

                ensureOutputDirectoryWatchStarted();
                registerKnownOutputName(name);
            },

            next: async () => {
                const navigationToken = ++currentNavigationToken;
                const startName = get().currentName;
                let names = get().availableNames;
                let nextName = findNextName(names, startName);

                if (nextName == null) {
                    names = await get().refreshAvailableNames();
                    if (navigationToken !== currentNavigationToken || get().currentName !== startName) {
                        return false;
                    }
                    nextName = findNextName(names, startName);
                }

                if (nextName == null || nextName === startName) {
                    return false;
                }

                return get().setCurrentName(nextName);
            },

            previous: async () => {
                const navigationToken = ++currentNavigationToken;
                const startName = get().currentName;
                let names = get().availableNames;
                let previousName = findPreviousName(names, startName);

                if (previousName == null) {
                    names = await get().refreshAvailableNames();
                    if (navigationToken !== currentNavigationToken || get().currentName !== startName) {
                        return false;
                    }
                    previousName = findPreviousName(names, startName);
                }

                if (previousName == null || previousName === startName) {
                    return false;
                }

                return get().setCurrentName(previousName);
            },

            first: async () => {
                let names = get().availableNames;
                if (names.length === 0) {
                    names = await get().refreshAvailableNames();
                }
                if (names.length === 0) {
                    return false;
                }

                return get().setCurrentName(names[0] ?? null);
            },

            last: async () => {
                let names = get().availableNames;
                if (names.length === 0) {
                    names = await get().refreshAvailableNames();
                }
                if (names.length === 0) {
                    return false;
                }

                return get().setCurrentName(names[names.length - 1] ?? null);
            },

            deleteCurrent: async () => {
                const { currentName, metadata, availableNames } = get();
                if (currentName == null || !metadata) {
                    return false;
                }

                const currentIndex = availableNames.findIndex((name) => name === currentName);
                await api.trashOutput(metadata.output_id);
                unregisterKnownOutputName(currentName);

                const refreshedNames = get().availableNames;
                if (refreshedNames.length === 0) {
                    await get().setCurrentName(null);
                    return true;
                }

                const fallbackIndex = Math.max(0, Math.min(currentIndex, refreshedNames.length - 1));
                return get().setCurrentName(refreshedNames[fallbackIndex] ?? null);
            },

            getNextAvailableName: async () => {
                let names = get().availableNames;
                if (names.length === 0) {
                    names = await get().refreshAvailableNames();
                }
                if (names.length === 0) {
                    return 0;
                }

                return (names[names.length - 1] ?? 0) + 1;
            },

            isSelected: (categoryId, subPromptId) => {
                const selections = get().metadata?.selections ?? [];
                return selections.some((selection) => selectionMatches(selection, categoryId, subPromptId));
            },

            clear: () => {
                set({
                    currentName: null,
                    metadata: null,
                    image: null,
                    error: null,
                });
            },
        }),
        {
            name: STORE_NAME,
            storage: createJSONStorage(() => createFileBackedStorage(STORE_FILE_PATH)),
            partialize: (state) => ({
                currentName: state.currentName,
            }),
            onRehydrateStorage: () => () => {
                ensureOutputDirectoryWatchStarted();
            },
        },
    ),
);

export function useIsCurrentImageSelected(
    categoryId: CategoryId,
    subPromptId: SubPromptId,
): boolean {
    return useCurrentImageStore((state) => {
        const selections = state.metadata?.selections ?? [];
        return selections.some((selection) => selectionMatches(selection, categoryId, subPromptId));
    });
}
