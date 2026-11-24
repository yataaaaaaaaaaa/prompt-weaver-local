// Includes the LoRA cases of the pre-refactor tests/promptEngine.test.ts (incl. missingIds).
import { describe, expect, it } from 'vitest';
import type { GenerationSelection } from '../api/types';
import { filterKnownLoraIds, filterSelectionLoraIds, resolveLoraSelection } from './loraSelection';

describe('LoRA selection (legacy cases)', () => {
	it('drops stale ids instead of returning unknown runtime entries and reports them as missing', () => {
		const library = {
			loras: [
				{ id: 'portrait', name: 'portrait.safetensors', path: 'D:/loras/portrait.safetensors' },
				{ id: 'style', name: 'style.safetensors', path: 'D:/loras/style.safetensors' },
			],
		};
		const selections: GenerationSelection[] = [
			{ category_name: 'Subject', prompt_text: 'person', locked: false, induced_lora_ids: ['style', 'missing-prompt-lora'] },
		];

		const resolved = resolveLoraSelection(library, ['portrait', 'missing-selected-lora'], selections);

		expect(resolved.selectedIds).toEqual(['portrait']);
		expect(resolved.promptLinkedIds).toEqual(['style']);
		expect(resolved.activeIds).toEqual(['portrait', 'style']);
		expect(resolved.missingIds).toEqual(['missing-selected-lora', 'missing-prompt-lora']);
		expect(resolved.activeLoras.map((item) => item.id)).toEqual(['portrait', 'style']);
		expect(resolved.selectedLoras.map((item) => item.id)).toEqual(['portrait']);
		expect(resolved.promptLinkedLoras.map((item) => item.id)).toEqual(['style']);
	});

	it('sanitizes persisted and generated selection payloads', () => {
		const library = { loras: [{ id: 'known', name: 'known.safetensors', path: 'D:/loras/known.safetensors' }] };
		const selections: GenerationSelection[] = [
			{ category_name: 'Style', prompt_text: 'painted', locked: false, induced_lora_ids: ['known', 'unknown', 'known'] },
		];

		expect(filterKnownLoraIds(['unknown', 'known', 'known'], library)).toEqual(['known']);
		expect(filterSelectionLoraIds(selections, new Set(['known']))[0].induced_lora_ids).toEqual(['known']);
	});

	it('missingIds are unique, user-selected first, then prompt-linked', () => {
		const resolved = resolveLoraSelection({ loras: [] }, ['b', 'a', 'b'], [
			{ induced_lora_ids: ['c', 'a'] },
			{ induced_lora_ids: ['d', 'c'] },
		]);
		expect(resolved.missingIds).toEqual(['b', 'a', 'c', 'd']);
		expect(resolved.activeLoras).toEqual([]);
	});

	it('active ids put the selection first and count shared ids once', () => {
		const loras = ['a', 'b', 'c'].map((id) => ({ id, name: id, path: id }));
		const resolved = resolveLoraSelection({ loras }, ['c', 'a'], [{ induced_lora_ids: ['a', 'b'] }]);
		expect(resolved.activeIds).toEqual(['c', 'a', 'b']);
		expect(resolved.missingIds).toEqual([]);
	});
});
