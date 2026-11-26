// Helpers of the categories / forbidden-rules specs (e2e/categories) and of the board scale journey: locators of the
// prompt board (its toolbar, cards, card headers, sub-prompt rows) and of the Used sub-prompts endpoints by their
// accessible names, the checks of the semantic state colors the real browser computes against THE color table
// (src/ui/stateColors.ts), the persisted categories / rules / board, and synthetic categories for scale tests.
import type { Locator, Page } from '@playwright/test';
import type { BoardPersistedState } from '../../src/domain/board';
import type { Category } from '../../src/domain/categories';
import type { ForbiddenRule } from '../../src/domain/forbiddenRules';
import { STATE_COLORS, type VisualState } from '../../src/ui/stateColors';
import type { AppDriver } from '../support/app';
import { savedStore, STORE_NAMES, type E2EBackend } from '../support/backend';
import { computedStyle, resolveColor } from '../support/colors';
import { expect } from '../support/fixtures';

// ---------------------------------------------------------------------------
// The prompt board
// ---------------------------------------------------------------------------

/** The board's command toolbar (Add category, Collapse all, Expand all, Sort by priority). */
export function boardCommands(app: AppDriver): Locator {
	return app.createRegion('board').getByRole('toolbar', { name: 'Board commands', exact: true });
}

/** The board's search box (Ctrl+F focuses it). */
export function boardSearch(app: AppDriver): Locator {
	return app.createRegion('board').getByRole('searchbox', { name: 'Search categories', exact: true });
}

/** The board's state filter (a Fluent Dropdown: role combobox). */
export function boardStateFilter(app: AppDriver): Locator {
	return app.createRegion('board').getByRole('combobox', { name: 'Filter by state', exact: true });
}

/** The scrolling container of the card grid. */
export function boardScroller(app: AppDriver): Locator {
	return app.createRegion('board').locator('[data-board-scroll]');
}

/** Every card the board shows, in board order. */
export function boardCards(app: AppDriver): Locator {
	return app.createRegion('board').getByRole('list', { name: 'Categories', exact: true }).getByRole('article');
}

/** The category names of the shown cards, in board order. */
export async function shownCategoryNames(app: AppDriver): Promise<string[]> {
	const labels = await boardCards(app).evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label') ?? ''));
	return labels.map((label) => label.replace(/ category$/, ''));
}

/** The header of a category card (tinted by the card state; its commands and state icon). */
export function cardHeader(card: Locator): Locator {
	return card.locator(':scope > header');
}

/** The reorder handle of a card. */
export function reorderHandle(card: Locator, name: string): Locator {
	return cardHeader(card).getByRole('button', { name: `Reorder ${name}`, exact: true });
}

/** The polite live region announcing reorders. */
export function boardAnnouncer(app: AppDriver): Locator {
	return app.createRegion('board').locator('[role="status"][aria-live="polite"]');
}

/** The list item of a sub-prompt in a category card (by its exact text). */
export function subPromptItem(card: Locator, text: string): Locator {
	return card.getByRole('listitem').filter({ has: card.page().getByRole('button', { name: `Sub-prompt: ${text}`, exact: true }) });
}

/** The row element of a sub-prompt (it carries data-visual-state and the state surface). */
export function subPromptRow(card: Locator, text: string): Locator {
	return subPromptItem(card, text).locator(':scope > div');
}

/** The text button of a sub-prompt (its color is the row's text color). */
export function subPromptText(card: Locator, text: string): Locator {
	return card.getByRole('button', { name: `Sub-prompt: ${text}`, exact: true });
}

// ---------------------------------------------------------------------------
// The Used sub-prompts list (viewer tab) and its association endpoints
// ---------------------------------------------------------------------------

/** The hint / source status of the Used sub-prompts list. */
export function usedStatus(app: AppDriver): Locator {
	return app
		.createRegion('viewer')
		.getByRole('status')
		.filter({ hasText: /Pick P, C, or a tag|Source selected/ });
}

