// One category card of the prompt board: <article aria-label="<name> category"> whose frame shows the category's
// semantic state (data-visual-state, aria-description = the state's label, src/ui/stateStyles.tsx frame.card), with
// its header (CategoryHeader: reorder handle, collapse toggle, name, count, state icon, commands) and, unless the card
// is collapsed, its body: the activation text, then the sub-prompt list (it scrolls inside the card, whose height is
// bounded) or the bulk editor (ephemeral card mode). A reveal request of the board store for this card scrolls it into
// view inside the board (never the page) and focuses its name, or opens the name editor (a new category).
import { makeStyles, mergeClasses, tokens, useId } from '@fluentui/react-components';
import { memo, useEffect, useRef, useState } from 'react';
import type { CategoryKey } from '../../domain/categories';
import { useBoardStore, useCardRevealRequest, useIsCardCollapsed } from '../../stores/boardStore';
import { findCategory, useCategoriesStore } from '../../stores/categoriesStore';
import { useCategoryCardState } from '../../stores/forbiddenRulesStore';
import { useIsSectionShown } from '../../stores/navigationStore';
import { STATE_COLORS } from '../../ui/stateColors';
import { useStateFrameClasses } from '../../ui/stateStyles';
import { BulkSubPromptEditor } from './BulkSubPromptEditor';
import { CategoryHeader } from './CategoryHeader';
import { InlineEditableText, type InlineEditableTextHandle } from './InlineEditableText';
import { boardScrollerOf, scrollIntoContainer } from './scrollWithin';
import { SubPromptList } from './SubPromptList';

/** The tallest a card gets: longer sub-prompt lists scroll inside it. */
export const CARD_MAX_HEIGHT = '400px';

const useStyles = makeStyles({
	card: {
		display: 'flex',
		flexDirection: 'column',
		maxHeight: CARD_MAX_HEIGHT,
		minWidth: 0,
		overflow: 'hidden',
		color: tokens.colorNeutralForeground1,
		backgroundColor: tokens.colorNeutralBackground1,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
		borderRadius: tokens.borderRadiusLarge,
		boxShadow: tokens.shadow4,
		// The scroll margin keeps a revealed card clear of the board edges.
		scrollMarginTop: tokens.spacingVerticalM,
		scrollMarginBottom: tokens.spacingVerticalM,
	},
	body: {
		display: 'flex',
		flexDirection: 'column',
		flex: '1 1 auto',
		minHeight: 0,
	},
	activation: {
		flexShrink: 0,
		paddingTop: tokens.spacingVerticalXXS,
		paddingLeft: tokens.spacingHorizontalXS,
		paddingRight: tokens.spacingHorizontalXS,
	},
});

function CategoryCardView({ categoryKey }: { categoryKey: CategoryKey }): JSX.Element | null {
	const styles = useStyles();
	const frame = useStateFrameClasses();
	const text = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.text);
	const activationText = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.activation_text ?? '');
	const setActivationText = useCategoriesStore((state) => state.setActivationText);
	const cardState = useCategoryCardState(categoryKey);
	const collapsed = useIsCardCollapsed(categoryKey);
	const reveal = useCardRevealRequest(categoryKey);
	const createShown = useIsSectionShown('create');
	const completeReveal = useBoardStore((state) => state.completeReveal);
	const bodyId = useId('category-body');
	const articleRef = useRef<HTMLElement>(null);
	const nameRef = useRef<InlineEditableTextHandle>(null);
	// Ephemeral card mode: the bulk editor replaces the sub-prompt list.
	const [bulkEditing, setBulkEditing] = useState(false);

	useEffect(() => {
		const article = articleRef.current;
		// Shown once the Create section is (a request made from another section waits for it).
		if (!reveal || !createShown || !article || article.closest('[hidden]')) {
			return;
		}
		const scroller = boardScrollerOf(article);
		if (scroller) {
			scrollIntoContainer(scroller, article);
		}
		if (reveal.editName) {
			nameRef.current?.edit({ selectAll: true });
		} else {
			nameRef.current?.focus();
		}
		completeReveal(reveal.serial);
	}, [reveal, createShown, completeReveal]);

	if (text === undefined) {
		return null;
	}

	return (
		<article
			ref={articleRef}
			aria-label={`${text} category`}
			aria-description={cardState ? STATE_COLORS[cardState].label : undefined}
			data-visual-state={cardState ?? undefined}
			className={mergeClasses(styles.card, cardState ? frame.card[cardState] : undefined)}
		>
			<CategoryHeader categoryKey={categoryKey} cardState={cardState} bodyId={bodyId} nameRef={nameRef} onEditAll={() => setBulkEditing(true)} />
			{collapsed ? null : (
				<div id={bodyId} className={styles.body}>
					<div className={styles.activation}>
						<InlineEditableText
							value={activationText}
							label="Activation text"
							placeholder="Activation text (optional)"
							variant="caption"
							rows={1}
							onCommit={(next) => setActivationText(categoryKey, next)}
						/>
					</div>
					{bulkEditing ? (
						<BulkSubPromptEditor categoryKey={categoryKey} onClose={() => setBulkEditing(false)} />
					) : (
						<SubPromptList categoryKey={categoryKey} />
					)}
				</div>
			)}
		</article>
	);
}

/** A card re-renders only for its own category (the board re-renders when the shown keys change). */
export const CategoryCard = memo(CategoryCardView);
