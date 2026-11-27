// Pointer drag and drop of the cards of a grid (ephemeral view state of its view: the prompt board's category cards,
// the Story section's scene cards; the grid items carry `itemAttribute`, BOARD_CARD_ATTRIBUTE by default, whose value
// is the card's key): a pointer down on a card's reorder handle starts a drag once the pointer moved DRAG_THRESHOLD_PX; while dragging, the card under the pointer
// and the pointer's half of it (domain/board.ts dropPlacementAt) give the drop target the board draws an insertion
// indicator for; near the top / bottom edge of the board the grid scrolls (auto-scroll); releasing drops the card
// there (onDrop -> boardStore.moveCategoryNextTo), Escape or a cancelled pointer leaves the order untouched. Pointer
// capture keeps the drag on the handle wherever the pointer goes; outside the board nothing is targeted.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { dropPlacementAt, type Placement } from '../../domain/board';
import type { CategoryKey } from '../../domain/categories';
import { BOARD_CARD_ATTRIBUTE } from './boardInteraction';

/** Pointer travel before a press on the handle becomes a drag (a plain click never moves anything). */
export const DRAG_THRESHOLD_PX = 4;
/** Height of the zones at the top / bottom of the board where a drag scrolls the grid. */
export const AUTO_SCROLL_EDGE_PX = 56;
/** Fastest auto-scroll step, per animation frame (at the very edge). */
export const AUTO_SCROLL_MAX_STEP_PX = 20;

/** What the board draws while a card is dragged. */
export type BoardDragView = {
	key: CategoryKey;
	/** The card the dragged one would be dropped next to (null: nowhere, e.g. over itself or outside the board). */
	target: CategoryKey | null;
	placement: Placement;
	/** The grid has a single column: the indicator is horizontal (above / below the target). */
	singleColumn: boolean;
};

type Session = BoardDragView & {
	pointerId: number;
	startX: number;
	startY: number;
	x: number;
	y: number;
	started: boolean;
	frame: number;
	handle: HTMLElement;
	cleanup: () => void;
};

export type BoardDragOptions = {
	/** The board's scrolling container (auto-scroll, the area where cards can be targeted). */
	scrollRef: RefObject<HTMLElement>;
	/** The card grid (column count). */
	gridRef: RefObject<HTMLElement>;
	onDrop: (key: CategoryKey, target: CategoryKey, placement: Placement) => void;
	/** The attribute marking the grid items (its value is the item's key). Default BOARD_CARD_ATTRIBUTE. */
	itemAttribute?: string;
};

function isSingleColumn(grid: HTMLElement | null): boolean {
	if (!grid) {
		return true;
	}
	return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length <= 1;
}

function sameView(left: BoardDragView | null, right: BoardDragView | null): boolean {
	return (
		left === right ||
		(left !== null &&
			right !== null &&
			left.key === right.key &&
			left.target === right.target &&
			left.placement === right.placement &&
			left.singleColumn === right.singleColumn)
	);
}

