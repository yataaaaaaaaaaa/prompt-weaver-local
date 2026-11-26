// DOM focus moves of the shell's keyboard requests (navigationStore: regionCycle, searchFocus, sectionFocus): the F6
// regions the user can see (F6_REGION_ATTRIBUTE, in DOM order: the rail, then the shown section's regions), the next
// or previous one around the focus (wrapping), the first region of a section, and a section's search box
// (SECTION_SEARCH_ATTRIBUTE). View-side helpers only: which request was made is store state.
import { F6_REGION_ATTRIBUTE, SECTION_SEARCH_ATTRIBUTE } from '../app/sections';

const REGION_SELECTOR = `[${F6_REGION_ATTRIBUTE}]`;
/** Inside one of these, nothing is on screen (an inactive section, the hidden content of a collapsed region). */
const HIDDEN_SELECTOR = '[hidden], [inert], [aria-hidden="true"]';
/** F6 never leaves a modal dialog (Fluent traps the focus there). */
const MODAL_SELECTOR = '[aria-modal="true"]';
const TEXT_FIELD_SELECTOR = 'input, textarea';

function isShown(element: Element): boolean {
	return element.closest(HIDDEN_SELECTOR) === null;
}

/** The F6 regions on screen inside `root`, in DOM order. */
export function shownRegions(root: ParentNode): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(REGION_SELECTOR)).filter(isShown);
}

/** The region after (1) or before (-1) the innermost region holding `active`, wrapping around. When the focus is in
 *  no region (e.g. a splitter between two regions, or nowhere), the region after / before it in DOM order. Null
 *  without any region. */
export function adjacentRegion(regions: readonly HTMLElement[], active: Element | null, direction: 1 | -1): HTMLElement | null {
	if (regions.length === 0) {
		return null;
	}
	let current = -1;
	regions.forEach((region, index) => {
		// Later regions in DOM order are nested deeper: the last match is the innermost.
		if (active && region.contains(active)) {
			current = index;
		}
	});
	if (current === -1) {
		// Index of the first region after `active` in DOM order (regions inside it, e.g. the body, count as after).
		const next = active ? regions.findIndex((region) => (active.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) : 0;
		const after = next === -1 ? regions.length : next;
		const index = direction === 1 ? after % regions.length : (after - 1 + regions.length) % regions.length;
		return regions[index];
	}
	return regions[(current + direction + regions.length) % regions.length];
}

/** F6 / Shift+F6: focuses the next / previous region on screen. Returns the focused region (null: nothing moved, e.g.
 *  the focus is in a modal dialog). */
export function cycleRegionFocus(root: ParentNode, active: Element | null, direction: 1 | -1): HTMLElement | null {
	if (active?.closest(MODAL_SELECTOR)) {
		return null;
	}
	const target = adjacentRegion(shownRegions(root), active, direction);
	target?.focus();
	return target;
}

/** Focuses the first region on screen inside a section (a section shown from the keyboard). */
export function focusFirstRegion(section: ParentNode | null): HTMLElement | null {
	const target = section ? (shownRegions(section)[0] ?? null) : null;
	target?.focus();
	return target;
}

/** Ctrl+F: focuses the search box of a section and selects its text. The attribute may sit on the text field itself
 *  or on its wrapper. Returns the focused element (null: the section has no search box on screen). */
export function focusSectionSearch(section: ParentNode | null): HTMLElement | null {
	const marked = Array.from(section?.querySelectorAll<HTMLElement>(`[${SECTION_SEARCH_ATTRIBUTE}]`) ?? []).find(isShown);
	if (!marked) {
		return null;
	}
	const field = marked.matches(TEXT_FIELD_SELECTOR) ? marked : (marked.querySelector<HTMLElement>(TEXT_FIELD_SELECTOR) ?? marked);
	field.focus();
	if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
		field.select();
	}
	return field;
}
