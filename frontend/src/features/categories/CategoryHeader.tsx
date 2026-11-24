// Header of a category card: inline-editable name and activation text, priority and the card actions.
import { Button, makeStyles, ToggleButton, tokens, Tooltip } from '@fluentui/react-components';
import { Add20Regular, Delete20Regular, Prohibited20Regular, TextBulletListSquareEdit20Regular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { CategoryKey } from '../../domain/categories';
import { useCategoriesStore, useCategory } from '../../stores/categoriesStore';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';
import { InlineEditableText } from './InlineEditableText';
import { PriorityField } from './PriorityField';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'flex-start',
		gap: tokens.spacingHorizontalS,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalM,
		paddingRight: tokens.spacingHorizontalM,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
	},
	texts: {
		display: 'flex',
		flexDirection: 'column',
		gap: tokens.spacingVerticalXXS,
		flex: '1 1 160px',
		minWidth: 0,
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXXS,
		marginLeft: 'auto',
	},
});

export type CategoryHeaderProps = {
	categoryKey: CategoryKey;
	/** Opens the bulk editor of the card (ephemeral card mode owned by CategoryCard). */
	onEditAll: () => void;
};

export function CategoryHeader({ categoryKey, onEditAll }: CategoryHeaderProps): JSX.Element | null {
	const styles = useStyles();
	const category = useCategory(categoryKey);
	const renameCategory = useCategoriesStore((state) => state.renameCategory);
	const setActivationText = useCategoriesStore((state) => state.setActivationText);
	const setCategoryState = useCategoriesStore((state) => state.setCategoryState);
	const addSubPrompt = useCategoriesStore((state) => state.addSubPrompt);
	const removeCategory = useCategoriesStore((state) => state.removeCategory);
	const [confirmDelete, setConfirmDelete] = useState(false);

	if (!category) {
		return null;
	}
	const skipped = category.state === 'skip';

	return (
		<div className={styles.root}>
			<div className={styles.texts}>
				<InlineEditableText
					value={category.text}
					label="Category name"
					placeholder="Unnamed category"
					variant="title"
					rows={1}
					onCommit={(text) => renameCategory(categoryKey, text)}
				/>
				<InlineEditableText
					value={category.activation_text}
					label="Activation text"
					placeholder="Activation text (optional)"
					variant="caption"
					rows={1}
					onCommit={(text) => setActivationText(categoryKey, text)}
				/>
			</div>
			<div className={styles.actions}>
				<PriorityField categoryKey={categoryKey} />
				<Tooltip content="Edit all sub-prompts" relationship="label">
					<Button appearance="subtle" icon={<TextBulletListSquareEdit20Regular />} aria-label="Edit all sub-prompts" onClick={onEditAll} />
				</Tooltip>
				<Tooltip content="Add sub-prompt" relationship="label">
					<Button appearance="subtle" icon={<Add20Regular />} aria-label="Add sub-prompt" onClick={() => addSubPrompt(categoryKey)} />
				</Tooltip>
				<Tooltip content={skipped ? 'Unskip category' : 'Skip category'} relationship="description">
					<ToggleButton
						appearance="subtle"
						icon={<Prohibited20Regular />}
						aria-label="Skip category"
						checked={skipped}
						onClick={() => setCategoryState(categoryKey, skipped ? 'normal' : 'skip')}
					/>
				</Tooltip>
				<Tooltip content="Delete category" relationship="label">
					<Button appearance="subtle" icon={<Delete20Regular />} aria-label="Delete category" onClick={() => setConfirmDelete(true)} />
				</Tooltip>
			</div>
			<DeleteCategoryDialog
				open={confirmDelete}
				categoryName={category.text}
				onDismiss={() => setConfirmDelete(false)}
				onConfirm={() => {
					setConfirmDelete(false);
					removeCategory(categoryKey);
				}}
			/>
		</div>
	);
}
