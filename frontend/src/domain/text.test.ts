import { describe, expect, it } from 'vitest';
import {
	areNameEquivalent,
	comparePriority,
	formatWeight,
	joinPromptTags,
	namedProblemsText,
	normalizeIdPart,
	normalizePromptName,
	normalizeTagId,
	normalizeTextForMatch,
	priorityToSortKey,
	promptHasTag,
	promptTagIds,
	sameKey,
	splitActivationTerms,
	splitPromptTags,
	splitPromptWords,
	textContains,
	toKey,
	uniqueDisplayName,
	uniqueKey,
	uniqueStrings,
} from './text';

describe('toKey (persisted keys depend on it)', () => {
	it.each([
		['day_moment', 'day-moment'],
		['Groza clothes', 'groza-clothes'],
		['an-94 clothes', 'an-94-clothes'],
		['girl frontline', 'girl-frontline'],
		['Main', 'main'],
		['Sub_clothed', 'sub-clothed'],
		['UMP45 clothes', 'ump45-clothes'],
		['realism helper', 'realism-helper'],
		['  --Spaced -- out__  ', 'spaced-out'],
		['Café crème', 'cafe-creme'],
		['<lora:Groza-10:1>, Groza', 'lora-groza-10-1-groza'],
		['', 'id'],
		['!!!', 'id'],
	])('%j -> %j', (text, key) => {
		expect(toKey(text)).toBe(key);
	});

	it('is idempotent', () => {
		expect(toKey(toKey('Groza clothes'))).toBe('groza-clothes');
	});

	it('sameKey compares names by key', () => {
		expect(sameKey('Groza clothes', 'groza_clothes')).toBe(true);
		expect(sameKey('day_moment', 'Day Moment')).toBe(true);
		expect(sameKey('Main', 'Main 2')).toBe(false);
	});
});

describe('uniqueKey', () => {
	it('keeps legacy library ids identical for ASCII names', () => {
		expect(uniqueKey('JANKUV5NSFWTrainedNoobai_v50.safetensors', [])).toBe('jankuv5nsfwtrainednoobai-v50-safetensors');
		expect(uniqueKey('catponyReal_ilV41.safetensors', [])).toBe('catponyreal-ilv41-safetensors');
		expect(uniqueKey('zy_illustrious_Realism_Enhancer_v1', [])).toBe('zy-illustrious-realism-enhancer-v1');
		expect(uniqueKey('bubblehentai_v20.safetensors', ['bubblehentai-v20-safetensors'])).toBe('bubblehentai-v20-safetensors-2');
	});

	it('suffixes -2, -3, ... until free (arrays and sets)', () => {
		expect(uniqueKey('new category', [])).toBe('new-category');
		expect(uniqueKey('new category', ['new-category'])).toBe('new-category-2');
		expect(uniqueKey('new category', new Set(['new-category', 'new-category-2']))).toBe('new-category-3');
	});

	it('uniqueStrings keeps the first occurrence order', () => {
		expect(uniqueStrings(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
	});
});

describe('prompt matching normalizations', () => {
	it('normalizes ids and tags', () => {
		expect(normalizeIdPart(' Long Hair ')).toBe('long_hair');
		expect(normalizeTagId('side-view')).toBe('side_view');
		expect(normalizeTagId('  ')).toBe('');
	});

	it('prompt names ignore casing, whitespace and comma-tag order', () => {
		expect(normalizePromptName('long hair, Blonde  hair,')).toBe('blonde_hair, long_hair');
		expect(areNameEquivalent('Blonde hair,  long hair', 'long_hair, blonde HAIR')).toBe(true);
		expect(areNameEquivalent('pants,', 'pants')).toBe(true);
		expect(areNameEquivalent('pants', 'bloomers')).toBe(false);
		expect(areNameEquivalent('', ' , ')).toBe(true);
	});

	it('normalizes text for substring matching', () => {
		expect(normalizeTextForMatch('  Full \n Clothed ')).toBe('full clothed');
		expect(textContains('1girl, FULL_clothed', 'clothed')).toBe(true);
		expect(textContains('1girl', 'boy')).toBe(false);
		expect(textContains('anything', '  ')).toBe(false);
	});

	it('splits activation terms, prompt words and tags', () => {
		expect(splitActivationTerms(' my_safe_prompt , ,Groza ')).toEqual(['my_safe_prompt', 'Groza']);
		expect(splitPromptWords('A  b, C,,')).toEqual(['a b', 'c']);
		expect(splitPromptTags('long hair, Long_Hair, blue eyes, , ,')).toEqual(['long hair', 'blue eyes']);
		expect([...promptTagIds('long hair, blue eyes')]).toEqual(['long_hair', 'blue_eyes']);
	});

	it('joins tags as prompt text (trigger words, image tags)', () => {
		expect(joinPromptTags([' easynegative ', '', 'detailed', '   '])).toBe('easynegative, detailed');
		expect(joinPromptTags(['castle', ' sky ', 'snow'])).toBe('castle, sky, snow');
		expect(joinPromptTags([])).toBe('');
	});

	it('promptHasTag compares normalized tag ids', () => {
		expect(promptHasTag('open_clothes, no bra, side view', 'side_view')).toBe(true);
		expect(promptHasTag('open_clothes', 'clothes')).toBe(false);
		expect(promptHasTag('anything', '')).toBe(false);
	});
});

describe('priorities', () => {
	it('parses dotted priorities', () => {
		expect(priorityToSortKey('2.x3')).toEqual([2, 3]);
		expect(priorityToSortKey('abc')).toEqual([10000]);
		expect(priorityToSortKey('')).toEqual([]);
	});

	it('compares numerically part by part (missing parts sort last)', () => {
		expect(comparePriority('1', '2')).toBeLessThan(0);
		expect(comparePriority('10', '9')).toBeGreaterThan(0);
		expect(comparePriority('1.2', '1.10')).toBeLessThan(0);
		expect(comparePriority('1.1', '1')).toBeLessThan(0);
		expect(comparePriority('3', '3')).toBe(0);
	});
});

describe('namedProblemsText', () => {
	it('lists named problems in one sentence', () => {
		expect(namedProblemsText([{ name: 'realistic filter [IL]', problem: 'No version id or hash published.' }])).toBe(
			'realistic filter [IL]: No version id or hash published.',
		);
		expect(namedProblemsText([{ name: 'a', problem: 'Disk full' }, { name: 'b', problem: ' Unsupported base model. ' }])).toBe('a: Disk full; b: Unsupported base model.');
	});
});

describe('formatWeight', () => {
	it('formats with at most 2 decimals and no trailing zeros', () => {
		expect(formatWeight(1)).toBe('1');
		expect(formatWeight(0.6)).toBe('0.6');
		expect(formatWeight(-1.25)).toBe('-1.25');
		expect(formatWeight(0.1 + 0.2)).toBe('0.3');
		expect(formatWeight(0.333333)).toBe('0.33');
	});
});

describe('uniqueDisplayName', () => {
	it('keeps the base name when free, else numbers it like uniqueKey', () => {
		expect(uniqueDisplayName('New story', [])).toBe('New story');
		expect(uniqueDisplayName('New story', ['new story'])).toBe('New story 2');
		expect(uniqueDisplayName('New story', ['New story', 'New-Story 2'])).toBe('New story 3');
	});
});
