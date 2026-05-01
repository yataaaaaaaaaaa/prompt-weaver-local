import type { ChangeEvent } from 'react';
import { useAppStore } from '../stores/appStore';
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

export default function DetailsPane(): JSX.Element {
    const currentMetadata = useCurrentImageStore((state) => state.metadata);
    const width = useSettingsStore((state) => state.width);
    const height = useSettingsStore((state) => state.height);
    const steps = useSettingsStore((state) => state.steps);
    const guidanceScale = useSettingsStore((state) => state.guidanceScale);
    const promptSeedInput = useSettingsStore((state) => state.promptSeedInput);
    const seedInput = useSettingsStore((state) => state.seedInput);
    const promptSeedBehavior = useSettingsStore((state) => state.promptSeedBehavior);
    const imageSeedBehavior = useSettingsStore((state) => state.imageSeedBehavior);
    const setWidth = useSettingsStore((state) => state.setWidth);
    const setHeight = useSettingsStore((state) => state.setHeight);
    const setSteps = useSettingsStore((state) => state.setSteps);
    const setGuidanceScale = useSettingsStore((state) => state.setGuidanceScale);
    const setPromptSeedInput = useSettingsStore((state) => state.setPromptSeedInput);
    const setSeedInput = useSettingsStore((state) => state.setSeedInput);
    const setPromptSeedBehavior = useSettingsStore((state) => state.setPromptSeedBehavior);
    const setImageSeedBehavior = useSettingsStore((state) => state.setImageSeedBehavior);
    const copyCurrentPrompt = useAppStore((state) => state.copyCurrentPrompt);

    const promptSeedManagedPerCategory = promptSeedBehavior === 'per_category_cycle';

    return (
        <div className="pane-content-scroll">
            <div className="panel-section">
                <div className="panel-title-row">
                    <h2>Current generation</h2>
                    <button className="ghost-button" onClick={() => void copyCurrentPrompt()} disabled={!currentMetadata?.prompt} type="button">Copy prompt</button>
                </div>
                <div className="two-column-grid">
                    <label>Width<input type="number" min={256} step={64} value={width} onChange={(event: ChangeEvent<HTMLInputElement>) => setWidth(Number(event.target.value))} /></label>
                    <label>Height<input type="number" min={256} step={64} value={height} onChange={(event: ChangeEvent<HTMLInputElement>) => setHeight(Number(event.target.value))} /></label>
                    <label>Steps<input type="number" min={1} max={100} value={steps} onChange={(event: ChangeEvent<HTMLInputElement>) => setSteps(Number(event.target.value))} /></label>
                    <label>CFG<input type="number" min={1} max={20} step={0.5} value={guidanceScale} onChange={(event: ChangeEvent<HTMLInputElement>) => setGuidanceScale(Number(event.target.value))} /></label>
                </div>
                <div className="seed-editor-grid">
                    <label>
                        Prompt seed
                        <input value={promptSeedInput} placeholder={promptSeedManagedPerCategory ? 'Managed automatically per category' : 'Prompt selection seed'} disabled={promptSeedManagedPerCategory} onChange={(event: ChangeEvent<HTMLInputElement>) => setPromptSeedInput(event.target.value)} />
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
            </div>
            {promptSeedManagedPerCategory ? (
                <div className="muted small-text">
                    Each active category advances on its own counter. It starts from a random value, walks one full cycle, then restarts from a new random value.
                    Locked prompts are still used for active categories unless they are forbidden.
                </div>
            ) : null}
        </div>
    );
}