function inside(rect: DOMRect, x: number, y: number): boolean {
	return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The auto-scroll step at pointer height `y` in the scroller `rect` (negative = up). */
function autoScrollStep(rect: DOMRect, x: number, y: number): number {
	if (x < rect.left || x > rect.right) {
		return 0;
	}
	const intoTop = rect.top + AUTO_SCROLL_EDGE_PX - y;
	if (intoTop > 0) {
		return -Math.min(AUTO_SCROLL_MAX_STEP_PX, Math.ceil((AUTO_SCROLL_MAX_STEP_PX * intoTop) / AUTO_SCROLL_EDGE_PX));
	}
	const intoBottom = y - (rect.bottom - AUTO_SCROLL_EDGE_PX);
	if (intoBottom > 0) {
		return Math.min(AUTO_SCROLL_MAX_STEP_PX, Math.ceil((AUTO_SCROLL_MAX_STEP_PX * intoBottom) / AUTO_SCROLL_EDGE_PX));
	}
	return 0;
}

export function useBoardDrag({ scrollRef, gridRef, onDrop, itemAttribute = BOARD_CARD_ATTRIBUTE }: BoardDragOptions): {
	drag: BoardDragView | null;
	startPointerDrag: (key: CategoryKey, event: ReactPointerEvent<HTMLElement>) => void;
} {
	const [drag, setDrag] = useState<BoardDragView | null>(null);
	const session = useRef<Session | null>(null);
	const onDropRef = useRef(onDrop);
	onDropRef.current = onDrop;

	const publish = useCallback((current: Session | null) => {
		const view: BoardDragView | null =
			current && current.started
				? { key: current.key, target: current.target, placement: current.placement, singleColumn: current.singleColumn }
				: null;
		setDrag((previous) => (sameView(previous, view) ? previous : view));
	}, []);

	const updateTarget = useCallback(
		(current: Session) => {
			const scroller = scrollRef.current;
			if (!scroller || !inside(scroller.getBoundingClientRect(), current.x, current.y)) {
				current.target = null;
				return;
			}
			const item = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>(`[${itemAttribute}]`);
			if (!item || !gridRef.current?.contains(item)) {
				// Between two cards: the last target stays.
				return;
			}
			const target = item.getAttribute(itemAttribute);
			if (target === null || target === current.key) {
				current.target = null;
				return;
			}
			current.target = target;
			current.placement = dropPlacementAt({ x: current.x, y: current.y }, item.getBoundingClientRect(), current.singleColumn);
		},
		[gridRef, itemAttribute, scrollRef],
	);

	const finish = useCallback(
		(current: Session, commit: boolean) => {
			if (session.current !== current) {
				return;
			}
			session.current = null;
			current.cleanup();
			publish(null);
			if (commit && current.started && current.target !== null) {
				onDropRef.current(current.key, current.target, current.placement);
			}
		},
		[publish],
	);

	const startPointerDrag = useCallback(
		(key: CategoryKey, event: ReactPointerEvent<HTMLElement>) => {
			if (event.button !== 0 || !event.isPrimary || session.current) {
				return;
			}
			const handle = event.currentTarget;
			const current: Session = {
				key,
				target: null,
				placement: 'after',
				singleColumn: true,
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				x: event.clientX,
				y: event.clientY,
				started: false,
				frame: 0,
				handle,
				cleanup: () => undefined,
			};
			const tick = () => {
				if (session.current !== current) {
					return;
				}
				const scroller = scrollRef.current;
				const step = scroller ? autoScrollStep(scroller.getBoundingClientRect(), current.x, current.y) : 0;
				if (scroller && step !== 0) {
					const before = scroller.scrollTop;
					scroller.scrollTop = before + step;
					if (scroller.scrollTop !== before) {
						updateTarget(current);
						publish(current);
					}
				}
				current.frame = requestAnimationFrame(tick);
			};
			const onMove = (moveEvent: PointerEvent) => {
				if (moveEvent.pointerId !== current.pointerId) {
					return;
				}
				current.x = moveEvent.clientX;
				current.y = moveEvent.clientY;
				if (!current.started) {
					if (Math.hypot(current.x - current.startX, current.y - current.startY) < DRAG_THRESHOLD_PX) {
						return;
					}
					current.started = true;
					current.singleColumn = isSingleColumn(gridRef.current);
					current.frame = requestAnimationFrame(tick);
				}
				moveEvent.preventDefault();
				updateTarget(current);
				publish(current);
			};
			const onUp = (upEvent: PointerEvent) => {
				if (upEvent.pointerId === current.pointerId) {
					finish(current, true);
				}
			};
			const onCancel = (cancelEvent: PointerEvent) => {
				if (cancelEvent.pointerId === current.pointerId) {
					finish(current, false);
				}
			};
			const onKey = (keyEvent: KeyboardEvent) => {
				if (keyEvent.key === 'Escape' && current.started) {
					keyEvent.preventDefault();
					keyEvent.stopPropagation();
					finish(current, false);
				}
			};
			current.cleanup = () => {
				cancelAnimationFrame(current.frame);
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				window.removeEventListener('pointercancel', onCancel);
				window.removeEventListener('keydown', onKey, true);
				if (handle.hasPointerCapture?.(current.pointerId)) {
					handle.releasePointerCapture(current.pointerId);
				}
			};
			session.current = current;
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
			window.addEventListener('pointercancel', onCancel);
			window.addEventListener('keydown', onKey, true);
			handle.setPointerCapture?.(event.pointerId);
		},
		[finish, gridRef, publish, scrollRef, updateTarget],
	);

	// A board unmounted mid-drag drops nothing.
	useEffect(
		() => () => {
			if (session.current) {
				finish(session.current, false);
			}
		},
		[finish],
	);

	return { drag, startPointerDrag };
}
