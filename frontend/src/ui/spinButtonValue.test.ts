import { describe, expect, it } from 'vitest';
import { spinButtonValue } from './spinButtonValue';

describe('spinButtonValue', () => {
	it('prefers the stepped value', () => {
		expect(spinButtonValue({ value: 0.65 })).toBe(0.65);
		expect(spinButtonValue({ value: 0, displayValue: '3' })).toBe(0);
	});

	it('parses typed text reported as displayValue', () => {
		expect(spinButtonValue({ value: undefined, displayValue: '512' })).toBe(512);
		expect(spinButtonValue({ displayValue: '-1.25' })).toBe(-1.25);
		expect(spinButtonValue({ displayValue: ' 0.6 ' })).toBe(0.6);
	});

	it('returns null without a usable number', () => {
		expect(spinButtonValue({})).toBeNull();
		expect(spinButtonValue({ value: null })).toBeNull();
		expect(spinButtonValue({ displayValue: '' })).toBeNull();
		expect(spinButtonValue({ displayValue: 'heavy' })).toBeNull();
		expect(spinButtonValue({ value: Number.NaN })).toBeNull();
	});
});
