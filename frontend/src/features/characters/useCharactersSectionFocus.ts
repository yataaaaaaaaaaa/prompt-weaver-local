// Keyboard focus of the docked Characters section (purely view behavior, no domain state):
// - when the editor opens (characters store editor.session: also when it replaces an open editor), the element that
//   had the focus (the opener: New character, Edit, a 'Create character' button of another section) is remembered and
//   the editor's name field takes the focus, as soon as the section is shown;
// - when it closes with the focus lost (the focused Save / Cancel was removed: the focus is on the body), the focus
//   returns to the opener when it is on screen again (in the Characters section, or in the section Cancel went back
//   to); otherwise to the fallback: the primary action of the selected character's details (after saving a new
//   character), else New character;
// - when a character is deleted with the focus lost (its focused Delete button went with its card or its details),
//   the focus goes to the fallback too.
// A focus the user moved elsewhere meanwhile is left alone. The targets carry CHARACTER_FOCUS_ATTRIBUTE
// (focusTarget()); the hook works inside the section's root element.
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useCharactersStore } from '../../stores/charactersStore';
import { useIsSectionShown } from '../../stores/navigationStore';

/** Attribute marking the elements the Characters section moves the focus to. */
export const CHARACTER_FOCUS_ATTRIBUTE = 'data-character-focus';

/** 'name': the editor's name field (focused when the editor opens); 'details': the primary action of the selected
 *  character's details and 'new': New character (the fallbacks when what had the focus is gone). */
export type CharacterFocusTarget = 'name' | 'details' | 'new';

/** Props marking an element as a focus target of the Characters section. */
export function focusTarget(target: CharacterFocusTarget): Record<string, string> {
	return { [CHARACTER_FOCUS_ATTRIBUTE]: target };
}

/** The element can take the focus now: in the document, not inside a hidden ancestor (a hidden section or detail
 *  view) and not disabled. */
function canFocus(element: HTMLElement | null): element is HTMLElement {
	return (
		element !== null &&
		element.isConnected &&
		element.closest('[hidden]') === null &&
		!(element as HTMLButtonElement).disabled
	);
}

function find(root: HTMLElement, target: CharacterFocusTarget): HTMLElement | null {
	return root.querySelector<HTMLElement>(`[${CHARACTER_FOCUS_ATTRIBUTE}="${target}"]`);
}

/** The focused element, null when the focus is lost (on the body). */
function focusedElement(): HTMLElement | null {
	const active = document.activeElement;
	return active instanceof HTMLElement && active !== document.body ? active : null;
}

/** Focuses the details' primary action, else New character, when the section is on screen. */
function focusFallback(container: HTMLElement): void {
	if (container.closest('[hidden]') === null) {
		[find(container, 'details'), find(container, 'new')].find(canFocus)?.focus();
	}
}

export function useCharactersSectionFocus(root: RefObject<HTMLElement | null>): void {
	const session = useCharactersStore((state) => state.editor?.session ?? null);
	const count = useCharactersStore((state) => state.characters.length);
	// Re-runs when the section is shown: an editor opened while the section was hidden takes the focus then.
	const shown = useIsSectionShown('characters');
	// null at mount: an editor already open when the section mounts (its first visit) counts as just opened.
	const previousSession = useRef<number | null>(null);
	const previousCount = useRef(count);
	const opener = useRef<HTMLElement | null>(null);
	const nameFocusPending = useRef(false);

	useLayoutEffect(() => {
		const container = root.current;
		const before = previousSession.current;
		const removed = count < previousCount.current;
		previousSession.current = session;
		previousCount.current = count;
		if (!container) {
			return;
		}
		if (session !== before) {
			if (session !== null) {
				// Opened, or replaced from outside the editor (whose removal lost the focus otherwise).
				opener.current = focusedElement() ?? opener.current;
				nameFocusPending.current = true;
			} else {
				nameFocusPending.current = false;
				const returnTo = opener.current;
				opener.current = null;
				if (focusedElement() === null) {
					if (canFocus(returnTo)) {
						returnTo.focus();
					} else {
						focusFallback(container);
					}
				}
			}
		} else if (removed && focusedElement() === null) {
			focusFallback(container);
		}
		if (nameFocusPending.current) {
			const name = find(container, 'name');
			if (canFocus(name)) {
				nameFocusPending.current = false;
				name.focus();
			}
		}
	}, [root, session, count, shown]);
}
