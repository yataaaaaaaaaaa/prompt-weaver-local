// Includes the LoRA cases of the pre-refactor tests/promptEngine.test.ts (incl. missingIds).
import { describe, expect, it } from 'vitest';
import { LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { GenerationSelection, LoraWeight, LoRASpec } from '../api/types';
import {
	loraSourceOf,
	withLora,
	addLorasToSelection,
	clampLoraWeight,
	filterKnownLoras,
	filterSelectionLoraIds,
	loraAtDefaultWeight,
	resolveLoraSelection,
	weightedLoraParts,
	weightedLoraText,
	weightedLorasText,
	withLoraWeight,
} from './loraSelection';

const spec = (id: string): LoRASpec => ({ id, name: `${id}.safetensors`, path: `D:/loras/${id}.safetensors`, source: null });
const at = (id: string, weight = LORA_WEIGHT_DEFAULTS.weight): LoraWeight => ({ id, weight });

describe('LoRA selection (legacy cases)', () => {
	it('drops stale ids instead of returning unknown runtime entries and reports them as missing', () => {
		const library = { loras: [spec('portrait'), spec('style')] };
		const selections: GenerationSelection[] = [
			{ category_name: 'Subject', prompt_text: 'person', locked: false, induced_lora_ids: ['style', 'missing-prompt-lora'] },
		];

		const resolved = resolveLoraSelection(library, [at('portrait'), at('missing-selected-lora')], selections);

		expect(resolved.selectedIds).toEqual(['portrait']);
		expect(resolved.promptLinkedIds).toEqual(['style']);
		expect(resolved.activeIds).toEqual(['portrait', 'style']);
		expect(resolved.missingIds).toEqual(['missing-selected-lora', 'missing-prompt-lora']);
		expect(resolved.activeLoras.map((item) => item.id)).toEqual(['portrait', 'style']);
	});

	it('sanitizes generated selection payloads', () => {
		const selections: GenerationSelection[] = [
			{ category_name: 'Style', prompt_text: 'painted', locked: false, induced_lora_ids: ['known', 'unknown', 'known'] },
		];

		expect(filterSelectionLoraIds(selections, new Set(['known']))[0].induced_lora_ids).toEqual(['known']);
	});

	it('missingIds are unique, user-selected first, then prompt-linked', () => {
		const resolved = resolveLoraSelection({ loras: [] }, [at('b'), at('a'), at('b')], [
			{ induced_lora_ids: ['c', 'a'] },
			{ induced_lora_ids: ['d', 'c'] },
		]);
		expect(resolved.missingIds).toEqual(['b', 'a', 'c', 'd']);
		expect(resolved.activeLoras).toEqual([]);
	});

	it('active ids put the selection first and count shared ids once', () => {
		const loras = ['a', 'b', 'c'].map(spec);
		const resolved = resolveLoraSelection({ loras }, [at('c'), at('a')], [{ induced_lora_ids: ['a', 'b'] }]);
		expect(resolved.activeIds).toEqual(['c', 'a', 'b']);
		expect(resolved.missingIds).toEqual([]);
	});
});

describe('resolveLoraSelection weights', () => {
	it('selected LoRAs keep their weight, prompt-linked-only LoRAs get the default weight, selected first', () => {
		const library = { loras: ['detail', 'grain', 'style'].map(spec) };

		const resolved = resolveLoraSelection(library, [at('grain', -1.25), at('detail', 0.6)], [{ induced_lora_ids: ['style', 'detail'] }]);

		expect(resolved.activeLoras).toEqual([
			{ ...spec('grain'), weight: -1.25 },
			{ ...spec('detail'), weight: 0.6 },
			{ ...spec('style'), weight: LORA_WEIGHT_DEFAULTS.weight },
		]);
	});

	it('uses the first weight of a duplicated id and clamps out-of-range weights', () => {
		const resolved = resolveLoraSelection({ loras: [spec('a')] }, [at('a', 42), at('a', 0.5)], []);
		expect(resolved.activeLoras).toEqual([{ ...spec('a'), weight: LORA_WEIGHT_DEFAULTS.max }]);
	});
});

describe('resolveLoraSelection with character LoRAs', () => {
	const library = { loras: ['face', 'detail', 'style', 'grain'].map(spec) };

	it('character LoRAs come first and their weight wins over the selected one', () => {
		const resolved = resolveLoraSelection(library, [at('detail', 0.8), at('face', 1.2)], [{ induced_lora_ids: ['style', 'detail'] }], [
			at('face', 0.4),
			at('grain', -0.5),
		]);

		expect(resolved.characterIds).toEqual(['face', 'grain']);
		expect(resolved.selectedIds).toEqual(['detail', 'face']);
		expect(resolved.promptLinkedIds).toEqual(['style', 'detail']);
		expect(resolved.activeIds).toEqual(['face', 'grain', 'detail', 'style']);
		expect(resolved.activeLoras).toEqual([
			{ ...spec('face'), weight: 0.4 },
			{ ...spec('grain'), weight: -0.5 },
			{ ...spec('detail'), weight: 0.8 },
			{ ...spec('style'), weight: LORA_WEIGHT_DEFAULTS.weight },
		]);
	});

	it('character weights are clamped, the first of a duplicated id wins', () => {
		const resolved = resolveLoraSelection(library, [], [], [at('face', 99), at('face', 0.3)]);
		expect(resolved.activeLoras).toEqual([{ ...spec('face'), weight: LORA_WEIGHT_DEFAULTS.max }]);
	});

	it('missingIds: character first, then selected, then prompt-linked', () => {
		const resolved = resolveLoraSelection(library, [at('gone-selected'), at('gone-character')], [{ induced_lora_ids: ['gone-prompt', 'style'] }], [
			at('gone-character'),
			at('face'),
		]);
		expect(resolved.missingIds).toEqual(['gone-character', 'gone-selected', 'gone-prompt']);
		expect(resolved.activeIds).toEqual(['face', 'style']);
	});

	it('without character LoRAs, characterIds is empty and nothing else changes', () => {
		const selection = [at('detail', 0.6)];
		const prompt = [{ induced_lora_ids: ['style'] }];
		const resolved = resolveLoraSelection(library, selection, prompt);
		expect(resolved.characterIds).toEqual([]);
		expect(resolveLoraSelection(library, selection, prompt, [])).toEqual(resolved);
		expect(resolved.activeIds).toEqual(['detail', 'style']);
	});
});

describe('clampLoraWeight', () => {
	it('clamps to the accepted range and maps non-finite weights to the default', () => {
		expect(clampLoraWeight(0.6)).toBe(0.6);
		expect(clampLoraWeight(LORA_WEIGHT_DEFAULTS.max + 1)).toBe(LORA_WEIGHT_DEFAULTS.max);
		expect(clampLoraWeight(LORA_WEIGHT_DEFAULTS.min - 1)).toBe(LORA_WEIGHT_DEFAULTS.min);
		expect(clampLoraWeight(LORA_WEIGHT_DEFAULTS.min)).toBe(LORA_WEIGHT_DEFAULTS.min);
		expect(clampLoraWeight(Number.NaN)).toBe(LORA_WEIGHT_DEFAULTS.weight);
		expect(clampLoraWeight(Number.POSITIVE_INFINITY)).toBe(LORA_WEIGHT_DEFAULTS.weight);
	});

	it('lists named LoRAs with their weights', () => {
		expect(weightedLorasText([{ name: 'Detail Tweaker LoRA - v1.0', weight: 1 }, { name: 'Kim LoRA - v1', weight: 0.6 }])).toBe(
			'Detail Tweaker LoRA - v1.0 (1), Kim LoRA - v1 (0.6)',
		);
		expect(weightedLorasText([])).toBe('');
		expect(weightedLoraText({ name: 'Watercolor Wash v1.2', weight: -0.5 })).toBe('Watercolor Wash v1.2 (-0.5)');
		expect(weightedLoraText({ name: 'Kim', weight: 0.333 })).toBe('Kim (0.33)');
		expect(weightedLoraParts({ name: 'Kim', weight: -1.25 })).toEqual({ name: 'Kim', weight: '(-1.25)' });
	});

});

describe('selection edits', () => {
	const library = { loras: ['a', 'b', 'c'].map(spec) };

	it('loraAtDefaultWeight', () => {
		expect(loraAtDefaultWeight('a')).toEqual({ id: 'a', weight: LORA_WEIGHT_DEFAULTS.weight });
	});

	it('filterKnownLoras keeps known ids in order, the first of duplicates, with clamped weights', () => {
		expect(filterKnownLoras([at('c', 0.5), at('gone'), at('a', -99), at('c', 2), at('b', Number.NaN)], library)).toEqual([
			at('c', 0.5),
			at('a', LORA_WEIGHT_DEFAULTS.min),
			at('b', LORA_WEIGHT_DEFAULTS.weight),
		]);
	});

	it('addLorasToSelection appends unselected known ids at the default weight and keeps existing weights', () => {
		const selection = [at('b', 0.4)];
		expect(addLorasToSelection(selection, ['c', 'b', 'gone', 'c', 'a'], library)).toEqual([at('b', 0.4), at('c'), at('a')]);
		expect(addLorasToSelection(selection, ['b', 'gone'], library)).toBe(selection);
	});

	it('withLoraWeight sets a clamped weight and keeps the array when nothing changes', () => {
		const selection = [at('a', 1), at('b', 0.5)];
		expect(withLoraWeight(selection, 'b', 0.75)).toEqual([at('a', 1), at('b', 0.75)]);
		expect(withLoraWeight(selection, 'a', 50)).toEqual([at('a', LORA_WEIGHT_DEFAULTS.max), at('b', 0.5)]);
		expect(withLoraWeight(selection, 'b', 0.5)).toBe(selection);
		expect(withLoraWeight(selection, 'c', 0.5)).toBe(selection);
	});
});

describe('resolveLoraSelection with scene LoRAs', () => {
	const library: { loras: LoRASpec[] } = {
		loras: ['cast', 'scene', 'picked', 'linked'].map((id) => ({ id, name: `${id}.safetensors`, path: `D:/l/${id}.safetensors`, source: null })),
	};

	it("puts the scene's LoRAs after the cast's and before the selection; the scene's weight wins", () => {
		const resolved = resolveLoraSelection(
			library,
			[{ id: 'picked', weight: 0.7 }, { id: 'scene', weight: 0.9 }],
			[{ induced_lora_ids: ['linked', 'cast'] }],
			[{ id: 'cast', weight: 0.5 }, { id: 'scene', weight: 0.2 }],
			[{ id: 'scene', weight: 0 }, { id: 'gone', weight: 1 }],
		);

		expect(resolved.activeIds).toEqual(['cast', 'scene', 'picked', 'linked']);
		expect(resolved.activeLoras.map((lora) => [lora.id, lora.weight])).toEqual([
			['cast', 0.5],
			['scene', 0],
			['picked', 0.7],
			['linked', LORA_WEIGHT_DEFAULTS.weight],
		]);
		expect(resolved.sceneIds).toEqual(['scene']);
		expect(resolved.missingIds).toEqual(['gone']);
		expect(['cast', 'scene', 'picked', 'linked'].map((id) => loraSourceOf(resolved, id))).toEqual(['character', 'scene', 'selection', 'prompt']);
	});

	it('withLora adds a LoRA or changes its weight (clamped)', () => {
		const loras: LoraWeight[] = [{ id: 'cast', weight: 1 }];
		expect(withLora(loras, 'scene', 0.4)).toEqual([{ id: 'cast', weight: 1 }, { id: 'scene', weight: 0.4 }]);
		expect(withLora(loras, 'cast', 99)).toEqual([{ id: 'cast', weight: LORA_WEIGHT_DEFAULTS.max }]);
		expect(withLora(loras, 'cast', 1)).toBe(loras);
	});
});
