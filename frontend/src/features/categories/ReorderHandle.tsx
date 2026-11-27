// The reorder handle of a card of a grid (a category card of the prompt board, a scene card of the Story section; the
// first control of its header): drag it with the pointer to move the card (the grid's drag controller, useBoardDrag
// through the BoardInteraction context, shows where it lands), or focus it and press ArrowLeft / ArrowUp (before the
// previous shown card), ArrowRight / ArrowDown (after the next one), Home / End (first / last). It owns those keys
// (ownsKeysProps): the global output arrows never fire while it has focus. Keyboard moves go to `onMove` (a store
// action), whose result the grid announces.
import { Button, makeStyles, Tooltip } from '@fluentui/react-components';
import { ReOrderDotsVerticalRegular } from '@fluentui/react-icons';
import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { boardMoveForKey, type BoardMove, type BoardMoveResult } from '../../domain/board';
import { ownsKeysProps } from '../../ui/keyboard';
import { REORDER_HANDLE_ATTRIBUTE, useBoardInteraction } from './boardInteraction';

const useStyles = makeStyles({
	handle: {
		flexShrink: 0,
		cursor: 'grab',
		// Touch and pen drags move the card instead of scrolling the board.
		touchAction: 'none',
	},
});

export const REORDER_HINT = 'Drag to move, or use the arrow keys, Home and End';

export type ReorderHandleProps = {
	/** The card's key (its grid item's attribute value). */
	itemKey: string;
	/** The card's name ('Reorder <name>', the move announcement). */
	name: string;
	/** Moves the card (a store action); its result is announced. */
	onMove: (move: BoardMove) => BoardMoveResult | null | Promise<BoardMoveResult | null>;
};

export function ReorderHandle({ itemKey, name, onMove }: ReorderHandleProps): JSX.Element {
	const styles = useStyles();
	const interaction = useBoardInteraction();
	// Ephemeral: the hint stays hidden while the handle is pressed (a drag keeps the pointer captured on the handle).
	const [hintVisible, setHintVisible] = useState(false);
	const [pressed, setPressed] = useState(false);

	useEffect(() => {
		if (!pressed) {
			return undefined;
		}
		const release = () => setPressed(false);
		window.addEventListener('pointerup', release);
		window.addEventListener('pointercancel', release);
		return () => {
			window.removeEventListener('pointerup', release);
			window.removeEventListener('pointercancel', release);
		};
	}, [pressed]);

	function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
		const move = event.ctrlKey || event.metaKey || event.altKey ? null : boardMoveForKey(event.key);
		if (!move) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		void Promise.resolve(onMove(move)).then((result) => interaction.moved(itemKey, name, result));
	}

	function handlePointerDown(event: PointerEvent<HTMLButtonElement>): void {
		setPressed(true);
		setHintVisible(false);
		interaction.startPointerDrag(itemKey, event);
	}

	return (
		<Tooltip
			content={REORDER_HINT}
			relationship="description"
			positioning="above-start"
			visible={hintVisible && !pressed}
			onVisibleChange={(_event, data) => setHintVisible(data.visible)}
		>
			<Button
				appearance="transparent"
				size="small"
				className={styles.handle}
				icon={<ReOrderDotsVerticalRegular />}
				aria-label={`Reorder ${name}`}
				{...{ [REORDER_HANDLE_ATTRIBUTE]: itemKey }}
				{...ownsKeysProps}
				onPointerDown={handlePointerDown}
				onKeyDown={handleKeyDown}
			/>
		</Tooltip>
	);
}
