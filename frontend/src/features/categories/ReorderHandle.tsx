// The reorder handle of a category card (first control of its header): drag it with the pointer to move the card
// (PromptBoard's drag controller shows where it lands), or focus it and press ArrowLeft / ArrowUp (before the previous
// shown card), ArrowRight / ArrowDown (after the next one), Home / End (first / last). It owns those keys
// (ownsKeysProps): the global output arrows never fire while it has focus. Moves go to the board store.
import { Button, makeStyles, Tooltip } from '@fluentui/react-components';
import { ReOrderDotsVerticalRegular } from '@fluentui/react-icons';
import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { boardMoveForKey } from '../../domain/board';
import type { CategoryKey } from '../../domain/categories';
import { useBoardStore } from '../../stores/boardStore';
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

export function ReorderHandle({ categoryKey, name }: { categoryKey: CategoryKey; name: string }): JSX.Element {
	const styles = useStyles();
	const interaction = useBoardInteraction();
	const moveCategory = useBoardStore((state) => state.moveCategory);
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
		interaction.moved(categoryKey, name, moveCategory(categoryKey, move));
	}

	function handlePointerDown(event: PointerEvent<HTMLButtonElement>): void {
		setPressed(true);
		setHintVisible(false);
		interaction.startPointerDrag(categoryKey, event);
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
				{...{ [REORDER_HANDLE_ATTRIBUTE]: categoryKey }}
				{...ownsKeysProps}
				onPointerDown={handlePointerDown}
				onKeyDown={handleKeyDown}
			/>
		</Tooltip>
	);
}
