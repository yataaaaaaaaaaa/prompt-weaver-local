import type { ChangeEvent } from 'react';
import { useAppStore } from '../stores/appStore';
import { useCategoriesStore } from '../stores/categoriesStore';
import { useGenerationStore } from '../stores/generationStore';
import { useLibraryStore } from '../stores/libraryStore';
import { useCurrentImageStore } from '../stores/currentImageStore';
import { useSettingsStore } from '../stores/settingsStore';
import type { SeedBehavior } from '../types';

const PROMPT_SEED_BEHAVIOR_OPTIONS: Array<{ value: SeedBehavior; label: string }> = [
    { value: 'fixed', label: 'Fixed' },
    { value: 'increment', label: 'Auto increment' },
    { value: 'randomize', label: 'Randomize' },
    { value: 'per_category_cycle', label: 'Per-category cycle (random restart)' },
];

const IMAGE_SEED_BEHAVIOR_OPTIONS: Array<{ value: SeedBehavior; label: string }> = [
    { value: 'fixed', label: 'Fixed' },
    { value: 'increment', label: 'Auto increment' },
    { value: 'randomize', label: 'Randomize' },
];

export default function ControlsPane(): JSX.Element {
    const addCategory = useAppStore((state) => state.addCategory);
    const generate = useAppStore((state) => state.generate);
    const toggleContinuousGenerate = useAppStore((state) => state.toggleContinuousGenerate);
    const selectModelFile = useAppStore((state) => state.selectModelFile);
    const addLoraFiles = useAppStore((state) => state.addLoraFiles);
    const removeLora = useAppStore((state) => state.removeLora);
    const copyCurrentPrompt = useAppStore((state) => state.copyCurrentPrompt);

    const categories = useCategoriesStore((state) => state.categories);
    const dataDir = useGenerationStore((state) => state.dataDir);
    const progress = useGenerationStore((state) => state.progress);
    const generating = useGenerationStore((state) => state.generating);
    const continuousGenerating = useGenerationStore((state) => state.continuousGenerating);
    const currentMetadata = useCurrentImageStore((state) => state.metadata);

    const models = useLibraryStore((state) => state.models);
    const loras = useLibraryStore((state) => state.loras);
    const selectedModelId = useLibraryStore((state) => state.selectedModelId);
    const selectedLoraIds = useLibraryStore((state) => state.selectedLoraIds);
    const setSelectedModelId = useLibraryStore((state) => state.setSelectedModelId);
    const toggleSelectedLoraId = useLibraryStore((state) => state.toggleSelectedLoraId);

    const width = useSettingsStore((state) => state.width);
    const height = useSettingsStore((state) => state.height);
    const steps = useSettingsStore((state) => state.steps);
    const guidanceScale = useSettingsStore((state) => state.guidanceScale);
    const negativePrompt = useSettingsStore((state) => state.negativePrompt);
    const promptSeedInput = useSettingsStore((state) => state.promptSeedInput);
    const seedInput = useSettingsStore((state) => state.seedInput);
    const promptSeedBehavior = useSettingsStore((state) => state.promptSeedBehavior);
    const imageSeedBehavior = useSettingsStore((state) => state.imageSeedBehavior);
    const setWidth = useSettingsStore((state) => state.setWidth);
    const setHeight = useSettingsStore((state) => state.setHeight);
    const setSteps = useSettingsStore((state) => state.setSteps);
    const setGuidanceScale = useSettingsStore((state) => state.setGuidanceScale);
    const setNegativePrompt = useSettingsStore((state) => state.setNegativePrompt);
    const setPromptSeedInput = useSettingsStore((state) => state.setPromptSeedInput);
    const setSeedInput = useSettingsStore((state) => state.setSeedInput);
    const setPromptSeedBehavior = useSettingsStore((state) => state.setPromptSeedBehavior);
    const setImageSeedBehavior = useSettingsStore((state) => state.setImageSeedBehavior);

    const progressRatio = progress && progress.total_steps > 0 ? Math.max(0, Math.min(1, progress.current_step / progress.total_steps)) : 0;
    const promptSeedManagedPerCategory = promptSeedBehavior === 'per_category_cycle';

    return (
        <div className="pane-content-scroll">
            <div className="panel-section compact-section">
                <div className="panel-title-row">
                    <h2>Current generation</h2>
                    <div className="inline-actions">
                        <button className="ghost-button slim-button" onClick={() => void copyCurrentPrompt()} disabled={!currentMetadata?.prompt} type="button">Copy prompt</button>
                        <button className="secondary-button slim-button" onClick={addCategory} type="button">+ Category</button>
                    </div>
                </div>
                <div className="inline-actions top-generation-actions">
                    <button className="primary-button" onClick={generate} disabled={!selectedModelId || generating} type="button">
                        {generating ? 'Generating…' : 'Generate'}
                    </button>
                    <button className="secondary-button" onClick={toggleContinuousGenerate} disabled={!selectedModelId} type="button">
                        {continuousGenerating ? 'Stop continuous' : 'Start continuous'}
                    </button>
                </div>
                <div className="progress-area">
                    <div className="progress-header">
                        <span>{progress?.message || (currentMetadata ? `Viewing #${currentMetadata.output_id}` : 'Idle')}</span>
                        {progress?.total_steps ? <span>{progress.current_step}/{progress.total_steps}</span> : null}
                    </div>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.max(2, progressRatio * 100)}%` }} /></div>
                </div>
                <div className="muted small-text">Data directory: {dataDir || '—'}</div>
                <div className="muted small-text">Categories: {categories.length}</div>
            </div>

            <div className="panel-section">
                <div className="two-column-grid">
                    <label>Width<input type="number" min={256} step={64} value={width} onChange={(event: ChangeEvent<HTMLInputElement>) => setWidth(Number(event.target.value))} /></label>
                    <label>Height<input type="number" min={256} step={64} value={height} onChange={(event: ChangeEvent<HTMLInputElement>) => setHeight(Number(event.target.value))} /></label>
                    <label>Steps<input type="number" min={1} max={100} value={steps} onChange={(event: ChangeEvent<HTMLInputElement>) => setSteps(Number(event.target.value))} /></label>
                    <label>CFG<input type="number" min={1} max={20} step={0.5} value={guidanceScale} onChange={(event: ChangeEvent<HTMLInputElement>) => setGuidanceScale(Number(event.target.value))} /></label>
                </div>
                <div className="seed-editor-grid">
                    <label>
                        Prompt seed
                        <input
                            value={promptSeedInput}
                            placeholder={promptSeedManagedPerCategory ? 'Managed automatically per category' : 'Prompt selection seed'}
                            disabled={promptSeedManagedPerCategory}
                            onChange={(event: ChangeEvent<HTMLInputElement>) => setPromptSeedInput(event.target.value)}
                        />
                    </label>
                    <label>
                        After each generation
                        <select value={promptSeedBehavior} onChange={(event: ChangeEvent<HTMLSelectElement>) => setPromptSeedBehavior(event.target.value as SeedBehavior)}>
                            {PROMPT_SEED_BEHAVIOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label>
                        Image seed
                        <input value={seedInput} placeholder="Image seed" onChange={(event: ChangeEvent<HTMLInputElement>) => setSeedInput(event.target.value)} />
                    </label>
                    <label>
                        After each generation
                        <select value={imageSeedBehavior} onChange={(event: ChangeEvent<HTMLSelectElement>) => setImageSeedBehavior(event.target.value as SeedBehavior)}>
                            {IMAGE_SEED_BEHAVIOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                </div>
                {promptSeedManagedPerCategory ? (
                    <div className="muted small-text">
                        Each active category advances on its own counter. It starts from a random value, walks one full cycle, then restarts from a new random value.
                        Locked prompts are still used for active categories unless they are forbidden.
                    </div>
                ) : null}
            </div>

            <div className="panel-section">
                <h3>Model</h3>
                <label>
                    Checkpoint
                    <select value={selectedModelId} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSelectedModelId(event.target.value)}>
                        {!models.length ? <option value="">No model available</option> : null}
                        {models.map((model) => (
                            <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                    </select>
                </label>
                <button className="ghost-button" onClick={selectModelFile} type="button">Choose model file</button>
            </div>

            <div className="panel-section">
                <div className="panel-title-row">
                    <h3>LoRAs</h3>
                    <button className="ghost-button slim-button" onClick={addLoraFiles} type="button">Add files</button>
                </div>
                {loras.length ? (
                    <div className="lora-library-list">
                        {loras.map((lora) => {
                            const selected = selectedLoraIds.includes(lora.id);
                            return (
                                <div key={lora.id} className="lora-library-row">
                                    <label className="lora-library-toggle">
                                        <input type="checkbox" checked={selected} onChange={() => toggleSelectedLoraId(lora.id)} />
                                        <span className="lora-library-name">{lora.name}</span>
                                    </label>
                                    <button
                                        type="button"
                                        className="selected-lora-remove-button"
                                        title={`Delete ${lora.name} from the library`}
                                        aria-label={`Delete ${lora.name} from the library`}
                                        onClick={() => removeLora(lora.id)}
                                    >
                                        ×
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : <div className="muted">No LoRAs loaded.</div>}
                <div className="muted small-text">Active LoRAs: {selectedLoraIds.length}</div>
            </div>

            <div className="panel-section">
                <h3>Negative prompt</h3>
                <textarea rows={6} value={negativePrompt} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNegativePrompt(event.target.value)} />
            </div>

        </div>
    );
}
