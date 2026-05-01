import { create } from 'zustand';
import { api } from '../api';
import { bootstrapWithRetry, dirnameFromPath, basenameFromPath, parseOptionalSeed, planSeed } from '../app/appHelpers';
import { selectPrompts, selectPromptsWithCategoryCycle } from '../promptEngine';
import type { AppState, ForbiddenAssociationEndpoint, GenerateRequest, PromptCategory, PromptEntry } from '../types';
import { uniqueSlug } from '../utils';
import { hasPersistedStoreData } from '../utils/createFileBackedStorage';
import { CategoryId } from '../utils/CategoryId';
import { useCategoriesStore, type StoredCategory } from './categoriesStore';
import { useForbiddenAssociationsStore } from './forbiddenAssociationsStore';
import { useGenerationStore } from './generationStore';
import { useLibraryStore } from './libraryStore';
import { useCurrentImageStore } from './currentImageStore';
import { usePanelLayoutsStore } from './panelLayoutState';
import { useSettingsStore } from './settingsStore';
import { useWorkspaceZIndexStore } from './workspaceZIndex';

type AppStore = {
    usedAssociationSource: ForbiddenAssociationEndpoint | null;
    bootstrap: () => Promise<void>;
    addCategory: () => void;
    focusSelection: (categoryName: string, promptText: string) => void;
    setUsedAssociationSource: (value: ForbiddenAssociationEndpoint | null) => void;
    clearUsedAssociationSource: () => void;
    generate: () => Promise<void>;
    toggleContinuousGenerate: () => Promise<void>;
    selectModelFile: () => Promise<void>;
    addLoraFiles: () => Promise<void>;
    removeLora: (loraId: string) => void;
    copyCurrentPrompt: () => Promise<void>;
};

let continuousStopRequested = false;
let currentAbortController: AbortController | null = null;

