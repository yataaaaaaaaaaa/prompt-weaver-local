import { describe, expect, it } from 'vitest';
import { formatBytes, formatTransfer } from './format';

const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;

describe('formatBytes', () => {
	it('shows whole bytes below one kilobyte', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1)).toBe('1 B');
		expect(formatBytes(1023)).toBe('1023 B');
	});

	it('uses KB, MB and GB with one decimal place', () => {
		expect(formatBytes(KB)).toBe('1.0 KB');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(144 * MB)).toBe('144.0 MB');
		expect(formatBytes(Math.round(1.2 * GB))).toBe('1.2 GB');
		expect(formatBytes(Math.round(6.94 * GB))).toBe('6.9 GB');
	});

	it('switches unit when rounding would reach 1024', () => {
		expect(formatBytes(MB - 1)).toBe('1.0 MB');
		expect(formatBytes(GB - 1)).toBe('1.0 GB');
		expect(formatBytes(Math.round(1023.94 * KB))).toBe('1023.9 KB');
	});

	it('keeps GB as the largest unit', () => {
		expect(formatBytes(2048 * GB)).toBe('2048.0 GB');
	});

	it('shows invalid sizes as zero', () => {
		expect(formatBytes(-5)).toBe('0 B');
		expect(formatBytes(Number.NaN)).toBe('0 B');
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
	});
});

describe('formatTransfer', () => {
	it('shows received of total', () => {
		expect(formatTransfer(Math.round(1.2 * GB), Math.round(6.9 * GB))).toBe('1.2 GB of 6.9 GB');
	});

	it('shows only the received size while the total is unknown', () => {
		expect(formatTransfer(512 * KB, 0)).toBe('512.0 KB');
	});
});
