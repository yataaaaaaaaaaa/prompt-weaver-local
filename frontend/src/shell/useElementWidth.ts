// The measured width of an element (ResizeObserver), as ephemeral view state: null until it has been measured, and
// widths of 0 (the element is hidden, e.g. its section is not shown) are skipped, so the last real width is kept.
import { useLayoutEffect, useState, type RefObject } from 'react';

export function useElementWidth(ref: RefObject<HTMLElement>): number | null {
	const [width, setWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) {
			return undefined;
		}
		const update = (value: number) => {
			if (value > 0) {
				setWidth(value);
			}
		};
		// Before the first paint: the first frame already has the fitted layout.
		update(element.getBoundingClientRect().width);
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				update(entry.contentRect.width);
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}
