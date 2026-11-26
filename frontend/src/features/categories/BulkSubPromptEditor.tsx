// Bulk editor of a category's sub-prompts (entries separated by '\n|\n', the format of useBulkText).
// Ctrl/Cmd+Enter or blur applies the text through applyBulkText; Escape cancels.
import { Field, makeStyles, Textarea, tokens } from '@fluentui/react-components';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { CategoryKey } from '../../domain/categories';
import { useBulkText, useCategoriesStore } from '../../stores/categoriesStore';

// The editor fills the card body: the text area takes the height left by the label and the hint and scrolls inside.
// It keeps a usable minimum height: a card with few sub-prompts grows (up to its maximum height) while it is open.
const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		flex: '1 1 auto',
		minHeight: 0,
		paddingTop: tokens.spacingVerticalS,
		paddingBottom: tokens.spacingVerticalS,
		paddingLeft: tokens.spacingHorizontalS,
		paddingRight: tokens.spacingHorizontalS,
	},
	field: {
		flex: '1 1 auto',
		minHeight: 0,
		gridTemplateRows: 'auto 1fr auto',
	},
	textarea: {
		height: '100%',
		minHeight: '160px',
		maxHeight: 'none',
	},
	textareaInput: {
		height: '100%',
		maxHeight: 'none',
	},
});

export type BulkSubPromptEditorProps = {
	categoryKey: CategoryKey;
	onClose: () => void;
};

export function BulkSubPromptEditor({ categoryKey, onClose }: BulkSubPromptEditorProps): JSX.Element {
	const styles = useStyles();
	const bulkText = useBulkText(categoryKey);
	const applyBulkText = useCategoriesStore((state) => state.applyBulkText);
	// Seeded once when the editor opens; later store changes do not overwrite the draft.
	const [initialText] = useState(bulkText);
	const [draft, setDraft] = useState(bulkText);
	const closedRef = useRef(false);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useLayoutEffect(() => {
		textareaRef.current?.focus();
	}, []);

	function close(commit: boolean): void {
		if (closedRef.current) {
			return;
		}
		closedRef.current = true;
		if (commit && draft !== initialText) {
			applyBulkText(categoryKey, draft);
		}
		onClose();
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			close(false);
			return;
		}
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			event.stopPropagation();
			close(true);
		}
	}

	return (
		<div className={styles.root}>
			<Field
				className={styles.field}
				label="All sub-prompts"
				hint="Separate sub-prompts with a line containing only '|'. Ctrl+Enter applies, Escape cancels."
			>
				<Textarea
					ref={textareaRef}
					className={styles.textarea}
					textarea={{ className: styles.textareaInput }}
					value={draft}
					resize="none"
					onChange={(_event, data) => setDraft(data.value)}
					onKeyDown={handleKeyDown}
					onBlur={() => close(true)}
				/>
			</Field>
		</div>
	);
}
