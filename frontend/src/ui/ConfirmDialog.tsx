// Confirmation before a destructive action (Fluent alert dialog: title, explanation, Cancel and the confirm button).
// Pure view: the caller owns `open` and the action. Shared by the category and character deletions.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from '@fluentui/react-components';
import type { ReactNode } from 'react';

export type ConfirmDialogProps = {
	open: boolean;
	title: string;
	children: ReactNode;
	/** Text of the confirm button (e.g. 'Delete'). */
	confirmLabel: string;
	onConfirm: () => void;
	onDismiss: () => void;
};

export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onDismiss }: ConfirmDialogProps): JSX.Element {
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
					<DialogTitle>{title}</DialogTitle>
					<DialogContent>{children}</DialogContent>
					<DialogActions>
						<Button appearance="secondary" onClick={onDismiss}>
							Cancel
						</Button>
						<Button appearance="primary" onClick={onConfirm}>
							{confirmLabel}
						</Button>
					</DialogActions>
				</DialogBody>
			</DialogSurface>
		</Dialog>
	);
}
