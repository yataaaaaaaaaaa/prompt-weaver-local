import { describe, expect, it } from 'vitest';
import { clamp, finiteNumberOr, isFiniteNumber, isRecord, parseNumberText, positiveNumberOr, recordOr, stringOr } from './guards';

describe('untrusted value guards', () => {
	it('recognizes records and finite numbers', () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord([])).toBe(false);
		expect(isRecord(null)).toBe(false);
		expect(recordOr({ a: 1 })).toEqual({ a: 1 });
		expect(recordOr([1])).toEqual({});
		expect(recordOr(undefined)).toEqual({});
		expect(isFiniteNumber(3)).toBe(true);
		expect(isFiniteNumber(Number.NaN)).toBe(false);
		expect(isFiniteNumber('3')).toBe(false);
	});

	it('falls back for invalid numbers and strings', () => {
		expect(finiteNumberOr(-2, 1)).toBe(-2);
		expect(finiteNumberOr(Number.POSITIVE_INFINITY, 1)).toBe(1);
		expect(finiteNumberOr('2', 1)).toBe(1);
		expect(positiveNumberOr(768, 1024)).toBe(768);
		expect(positiveNumberOr(0, 1024)).toBe(1024);
		expect(positiveNumberOr('768', 1024)).toBe(1024);
		expect(stringOr('x', null)).toBe('x');
		expect(stringOr(4, null)).toBeNull();
		expect(stringOr(undefined, '')).toBe('');
	});

	it('parses typed numbers', () => {
		expect(parseNumberText(' 1.5 ')).toBe(1.5);
		expect(parseNumberText('-3')).toBe(-3);
		expect(parseNumberText('')).toBeNull();
		expect(parseNumberText('   ')).toBeNull();
		expect(parseNumberText('1.')).toBe(1);
		expect(parseNumberText('abc')).toBeNull();
		expect(parseNumberText('Infinity')).toBeNull();
	});

	it('clamps', () => {
		expect(clamp(5, 0, 3)).toBe(3);
		expect(clamp(-1, 0, 3)).toBe(0);
		expect(clamp(2, 0, 3)).toBe(2);
	});
});
