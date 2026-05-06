import test from 'node:test';
import assert from 'node:assert/strict';
import { filterKnownLoraIds, filterSelectionLoraIds, resolveLoraSelection } from '../src/app/loraSelection';
import { selectPromptsWithCategoryCycle } from '../src/promptEngine';
import { makeRuntimePromptEndpoint, ruleMatchesPrompt } from '../src/utils';
import type { AppState, ForbiddenRule, GenerationSelection, LibraryState, PromptCategory } from '../src/types';

function makeCategory(name: string, prompts: string[], options: Partial<PromptCategory> = {}): PromptCategory {
    const id = name.toLowerCase();
    return {
        id,
        name,
        state: 'normal',
        priority: options.priority ?? '1',
        activation_text: options.activation_text ?? '',
        position: options.position ?? { x: 24, y: 24 },
        size: options.size ?? { width: 320, height: 240 },
        z_index: options.z_index ?? 1,
        prompts: prompts.map((text, index) => ({
            id: `${id}-prompt-${index + 1}`,
            text,
            state: 'normal',
            extra_lora_ids: [],
        })),
        ...options,
    };
}

function withMockedRandom<T>(value: number, callback: () => T): T {
    const originalRandom = Math.random;
    Math.random = () => value;
    try {
        return callback();
    } finally {
        Math.random = originalRandom;
    }
}

function makeState(categories: PromptCategory[], forbidden_rules: ForbiddenRule[] = []): AppState {
    return {
        categories,
        forbidden_rules,
        last_model_id: null,
        last_lora_ids: [],
        last_model_dir: null,
        last_lora_dir: null,
        width: 1024,
        height: 1024,
        steps: 30,
        guidance_scale: 7,
        prompt_seed: null,
        seed: null,
        seed_mode: 'manual',
        seed_advance_mode: 'keep',
        prompt_seed_behavior: 'per_category_cycle',
        image_seed_behavior: 'fixed',
        negative_prompt: '',
        workspace: {
            image: { x: 24, y: 24, width: 320, height: 320, z_index: 1 },
            browser: { x: 360, y: 24, width: 320, height: 320, z_index: 2 },
            controls: { x: 696, y: 24, width: 320, height: 320, z_index: 3 },
            details: { x: 24, y: 360, width: 320, height: 320, z_index: 4 },
            used: { x: 360, y: 360, width: 320, height: 320, z_index: 5 },
        },
        editor: {
            overlays_hidden: false,
            visibility_mode: 'all',
            selected_category_id: null,
            selected_prompt_id: null,
            edit_session_id: 0,
            editing_target: { kind: 'none', category_id: null, prompt_id: null },
        },
        last_output_id: null,
    };
}

test('category-level specific matchers apply to every prompt in the target category', () => {
    const alpha = makeCategory('Alpha', ['alpha prompt'], { priority: '1' });
    const beta = makeCategory('Beta', ['beta first', 'beta second'], { priority: '2' });
    const rule: ForbiddenRule = {
        left: { kind: 'specific', category_name: 'Alpha', prompt_text: 'alpha prompt', contains_text: null, tag_text: null },
        right: { kind: 'specific', category_name: 'Beta', prompt_text: null, contains_text: null, tag_text: null },
    };

    const categories = [alpha, beta];
    const alphaEndpoint = makeRuntimePromptEndpoint(alpha, alpha.prompts[0], false);
    const betaFirstEndpoint = makeRuntimePromptEndpoint(beta, beta.prompts[0], false);
    const betaSecondEndpoint = makeRuntimePromptEndpoint(beta, beta.prompts[1], false);

    assert.equal(ruleMatchesPrompt(rule, alphaEndpoint, betaFirstEndpoint, categories), true);
    assert.equal(ruleMatchesPrompt(rule, alphaEndpoint, betaSecondEndpoint, categories), true);
});

test('per-category cycle does not increment a category counter when a category-level forbidden association disables the whole category', () => {
    const alpha = makeCategory('Alpha', ['alpha prompt'], { priority: '1' });
    const beta = makeCategory('Beta', ['beta first', 'beta second'], { priority: '2' });
    const state = makeState([
        alpha,
        beta,
    ], [
        {
            left: { kind: 'specific', category_name: 'Alpha', prompt_text: 'alpha prompt', contains_text: null, tag_text: null },
            right: { kind: 'specific', category_name: 'Beta', prompt_text: null, contains_text: null, tag_text: null },
        },
    ]);

    const result = withMockedRandom(0.25, () => selectPromptsWithCategoryCycle(state, {
        alpha: { seed: 5, remaining: 1, prompt_count: 1 },
        beta: { seed: 11, remaining: 2, prompt_count: 2 },
    }));

    assert.deepEqual(result.selections.map((item) => item.category_name), ['Alpha']);
    assert.equal(result.promptSeed, 5);
    assert.deepEqual(result.nextCategorySeedState.alpha, { seed: 536870912, remaining: 1, prompt_count: 1 });
    assert.deepEqual(result.nextCategorySeedState.beta, { seed: 11, remaining: 2, prompt_count: 2 });
});

test('per-category cycle does not touch skipped category counters because skipped categories are not processed', () => {
    const alpha = makeCategory('Alpha', ['alpha prompt'], { priority: '1' });
    const beta = makeCategory('Beta', ['beta first', 'beta second'], { priority: '2', state: 'skip' });
    const state = makeState([alpha, beta]);

    const result = withMockedRandom(0.75, () => selectPromptsWithCategoryCycle(state, {
        alpha: { seed: 3, remaining: 1, prompt_count: 1 },
        beta: { seed: 10, remaining: 2, prompt_count: 2 },
    }));

    assert.deepEqual(result.selections.map((item) => item.category_name), ['Alpha']);
    assert.equal('beta' in result.nextCategorySeedState, false);
});

test('LoRA selection resolver derives runtime entries without owning stale id repair', () => {
    const library: LibraryState = {
        models: [],
        loras: [
            { id: 'portrait', name: 'portrait.safetensors', path: 'D:/loras/portrait.safetensors' },
            { id: 'style', name: 'style.safetensors', path: 'D:/loras/style.safetensors' },
        ],
    };
    const selections: GenerationSelection[] = [
        { category_name: 'Subject', prompt_text: 'person', locked: false, induced_lora_ids: ['style', 'missing-prompt-lora'] },
    ];

    const resolved = resolveLoraSelection(library, ['portrait', 'missing-selected-lora'], selections);

    assert.deepEqual(resolved.selectedIds, ['portrait']);
    assert.deepEqual(resolved.promptLinkedIds, ['style']);
    assert.deepEqual(resolved.activeIds, ['portrait', 'style']);
    assert.deepEqual(resolved.activeLoras.map((item) => item.id), ['portrait', 'style']);
});

test('LoRA helpers sanitize persisted and generated selection payloads', () => {
    const library: LibraryState = {
        models: [],
        loras: [{ id: 'known', name: 'known.safetensors', path: 'D:/loras/known.safetensors' }],
    };
    const selections: GenerationSelection[] = [
        { category_name: 'Style', prompt_text: 'painted', locked: false, induced_lora_ids: ['known', 'unknown', 'known'] },
    ];

    assert.deepEqual(filterKnownLoraIds(['unknown', 'known', 'known'], library), ['known']);
    assert.deepEqual(filterSelectionLoraIds(selections, new Set(['known']))[0].induced_lora_ids, ['known']);
});