/** A row of the Used sub-prompts list (call app.showViewerTab('Used sub-prompts') first). */
export function usedRow(app: AppDriver, categoryName: string, promptText: string): Locator {
	return app.usedSubPrompts().getByRole('listitem', { name: `${categoryName}: ${promptText}`, exact: true });
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

// ---------------------------------------------------------------------------
// State colors
// ---------------------------------------------------------------------------

/** Every element of `locator` has data-visual-state = state (null: no attribute). */
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

/** The browser-computed frame (border of the card) and header tint of a card are the state's tokens. */
export async function expectFrameColors(page: Page, card: Locator, state: VisualState): Promise<void> {
	const colors = STATE_COLORS[state];
	const expected = { frame: await resolveColor(page, colors.border), style: colors.borderStyle, header: await resolveColor(page, colors.background) };
	await expect
		.poll(
			async () => ({
				frame: await computedStyle(card, 'border-top-color'),
				style: await computedStyle(card, 'border-top-style'),
				header: await computedStyle(cardHeader(card), 'background-color'),
			}),
			{ message: `${state} card: frame color, frame style, header tint` },
		)
		.toEqual(expected);
}

// ---------------------------------------------------------------------------
// Persisted stores (what the backend saved: the categories, the forbidden rules and the board survive a reload).
// Wait for the app's save (call before the action, await after), then read the backend.
// ---------------------------------------------------------------------------

/** savedStore for the categories store. */
export function categoriesWritten(page: Page, predicate: (categories: Category[]) => boolean): Promise<{ categories: Category[] }> {
	return savedStore<{ categories: Category[] }>(page, STORE_NAMES.categories, (state) => predicate(state.categories));
}

/** savedStore for the forbidden rules store. */
export function rulesWritten(page: Page, predicate: (rules: string[]) => boolean): Promise<{ rules: ForbiddenRule[] }> {
	return savedStore<{ rules: ForbiddenRule[] }>(page, STORE_NAMES.forbiddenRules, (state) => predicate(state.rules.map(describeRule)));
}

/** savedStore for the board store (card order, collapsed cards). */
export function boardWritten(page: Page, predicate: (board: BoardPersistedState) => boolean): Promise<BoardPersistedState> {
	return savedStore<BoardPersistedState>(page, STORE_NAMES.board, predicate);
}

/** The categories the backend has persisted (categorie-store). */
export async function storedCategories(backend: E2EBackend): Promise<Category[]> {
	return (await backend.storedState<{ categories: Category[] }>(STORE_NAMES.categories)).categories;
}

/** The forbidden rules the backend has persisted (forbidden-associations-store). */
export async function storedRules(backend: E2EBackend): Promise<ForbiddenRule[]> {
	return (await backend.storedState<{ rules: ForbiddenRule[] }>(STORE_NAMES.forbiddenRules)).rules;
}

/** The board the backend has persisted (board-store). */
export async function storedBoard(backend: E2EBackend): Promise<BoardPersistedState> {
	return backend.storedState<BoardPersistedState>(STORE_NAMES.board);
}

/** A rule as 'category:prompt|kind:text' pairs, sorted, for readable assertions. */
export function describeRule(rule: ForbiddenRule): string {
	const side = (matcher: ForbiddenRule['left']) =>
		`${matcher.kind}:${matcher.category_name ?? '*'}:${matcher.prompt_text ?? matcher.contains_text ?? matcher.tag_text ?? '*'}`;
	return [side(rule.left), side(rule.right)].sort().join(' x ');
}

// ---------------------------------------------------------------------------
// Synthetic categories for scale tests (never user data)
// ---------------------------------------------------------------------------

const SCALE_TOPICS = [
	'Subject', 'Hair', 'Eyes', 'Expression', 'Pose', 'Outfit', 'Shoes', 'Accessory', 'Headwear', 'Background', 'Location',
	'Time of day', 'Weather', 'Season', 'Lighting', 'Camera angle', 'Lens', 'Composition', 'Style', 'Medium', 'Palette',
	'Mood', 'Effects', 'Props', 'Animal', 'Vehicle', 'Architecture', 'Nature', 'Food', 'Music', 'Sport', 'Fantasy',
	'Science fiction', 'History', 'Texture', 'Pattern', 'Frame', 'Depth', 'Motion', 'Quality', 'Detail', 'Finish',
	'Signature', 'Border', 'Filter', 'Grain', 'Contrast', 'Saturation',
];

/** `count` synthetic categories (at most SCALE_TOPICS.length), priorities 1..count, two to five sub-prompts each; every
 *  seventh is skipped, every fifth has one locked sub-prompt. */
export function scaleCategories(count: number): Category[] {
	if (count > SCALE_TOPICS.length) {
		throw new Error(`at most ${SCALE_TOPICS.length} synthetic categories`);
	}
	return SCALE_TOPICS.slice(0, count).map((topic, index) => ({
		text: topic,
		activation_text: '',
		priority: index + 1,
		state: index % 7 === 6 ? 'skip' : 'normal',
		subPrompts: Array.from({ length: 2 + (index % 4) }, (_, prompt) => ({
			text: `${topic.toLowerCase()} option ${prompt + 1}`,
			state: index % 5 === 4 && prompt === 0 ? 'lock' : 'normal',
			extraLoraIds: [],
		})),
	}));
}
