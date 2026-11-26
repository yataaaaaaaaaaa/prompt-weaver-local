// Scrolling inside the prompt board without ever scrolling the page or another region: the board's card grid and each
// card's sub-prompt list scroll themselves (Element.scrollIntoView would also scroll every scrollable ancestor). Pure
// DOM helpers shared by the board (reveal, keyboard reorder, drag auto-scroll) and the sub-prompt lists.

/** Marks the scrolling container of the prompt board's card grid. */
export const BOARD_SCROLL_ATTRIBUTE = 'data-board-scroll';

/** Offset of `element` from the top of `container`'s content (the container must be positioned: offsetTop chains
 *  stop at it). */
function offsetTopWithin(container: HTMLElement, element: HTMLElement): number {
	let offset = 0;
	let current: HTMLElement | null = element;
	while (current && current !== container) {
		offset += current.offsetTop;
		current = current.offsetParent instanceof HTMLElement ? current.offsetParent : null;
	}
	return offset;
}

/** Minimal scroll of the positioned `container` so that `element` is fully visible (its top when it is taller than
 *  the container). Never scrolls anything else. */
export function scrollIntoContainer(container: HTMLElement, element: HTMLElement): void {
	const top = offsetTopWithin(container, element);
	const bottom = top + element.offsetHeight;
	if (top < container.scrollTop || element.offsetHeight > container.clientHeight) {
		container.scrollTop = top;
	} else if (bottom > container.scrollTop + container.clientHeight) {
		container.scrollTop = Math.max(0, bottom - container.clientHeight);
	}
}

/** The board's scrolling container holding `element`, if any. */
export function boardScrollerOf(element: Element): HTMLElement | null {
	return element.closest<HTMLElement>(`[${BOARD_SCROLL_ATTRIBUTE}]`);
}
