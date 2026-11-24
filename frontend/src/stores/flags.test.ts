import { describe, expect, it } from 'vitest';
import { withFlag } from './flags';

describe('withFlag', () => {
	it('sets and clears a flag without mutating', () => {
		const flags = { a: true } as const;
		expect(withFlag(flags, 'b', true)).toEqual({ a: true, b: true });
		expect(withFlag(flags, 'a', false)).toEqual({});
		expect(withFlag(flags, 'missing', false)).toEqual({ a: true });
		expect(flags).toEqual({ a: true });
	});
});
