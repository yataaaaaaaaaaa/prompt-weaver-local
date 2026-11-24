// Workspace window layout domain: types, window keys and the pure layout algorithms (rect sanitizing,
// z-order, grid arrangement, legacy panel-layouts/z-index migration). The workspace store
// (src/stores/workspaceStore.ts) is the only state holder; everything here is pure.
import { clamp, finiteNumberOr, isFiniteNumber, recordOr } from './guards';

export type Size = { width: number; height: number };
export type Rect = { x: number; y: number } & Size;

/** Every floating window of the workspace: registered panes and category cards share one z-order. */
export type WindowKey = `pane:${string}` | `category:${string}`;
export type WindowLayout = Rect & { z: number };
export type WindowLayouts = Partial<Record<WindowKey, WindowLayout>>;

export type Viewport = Size;

export type ArrangeItem = {
	key: WindowKey;
	/** Preferred size estimated from the content. The workspace store uses the window's current
	 *  (stored) size instead when it has one, like the legacy reorganize did. */
	preferred: Size;
};

export function paneWindowKey(paneId: string): WindowKey {
	return `pane:${paneId}`;
}

export function categoryWindowKey(categoryKey: string): WindowKey {
	return `category:${categoryKey}`;
}

// ---------------------------------------------------------------------------
// Rects
// ---------------------------------------------------------------------------

/** A window can never be dragged above/left of this offset (it would be unreachable). */
export const MIN_VISIBLE_WINDOW_OFFSET = 8;

/** Used when neither the rect nor the caller provides a usable value (legacy DefaultPanelLayout). */
export const DEFAULT_WINDOW_RECT: Rect = { x: MIN_VISIBLE_WINDOW_OFFSET, y: MIN_VISIBLE_WINDOW_OFFSET, width: 320, height: 240 };

/** Windows without a stored layout are drawn at this z. */
export const BASE_WINDOW_Z = 1;

function clampOffset(value: unknown, fallback: number): number {
	return Math.max(MIN_VISIBLE_WINDOW_OFFSET, finiteNumberOr(value, fallback));
}

function clampSize(value: unknown, fallback: number): number {
	return Math.max(1, finiteNumberOr(value, fallback));
}

/** x,y >= 8 and width,height >= 1; non-finite values are taken from `fallback`. */
export function sanitizeRect(rect: Partial<Rect>, fallback: Rect = DEFAULT_WINDOW_RECT): Rect {
	return {
		x: clampOffset(rect.x, fallback.x),
		y: clampOffset(rect.y, fallback.y),
		width: clampSize(rect.width, fallback.width),
		height: clampSize(rect.height, fallback.height),
	};
}

/** The rect moved by (deltaX, deltaY), kept reachable (x,y >= MIN_VISIBLE_WINDOW_OFFSET). */
export function moveRect(rect: Rect, deltaX: number, deltaY: number): Rect {
	return sanitizeRect({ ...rect, x: rect.x + deltaX, y: rect.y + deltaY });
}

/** The rect resized from its bottom-right corner by (deltaX, deltaY), never below `minSize`. */
export function resizeRect(rect: Rect, deltaX: number, deltaY: number, minSize: Size): Rect {
	return {
		...rect,
		width: Math.max(minSize.width, rect.width + deltaX),
		height: Math.max(minSize.height, rect.height + deltaY),
	};
}

/** Every coordinate is a finite number (persisted or imported data may contain anything). */
export function isCompleteRect(value: unknown): value is Rect {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const rect = value as Partial<Rect>;
	return isFiniteNumber(rect.x) && isFiniteNumber(rect.y) && isFiniteNumber(rect.width) && isFiniteNumber(rect.height);
}

/** Sanitized layout of a window (z defaults to BASE_WINDOW_Z when invalid). */
export function sanitizeWindowLayout(layout: Partial<WindowLayout>, fallback: Rect = DEFAULT_WINDOW_RECT): WindowLayout {
	return { ...sanitizeRect(layout, fallback), z: finiteNumberOr(layout.z, BASE_WINDOW_Z) };
}

/** Keeps the entries whose rect is complete, sanitized; drops the others. */
export function sanitizeWindowLayouts(windows: WindowLayouts): WindowLayouts {
	const result: WindowLayouts = {};
	for (const [key, layout] of Object.entries(windows) as [WindowKey, WindowLayout | undefined][]) {
		if (isCompleteRect(layout)) {
			result[key] = sanitizeWindowLayout(layout);
		}
	}
	return result;
}

// ---------------------------------------------------------------------------
// Z-order
// ---------------------------------------------------------------------------

function storedZValues(windows: WindowLayouts, except?: WindowKey): number[] {
	const values: number[] = [];
	for (const [key, layout] of Object.entries(windows) as [WindowKey, WindowLayout | undefined][]) {
		if (key !== except && layout && isFiniteNumber(layout.z)) {
			values.push(layout.z);
		}
	}
	return values;
}

/** Highest z of the workspace (windows without a stored layout count as BASE_WINDOW_Z). */
export function maxWindowZ(windows: WindowLayouts): number {
	return Math.max(BASE_WINDOW_Z, ...storedZValues(windows));
}

/** z that brings `key` to the front, or null when it already is the single top-most window. */
export function frontZ(windows: WindowLayouts, key: WindowKey): number | null {
	const current = windows[key]?.z;
	const othersMax = Math.max(BASE_WINDOW_Z, ...storedZValues(windows, key));
	if (isFiniteNumber(current) && current > othersMax) {
		return null;
	}
	return maxWindowZ(windows) + 1;
}

/** z that sends `key` behind every other window (legacy lowerPane: min - 1), or null when it already is
 *  behind all of them. Windows without a stored layout count as BASE_WINDOW_Z. */
