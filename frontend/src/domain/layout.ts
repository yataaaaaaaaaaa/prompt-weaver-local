// Docked layout of the Create section (regions and ids: src/app/sections.ts): the stored region widths, the collapsed
// regions, the output details panel of the viewer, and the pure algorithms on them: fitting the regions into the
// available width (fitRegions), the splitter ranges, collapsing (never every region), the Ctrl+H focus cycle, and
// deriving the layout once from the legacy floating workspace (src/domain/legacyLayout.ts). The layout store
// (src/stores/layoutStore.ts) is the only state holder; this module is pure.
//
// Widths are CSS pixels. The board has no stored width: it takes what the viewer and the generation panel leave (the
// fill region), and a splitter widening the viewer or the generation panel narrows the board.
import { CREATE_REGION_IDS, type CreateRegionId } from '../app/sections';
import { clamp, isFiniteNumber, isRecord, recordOr } from './guards';
import type { LegacyWorkspaceState } from './legacyLayout';

/** The regions whose width is stored (the board takes the rest). */
export const RESIZABLE_REGION_IDS = ['viewer', 'generation'] as const satisfies readonly CreateRegionId[];
export type ResizableRegionId = (typeof RESIZABLE_REGION_IDS)[number];

export function isResizableRegion(region: CreateRegionId): region is ResizableRegionId {
	return (RESIZABLE_REGION_IDS as readonly CreateRegionId[]).includes(region);
}

export type RegionWidths = Record<ResizableRegionId, number>;
export type RegionCollapsed = Record<CreateRegionId, boolean>;

/** The tabs of the output details panel of the viewer. */
export const DETAILS_TABS = ['details', 'used'] as const;
export type DetailsTab = (typeof DETAILS_TABS)[number];

export type DetailsPanelState = { open: boolean; tab: DetailsTab };

/** The persisted state of the layout store ('layout-store', version 0). */
export type CreateLayout = {
	widths: RegionWidths;
	collapsed: RegionCollapsed;
	details: DetailsPanelState;
};

/** Narrowest usable width of each expanded region. */
export const REGION_MIN_WIDTH: Readonly<Record<CreateRegionId, number>> = { board: 320, viewer: 320, generation: 300 };
/** Widest stored width of the resizable regions. */
export const REGION_MAX_WIDTH: Readonly<Record<ResizableRegionId, number>> = { viewer: 1400, generation: 640 };
/** Width of a collapsed region (its strip: expand button, and for the generation panel its compact actions). */
export const COLLAPSED_REGION_WIDTH = 56;

export const DEFAULT_CREATE_LAYOUT: CreateLayout = {
	widths: { viewer: 560, generation: 380 },
	collapsed: { board: false, viewer: false, generation: false },
	details: { open: true, tab: 'details' },
};

export function clampRegionWidth(region: ResizableRegionId, width: number): number {
	return Math.round(clamp(width, REGION_MIN_WIDTH[region], REGION_MAX_WIDTH[region]));
}

/** Every region collapsed is not a layout (nothing to see): the board is expanded then. */
function atLeastOneExpanded(collapsed: RegionCollapsed): RegionCollapsed {
	return fillRegion(collapsed) === null ? { ...collapsed, board: false } : collapsed;
}

/** Persisted (or migrated) data -> a valid layout; anything unusable takes the default, and at least one region is
 *  expanded. */
