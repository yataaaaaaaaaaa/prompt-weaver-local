// The edit draft of a text field that saves through a store action when the edit is done (the Story section's title,
// text, tag and seed fields): the field shows `value` until it gets the focus, keeps what the user types meanwhile, and
// commits it when it loses the focus or on Enter (Ctrl+Enter in a multi-line field, where Enter adds a line); Escape
// puts `value` back. A value changed elsewhere (e.g. a tool) shows as soon as the field is not being edited.
// Ephemeral view state only: `commit` decides what is saved (it returns false to refuse a draft, which is then reset).
import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent } from 'react';

export type CommitFieldProps = {
	value: string;
	onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, data: { value: string }) => void;
	onFocus: (event: FocusEvent) => void;
	onBlur: (event: FocusEvent) => void;
	onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
};

/** Props for a Fluent Input / Textarea. `commit(draft)` runs when the draft differs from `value`; returning false
 *  resets the draft to `value`. */
export function useCommitField(value: string, commit: (draft: string) => boolean | void, { multiline = false }: { multiline?: boolean } = {}): CommitFieldProps {
	const [draft, setDraft] = useState(value);
	const editing = useRef(false);

	useEffect(() => {
		if (!editing.current) {
			setDraft(value);
		}
	}, [value]);

	const finish = (text: string) => {
		if (text !== value && commit(text) === false) {
			setDraft(value);
		}
	};

	return {
		value: draft,
		onChange: (_event, data) => setDraft(data.value),
		onFocus: () => {
			editing.current = true;
		},
		onBlur: () => {
			editing.current = false;
			finish(draft);
		},
		onKeyDown: (event) => {
			if (event.key === 'Escape' && draft !== value) {
				event.preventDefault();
				event.stopPropagation();
				setDraft(value);
			} else if (event.key === 'Enter' && (!multiline || event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				finish(draft);
			}
		},
	};
}