export function backZ(windows: WindowLayouts, key: WindowKey): number | null {
	const stored = windows[key]?.z;
	const current = isFiniteNumber(stored) ? stored : BASE_WINDOW_Z;
	const othersMin = Math.min(BASE_WINDOW_Z, ...storedZValues(windows, key));
	return current < othersMin ? null : othersMin - 1;
}

// ---------------------------------------------------------------------------
// Grid arrangement ("Reorganize categories")
// ---------------------------------------------------------------------------

export const ARRANGE_MARGIN = 24;
export const ARRANGE_GAP = 16;
export const ARRANGE_MIN_WIDTH = 300;
export const ARRANGE_MIN_HEIGHT = 168;
/** Row height cap, as a fraction of the viewport height. */
export const ARRANGE_MAX_ROW_HEIGHT_RATIO = 0.3;

type ArrangedPanel = { key: WindowKey; width: number; preferredHeight: number };

/**
 * Rows left-to-right inside the viewport (margin 24, gap 16), widths clamped to [300, available width],
 * row height = min(30% of the viewport height (>= 168), tallest preferred height of the row), each
 * window stacked above `baseZ` in item order. Port of the legacy applyReorganizedCategoryLayouts.
 */
export function arrangeGrid(items: readonly ArrangeItem[], viewport: Viewport, baseZ: number): WindowLayouts {
	const availableWidth = Math.max(360, viewport.width - ARRANGE_MARGIN * 2);
	const maxRowHeight = Math.max(ARRANGE_MIN_HEIGHT, Math.floor(viewport.height * ARRANGE_MAX_ROW_HEIGHT_RATIO));

	const panels: ArrangedPanel[] = items.map((item) => ({
		key: item.key,
		width: clamp(finiteNumberOr(item.preferred.width, ARRANGE_MIN_WIDTH), ARRANGE_MIN_WIDTH, availableWidth),
		preferredHeight: clamp(finiteNumberOr(item.preferred.height, ARRANGE_MIN_HEIGHT), ARRANGE_MIN_HEIGHT, maxRowHeight),
	}));

	const rows: ArrangedPanel[][] = [];
	let currentRow: ArrangedPanel[] = [];
	let currentRowWidth = 0;
	for (const panel of panels) {
		const nextRowWidth = currentRow.length === 0 ? panel.width : currentRowWidth + ARRANGE_GAP + panel.width;
		if (currentRow.length > 0 && nextRowWidth > availableWidth) {
			rows.push(currentRow);
			currentRow = [panel];
			currentRowWidth = panel.width;
			continue;
		}
		currentRow.push(panel);
		currentRowWidth = nextRowWidth;
	}
	if (currentRow.length > 0) {
		rows.push(currentRow);
	}

	const result: WindowLayouts = {};
	let cursorY = ARRANGE_MARGIN;
	let index = 0;
	for (const row of rows) {
		const rowHeight = Math.min(maxRowHeight, Math.max(...row.map((panel) => panel.preferredHeight)));
		let cursorX = ARRANGE_MARGIN;
		for (const panel of row) {
			index += 1;
			result[panel.key] = { x: cursorX, y: cursorY, width: panel.width, height: rowHeight, z: baseZ + index };
			cursorX += panel.width + ARRANGE_GAP;
		}
		cursorY += rowHeight + ARRANGE_GAP;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Legacy migration: 'panel-layouts-store' + 'workspace-z-index-store' -> 'workspace-store'
// ---------------------------------------------------------------------------

/** zustand persist envelope as read from the store backend. */
export type LegacyEnvelope = { state: Record<string, unknown>; version?: number } | null | undefined;

export type WorkspacePersistedState = {
	windows: WindowLayouts;
	hiddenPaneIds: string[];
};

const LEGACY_PANE_PREFIX = 'pane-';

function zOf(source: Record<string, unknown>, id: string): number {
	return finiteNumberOr(source[id], BASE_WINDOW_Z);
}

/**
 * Legacy 'panel-layouts-store' state {panels: {'pane-image': rect, '<categoryKey>': rect}} and
 * 'workspace-z-index-store' state {maxZ, paneZ: {image: n}, categoryZ: {<categoryKey>: n}} ->
 * 'workspace-store' envelope (windows 'pane:<id>' / 'category:<key>', z defaulting to 1).
 * Unknown pane ids (e.g. 'details') are kept; entries with non-finite coordinates are dropped.
 * Returns null when neither legacy store exists.
 */
export function migrateLegacyWorkspace(
	panelLayouts: LegacyEnvelope,
	zIndex: LegacyEnvelope,
): { state: WorkspacePersistedState; version: 0 } | null {
	if (!panelLayouts && !zIndex) {
		return null;
	}
	const panels = recordOr(panelLayouts?.state.panels);
	const zState = recordOr(zIndex?.state);
	const paneZ = recordOr(zState.paneZ);
	const categoryZ = recordOr(zState.categoryZ);

	const windows: WindowLayouts = {};
	for (const [id, rect] of Object.entries(panels)) {
		if (!isCompleteRect(rect)) {
			continue;
		}
		const paneId = id.startsWith(LEGACY_PANE_PREFIX) ? id.slice(LEGACY_PANE_PREFIX.length) : null;
		// Legacy panes and categories shared one key space: a category whose key starts with 'pane-'
		// is recognised by its z entry.
		const isPane = paneId !== null && !(id in categoryZ && !(paneId in paneZ));
		if (isPane) {
			windows[paneWindowKey(paneId)] = { ...sanitizeRect(rect), z: zOf(paneZ, paneId) };
		} else {
			windows[categoryWindowKey(id)] = { ...sanitizeRect(rect), z: zOf(categoryZ, id) };
		}
	}
	return { state: { windows, hiddenPaneIds: [] }, version: 0 };
}
