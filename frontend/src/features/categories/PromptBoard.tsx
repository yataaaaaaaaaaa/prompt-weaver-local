// The prompt board: the Create section's region of category cards (the shell renders it inside the 'Prompt board'
// region, src/app/sections.ts; it fills that flex column and scrolls itself). Top: the board toolbar (search, state
// filter, Add category, Collapse all / Expand all, Sort by priority, count). Below: every card in board order
// (useBoardOrder) in a responsive grid that auto-fills columns of at least BOARD_CARD_MIN_WIDTH, cards top-aligned, no
// free positions; the cards the filter hides (not in useVisibleCategoryKeys) stay mounted but hidden, so typing a
// search only toggles them (40+ cards). An empty state replaces the grid when no card is shown.
//
// Reordering: each card's reorder handle (ReorderHandle) is dragged with the pointer (useBoardDrag: the insertion
// indicator before / after the target card) or moved with the keyboard; the move goes to the board store, the board
// announces the new position in its polite live region and gives the focus back to the moved card's handle.
// Thin view: arrangement in the board store, categories in the categories store, card states derived by the
// forbidden-rules store; only the drag preview and the last announcement are local.
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useCallback, useMemo, useRef, useState } from 'react';
import { boardMoveAnnouncement, type BoardMoveResult, type Placement } from '../../domain/board';
import type { CategoryKey } from '../../domain/categories';
import { useBoardOrder, useBoardStore, useVisibleCategoryKeys } from '../../stores/boardStore';
import { findCategory, useCategoriesStore } from '../../stores/categoriesStore';
import { BoardEmptyState } from './BoardEmptyState';
import { BOARD_CARD_ATTRIBUTE, BoardInteractionContext, REORDER_HANDLE_ATTRIBUTE, type BoardInteraction } from './boardInteraction';
import { BoardToolbar } from './BoardToolbar';
import { CategoryCard } from './CategoryCard';
import { BOARD_SCROLL_ATTRIBUTE, scrollIntoContainer } from './scrollWithin';
import { useBoardDrag } from './useBoardDrag';
import { useVisuallyHiddenClass } from '../../ui/visuallyHidden';

/** The narrowest a grid column gets (a narrower board shows one column as wide as the board). */
export const BOARD_CARD_MIN_WIDTH = '280px';

/** Thickness of the insertion indicator, centered in the grid gap. */
const INDICATOR = tokens.strokeWidthThickest;

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		flex: 1,
		minHeight: 0,
		minWidth: 0,
	},
	dragging: {
		userSelect: 'none',
		cursor: 'grabbing',
		'& *': { cursor: 'grabbing' },
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
	const [announcement, setAnnouncement] = useState('');

	/** After a move React re-inserts the moved card (its handle loses the focus): give the focus back, without
	 *  scrolling anything but the board. */
	const moved = useCallback((key: CategoryKey, name: string, result: BoardMoveResult | null) => {
		if (result) {
			setAnnouncement(boardMoveAnnouncement(name, result));
		}
		window.setTimeout(() => {
			const scroller = scrollRef.current;
			const handle = scroller?.querySelector<HTMLElement>(`[${REORDER_HANDLE_ATTRIBUTE}="${CSS.escape(key)}"]`);
			const item = scroller?.querySelector<HTMLElement>(`[${BOARD_CARD_ATTRIBUTE}="${CSS.escape(key)}"]`);
			if (scroller && item) {
				scrollIntoContainer(scroller, item);
			}
			if (handle && document.activeElement !== handle) {
				handle.focus({ preventScroll: true });
			}
		}, 0);
	}, []);

	const onDrop = useCallback(
		(key: CategoryKey, target: CategoryKey, placement: Placement) => moved(key, nameOf(key), moveCategoryNextTo(key, target, placement)),
		[moved, moveCategoryNextTo],
	);
	const { drag, startPointerDrag } = useBoardDrag({ scrollRef, gridRef, onDrop });
	const interaction = useMemo<BoardInteraction>(() => ({ startPointerDrag, moved }), [startPointerDrag, moved]);

	const indicatorClass = (key: CategoryKey): string | undefined => {
		if (!drag || drag.target !== key) {
			return undefined;
		}
		const side = drag.singleColumn
			? drag.placement === 'before'
				? styles.beforeRow
				: styles.afterRow
			: drag.placement === 'before'
				? styles.beforeColumn
				: styles.afterColumn;
		return mergeClasses(styles.indicator, side);
	};

	return (
		<BoardInteractionContext.Provider value={interaction}>
			<div className={mergeClasses(styles.root, drag ? styles.dragging : undefined)}>
				<BoardToolbar shown={keys.length} announce={setAnnouncement} />
				<div ref={scrollRef} className={styles.scroll} {...{ [BOARD_SCROLL_ATTRIBUTE]: '' }}>
					{keys.length === 0 ? <BoardEmptyState hasCategories={total > 0} /> : null}
					<ul ref={gridRef} className={styles.grid} aria-label="Categories" hidden={keys.length === 0}>
						{ordered.map((key) => (
							<li
								key={key}
								hidden={!shown.has(key)}
								{...{ [BOARD_CARD_ATTRIBUTE]: key }}
								className={mergeClasses(styles.item, drag?.key === key && styles.dragged, indicatorClass(key))}
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
