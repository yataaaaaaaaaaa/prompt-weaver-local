// What a card's reorder handle needs from the board around it (PromptBoard provides it): starting a pointer drag (the
// board's drag controller, useBoardDrag) and reporting a finished move (the board announces it in its polite live
// region and gives the focus back to the moved card's handle). Stable callbacks only: providing them never re-renders
// the cards. Ephemeral view plumbing; the order itself lives in the board store.
import { createContext, useContext, type PointerEvent as ReactPointerEvent } from 'react';
import type { BoardMoveResult } from '../../domain/board';
import type { CategoryKey } from '../../domain/categories';

export type BoardInteraction = {
	/** Pointer down on the reorder handle of `key`: a drag starts once the pointer moved a few pixels. */
	startPointerDrag: (key: CategoryKey, event: ReactPointerEvent<HTMLElement>) => void;
	/** The card of `key` (named `name`) was moved, or tried to move past an end (its position is unchanged). */
	moved: (key: CategoryKey, name: string, result: BoardMoveResult | null) => void;
};

const NO_INTERACTION: BoardInteraction = {
	startPointerDrag: () => undefined,
	moved: () => undefined,
};

export const BoardInteractionContext = createContext<BoardInteraction>(NO_INTERACTION);

export function useBoardInteraction(): BoardInteraction {
	return useContext(BoardInteractionContext);
}

/** Marks a card's reorder handle (value: the category key): the board finds it to give the focus back after a move. */
export const REORDER_HANDLE_ATTRIBUTE = 'data-reorder-handle';

/** Marks the grid item of a card (value: the category key): the drag controller finds the card under the pointer. */
export const BOARD_CARD_ATTRIBUTE = 'data-board-card';
