import * as React from "react";

export type EditableDisplayProps = {
	text: string;
};

export type EditableDisplayComponent = (props: EditableDisplayProps) => JSX.Element | null;

export interface EditableOnDemandTextProps {
	text: string;
	onExit: (nextText: string) => void;
	DisplayComponent: EditableDisplayComponent;
	className?: string;
	displayClassName?: string;
	textareaClassName?: string;
	ariaLabel?: string;
	placeholder?: string;
	disabled?: boolean;
	rows?: number;
	/**
	 * Defaults to false because plain Enter is usually a poor UX for large,
	 * multi-line text. When false, Ctrl+Enter / Cmd+Enter commits instead.
	 */
	commitOnPlainEnter?: boolean;
	onCancel?: () => void;
	editToken?: number;
}

export default function EditableOnDemandText({
	text,
	onExit,
	DisplayComponent,
	className,
	displayClassName,
	textareaClassName,
	ariaLabel = "Editable text",
	placeholder,
	disabled = false,
	rows = 6,
	commitOnPlainEnter = true,
	onCancel,
	editToken,
}: EditableOnDemandTextProps): JSX.Element {
	const [isEditing, setIsEditing] = React.useState(false);
	const [draftText, setDraftText] = React.useState(text);
	const previousEditTokenRef = React.useRef<number | undefined>(undefined);

	React.useEffect(() => {
		if (!isEditing) {
			setDraftText(text);
		}
	}, [isEditing, text]);

	React.useEffect(() => {
		if (editToken == null) {
			previousEditTokenRef.current = undefined;
			return;
		}

		if (previousEditTokenRef.current === editToken) {
			return;
		}

		previousEditTokenRef.current = editToken;
		setDraftText(text);
		setIsEditing(true);
	}, [editToken, text]);

	function beginEditing(): void {
		if (disabled) {
			return;
		}

		setDraftText(text);
		setIsEditing(true);
	}

	function commit(nextText: string): void {
		setIsEditing(false);
		onExit(nextText);
	}

	function cancel(): void {
		setDraftText(text);
		setIsEditing(false);
		onCancel?.();
	}

	function handleBlur(): void {
		commit(draftText);
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
			return;
		}

		const shouldCommit = commitOnPlainEnter
			? event.key === 'Enter' && !event.shiftKey
			: event.key === 'Enter' && (event.ctrlKey || event.metaKey);
		if (!shouldCommit) {
			return;
		}

		event.preventDefault();
		commit(draftText);
	}

	if (isEditing) {
		return (
			<textarea
				className={textareaClassName}
				value={draftText}
				rows={rows}
				placeholder={placeholder}
				aria-label={ariaLabel}
				onChange={(event) => setDraftText(event.target.value)}
				onKeyDown={handleKeyDown}
				onBlur={handleBlur}
			/>
		);
	}

	return (
		<div className={className}>
			<div
				role="button"
				tabIndex={disabled ? -1 : 0}
				aria-label={ariaLabel}
				aria-disabled={disabled}
				className={displayClassName}
				onClick={beginEditing}
			>
				<DisplayComponent text={text} />
			</div>
		</div>
	);
}
