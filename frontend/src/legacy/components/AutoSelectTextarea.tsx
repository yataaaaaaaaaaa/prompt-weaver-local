import { useLayoutEffect, useRef, type ChangeEvent, type FocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

const autoSelectedSessions = new Set<string>();

type AutoSelectTextareaProps = {
	className?: string;
	rows?: number;
	value: string;
	placeholder?: string;
	autoFocus?: boolean;
	selectOnMount?: boolean;
	selectionIdentity: string;
	onChange: (value: string) => void;
	onCommit: () => void;
};

export default function AutoSelectTextarea(props: AutoSelectTextareaProps) {
	const {
		className,
		rows,
		value,
		placeholder,
		autoFocus = true,
		selectOnMount = true,
		selectionIdentity,
		onChange,
		onCommit,
	} = props;
	const ref = useRef<HTMLTextAreaElement | null>(null);

	useLayoutEffect(() => {
		if (!autoFocus || !ref.current) {
			return;
		}
		ref.current.focus();
	}, [autoFocus]);

	function stopPropagation(event: ReactMouseEvent<HTMLTextAreaElement>) {
		event.stopPropagation();
	}

	function handleFocus(event: FocusEvent<HTMLTextAreaElement>) {
		if (!selectOnMount || autoSelectedSessions.has(selectionIdentity)) {
			return;
		}
		autoSelectedSessions.add(selectionIdentity);
		event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
	}

	function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key !== 'Enter' || event.shiftKey) {
			return;
		}
		event.preventDefault();
		onCommit();
	}

	return (
		<textarea
			ref={ref}
			className={className}
			autoFocus={autoFocus}
			rows={rows}
			value={value}
			placeholder={placeholder}
			onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
			onBlur={() => onCommit()}
			onFocus={handleFocus}
			onKeyDown={handleKeyDown}
			onMouseDown={stopPropagation}
			onClick={stopPropagation}
			onContextMenu={stopPropagation}
		/>
	);
}
