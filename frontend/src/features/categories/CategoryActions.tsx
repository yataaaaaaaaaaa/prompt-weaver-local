// Commands of a category card, the second row of its header: priority, then Edit all sub-prompts, Add sub-prompt,
// Skip category and Delete category (with its confirmation dialog). Colors of the action intents (checked Skip =
// warning, Delete = danger) come from src/ui/stateStyles.tsx only.
import { Button, makeStyles, ToggleButton, tokens, Tooltip, useRestoreFocusTarget } from '@fluentui/react-components';
import { AddRegular, DeleteRegular, ProhibitedRegular, TextBulletListSquareEditRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import type { CategoryKey } from '../../domain/categories';
import { findCategory, useCategoriesStore } from '../../stores/categoriesStore';
import { useActionClasses } from '../../ui/stateStyles';
import { DeleteCategoryDialog } from './DeleteCategoryDialog';
import { PriorityField } from './PriorityField';

const useStyles = makeStyles({
	root: {
		display: 'flex',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: tokens.spacingHorizontalXXS,
		minWidth: 0,
	},
	commands: {
		display: 'flex',
		alignItems: 'center',
		gap: tokens.spacingHorizontalXXS,
		marginLeft: 'auto',
	},
});

export type CategoryActionsProps = {
	categoryKey: CategoryKey;
	/** Opens the bulk editor (ephemeral card mode owned by CategoryCard). */
	onEditAll: () => void;
};

export function CategoryActions({ categoryKey, onEditAll }: CategoryActionsProps): JSX.Element | null {
	const styles = useStyles();
	const actions = useActionClasses();
	const exists = useCategoriesStore((state) => findCategory(state.categories, categoryKey) !== undefined);
	const name = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.text ?? '');
	const skipped = useCategoriesStore((state) => findCategory(state.categories, categoryKey)?.state === 'skip');
	const setCategoryState = useCategoriesStore((state) => state.setCategoryState);
	const addSubPrompt = useCategoriesStore((state) => state.addSubPrompt);
	const removeCategory = useCategoriesStore((state) => state.removeCategory);
	const [confirmDelete, setConfirmDelete] = useState(false);
	// The delete dialog returns the focus here when it closes (Cancel / Escape).
	const restoreFocusTarget = useRestoreFocusTarget();

	if (!exists) {
		return null;
	}

	return (
		<div className={styles.root} role="group" aria-label="Category actions">
			<PriorityField categoryKey={categoryKey} />
			<div className={styles.commands}>
				<Tooltip content="Edit all sub-prompts" relationship="label">
					<Button appearance="subtle" size="small" icon={<TextBulletListSquareEditRegular />} aria-label="Edit all sub-prompts" onClick={onEditAll} />
				</Tooltip>
				<Tooltip content="Add sub-prompt" relationship="label">
					<Button appearance="subtle" size="small" icon={<AddRegular />} aria-label="Add sub-prompt" onClick={() => addSubPrompt(categoryKey)} />
				</Tooltip>
				<Tooltip content={skipped ? 'Unskip category' : 'Skip category'} relationship="description">
					<ToggleButton
						appearance="subtle"
						size="small"
						className={skipped ? actions.filled.warning : undefined}
						icon={<ProhibitedRegular />}
						aria-label="Skip category"
						checked={skipped}
						onClick={() => setCategoryState(categoryKey, skipped ? 'normal' : 'skip')}
					/>
				</Tooltip>
				<Tooltip content="Delete category" relationship="label">
					<Button
						appearance="subtle"
						size="small"
						className={actions.subtle.danger}
						icon={<DeleteRegular />}
						aria-label="Delete category"
						onClick={() => setConfirmDelete(true)}
						{...restoreFocusTarget}
					/>
				</Tooltip>
			</div>
			<DeleteCategoryDialog
				open={confirmDelete}
				categoryName={name}
				onDismiss={() => setConfirmDelete(false)}
				onConfirm={() => {
					setConfirmDelete(false);
					removeCategory(categoryKey);
				}}
			/>
		</div>
	);
}
