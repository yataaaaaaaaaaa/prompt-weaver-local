// The prompt board: the Create section's region of category cards (the shell renders it inside the 'Prompt board'
// region, src/app/sections.ts; it fills that flex column and scrolls itself). Top: the board toolbar (search, state
// filter, Add category, Collapse all / Expand all, Sort by priority, count). Below: every card in board order
// (useBoardOrder) in a responsive grid that auto-fills columns of at least BOARD_CARD_MIN_WIDTH, cards top-aligned, no
// free positions; the cards the filter hides (not in useVisibleCategoryKeys) stay mounted but hidden, so typing a
// search only toggles them (40+ cards). An empty state replaces the grid when no card is shown.
//
// Reordering (the reorder kit of src/features/categories/reorderGrid.ts): each card's reorder handle (ReorderHandle) is
// dragged with the pointer (useBoardDrag: the insertion indicator before / after the target card) or moved with the
// keyboard; the move goes to the board store, the board announces the new position in its polite live region and gives
// the focus back to the moved card's handle.
// Thin view: arrangement in the board store, categories in the categories store, card states derived by the
// forbidden-rules store; only the drag preview and the last announcement are local.
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useCallback, useMemo, useRef } from 'react';
import type { Placement } from '../../domain/board';
import type { CategoryKey } from '../../domain/categories';
import { useBoardOrder, useBoardStore, useVisibleCategoryKeys } from '../../stores/boardStore';
import { findCategory, useCategoriesStore } from '../../stores/categoriesStore';
import { BoardEmptyState } from './BoardEmptyState';
import { BOARD_CARD_ATTRIBUTE, BoardInteractionContext, type BoardInteraction } from './boardInteraction';
import { BoardToolbar } from './BoardToolbar';
import { CategoryCard } from './CategoryCard';
import { reorderItemClass, useReorderFeedback, useReorderGridStyles } from './reorderGrid';
import { BOARD_SCROLL_ATTRIBUTE } from './scrollWithin';
import { useBoardDrag } from './useBoardDrag';
import { useVisuallyHiddenClass } from '../../ui/visuallyHidden';

/** The narrowest a grid column gets (a narrower board shows one column as wide as the board). */
export const BOARD_CARD_MIN_WIDTH = '280px';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		flex: 1,
		minHeight: 0,
		minWidth: 0,
	},
	scroll: {
		position: 'relative',
		flex: 1,
		minHeight: 0,
		overflowY: 'auto',
		overflowX: 'hidden',
		paddingTop: tokens.spacingVerticalM,
		paddingBottom: tokens.spacingVerticalXXL,
		paddingLeft: tokens.spacingHorizontalM,
		paddingRight: tokens.spacingHorizontalM,
		backgroundColor: tokens.colorNeutralBackground2,
	},
	grid: {
		display: 'grid',
		gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${BOARD_CARD_MIN_WIDTH}), 1fr))`,
		alignItems: 'start',
		columnGap: tokens.spacingHorizontalM,
		rowGap: tokens.spacingVerticalM,
		margin: 0,
		padding: 0,
		listStyleType: 'none',
	},
	item: {
		position: 'relative',
		minWidth: 0,
	},
});

function nameOf(key: CategoryKey): string {
	return findCategory(useCategoriesStore.getState().categories, key)?.text || 'Unnamed category';
}

export function PromptBoard(): JSX.Element {
	const styles = useStyles();
	const visuallyHidden = useVisuallyHiddenClass();
	const ordered = useBoardOrder();
	const keys = useVisibleCategoryKeys();
	const shown = useMemo(() => new Set(keys), [keys]);
	const total = useCategoriesStore((state) => state.categories.length);
	const moveCategoryNextTo = useBoardStore((state) => state.moveCategoryNextTo);
	const scrollRef = useRef<HTMLDivElement>(null);
	const gridRef = useRef<HTMLUListElement>(null);
	const reorder = useReorderGridStyles();
	const { announcement, announce, moved } = useReorderFeedback(scrollRef, BOARD_CARD_ATTRIBUTE);

	const onDrop = useCallback(
		(key: CategoryKey, target: CategoryKey, placement: Placement) => moved(key, nameOf(key), moveCategoryNextTo(key, target, placement)),
		[moved, moveCategoryNextTo],
	);
	const { drag, startPointerDrag } = useBoardDrag({ scrollRef, gridRef, onDrop });
	const interaction = useMemo<BoardInteraction>(() => ({ startPointerDrag, moved }), [startPointerDrag, moved]);

	return (
		<BoardInteractionContext.Provider value={interaction}>
			<div className={mergeClasses(styles.root, drag ? reorder.dragging : undefined)}>
				<BoardToolbar shown={keys.length} announce={announce} />
				<div ref={scrollRef} className={styles.scroll} {...{ [BOARD_SCROLL_ATTRIBUTE]: '' }}>
					{keys.length === 0 ? <BoardEmptyState hasCategories={total > 0} /> : null}
					<ul ref={gridRef} className={styles.grid} aria-label="Categories" hidden={keys.length === 0}>
						{ordered.map((key) => (
							<li
								key={key}
								hidden={!shown.has(key)}
								{...{ [BOARD_CARD_ATTRIBUTE]: key }}
								className={mergeClasses(styles.item, reorderItemClass(reorder, drag, key))}
							>
								<CategoryCard categoryKey={key} />
							</li>
						))}
					</ul>
				</div>
				<div className={visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
					{announcement}
				</div>
			</div>
		</BoardInteractionContext.Provider>
	);
}
