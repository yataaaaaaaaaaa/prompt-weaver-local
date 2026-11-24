import { describe, expect, it } from 'vitest';
import type { OutputRecord } from '../api/types';
import { outputCharacter } from '../test/characterData';
import {
	compareOutputIds,
	formatOutputId,
	indexSelections,
	insertOutputId,
	nearestOutputId,
	nextOutputId,
	normalizeOutputIds,
	outputCharacterText,
	outputDetails,
	parseOutputId,
	previousOutputId,
	removeOutputId,
} from './outputs';

describe('output ids', () => {
	it('formats and parses 10-digit ids', () => {
		expect(formatOutputId(112)).toBe('0000000112');
		expect(formatOutputId(0)).toBe('0000000000');
		expect(() => formatOutputId(-1)).toThrow(RangeError);
		expect(() => formatOutputId(1.5)).toThrow(RangeError);
		expect(parseOutputId('0000000112')).toBe(112);
		expect(parseOutputId('12a')).toBeNull();
		expect(parseOutputId('')).toBeNull();
		expect(parseOutputId(null)).toBeNull();
	});

	it('orders numerically, unique and ascending', () => {
		expect(compareOutputIds('0000000002', '0000000010')).toBeLessThan(0);
		expect(compareOutputIds('99999999999', '0000000010')).toBeGreaterThan(0);
		expect(normalizeOutputIds(['0000000003', '0000000001', '0000000003', '0000000002'])).toEqual(['0000000001', '0000000002', '0000000003']);
	});

	it('inserts keeping the order and removes', () => {
		const ids = ['0000000001', '0000000003'];
		expect(insertOutputId(ids, '0000000004')).toEqual(['0000000001', '0000000003', '0000000004']);
		expect(insertOutputId(ids, '0000000002')).toEqual(['0000000001', '0000000002', '0000000003']);
		expect(insertOutputId(ids, '0000000003')).toBe(ids);
		expect(insertOutputId([], '0000000001')).toEqual(['0000000001']);
		expect(removeOutputId(ids, '0000000001')).toEqual(['0000000003']);
		expect(removeOutputId(ids, '0000000009')).toBe(ids);
	});
});

describe('neighbours', () => {
	const ids = ['0000000001', '0000000002', '0000000005'];

	it('finds the next and previous ids, also from an id that is not in the list', () => {
		expect(nextOutputId(ids, '0000000002')).toBe('0000000005');
		expect(nextOutputId(ids, '0000000005')).toBeNull();
		expect(nextOutputId(ids, '0000000003')).toBe('0000000005');
		expect(nextOutputId(ids, null)).toBe('0000000001');
		expect(previousOutputId(ids, '0000000002')).toBe('0000000001');
		expect(previousOutputId(ids, '0000000001')).toBeNull();
		expect(previousOutputId(ids, '0000000004')).toBe('0000000002');
		expect(previousOutputId(ids, null)).toBe('0000000005');
		expect(nextOutputId([], null)).toBeNull();
		expect(previousOutputId([], null)).toBeNull();
	});

	it('replaces a gone output by the one now at its position, else the previous one', () => {
		expect(nearestOutputId(ids, '0000000003')).toBe('0000000005');
		expect(nearestOutputId(ids, '0000000009')).toBe('0000000005');
		expect(nearestOutputId(['0000000001'], '0000000000')).toBe('0000000001');
		expect(nearestOutputId([], '0000000001')).toBeNull();
	});
});

describe('indexSelections', () => {
	it('indexes sub-prompt keys by category key (key equivalence)', () => {
		const index = indexSelections([
			{ category_name: 'Main Style', prompt_text: 'Masterpiece, best quality' },
			{ category_name: 'main style', prompt_text: 'other' },
			{ category_name: 'Clothed', prompt_text: 'naked' },
		]);
		expect(index.get('main-style')).toEqual(['masterpiece-best-quality', 'other']);
		expect(index.get('clothed')).toEqual(['naked']);
		expect(index.get('missing')).toBeUndefined();
	});
});

describe('outputDetails', () => {
	const record: OutputRecord = {
		output_id: '0000000112',
		generated_at: '2026-03-23T10:00:00Z',
		prompt: 'masterpiece, clothed',
		negative_prompt: 'ugly',
		seed: 689303569,
		prompt_seed: 94,
		image_seed: 689303569,
		width: 832,
		height: 1216,
		steps: 30,
		guidance_scale: 5,
		model_id: 'model-a',
		active_loras: [
			{ id: 'alya', weight: 0.6 },
			{ id: 'gone', weight: 1 },
		],
		selections: [],
		image_path: 'D:\\data\\output\\0000000112.png',
		metadata_path: 'D:\\data\\output\\0000000112.json',
		character: null,
	};

	it('resolves names, keeps the LoRA weights and the image file name', () => {
		expect(outputDetails(record, 'Model A', [{ id: 'alya', name: 'Alya', path: 'x', source: null }])).toEqual({
			outputId: '0000000112',
			imageName: '0000000112.png',
			generatedAt: '2026-03-23T10:00:00Z',
			width: 832,
			height: 1216,
			steps: 30,
			guidanceScale: 5,
			seed: 689303569,
			promptSeed: 94,
			modelName: 'Model A',
			loras: [
				{ name: 'Alya', weight: 0.6 },
				{ name: 'gone', weight: 1 },
			],
			prompt: 'masterpiece, clothed',
			negativePrompt: 'ugly',
			character: null,
		});
	});

	it('passes the output character through and describes how its references were used', () => {
		const used = outputCharacter();
		expect(outputDetails({ ...record, character: used }, 'Model A', []).character).toBe(used);
		expect(outputCharacterText(used)).toBe('Alice · references applied (strength 0.6, 1 image)');
		expect(
			outputCharacterText(outputCharacter({ reference: { ...used.reference, strength: 0.1 + 0.2, image_ids: ['img-000000000001', 'img-000000000002'] } })),
		).toBe('Alice · references applied (strength 0.3, 2 images)');
		expect(
			outputCharacterText(
				outputCharacter({ reference: { applied: false, variant_id: null, strength: null, image_ids: [], reason: 'The character has no reference images.' } }),
			),
		).toBe('Alice · references not applied: The character has no reference images.');
	});
});
