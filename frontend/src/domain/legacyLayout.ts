// The floating-window workspace of older versions, read-only: its persisted shapes and the parsing of every legacy
// source of window geometry, so the docked layout can be derived from it once (src/domain/board.ts: category order
// and collapsed cards; src/domain/layout.ts: Create region widths and collapsed regions). Nothing here writes or
// renders windows any more: the app has no floating windows.
//
// Legacy sources, newest first (each is left untouched on disk):
// - 'workspace-store' version 0: { windows: { 'pane:<id>' | 'category:<key>': {x, y, width, height, z} },
//   hiddenPaneIds };
// - 'panel-layouts-store' ({ panels: { 'pane-<id>' | '<categoryKey>': rect } }) + 'workspace-z-index-store'
//   ({ maxZ, paneZ, categoryZ }), merged by migrateLegacyPanelLayouts;
// - app_state.json (categories' position/size/z_index, the image/controls/used panes): src/domain/legacyImport.ts
//   legacyWorkspaceWindows.
import { LEGACY_STORE_NAMES } from '../persistence/storeNames';
import { finiteNumberOr, isFiniteNumber, isRecord, recordOr } from './guards';

export type LegacyRect = { x: number; y: number; width: number; height: number };

/** Every floating window had one key: registered panes and category windows. */
export type LegacyWindowKey = `pane:${string}` | `category:${string}`;
export type LegacyWindowLayout = LegacyRect & { z: number };
export type LegacyWindowLayouts = Partial<Record<LegacyWindowKey, LegacyWindowLayout>>;

/** The state of the legacy 'workspace-store' (version 0). */
export type LegacyWorkspaceState = {
	windows: LegacyWindowLayouts;
	/** Panes the user had closed ('image', 'browser', 'controls', 'used', 'models', 'images', 'characters'). */
	hiddenPaneIds: string[];
};

/** zustand persist envelope as read from the store backend. */
export type LegacyEnvelope = { state: Record<string, unknown>; version?: number } | null | undefined;

/** The pane ids of the floating workspace (window key 'pane:<id>'). 'details' only exists in very old layouts. */
export const LEGACY_PANE_IDS = ['image', 'browser', 'controls', 'used', 'models', 'images', 'characters', 'details'] as const;
export type LegacyPaneId = (typeof LEGACY_PANE_IDS)[number];

export function legacyPaneWindowKey(paneId: string): LegacyWindowKey {
	return `pane:${paneId}`;
}

export function legacyCategoryWindowKey(categoryKey: string): LegacyWindowKey {
	return `category:${categoryKey}`;
}

const CATEGORY_PREFIX = 'category:';

/** The category key of a category window key, null for a pane window. */
export function categoryKeyOfLegacyWindow(key: string): string | null {
	return key.startsWith(CATEGORY_PREFIX) ? key.slice(CATEGORY_PREFIX.length) : null;
}

/** A window could never be dragged above/left of this offset. */
const MIN_OFFSET = 8;
const BASE_Z = 1;

/** Every coordinate is a finite number (persisted or imported data may contain anything). */
export function isCompleteRect(value: unknown): value is LegacyRect {
	if (!isRecord(value)) {
		return false;
	}
	return isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.width) && isFiniteNumber(value.height);
}

/** A complete rect as the floating workspace drew it: x,y >= 8, width,height >= 1, z defaulting to 1. */
export function sanitizeLegacyWindow(rect: LegacyRect & { z?: unknown }): LegacyWindowLayout {
	return {
		x: Math.max(MIN_OFFSET, rect.x),
		y: Math.max(MIN_OFFSET, rect.y),
		width: Math.max(1, rect.width),
		height: Math.max(1, rect.height),
		z: finiteNumberOr(rect.z, BASE_Z),
	};
}

