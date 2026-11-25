// Helpers of the workspace shell specs (e2e/workspace): window geometry, the window chrome parts, the persisted
// workspace layout and the fixture expectations of the shell. Built on the shared support helpers.
import { expect, type Locator, type Page } from '@playwright/test';
import type { WindowLayouts } from '../../src/domain/layout';
import type { AppDriver } from '../support/app';
import { savedStore, STORE_NAMES, type E2EBackend } from '../support/backend';
import { boxOf, type Box } from '../support/visibility';

/** The registered panes as the app bar names them (src/workspace/paneRegistry.tsx titles: persisted layouts and every
 *  area's e2e specs depend on these names, so a rename must fail here). */
export const PANE_TITLES = ['Image', 'Output browser', 'Generation', 'Used sub-prompts', 'Model library', 'Image library', 'Characters'] as const;

/** Panes the fixture workspace (backend/tests/e2e/fixtures/data/stores/workspace-store) shows and hides. */
export const FIXTURE_VISIBLE_PANES = ['Image', 'Output browser', 'Generation', 'Used sub-prompts'] as const;
export const FIXTURE_HIDDEN_PANES = ['Model library', 'Image library', 'Characters'] as const;

/** The chrome of a workspace window (FloatingPane): its <header>, its content body and its <footer> (resize grip). */
export function windowParts(window: Locator): { header: Locator; body: Locator; footer: Locator } {
	return {
		header: window.locator(':scope > header'),
		body: window.locator(':scope > div'),
		footer: window.locator(':scope > footer'),
	};
}

/** The move handle and the resize grip of a window named `name`. */
export function windowHandles(window: Locator, name: string): { move: Locator; resize: Locator } {
	return {
		move: window.getByRole('button', { name: `Move ${name}`, exact: true }),
		resize: window.getByRole('button', { name: `Resize ${name}`, exact: true }),
	};
}

export type StoredWorkspace = { windows: WindowLayouts; hiddenPaneIds: string[] };

/** The persisted workspace store ('workspace-store': { windows, hiddenPaneIds }). */
export function storedWorkspace(backend: E2EBackend): Promise<StoredWorkspace> {
	return backend.storedState<StoredWorkspace>(STORE_NAMES.workspace);
}

/** savedStore() of the workspace store, waiting for a state where `accepts` holds. */
export function savedWorkspace(page: Page, accepts: (state: StoredWorkspace) => boolean): Promise<StoredWorkspace> {
	return savedStore<StoredWorkspace>(page, STORE_NAMES.workspace, accepts);
}

/** The stored rect of `key` equals `rect` (x, y, width, height; z is free). */
export function hasRect(state: StoredWorkspace, key: string, rect: Box): boolean {
	const layout = state.windows[key as keyof WindowLayouts];
	return layout !== undefined && layout.x === rect.x && layout.y === rect.y && layout.width === rect.width && layout.height === rect.height;
}

/** The window's rect as the page draws it (inline left/top/width/height, i.e. relative to the workspace surface). */
export async function drawnRect(window: Locator): Promise<Box> {
	return window.evaluate((element) => {
		const style = (element as HTMLElement).style;
		return { x: parseFloat(style.left), y: parseFloat(style.top), width: parseFloat(style.width), height: parseFloat(style.height) };
	});
}

/** The element drawn on top at the center of `target`, described by its closest window's accessible name. */
export async function windowOnTopAt(page: Page, box: Box): Promise<string | null> {
	return page.evaluate(({ x, y }) => {
		const element = document.elementFromPoint(x, y);
		return element?.closest('main[aria-label="Workspace windows"] > section')?.getAttribute('aria-label') ?? null;
	}, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** Every item of the app bar sits on one row (same vertical center) and the bar is not taller than one row of items:
 *  the bar never wraps, whatever the window width (useToolbarDensity). */
export async function expectOneRow(app: AppDriver): Promise<void> {
	const items = app.appBar().getByRole('button');
	const count = await items.count();
	expect(count, 'app bar items').toBeGreaterThan(0);
	const centers: number[] = [];
	for (let index = 0; index < count; index += 1) {
		const box = await boxOf(items.nth(index));
		centers.push(box.y + box.height / 2);
	}
	expect(Math.max(...centers) - Math.min(...centers), 'vertical spread of the app bar items').toBeLessThan(1);
	const bar = await boxOf(app.appBar());
	expect(bar.height, 'app bar height').toBeLessThan(48);
}
