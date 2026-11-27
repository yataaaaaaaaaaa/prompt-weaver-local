// The reorder kit of the card grids (the prompt board's category cards, the Story section's scene cards): the look of a
// drag (the dragged card dimmed with a dashed brand outline, the brand insertion bar in the gap before / after the
// target card: vertical between columns, horizontal in a single column) and the feedback of a finished move (the
// polite announcement 'X moved to position 3 of 7', the moved card kept in view inside its scroller and the focus given
// back to its reorder handle). Pointer drags are useBoardDrag, the handles ReorderHandle, the moves of a list
// src/domain/board.ts. View plumbing only: the order itself lives in a store.
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useCallback, useState, type RefObject } from 'react';
import { boardMoveAnnouncement, type BoardMoveResult } from '../../domain/board';
import { REORDER_HANDLE_ATTRIBUTE } from './boardInteraction';
import { scrollIntoContainer } from './scrollWithin';
import type { BoardDragView } from './useBoardDrag';

/** Thickness of the insertion indicator, centered in the grid gap. */
const INDICATOR = tokens.strokeWidthThickest;

/** The drag classes of a grid whose gaps are spacingHorizontalM (columns) and spacingVerticalM (rows). */
export const useReorderGridStyles = makeStyles({
	dragging: {
		userSelect: 'none',
		cursor: 'grabbing',
		'& *': { cursor: 'grabbing' },
	},
	// The card being dragged stays in place, dimmed, with a dashed brand outline.
	dragged: {
		opacity: 0.5,
		outline: `${tokens.strokeWidthThick} dashed ${tokens.colorBrandStroke1}`,
		outlineOffset: tokens.strokeWidthThin,
		borderRadius: tokens.borderRadiusLarge,
	},
	indicator: {
		'::after': {
			content: "''",
			position: 'absolute',
			backgroundColor: tokens.colorBrandStroke1,
			borderRadius: tokens.borderRadiusCircular,
			pointerEvents: 'none',
		},
	},
	// Several columns: a vertical bar in the gap left / right of the target card.
	beforeColumn: {
		'::after': { top: 0, bottom: 0, width: INDICATOR, left: `calc(${tokens.spacingHorizontalM} / -2 - ${INDICATOR} / 2)` },
	},
	afterColumn: {
		'::after': { top: 0, bottom: 0, width: INDICATOR, right: `calc(${tokens.spacingHorizontalM} / -2 - ${INDICATOR} / 2)` },
	},
	// One column: a horizontal bar in the gap above / below the target card.
	beforeRow: {
		'::after': { left: 0, right: 0, height: INDICATOR, top: `calc(${tokens.spacingVerticalM} / -2 - ${INDICATOR} / 2)` },
	},
	afterRow: {
		'::after': { left: 0, right: 0, height: INDICATOR, bottom: `calc(${tokens.spacingVerticalM} / -2 - ${INDICATOR} / 2)` },
	},
});

export type ReorderGridClasses = ReturnType<typeof useReorderGridStyles>;

/** The drag classes of the grid item `key` (positioned: `position: relative`): dragged, or the insertion indicator on
 *  the side it would land on; undefined otherwise. */
export function reorderItemClass(classes: ReorderGridClasses, drag: BoardDragView | null, key: string): string | undefined {
	if (!drag) {
		return undefined;
	}
	if (drag.key === key) {
		return classes.dragged;
	}
	if (drag.target !== key) {
		return undefined;
	}
	const side = drag.singleColumn
		? drag.placement === 'before'
			? classes.beforeRow
			: classes.afterRow
		: drag.placement === 'before'
			? classes.beforeColumn
			: classes.afterColumn;
	return mergeClasses(classes.indicator, side);
}

/** The feedback of finished moves in the grid inside `scrollRef`, whose items carry `itemAttribute` (value: the key):
 *  `moved` announces the result (`announcement`, for a polite live region) and, after React re-inserted the moved
 *  item, keeps it in view inside the scroller and gives the focus back to its reorder handle (never scrolling anything
 *  else). */
export function useReorderFeedback(
	scrollRef: RefObject<HTMLElement>,
	itemAttribute: string,
): {
	announcement: string;
	/** Announces another change of the grid (e.g. a sort). */
	announce: (text: string) => void;
	moved: (key: string, name: string, result: BoardMoveResult | null) => void;
} {
	const [announcement, setAnnouncement] = useState('');
	const moved = useCallback(
		(key: string, name: string, result: BoardMoveResult | null) => {
			if (result) {
				setAnnouncement(boardMoveAnnouncement(name, result));
			}
			window.setTimeout(() => {
				const scroller = scrollRef.current;
				const handle = scroller?.querySelector<HTMLElement>(`[${REORDER_HANDLE_ATTRIBUTE}="${CSS.escape(key)}"]`);
				const item = scroller?.querySelector<HTMLElement>(`[${itemAttribute}="${CSS.escape(key)}"]`);
				if (scroller && item) {
					scrollIntoContainer(scroller, item);
				}
				if (handle && document.activeElement !== handle) {
					handle.focus({ preventScroll: true });
				}
			}, 0);
		},
		[itemAttribute, scrollRef],
	);
	return { announcement, announce: setAnnouncement, moved };
}