export function sanitizeCreateLayout(value: unknown): CreateLayout {
	const raw = recordOr(value);
	const widths = recordOr(raw.widths);
	const collapsed = recordOr(raw.collapsed);
	const details = recordOr(raw.details);
	return {
		widths: {
			viewer: isFiniteNumber(widths.viewer) ? clampRegionWidth('viewer', widths.viewer) : DEFAULT_CREATE_LAYOUT.widths.viewer,
			generation: isFiniteNumber(widths.generation)
				? clampRegionWidth('generation', widths.generation)
				: DEFAULT_CREATE_LAYOUT.widths.generation,
		},
		collapsed: atLeastOneExpanded(
			Object.fromEntries(
				CREATE_REGION_IDS.map((region) => [region, typeof collapsed[region] === 'boolean' ? collapsed[region] : DEFAULT_CREATE_LAYOUT.collapsed[region]]),
			) as RegionCollapsed,
		),
		details: {
			open: typeof details.open === 'boolean' ? details.open : DEFAULT_CREATE_LAYOUT.details.open,
			tab: (DETAILS_TABS as readonly unknown[]).includes(details.tab) ? (details.tab as DetailsTab) : DEFAULT_CREATE_LAYOUT.details.tab,
		},
	};
}

/** Drawn widths of the three regions (CSS px). */
export type RegionBoxes = Record<CreateRegionId, number>;

/** The region that takes the room the others leave: the first expanded one of board, viewer, generation (the board
 *  whenever it is expanded); null when every region is collapsed. Its stored width (if any) is not used. */
export function fillRegion(collapsed: RegionCollapsed): CreateRegionId | null {
	return CREATE_REGION_IDS.find((region) => !collapsed[region]) ?? null;
}

/** When the stored widths do not fit, these give up room first, in this order (never below their minimum): the
 *  viewer (its image scales down), then the generation panel (its controls need the width most). The fill region
 *  (the board) only ever keeps its minimum. */
const SHRINK_ORDER: readonly ResizableRegionId[] = ['viewer', 'generation'];

/**
 * Drawn width of every region inside `available` px (the measured width of the regions row; splitters take no room):
 * - a collapsed region takes COLLAPSED_REGION_WIDTH;
 * - the viewer and the generation panel take their stored width, unless one of them is the fill region;
 * - the fill region (fillRegion: the board when expanded) takes the rest, at least its minimum;
 * - when that does not fit, the viewer, then the generation panel, shrink down to their minimum before anything else.
 * The sum equals `available` (rounded down to whole px) whenever something is expanded and every region fits at its
 * minimum; below that (a window narrower than the minimums) every expanded region keeps its minimum and the row
 * scrolls horizontally.
 */
export function fitRegions(available: number, layout: Pick<CreateLayout, 'widths' | 'collapsed'>): RegionBoxes {
	const room = Math.max(0, Math.floor(available));
	const fill = fillRegion(layout.collapsed);
	const boxes = Object.fromEntries(
		CREATE_REGION_IDS.map((region) => {
			if (layout.collapsed[region]) {
				return [region, COLLAPSED_REGION_WIDTH];
			}
			if (region === fill || region === 'board') {
				return [region, REGION_MIN_WIDTH[region]];
			}
			return [region, clampRegionWidth(region, layout.widths[region])];
		}),
	) as RegionBoxes;
	let excess = CREATE_REGION_IDS.reduce((sum, region) => sum + boxes[region], 0) - room;
	for (const region of SHRINK_ORDER) {
		if (excess <= 0) {
			break;
		}
		if (layout.collapsed[region] || region === fill) {
			continue;
		}
		const given = Math.min(excess, boxes[region] - REGION_MIN_WIDTH[region]);
		boxes[region] -= given;
		excess -= given;
	}
	if (fill !== null && excess < 0) {
		boxes[fill] -= excess;
	}
	return boxes;
}

/** A resizable region has a splitter (on its start side) while it is expanded and not the fill region. */
export function hasSplitter(region: ResizableRegionId, collapsed: RegionCollapsed): boolean {
	return !collapsed[region] && fillRegion(collapsed) !== region;
}

export type WidthRange = { min: number; max: number };

/** The widths a splitter can give a region in `available` px: from the region's minimum up to its maximum, and no
 *  wider than what leaves the fill region its minimum (the other regions keep their drawn widths: widening a region
 *  narrows the board). */
