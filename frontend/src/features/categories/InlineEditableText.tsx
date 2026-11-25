// Click-to-edit text (category name, activation text, sub-prompt text). The one inline editor of the app:
// display = a subtle Fluent Button showing the text; edit = a Fluent Textarea where
// Enter commits, Shift+Enter inserts a newline, Escape cancels and blur commits.
// Pure view: the draft is ephemeral UI state; the owner store receives the committed text through onCommit.
import { Button, makeStyles, mergeClasses, Textarea, tokens } from '@fluentui/react-components';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export type InlineEditableTextVariant = 'title' | 'body' | 'caption';

export type InlineEditableTextProps = {
	value: string;
	/** Called with the edited text when it differs from `value` (Enter or blur). */
	onCommit: (text: string) => void;
	/** What the text is ('Category name', 'Sub-prompt', ...): accessible name of the editor and the display. */
	label: string;
	/** Shown (subtle) when the value is empty. */
	placeholder: string;
	variant?: InlineEditableTextVariant;
	/** Initial height of the editor. */
	rows?: number;
	/** Extra classes of the display button (row state styling: src/ui/stateStyles.tsx text classes). */
	displayClassName?: string;
	/** Accessible description of the display button (e.g. the row's visual state label). */
	description?: string;
};

const useStyles = makeStyles({
	display: {
		width: '100%',
		minWidth: 0,
		justifyContent: 'flex-start',
		textAlign: 'start',
		whiteSpace: 'pre-wrap',
		overflowWrap: 'anywhere',
		paddingTop: tokens.spacingVerticalXS,
		paddingBottom: tokens.spacingVerticalXS,
		paddingLeft: tokens.spacingHorizontalS,
		paddingRight: tokens.spacingHorizontalS,
		fontWeight: tokens.fontWeightRegular,
	},
	// Typography of each variant, the same while displayed and while edited (the text does not jump on edit).
	title: {
		fontSize: tokens.fontSizeBase400,
		lineHeight: tokens.lineHeightBase400,
		fontWeight: tokens.fontWeightSemibold,
	},
	body: {
		fontSize: tokens.fontSizeBase300,
		lineHeight: tokens.lineHeightBase300,
	},
	caption: {
		fontSize: tokens.fontSizeBase200,
		lineHeight: tokens.lineHeightBase200,
	},
	captionDisplay: {
		color: tokens.colorNeutralForeground2,
	},
	placeholder: {
		color: tokens.colorNeutralForeground4,
		fontStyle: 'italic',
	},
	editor: {
		width: '100%',
		minWidth: 0,
	},
	// On the <textarea> itself (the element scrolled into view): its field border, its row and the list padding stay
	// visible around it.
	editorInput: {
		scrollMarginTop: tokens.spacingVerticalXL,
		scrollMarginBottom: tokens.spacingVerticalXL,
	},
});

export function InlineEditableText({
	value,
	onCommit,
	label,
	placeholder,
	variant = 'body',
	rows = 2,
	displayClassName,
	description,
}: InlineEditableTextProps): JSX.Element {
	const styles = useStyles();
	const [draft, setDraft] = useState<string | null>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const displayRef = useRef<HTMLButtonElement>(null);
	/** True while an edit session is open: guards against a blur after Escape/Enter already closed it. */
	const sessionOpenRef = useRef(false);
	const restoreFocusRef = useRef(false);
	const editing = draft !== null;

	useLayoutEffect(() => {
		if (editing) {
			const editor = editorRef.current;
			if (editor) {
				editor.focus();
				editor.setSelectionRange(editor.value.length, editor.value.length);
				// The editor is taller than the text: keep all of it visible in its scrolling list.
				editor.scrollIntoView?.({ block: 'nearest' });
			}
		} else if (restoreFocusRef.current) {
			restoreFocusRef.current = false;
			displayRef.current?.focus();
		}
	}, [editing]);

	function begin(): void {
		sessionOpenRef.current = true;
		setDraft(value);
	}

	function close(commit: boolean, restoreFocus: boolean): void {
		if (!sessionOpenRef.current) {
			return;
		}
		sessionOpenRef.current = false;
		restoreFocusRef.current = restoreFocus;
		const text = draft ?? value;
		setDraft(null);
		if (commit && text !== value) {
			onCommit(text);
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close(false, true);
			return;
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			event.stopPropagation();
			close(true, true);
		}
	}

	if (editing) {
		return (
			<Textarea
				ref={editorRef}
				className={styles.editor}
				textarea={{ className: mergeClasses(styles[variant], styles.editorInput) }}
				aria-label={label}
				placeholder={placeholder}
				value={draft}
				rows={rows}
				resize="vertical"
				onChange={(_event, data) => setDraft(data.value)}
				onKeyDown={handleKeyDown}
				onBlur={() => close(true, false)}
			/>
		);
	}

	return (
		<Button
			ref={displayRef}
			appearance="subtle"
			className={mergeClasses(
				styles.display,
				styles[variant],
				variant === 'caption' && styles.captionDisplay,
				value ? undefined : styles.placeholder,
				displayClassName,
			)}
			aria-label={`${label}: ${value || placeholder}`}
			aria-description={description}
			onClick={begin}
		>
			{value || placeholder}
		</Button>
	);
}
