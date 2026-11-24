// Confirmation before deleting a category (the shared ConfirmDialog). Pure view: the caller owns `open`.
import { ConfirmDialog } from '../../ui/ConfirmDialog';

export type DeleteCategoryDialogProps = {
	open: boolean;
	categoryName: string;
	onConfirm: () => void;
	onDismiss: () => void;
};

export function DeleteCategoryDialog({ open, categoryName, onConfirm, onDismiss }: DeleteCategoryDialogProps): JSX.Element {
	return (
		<ConfirmDialog
			open={open}
			title={`Delete category '${categoryName || '(unnamed category)'}'?`}
			confirmLabel="Delete"
			onConfirm={onConfirm}
			onDismiss={onDismiss}
		>
			Its sub-prompts and the forbidden rules naming it are deleted too.
		</ConfirmDialog>
	);
}
