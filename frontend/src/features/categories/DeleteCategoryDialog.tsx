// Confirmation before deleting a category (Fluent alert dialog). Pure view: the caller owns `open`.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';

export type DeleteCategoryDialogProps = {
	open: boolean;
	categoryName: string;
	onConfirm: () => void;
	onDismiss: () => void;
};

export function DeleteCategoryDialog({ open, categoryName, onConfirm, onDismiss }: DeleteCategoryDialogProps): JSX.Element {
	return (
		<Dialog
			open={open}
			modalType="alert"
			onOpenChange={(_event, data) => {
				if (!data.open) {
					onDismiss();
				}
			}}
		>
			<DialogSurface>
				<DialogBody>
					<DialogTitle>Delete category '{categoryName || '(unnamed category)'}'?</DialogTitle>
					<DialogContent>Its sub-prompts and the forbidden rules naming it are deleted too.</DialogContent>
					<DialogActions>
						<Button appearance="secondary" onClick={onDismiss}>
							Cancel
						</Button>
						<Button appearance="primary" onClick={onConfirm}>
							Delete
						</Button>
					</DialogActions>
				</DialogBody>
			</DialogSurface>
		</Dialog>
	);
}
