// Component test helpers for Fluent dialogs in jsdom. jsdom has no layout, so Fluent cannot move the focus into an
// opened dialog as a browser does, and tabster then soon hides the modal (aria-hidden), which makes role queries
// flaky under load. openDialog focuses the dialog's first focusable element like the browser would; query inside
// the returned element (or currentDialog()).
import { act, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import type { renderWithProviders } from './render';

export type DialogRole = 'dialog' | 'alertdialog';

type User = ReturnType<typeof renderWithProviders>['user'];

const FOCUSABLE = 'input, textarea, select, button, [tabindex]:not([tabindex="-1"])';

/** A real control: not one of tabster's hidden focus-trap sentinels (inserted inside the modal). */
function isControl(element: HTMLElement): boolean {
	return !element.hasAttribute('data-tabster-dummy') && element.getAttribute('aria-hidden') !== 'true';
}

/** The open dialog (throws when none is open). */
export function currentDialog(role: DialogRole = 'dialog'): HTMLElement {
	const dialog = document.querySelector<HTMLElement>(`[role="${role}"]`);
	if (!dialog) {
		throw new Error(`no open ${role}`);
	}
	return dialog;
}

/** Clicks `trigger`, waits for the dialog and moves the focus into it. */
export async function openDialog(user: User, trigger: HTMLElement, role: DialogRole = 'dialog'): Promise<HTMLElement> {
	await user.click(trigger);
	const dialog = await waitFor(() => currentDialog(role));
	const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isControl) ?? dialog;
	act(() => focusable.focus());
	return dialog;
}

/** Waits until no dialog of `role` is open any more. */
export async function waitForDialogClose(role: DialogRole = 'dialog'): Promise<void> {
	await waitFor(() => expect(document.querySelector(`[role="${role}"]`)).toBeNull());
}
