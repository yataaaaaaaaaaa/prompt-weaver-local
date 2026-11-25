import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAtLeast, isOverflowing, nextDensity, TOOLBAR_DENSITIES, useToolbarDensity, type ToolbarDensity } from './useToolbarDensity';
import { installLayoutStub, type LayoutStub } from '../test/layoutStub';

describe('nextDensity', () => {
	it('goes one level denser while the content overflows, and stays otherwise', () => {
		expect(TOOLBAR_DENSITIES).toEqual(['full', 'untitled', 'compact', 'minimal']);
		expect(nextDensity('full', true)).toBe('untitled');
		expect(nextDensity('untitled', true)).toBe('compact');
		expect(nextDensity('compact', true)).toBe('minimal');
		expect(nextDensity('minimal', true)).toBe('minimal');
		for (const density of TOOLBAR_DENSITIES) {
			expect(nextDensity(density, false)).toBe(density);
		}
	});
});

describe('isAtLeast', () => {
	it('orders the levels from the least to the most dense', () => {
		expect(isAtLeast('full', 'full')).toBe(true);
		expect(isAtLeast('full', 'untitled')).toBe(false);
		expect(isAtLeast('compact', 'untitled')).toBe(true);
		expect(isAtLeast('compact', 'minimal')).toBe(false);
		expect(isAtLeast('minimal', 'compact')).toBe(true);
	});
});

describe('isOverflowing', () => {
	it('compares the content width with the box width, tolerating one sub-pixel rounding', () => {
		expect(isOverflowing({ scrollWidth: 1000, clientWidth: 1000 })).toBe(false);
		expect(isOverflowing({ scrollWidth: 1001, clientWidth: 1000 })).toBe(false);
		expect(isOverflowing({ scrollWidth: 1002, clientWidth: 1000 })).toBe(true);
	});
});

// The content width of the probe at each density (what the toolbar's items need on one row).
const NATURAL: Record<ToolbarDensity, number> = { full: 1700, untitled: 1500, compact: 1000, minimal: 500 };

function Probe({ contentKey = 'a' }: { contentKey?: string }): JSX.Element {
	const { containerRef, contentRef, density } = useToolbarDensity<HTMLDivElement, HTMLDivElement>(contentKey);
	return (
		<div ref={containerRef}>
			<div ref={contentRef} data-testid="probe" data-density={density} data-content={contentKey}>
				{density}
			</div>
		</div>
	);
}

const density = () => screen.getByTestId('probe').getAttribute('data-density');

describe('useToolbarDensity', () => {
	let layout: LayoutStub;

	beforeEach(() => {
		layout = installLayoutStub((element) => NATURAL[element.getAttribute('data-density') as ToolbarDensity] ?? 0);
	});

	afterEach(() => {
		layout.restore();
	});

	it('keeps every label when they fit', () => {
		layout.setAvailableWidth(1920);
		render(<Probe />);
		expect(density()).toBe('full');
	});

	it('picks the least dense level that fits, before the first paint', () => {
		layout.setAvailableWidth(1600);
		const first = render(<Probe />);
		expect(density()).toBe('untitled');
		first.unmount();

		layout.setAvailableWidth(1200);
		const { unmount } = render(<Probe />);
		expect(density()).toBe('compact');
		unmount();

		layout.setAvailableWidth(600);
		render(<Probe />);
		expect(density()).toBe('minimal');
	});

	it('stays at the densest level when even that does not fit', () => {
		layout.setAvailableWidth(300);
		render(<Probe />);
		expect(density()).toBe('minimal');
	});

	it('measures again when the toolbar is resized, both ways', () => {
		layout.setAvailableWidth(600);
		render(<Probe />);
		expect(density()).toBe('minimal');

		act(() => layout.resize(1920));
		expect(density()).toBe('full');

		act(() => layout.resize(1200));
		expect(density()).toBe('compact');

		// Same width again: nothing to do.
		act(() => layout.resize(1200));
		expect(density()).toBe('compact');
	});

	it('measures again from the least dense level when the content changes', () => {
		layout.setAvailableWidth(1200);
		const { rerender } = render(<Probe contentKey="short" />);
		expect(density()).toBe('compact');

		// Shorter content: the labels fit again.
		layout.setNaturalWidth((element) => (element.getAttribute('data-content') === 'shorter' ? 900 : NATURAL.compact));
		rerender(<Probe contentKey="shorter" />);
		expect(density()).toBe('full');
	});

	it('stops observing on unmount', () => {
		layout.setAvailableWidth(1920);
		const { unmount } = render(<Probe />);
		expect(layout.observed()).toBe(1);
		unmount();
		expect(layout.observed()).toBe(0);
	});
});
