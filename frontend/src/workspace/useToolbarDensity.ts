// Density of the workspace app bar: the least dense level whose items fit on ONE row.
// - 'full': the app title, and every item with its icon and its label;
// - 'untitled': the app title is visually hidden (it stays the page heading; the window title bar shows the app
//   name anyway), every label stays;
// - 'compact': the pane toggles become icon-only (their name stays the pane title; their tooltip says which pane);
// - 'minimal': every item is icon-only.
// Purely ephemeral layout state of the view (no domain state): measured in the real layout, before the browser paints
// (layout effects re-render synchronously, the resize observer flushes synchronously). Two elements are involved:
// - the content (the toolbar), which clips what does not fit: scrollWidth > clientWidth means "does not fit";
// - the container (the app bar), whose width follows the window only, observed to measure again on resize. (The
//   content's own width changes with the density, e.g. when the title hides: observing it would loop.)
// The measurement also starts again whenever the items' content changes (`contentKey`, e.g. the visibility mode label).
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

export const TOOLBAR_DENSITIES = ['full', 'untitled', 'compact', 'minimal'] as const;
export type ToolbarDensity = (typeof TOOLBAR_DENSITIES)[number];

/** Sub-pixel layouts may report a width 1px larger than the box without any visible overflow. */
const OVERFLOW_TOLERANCE_PX = 1;

/** The content of `element` is wider than its box (it clips the rest). */
export function isOverflowing(element: Pick<HTMLElement, 'scrollWidth' | 'clientWidth'>): boolean {
	return element.scrollWidth > element.clientWidth + OVERFLOW_TOLERANCE_PX;
}

/** The density to render next: one level denser while the content overflows (the densest level is final). */
export function nextDensity(current: ToolbarDensity, overflowing: boolean): ToolbarDensity {
	const index = TOOLBAR_DENSITIES.indexOf(current);
	return overflowing && index < TOOLBAR_DENSITIES.length - 1 ? TOOLBAR_DENSITIES[index + 1] : current;
}

/** `density` is at least as dense as `level` (levels only ever add reductions). */
export function isAtLeast(density: ToolbarDensity, level: ToolbarDensity): boolean {
	return TOOLBAR_DENSITIES.indexOf(density) >= TOOLBAR_DENSITIES.indexOf(level);
}

type Measure = { density: ToolbarDensity; generation: number };

/** Starts again from the least dense level (a new generation forces a new measurement even when already 'full'). */
function restart(previous: Measure): Measure {
	return { density: TOOLBAR_DENSITIES[0], generation: previous.generation + 1 };
}

export type ToolbarDensityRefs<C extends HTMLElement, E extends HTMLElement> = {
	/** The element whose width follows the window (observed). */
	containerRef: RefObject<C>;
	/** The element that clips its items (measured). */
	contentRef: RefObject<E>;
	density: ToolbarDensity;
};

export function useToolbarDensity<C extends HTMLElement, E extends HTMLElement>(contentKey: unknown): ToolbarDensityRefs<C, E> {
	const containerRef = useRef<C>(null);
	const contentRef = useRef<E>(null);
	const [measure, setMeasure] = useState<Measure>({ density: TOOLBAR_DENSITIES[0], generation: 0 });

	// After every render: one level denser while the items overflow (re-renders synchronously, before paint).
	useLayoutEffect(() => {
		const content = contentRef.current;
		if (!content) {
			return;
		}
		const next = nextDensity(measure.density, isOverflowing(content));
		if (next !== measure.density) {
			setMeasure((previous) => ({ ...previous, density: next }));
		}
	}, [measure]);

	// New content (e.g. a longer label): measure again from the least dense level.
	const firstRender = useRef(true);
	useLayoutEffect(() => {
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		setMeasure(restart);
	}, [contentKey]);

	// The window was resized: measure again from the least dense level.
	useEffect(() => {
		const container = containerRef.current;
		if (!container || typeof ResizeObserver === 'undefined') {
			return;
		}
		let lastWidth = container.clientWidth;
		const observer = new ResizeObserver(() => {
			const width = container.clientWidth;
			if (width !== lastWidth) {
				lastWidth = width;
				flushSync(() => setMeasure(restart));
			}
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	return { containerRef, contentRef, density: measure.density };
}
