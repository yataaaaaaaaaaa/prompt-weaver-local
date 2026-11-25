// Helpers of the categories / forbidden-rules specs (e2e/categories): locators of category windows, sub-prompt rows
// and Used sub-prompts endpoints by their accessible names, and the checks of the semantic state colors the real
// browser computes against THE color table (src/ui/stateColors.ts).
import type { Locator, Page } from '@playwright/test';
import type { Category } from '../../src/domain/categories';
import type { ForbiddenRule } from '../../src/domain/forbiddenRules';
import { STATE_COLORS, type VisualState } from '../../src/ui/stateColors';
import type { AppDriver } from '../support/app';
import { savedStore, STORE_NAMES, type E2EBackend } from '../support/backend';
import { computedStyle, resolveColor } from '../support/colors';
import { expect } from '../support/fixtures';

/** The list item of a sub-prompt in a category window (by its exact text). */
export function subPromptItem(window: Locator, text: string): Locator {
	return window
		.getByRole('listitem')
		.filter({ has: window.page().getByRole('button', { name: `Sub-prompt: ${text}`, exact: true }) });
}

/** The row element of a sub-prompt (it carries data-visual-state and the state surface). */
export function subPromptRow(window: Locator, text: string): Locator {
	return subPromptItem(window, text).locator(':scope > div');
}

/** The text button of a sub-prompt (its color is the row's text color). */
export function subPromptText(window: Locator, text: string): Locator {
	return window.getByRole('button', { name: `Sub-prompt: ${text}`, exact: true });
}

/** The header of a workspace window (FloatingPane: tinted by the frame state). */
export function windowHeader(window: Locator): Locator {
	return window.locator(':scope > header');
}

/** A row of the Used sub-prompts pane. */
export function usedRow(app: AppDriver, categoryName: string, promptText: string): Locator {
	return app.pane('Used sub-prompts').getByRole('listitem', { name: `${categoryName}: ${promptText}`, exact: true });
}

export function promptButton(row: Locator): Locator {
	return row.getByRole('button', { name: 'P: sub-prompt association' });
}

export function categoryButton(row: Locator): Locator {
	return row.getByRole('button', { name: 'C: category association' });
}

export function tagButton(row: Locator, tag: string): Locator {
	return row.getByRole('group', { name: 'Tags' }).getByRole('button', { name: tag, exact: true });
}

/** Every element of `locators` has data-visual-state = state (null: no attribute). */
export async function expectVisualState(locator: Locator, state: VisualState | null): Promise<void> {
	if (state === null) {
		await expect(locator).not.toHaveAttribute('data-visual-state');
	} else {
		await expect(locator).toHaveAttribute('data-visual-state', state);
	}
}

// Colors are polled: Fluent controls animate color changes (a read right after a click can see a transition).

/** The browser-computed border (top side) and background of a row / chip are the state's tokens. */
export async function expectSurfaceColors(page: Page, element: Locator, state: VisualState): Promise<void> {
	const colors = STATE_COLORS[state];
	const expected = { border: await resolveColor(page, colors.border), style: colors.borderStyle, background: await resolveColor(page, colors.background) };
	await expect
		.poll(
			async () => ({
				border: await computedStyle(element, 'border-top-color'),
				style: await computedStyle(element, 'border-top-style'),
				background: await computedStyle(element, 'background-color'),
			}),
			{ message: `${state} surface: border color, border style, background` },
		)
		.toEqual(expected);
}

/** The browser-computed frame (border of the window) and header tint of a window are the state's tokens. */
export async function expectFrameColors(page: Page, window: Locator, state: VisualState): Promise<void> {
	const colors = STATE_COLORS[state];
	const expected = { frame: await resolveColor(page, colors.border), style: colors.borderStyle, header: await resolveColor(page, colors.background) };
	await expect
		.poll(
			async () => ({
				frame: await computedStyle(window, 'border-top-color'),
				style: await computedStyle(window, 'border-top-style'),
				header: await computedStyle(windowHeader(window), 'background-color'),
			}),
			{ message: `${state} window: frame color, frame style, header tint` },
		)
		.toEqual(expected);
}

// ---------------------------------------------------------------------------
// Persisted stores (what the backend saved: the categories and the forbidden rules survive a reload). Wait for the
// app's save (call before the action, await after), then read the backend.
// ---------------------------------------------------------------------------

/** savedStore for the categories store. */
export function categoriesWritten(page: Page, predicate: (categories: Category[]) => boolean): Promise<{ categories: Category[] }> {
	return savedStore<{ categories: Category[] }>(page, STORE_NAMES.categories, (state) => predicate(state.categories));
}

/** savedStore for the forbidden rules store. */
export function rulesWritten(page: Page, predicate: (rules: string[]) => boolean): Promise<{ rules: ForbiddenRule[] }> {
	return savedStore<{ rules: ForbiddenRule[] }>(page, STORE_NAMES.forbiddenRules, (state) => predicate(state.rules.map(describeRule)));
}

/** The categories the backend has persisted (categorie-store). */
export async function storedCategories(backend: E2EBackend): Promise<Category[]> {
	return (await backend.storedState<{ categories: Category[] }>(STORE_NAMES.categories)).categories;
}

/** The forbidden rules the backend has persisted (forbidden-associations-store). */
export async function storedRules(backend: E2EBackend): Promise<ForbiddenRule[]> {
	return (await backend.storedState<{ rules: ForbiddenRule[] }>(STORE_NAMES.forbiddenRules)).rules;
}

/** A rule as 'category:prompt|kind:text' pairs, sorted, for readable assertions. */
export function describeRule(rule: ForbiddenRule): string {
	const side = (matcher: ForbiddenRule['left']) =>
		`${matcher.kind}:${matcher.category_name ?? '*'}:${matcher.prompt_text ?? matcher.contains_text ?? matcher.tag_text ?? '*'}`;
	return [side(rule.left), side(rule.right)].sort().join(' x ');
}
