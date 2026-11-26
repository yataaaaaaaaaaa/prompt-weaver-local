// Infinite scroll for any paged list: returns a callback ref for a sentinel element placed after the list; when the
// sentinel comes within rootMargin of the visible area of its scroll container (the nearest scrollable ancestor,
// e.g. a section's results region; else the viewport) onReach is called. Pure view helper: the paging itself (cursor, requests,
// "already loading" guards) stays in the owning store. No-op where IntersectionObserver does not exist.
import { useEffect, useRef, useState } from 'react';

/** Loading starts this far before the sentinel scrolls into view. */
export const INFINITE_SCROLL_ROOT_MARGIN = '0px 0px 320px 0px';

export type InfiniteScrollOptions = {
	/** Called when the sentinel is reached (and again each time it re-enters the visible area). */
	onReach: () => void;
	/** False: reaching the sentinel is ignored (no further page, or a page is loading). */
	enabled: boolean;
	/** Re-checks a sentinel that stays in view when this value changes. Pass the item list: after a page is
	 *  appended the next one loads while the end of the list is still visible, whereas an unchanged list (a failed
	 *  load) is not retried in a loop. */
	resetKey?: unknown;
	/** IntersectionObserver rootMargin (around the scroll container). */
	rootMargin?: string;
};

const SCROLLABLE_OVERFLOW = /(auto|scroll|overlay)/;

/** Nearest ancestor that scrolls vertically (null: the viewport). */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		if (SCROLLABLE_OVERFLOW.test(getComputedStyle(node).overflowY)) {
			return node;
		}
	}
	return null;
}

export function useInfiniteScroll({
	onReach,
	enabled,
	resetKey,
	rootMargin = INFINITE_SCROLL_ROOT_MARGIN,
}: InfiniteScrollOptions): (element: HTMLElement | null) => void {
	const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
	// Latest callback and flag, read when an intersection is reported (the observer is not re-created for them).
	const latestRef = useRef({ onReach, enabled });
	latestRef.current = { onReach, enabled };

	useEffect(() => {
		if (!sentinel || typeof IntersectionObserver === 'undefined') {
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				const latest = latestRef.current;
				if (latest.enabled && entries[entries.length - 1]?.isIntersecting) {
					latest.onReach();
				}
			},
			{ root: scrollParentOf(sentinel), rootMargin },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [sentinel, rootMargin, resetKey]);

	return setSentinel;
}