function clampNumber(value: number, fallback: number): number {
    return Number.isFinite(value) ? value : fallback;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function resolveCategoryState(category: {
    state?: string | null;
    muted?: boolean | null;
}): StoredCategory['state'] {
    return category.state === 'skip' || category.muted ? 'skip' : 'normal';
}

function resolveSubPromptState(
    category: {
        locked_prompt_id?: string | null;
        locked_prompt_text?: string | null;
    },
    prompt: {
        id?: string | null;
        text: string;
        state?: string | null;
        skipped?: boolean | null;
    },
): StoredCategory['subPrompts'][number]['state'] {
    if (prompt.state === 'lock') {
        return 'lock';
    }
    if ((category.locked_prompt_id && prompt.id === category.locked_prompt_id)
        || (category.locked_prompt_text != null && prompt.text === category.locked_prompt_text)) {
        return 'lock';
    }
    if (prompt.state === 'skip' || prompt.skipped) {
        return 'skip';
    }
    return 'normal';
}

function toPromptCategory(category: StoredCategory, index: number): PromptCategory {
    const categoryId = uniqueSlug(category.text || `category-${index + 1}`, []);
    const prompts: PromptEntry[] = category.subPrompts.map((subPrompt, promptIndex) => ({
        id: uniqueSlug(subPrompt.text || `prompt-${promptIndex + 1}`, []),
        text: subPrompt.text,
        state: subPrompt.state === 'lock' ? 'lock' : subPrompt.state === 'skip' ? 'skip' : 'normal',
        extra_lora_ids: [...subPrompt.extraLoraIds],
    }));

    return {
        id: categoryId,
        name: category.text,
        state: category.state === 'skip' ? 'skip' : 'normal',
        priority: String(category.priority),
        activation_text: category.activation_text,
        position: { x: 40 + index * 20, y: 40 + index * 20 },
        size: { width: 500, height: 300 },
        z_index: index + 1,
        prompts,
    };
}


async function getLocalPersistencePresence(): Promise<{
    categories: boolean;
    forbidden: boolean;
    settings: boolean;
    panelLayouts: boolean;
    workspaceZIndex: boolean;
    currentImage: boolean;
}> {
    const [
        categories,
        forbidden,
        settings,
        panelLayouts,
        workspaceZIndex,
        currentImage,
    ] = await Promise.all([
        hasPersistedStoreData('categorie-store'),
        hasPersistedStoreData('forbidden-associations-store'),
        hasPersistedStoreData('settings-store'),
        hasPersistedStoreData('panel-layouts-store'),
        hasPersistedStoreData('workspace-z-index-store'),
        hasPersistedStoreData('current-image-store'),
    ]);

    return {
        categories,
        forbidden,
        settings,
        panelLayouts,
        workspaceZIndex,
        currentImage,
    };
}

function buildSelectionState(): AppState {
    const categoryStore = useCategoriesStore.getState();
    const settings = useSettingsStore.getState();
    const library = useLibraryStore.getState();
    const forbidden = useForbiddenAssociationsStore.getState();
    const categories = categoryStore.categories.map(toPromptCategory);

    return {
        categories,
        forbidden_rules: forbidden.rules,
        last_model_id: library.selectedModelId || null,
        last_lora_ids: [...library.selectedLoraIds],
        last_model_dir: library.lastModelDir,
        last_lora_dir: library.lastLoraDir,
        width: settings.width,
        height: settings.height,
        steps: settings.steps,
        guidance_scale: settings.guidanceScale,
        prompt_seed: settings.promptSeedBehavior === 'per_category_cycle' ? null : parseOptionalSeed(settings.promptSeedInput),
        seed: parseOptionalSeed(settings.seedInput),
        seed_mode: 'manual',
        seed_advance_mode: 'keep',
        prompt_seed_behavior: settings.promptSeedBehavior,
        image_seed_behavior: settings.imageSeedBehavior,
        negative_prompt: settings.negativePrompt,
        workspace: {
            image: { x: 24, y: 24, width: 640, height: 720, z_index: 1 },
            browser: { x: 690, y: 24, width: 360, height: 280, z_index: 2 },
            controls: { x: 1060, y: 24, width: 420, height: 720, z_index: 3 },
            details: { x: 690, y: 320, width: 790, height: 420, z_index: 4 },
            used: { x: 690, y: 320, width: 790, height: 420, z_index: 5 },
        },
        editor: {
            overlays_hidden: false,
            visibility_mode: 'all',
            selected_category_id: null,
            selected_prompt_id: null,
            edit_session_id: 0,
            editing_target: { kind: 'none', category_id: null, prompt_id: null },
        },
        last_output_id: useCurrentImageStore.getState().metadata?.output_id ?? null,
    };
}

async function executeGenerate(): Promise<void> {
    const generation = useGenerationStore.getState();
    const settings = useSettingsStore.getState();
    const library = useLibraryStore.getState();
    const currentImage = useCurrentImageStore.getState();
    const state = buildSelectionState();

    if (!library.selectedModelId) {
        throw new Error('Select a model before generating.');
    }

    const model = library.models.find((item) => item.id === library.selectedModelId);
    if (!model) {
        throw new Error(`Unknown model '${library.selectedModelId}'.`);
    }

    const imageSeedPlan = planSeed(settings.imageSeedBehavior, settings.seedInput);
    const promptSelectionResult = settings.promptSeedBehavior === 'per_category_cycle'
        ? selectPromptsWithCategoryCycle(state, settings.promptCategorySeedState)
        : {
            selections: selectPrompts(state, planSeed(settings.promptSeedBehavior, settings.promptSeedInput).requestSeed),
            nextCategorySeedState: settings.promptCategorySeedState,
            promptSeed: planSeed(settings.promptSeedBehavior, settings.promptSeedInput).requestSeed,
        };
    const promptSelections = promptSelectionResult.selections;
    const allLoraIds = Array.from(new Set([...library.selectedLoraIds, ...promptSelections.flatMap((item) => item.induced_lora_ids)]));
    const loras = allLoraIds.map((loraId) => {
        const lora = library.loras.find((item) => item.id === loraId);
        if (!lora) {
            throw new Error(`Unknown LoRA '${loraId}'.`);
        }
        return lora;
    });
    const prompt = promptSelections.map((item) => item.prompt_text).filter(Boolean).join(', ');
    const request: GenerateRequest = {
        model,
        loras,
        prompt,
        selections: promptSelections,
        width: settings.width,
        height: settings.height,
        steps: settings.steps,
        guidance_scale: settings.guidanceScale,
        prompt_seed: promptSelectionResult.promptSeed,
        seed: imageSeedPlan.requestSeed,
        negative_prompt: settings.negativePrompt,
    };

    useGenerationStore.getState().setGenerating(true);
    useGenerationStore.getState().setError(null);

    try {
        currentAbortController = new AbortController();
        const generated = await api.generate(request, currentAbortController.signal);
        useGenerationStore.getState().setGenerating(false);
        useSettingsStore.getState().hydrate({
            width: generated.width,
            height: generated.height,
            steps: generated.steps,
            guidanceScale: generated.guidance_scale,
            promptSeedInput: settings.promptSeedBehavior === 'per_category_cycle'
                ? settings.promptSeedInput
                : planSeed(settings.promptSeedBehavior, settings.promptSeedInput, generated.prompt_seed).nextInput,
            seedInput: planSeed(settings.imageSeedBehavior, settings.seedInput, generated.image_seed ?? generated.seed).nextInput,
            promptCategorySeedState: settings.promptSeedBehavior === 'per_category_cycle'
                ? promptSelectionResult.nextCategorySeedState
                : settings.promptCategorySeedState,
        });
        currentImage.setCurrentRecord(generated);
        useLibraryStore.getState().setSelectedLoraIds(generated.active_lora_ids);
    } finally {
        currentAbortController = null;
        useGenerationStore.getState().setGenerating(false);
    }
}

export const useAppStore = create<AppStore>((set, get) => ({
    usedAssociationSource: null,
    bootstrap: async () => {
        useGenerationStore.getState().setLoading(true);
        const signal = { cancelled: false };
        try {
            const payload = await bootstrapWithRetry(signal, (error) => useGenerationStore.getState().setError(String(error)));
            const persistence = await getLocalPersistencePresence();
            useGenerationStore.getState().setDataDir(payload.data_dir);
            useLibraryStore.getState().setLibrary(payload.library);

            const libraryStore = useLibraryStore.getState();
            if (!libraryStore.selectedModelId) {
                libraryStore.setSelectedModelId(payload.state.last_model_id ?? payload.library.models[0]?.id ?? '');
            }
            if (libraryStore.selectedLoraIds.length === 0 && (payload.state.last_lora_ids?.length ?? 0) > 0) {
                libraryStore.setSelectedLoraIds(payload.state.last_lora_ids ?? []);
            }
            if (!libraryStore.lastModelDir) {
                libraryStore.setLastModelDir(payload.state.last_model_dir);
            }
            if (!libraryStore.lastLoraDir) {
                libraryStore.setLastLoraDir(payload.state.last_lora_dir);
            }

            const categories = payload.state.categories.map((category) => ({
                text: category.name,
                activation_text: category.activation_text,
                priority: clampNumber(Number(category.priority), 1),
                state: resolveCategoryState(category),
                subPrompts: category.prompts.map((prompt) => ({
                    text: prompt.text,
                    state: resolveSubPromptState(category, prompt),
                    extraLoraIds: [...prompt.extra_lora_ids],
                })),
            }));
            if (!persistence.categories) {
                useCategoriesStore.getState().setCategories(categories);
            }
            if (!persistence.forbidden) {
                useForbiddenAssociationsStore.getState().setRules(payload.state.forbidden_rules);
            }
            if (!persistence.settings) {
                useSettingsStore.getState().hydrate({
                    width: payload.state.width,
                    height: payload.state.height,
                    steps: payload.state.steps,
                    guidanceScale: payload.state.guidance_scale,
                    negativePrompt: payload.state.negative_prompt,
                    promptSeedInput: payload.state.prompt_seed != null ? String(payload.state.prompt_seed) : '',
                    seedInput: payload.state.seed != null ? String(payload.state.seed) : '',
                    promptSeedBehavior: payload.state.prompt_seed_behavior,
                    imageSeedBehavior: payload.state.image_seed_behavior,
                    promptCategorySeedState: {},
                });
            }
            const currentImage = useCurrentImageStore.getState();
            await currentImage.refreshAvailableNames();
            if (!persistence.currentImage) {
                const preferredOutputId = payload.state.last_output_id ?? payload.current_output?.output_id ?? payload.outputs[payload.outputs.length - 1]?.output_id ?? null;
                if (preferredOutputId) {
                    await currentImage.setCurrentOutputId(preferredOutputId);
                } else {
                    await currentImage.last();
                }
            } else {
                await currentImage.reloadCurrentFromDisk();
            }

            const panelLayouts = usePanelLayoutsStore.getState();
            const workspace = payload.state.workspace as Partial<Record<'image' | 'browser' | 'controls' | 'details' | 'used', { x?: number; y?: number; width?: number; height?: number; z_index?: number }>>;
            const workspaceZ = useWorkspaceZIndexStore.getState();
            const paneLayouts: Array<{ id: string; data?: { x?: number; y?: number; width?: number; height?: number; z_index?: number } }> = [
                { id: 'pane-image', data: workspace.image },
                { id: 'pane-browser', data: workspace.browser },
                { id: 'pane-controls', data: workspace.controls },
                { id: 'pane-details', data: workspace.details },
                { id: 'pane-used', data: workspace.used },
            ];

            if (!persistence.panelLayouts || !persistence.workspaceZIndex) {
                for (const pane of paneLayouts) {
                    const layout = pane.data;
                    if (!layout) {
                        continue;
                    }
                    if (!persistence.panelLayouts
                        && isFiniteNumber(layout.x)
                        && isFiniteNumber(layout.y)
                        && isFiniteNumber(layout.width)
                        && isFiniteNumber(layout.height)) {
                        panelLayouts.setPanelLayout(pane.id, {
                            x: layout.x,
                            y: layout.y,
                            width: layout.width,
                            height: layout.height,
                        });
                    }
                    const paneKey = pane.id.replace(/^pane-/, '') as 'image' | 'browser' | 'controls' | 'details' | 'used';
                    if (!persistence.workspaceZIndex && isFiniteNumber(layout.z_index)) {
                        workspaceZ.setPaneZIndex(paneKey, layout.z_index);
                    }
                }

                payload.state.categories.forEach((category) => {
                    if (!persistence.panelLayouts
                        && isFiniteNumber(category.position?.x)
                        && isFiniteNumber(category.position?.y)
                        && isFiniteNumber(category.size?.width)
                        && isFiniteNumber(category.size?.height)) {
                        panelLayouts.setPanelLayout(CategoryId.from(category.name).toString(), {
                            x: category.position.x,
                            y: category.position.y,
                            width: category.size.width,
                            height: category.size.height,
                        });
                    }
                    if (!persistence.workspaceZIndex && isFiniteNumber(category.z_index)) {
                        workspaceZ.setCategoryZIndex(CategoryId.from(category.name).toString(), category.z_index);
                    }
                });
            }

            useGenerationStore.getState().setError(null);
        } catch (error) {
            useGenerationStore.getState().setError(String(error));
        } finally {
            useGenerationStore.getState().setLoading(false);
        }
    },
    addCategory: () => {
        const categories = useCategoriesStore.getState().categories;
        const nextName = uniqueSlug('new category', categories.map((item) => uniqueSlug(item.text, [])));
        useCategoriesStore.getState().upsertCategory({
            text: nextName,
            activation_text: '',
            priority: 1,
            state: 'normal',
            subPrompts: [{ text: '', state: 'normal', extraLoraIds: [] }],
        });
    },
    focusSelection: (categoryName, promptText) => {
        // placeholder for later richer editor focus; keep current output highlighted through stores.
        useGenerationStore.getState().setError(`Selection focus is not yet wired for '${categoryName} / ${promptText}'.`);
        window.setTimeout(() => {
            if (useGenerationStore.getState().error?.startsWith('Selection focus is not yet wired')) {
                useGenerationStore.getState().setError(null);
            }
        }, 2000);
    },
    setUsedAssociationSource: (usedAssociationSource) => set({ usedAssociationSource }),
    clearUsedAssociationSource: () => set({ usedAssociationSource: null }),
    generate: async () => {
        try {
            await executeGenerate();
        } catch (error) {
            useGenerationStore.getState().setError(String(error));
        }
    },
    toggleContinuousGenerate: async () => {
        const { continuousGenerating } = useGenerationStore.getState();
        if (continuousGenerating) {
            continuousStopRequested = true;
            useGenerationStore.getState().setContinuousGenerating(false);
            currentAbortController?.abort();
            void api.cancelGeneration().catch(() => undefined);
            return;
        }

        continuousStopRequested = false;
        useGenerationStore.getState().setContinuousGenerating(true);
        useGenerationStore.getState().setError(null);
        try {
            while (!continuousStopRequested) {
                await executeGenerate();
            }
        } catch (error) {
            useGenerationStore.getState().setError(String(error));
        } finally {
            continuousStopRequested = false;
            useGenerationStore.getState().setContinuousGenerating(false);
        }
    },
    selectModelFile: async () => {
        const selectedPath = await window.promptWeaverDesktop?.pickFile({
            defaultPath: useLibraryStore.getState().lastModelDir ?? undefined,
            title: 'Select checkpoint',
            filters: [{ name: 'Checkpoint files', extensions: ['safetensors', 'ckpt'] }],
        });
        if (!selectedPath) {
            return;
        }
        const settings = useSettingsStore.getState();
        const name = basenameFromPath(selectedPath);
        const existingIds = useLibraryStore.getState().models.map((item) => item.id);
        const id = uniqueSlug(name, existingIds);
        useLibraryStore.getState().addModel({
            id,
            name,
            path: selectedPath,
            default_width: settings.width,
            default_height: settings.height,
            torch_dtype: 'float16',
        });
        useLibraryStore.getState().setSelectedModelId(id);
        useLibraryStore.getState().setLastModelDir(dirnameFromPath(selectedPath));
    },
    removeLora: (loraId) => {
        useLibraryStore.getState().removeLora(loraId);
        const categoriesStore = useCategoriesStore.getState();
        categoriesStore.setCategories(categoriesStore.categories.map((category) => ({
            ...category,
            subPrompts: category.subPrompts.map((subPrompt) => ({
                ...subPrompt,
                extraLoraIds: subPrompt.extraLoraIds.filter((item) => item !== loraId),
            })),
        })));
    },
    addLoraFiles: async () => {
        const paths = await window.promptWeaverDesktop?.pickFiles({
            defaultPath: useLibraryStore.getState().lastLoraDir ?? undefined,
            title: 'Add LoRA',
            filters: [{ name: 'LoRA files', extensions: ['safetensors', 'bin', 'pt'] }],
        });
        if (!paths?.length) {
            return;
        }
        const library = useLibraryStore.getState();
        const nextLoras = paths.map((selectedPath) => {
            const existing = library.loras.find((item) => item.path.toLowerCase() === selectedPath.toLowerCase());
            if (existing) {
                return existing;
            }
            const name = basenameFromPath(selectedPath);
            return {
                id: uniqueSlug(name.replace(/\.[^.]+$/, ''), library.loras.map((item) => item.id)),
                name,
                path: selectedPath,
            };
        });
        useLibraryStore.getState().addLoras(nextLoras);
        useLibraryStore.getState().setSelectedLoraIds(Array.from(new Set([...library.selectedLoraIds, ...nextLoras.map((item) => item.id)])));
        useLibraryStore.getState().setLastLoraDir(dirnameFromPath(paths[0]));
    },
    copyCurrentPrompt: async () => {
        const prompt = useCurrentImageStore.getState().metadata?.prompt;
        if (!prompt) {
            return;
        }
        await navigator.clipboard.writeText(prompt);
    },
}));