export function regionWidthRange(region: ResizableRegionId, available: number, layout: Pick<CreateLayout, 'widths' | 'collapsed'>): WidthRange {
	const boxes = fitRegions(available, layout);
	const fill = fillRegion(layout.collapsed);
	const spare = fill !== null && fill !== region ? Math.max(0, boxes[fill] - REGION_MIN_WIDTH[fill]) : 0;
	const min = REGION_MIN_WIDTH[region];
	return { min, max: Math.max(min, Math.min(REGION_MAX_WIDTH[region], boxes[region] + spare)) };
}

/** How far from the end edge of the window the toasts keep while Create is shown, so they never cover the generation
 *  panel and its sticky actions (Generate): the panel's width, the strip's when it is collapsed (its compact actions),
 *  nothing when the panel fills the row (its actions then sit at its start edge). The stored width stands for the drawn
 *  one: they are equal unless the window is too narrow for the viewer's minimum (below 1280 px with the defaults). */
export function generationPanelInset(layout: Pick<CreateLayout, 'widths' | 'collapsed'>): number {
	if (layout.collapsed.generation) {
		return COLLAPSED_REGION_WIDTH;
	}
	return fillRegion(layout.collapsed) === 'generation' ? 0 : clampRegionWidth('generation', layout.widths.generation);
}

/** Collapses or expands a region; collapsing the last expanded region is refused (the same state comes back): the
 *  Create section always shows at least one region. */
export function withRegionCollapsed(collapsed: RegionCollapsed, region: CreateRegionId, value: boolean): RegionCollapsed {
	if (collapsed[region] === value) {
		return collapsed;
	}
	const next = { ...collapsed, [region]: value };
	return fillRegion(next) === null ? collapsed : next;
}

/** The region is the only expanded one (its collapse is refused). */
export function isLastExpandedRegion(collapsed: RegionCollapsed, region: CreateRegionId): boolean {
	return !collapsed[region] && CREATE_REGION_IDS.every((other) => other === region || collapsed[other]);
}

/** Ctrl+H: all regions -> the prompt board alone (viewer and generation panel collapsed) -> the image and the
 *  generation panel (board collapsed) -> all regions. Any other combination goes back to all regions. */
export function nextFocusLayout(collapsed: RegionCollapsed): RegionCollapsed {
	const isAll = !collapsed.board && !collapsed.viewer && !collapsed.generation;
	const isBoardFocus = !collapsed.board && collapsed.viewer && collapsed.generation;
	if (isAll) {
		return { board: false, viewer: true, generation: true };
	}
	if (isBoardFocus) {
		return { board: true, viewer: false, generation: false };
	}
	return { board: false, viewer: false, generation: false };
}

/** The layout derived once from the legacy floating workspace: the Image pane's width becomes the viewer width and
 *  the Generation pane's ('controls') the generation panel width (clamped); a region whose every legacy pane was
 *  closed starts collapsed (viewer: image + browser + used; generation: controls); the details panel starts on the
 *  Used sub-prompts tab when only that pane was open, closed when both browser and used were closed. Free positions
 *  are dropped. */
export function layoutFromLegacyWorkspace(legacy: LegacyWorkspaceState): CreateLayout {
	const hidden = new Set(legacy.hiddenPaneIds);
	const legacyWidth = (paneId: string, region: ResizableRegionId): number => {
		const window = legacy.windows[`pane:${paneId}`];
		return isRecord(window) && isFiniteNumber(window.width) ? clampRegionWidth(region, window.width) : DEFAULT_CREATE_LAYOUT.widths[region];
	};
	const browserShown = !hidden.has('browser');
	const usedShown = !hidden.has('used');
	return {
		widths: { viewer: legacyWidth('image', 'viewer'), generation: legacyWidth('controls', 'generation') },
		collapsed: {
			board: false,
			viewer: hidden.has('image') && !browserShown && !usedShown,
			generation: hidden.has('controls'),
		},
		details: { open: browserShown || usedShown, tab: !browserShown && usedShown ? 'used' : 'details' },
	};
}