/** Keeps the entries whose key is a window key and whose rect is complete, sanitized; drops the others. */
export function sanitizeLegacyWindows(value: unknown): LegacyWindowLayouts {
	const result: LegacyWindowLayouts = {};
	for (const [key, layout] of Object.entries(recordOr(value))) {
		if ((key.startsWith('pane:') || key.startsWith(CATEGORY_PREFIX)) && isCompleteRect(layout)) {
			result[key as LegacyWindowKey] = sanitizeLegacyWindow(layout as LegacyRect & { z?: unknown });
		}
	}
	return result;
}

/** A legacy 'workspace-store' state (any version-0 payload), sanitized. */
export function sanitizeLegacyWorkspace(value: unknown): LegacyWorkspaceState {
	const state = recordOr(value);
	const hidden = Array.isArray(state.hiddenPaneIds) ? state.hiddenPaneIds.filter((id): id is string => typeof id === 'string') : [];
	return { windows: sanitizeLegacyWindows(state.windows), hiddenPaneIds: [...new Set(hidden)] };
}

const LEGACY_PANE_PREFIX = 'pane-';

/**
 * Legacy 'panel-layouts-store' state {panels: {'pane-image': rect, '<categoryKey>': rect}} and
 * 'workspace-z-index-store' state {maxZ, paneZ: {image: n}, categoryZ: {<categoryKey>: n}} -> the 'workspace-store'
 * state (windows 'pane:<id>' / 'category:<key>', z defaulting to 1, nothing hidden). Unknown pane ids (e.g. 'details')
 * are kept; entries with non-finite coordinates are dropped. Null when neither legacy store exists.
 */
export function migrateLegacyPanelLayouts(panelLayouts: LegacyEnvelope, zIndex: LegacyEnvelope): LegacyWorkspaceState | null {
	if (!panelLayouts && !zIndex) {
		return null;
	}
	const panels = recordOr(panelLayouts?.state.panels);
	const zState = recordOr(zIndex?.state);
	const paneZ = recordOr(zState.paneZ);
	const categoryZ = recordOr(zState.categoryZ);

	const windows: LegacyWindowLayouts = {};
	for (const [id, rect] of Object.entries(panels)) {
		if (!isCompleteRect(rect)) {
			continue;
		}
		const paneId = id.startsWith(LEGACY_PANE_PREFIX) ? id.slice(LEGACY_PANE_PREFIX.length) : null;
		// Legacy panes and categories shared one key space: a category whose key starts with 'pane-' is recognised by
		// its z entry.
		const isPane = paneId !== null && !(id in categoryZ && !(paneId in paneZ));
		if (isPane) {
			windows[legacyPaneWindowKey(paneId)] = sanitizeLegacyWindow({ ...rect, z: paneZ[paneId] });
		} else {
			windows[legacyCategoryWindowKey(id)] = sanitizeLegacyWindow({ ...rect, z: categoryZ[id] });
		}
	}
	return { windows, hiddenPaneIds: [] };
}

/** The legacy store names a docked layout store reads when it has no data of its own (persisted store `legacy`
 *  option), newest first. */
export const LEGACY_WORKSPACE_STORE_NAMES: readonly string[] = [
	LEGACY_STORE_NAMES.workspace,
	LEGACY_STORE_NAMES.panelLayouts,
	LEGACY_STORE_NAMES.workspaceZIndex,
];

/** The newest legacy workspace among the envelopes read by a persisted store's `legacy` option: 'workspace-store'
 *  when present, else the panel-layouts + z-index pair; null when there is none. */
export function legacyWorkspaceFromEnvelopes(envelopes: Readonly<Record<string, LegacyEnvelope>>): LegacyWorkspaceState | null {
	const workspace = envelopes[LEGACY_STORE_NAMES.workspace];
	if (workspace) {
		return sanitizeLegacyWorkspace(workspace.state);
	}
	return migrateLegacyPanelLayouts(envelopes[LEGACY_STORE_NAMES.panelLayouts], envelopes[LEGACY_STORE_NAMES.workspaceZIndex]);
}
