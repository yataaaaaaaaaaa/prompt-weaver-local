// The header of a category card (<header>, tinted by the card's state: src/ui/stateStyles.tsx frame.header). First
// row: the reorder handle, the expand / collapse toggle, the inline-editable name, the sub-prompt count and the state
// icon; second row: the category's commands (CategoryActions). A collapsed card shows only this header.
import { Badge, Button, makeStyles, mergeClasses, Tooltip, tokens } from '@fluentui/react-components';
import { ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import type { Ref } from 'react';
import type { CategoryKey } from '../../domain/categories';
import { useBoardStore, useIsCardCollapsed } from '../../stores/boardStore';
import { findCategory, useCategoriesStore } from '../../stores/categoriesStore';
import { STATE_COLORS, type VisualState } from '../../ui/stateColors';
import { STATE_ICONS, useStateAccentClasses, useStateFrameClasses } from '../../ui/stateStyles';
import { CategoryActions } from './CategoryActions';
import { InlineEditableText, type InlineEditableTextHandle } from './InlineEditableText';
import { ReorderHandle } from './ReorderHandle';
import { useVisuallyHiddenClass } from '../../ui/visuallyHidden';

const useStyles = makeStyles({
	header: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		flexShrink: 0,
		paddingTop: tokens.spacingVerticalXXS,
		paddingBottom: tokens.spacingVerticalXS,
		paddingLeft: tokens.spacingHorizontalXXS,
		paddingRight: tokens.spacingHorizontalS,
		backgroundColor: tokens.colorNeutralBackground3,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
	// A collapsed card is only its header: no divider under it.
	collapsed: {
		borderBottomColor: 'transparent',
	},
	titleRow: {
		display: 'flex',
		alignItems: 'flex-start',
		gap: tokens.spacingHorizontalXXS,
		minWidth: 0,
	},
	// The 24 px controls centered on the first line of the name.
	control: {
		flexShrink: 0,
		marginTop: tokens.spacingVerticalXXS,
	},
	name: {
		flex: '1 1 auto',
		minWidth: 0,
	},
	meta: {
		display: 'flex',
		alignItems: 'center',
		flexShrink: 0,
		gap: tokens.spacingHorizontalXS,
		minHeight: '32px',
	},
	stateIcon: {
		fontSize: tokens.fontSizeBase400,
	},
	actions: {
		paddingLeft: tokens.spacingHorizontalXS,
	},
});

export type CategoryHeaderProps = {
	categoryKey: CategoryKey;
	/** The card's state (forbiddenRulesStore useCategoryCardState). */
	cardState: VisualState | null;
	/** Id of the card body (the toggle controls it while it is shown). */
	bodyId: string;
	/** The name editor (the card focuses it, or opens it, when revealed). */
	nameRef: Ref<InlineEditableTextHandle>;
	onEditAll: () => void;
};

export function CategoryHeader({ categoryKey, cardState, bodyId, nameRef, onEditAll }: CategoryHeaderProps): JSX.Element | null {
	const styles = useStyles();
	const frame = useStateFrameClasses();
	const accent = useStateAccentClasses();
	const visuallyHidden = useVisuallyHiddenClass();
	const text = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.text);
	const count = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.subPrompts.length ?? 0);
	const renameCategory = useCategoriesStore((state) => state.renameCategory);
	const collapsed = useIsCardCollapsed(categoryKey);
	const toggleCollapsed = useBoardStore((state) => state.toggleCollapsed);
	const moveCategory = useBoardStore((state) => state.moveCategory);

	if (text === undefined) {
		return null;
	}
	const name = text || 'Unnamed category';
	const StateIcon = cardState ? STATE_ICONS[cardState] : null;
	const stateLabel = cardState ? STATE_COLORS[cardState].label : '';
	const toggleLabel = `${collapsed ? 'Expand' : 'Collapse'} ${name}`;

	return (
		<header className={mergeClasses(styles.header, collapsed && styles.collapsed, cardState ? frame.header[cardState] : undefined)}>
			<div className={styles.titleRow}>
				<span className={styles.control}>
					<ReorderHandle itemKey={categoryKey} name={name} onMove={(move) => moveCategory(categoryKey, move)} />
				</span>
				<Tooltip content={toggleLabel} relationship="label">
					<Button
						appearance="subtle"
						size="small"
						className={styles.control}
						icon={collapsed ? <ChevronRightRegular /> : <ChevronDownRegular />}
						aria-expanded={!collapsed}
						aria-controls={collapsed ? undefined : bodyId}
						onClick={() => toggleCollapsed(categoryKey)}
					/>
				</Tooltip>
				<div className={styles.name}>
					<InlineEditableText
						ref={nameRef}
						value={text}
						label="Category name"
						placeholder="Unnamed category"
						variant="title"
						rows={1}
						onCommit={(next) => renameCategory(categoryKey, next)}
					/>
				</div>
				<div className={styles.meta}>
					<Badge appearance="outline" color="informative" shape="rounded" size="medium">
						{count}
						<span className={visuallyHidden}>{count === 1 ? ' sub-prompt' : ' sub-prompts'}</span>
					</Badge>
					{StateIcon && cardState ? (
						<Tooltip content={stateLabel} relationship="inaccessible">
							<StateIcon role="img" aria-label={stateLabel} className={mergeClasses(styles.stateIcon, accent[cardState])} />
						</Tooltip>
					) : null}
				</div>
			</div>
			<div className={styles.actions}>
				<CategoryActions categoryKey={categoryKey} onEditAll={onEditAll} />
			</div>
		</header>
	);
}
