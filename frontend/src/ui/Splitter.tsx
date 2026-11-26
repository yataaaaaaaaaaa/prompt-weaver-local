// A WAI-ARIA window splitter (role="separator", vertical) between two docked regions: it resizes the region it
// controls (aria-controls) by pointer drag or keyboard, and Enter collapses that region. It takes no room in the row:
// a zero-width slot whose handle straddles the boundary between the two regions.
//
// - Pointer: drag with pointer capture; the width while dragging is a draft (onDraft, ephemeral view state), committed
//   once on release (onCommit). Escape or a lost capture cancels the drag.
// - Keys (owned by the splitter, src/ui/keyboard.ts ownsKeysProps, so they never browse outputs): ArrowLeft / ArrowRight
//   move the splitter by SPLITTER_STEP px (Shift: SPLITTER_LARGE_STEP), Home / End give the region its minimum /
//   maximum, Enter toggles its collapse. Every key press commits.
// - aria-valuenow / min / max are the controlled region's width in px.
import { makeStyles, mergeClasses, tokens } from '@fluentui/react-components';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { clamp } from '../domain/guards';
import { ownsKeysProps } from './keyboard';

/** One arrow key press, and with Shift. */
export const SPLITTER_STEP = 16;
export const SPLITTER_LARGE_STEP = 64;

const useStyles = makeStyles({
	slot: {
		position: 'relative',
		flexShrink: 0,
		width: 0,
		zIndex: 1,
	},
	handle: {
		position: 'absolute',
		top: 0,
		bottom: 0,
		left: `calc(-1 * ${tokens.spacingHorizontalXS})`,
		width: tokens.spacingHorizontalS,
		cursor: 'col-resize',
		touchAction: 'none',
		outlineStyle: 'none',
		// The boundary line, highlighted while hovered, focused or dragged.
		'::before': {
			content: '""',
			position: 'absolute',
			top: 0,
			bottom: 0,
			left: `calc(50% - ${tokens.strokeWidthThin})`,
			width: tokens.strokeWidthThick,
			backgroundColor: tokens.colorTransparentStroke,
			transitionProperty: 'background-color',
			transitionDuration: tokens.durationFaster,
			transitionTimingFunction: tokens.curveEasyEase,
		},
		// The grip: shows that the boundary can be dragged.
		'::after': {
			content: '""',
			position: 'absolute',
			top: `calc(50% - ${tokens.spacingVerticalL})`,
			height: `calc(2 * ${tokens.spacingVerticalL})`,
			left: `calc(50% - ${tokens.strokeWidthThick})`,
			width: `calc(2 * ${tokens.strokeWidthThick})`,
			borderRadius: tokens.borderRadiusCircular,
			backgroundColor: tokens.colorNeutralStroke1,
			transitionProperty: 'background-color',
			transitionDuration: tokens.durationFaster,
			transitionTimingFunction: tokens.curveEasyEase,
		},
		':hover::before': { backgroundColor: tokens.colorNeutralStroke1Hover },
		':hover::after': { backgroundColor: tokens.colorNeutralForeground3Hover },
		':focus-visible': {
			outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
			outlineOffset: `calc(-1 * ${tokens.strokeWidthThin})`,
			borderRadius: tokens.borderRadiusSmall,
		},
		':focus-visible::before': { backgroundColor: tokens.colorCompoundBrandStroke },
		':focus-visible::after': { backgroundColor: tokens.colorCompoundBrandStroke },
	},
	dragging: {
		'::before': { backgroundColor: tokens.colorCompoundBrandStroke },
		'::after': { backgroundColor: tokens.colorCompoundBrandStroke },
		':hover::before': { backgroundColor: tokens.colorCompoundBrandStroke },
		':hover::after': { backgroundColor: tokens.colorCompoundBrandStroke },
	},
});

export type SplitterProps = {
	/** Accessible name ('Resize Current image'). */
	label: string;
	/** Id of the controlled region (aria-controls). */
	controls: string;
	/** Drawn width of the controlled region (aria-valuenow). */
	value: number;
	/** Narrowest and widest width the splitter can give the region. */
	min: number;
	max: number;
	/** Side of the splitter the controlled region is on: 'after' (to its right: moving the splitter left widens it) or
	 *  'before'. */
	controlledSide: 'before' | 'after';
	/** The width while dragging, live; null once the drag ends or is cancelled. */
	onDraft?: (width: number | null) => void;
	/** A new width: at the end of a drag and on every key press. */
	onCommit: (width: number) => void;
	/** Enter: collapse (or restore) the controlled region. */
	onToggleCollapse?: () => void;
};

type Drag = { pointerId: number; startX: number; startValue: number; draft: number };

export function Splitter({ label, controls, value, min, max, controlledSide, onDraft, onCommit, onToggleCollapse }: SplitterProps): JSX.Element {
	const styles = useStyles();
	const drag = useRef<Drag | null>(null);
	const [dragging, setDragging] = useState(false);
	// Moving the splitter right (dx > 0) narrows a region after it and widens a region before it.
	const direction = controlledSide === 'after' ? -1 : 1;
	const bound = (width: number) => Math.round(clamp(width, min, Math.max(min, max)));
	const shown = bound(value);

	const commit = (width: number) => {
		const next = bound(width);
		if (next !== shown) {
			onCommit(next);
		}
	};

	const endDrag = (target: HTMLElement, commitDraft: boolean) => {
		const current = drag.current;
		if (!current) {
			return;
		}
		drag.current = null;
		setDragging(false);
		if (target.hasPointerCapture?.(current.pointerId)) {
			target.releasePointerCapture(current.pointerId);
		}
		onDraft?.(null);
		// While dragging, `value` already is the draft (the owner draws it): compare with where the drag started.
		if (commitDraft && current.draft !== current.startValue) {
			onCommit(current.draft);
		}
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) {
			return;
		}
		// No text selection while dragging; the handle takes the keyboard focus like a click on any control.
		event.preventDefault();
		event.currentTarget.focus();
		event.currentTarget.setPointerCapture?.(event.pointerId);
		drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: shown, draft: shown };
		setDragging(true);
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const current = drag.current;
		if (!current || current.pointerId !== event.pointerId) {
			return;
		}
		const draft = bound(current.startValue + direction * (event.clientX - current.startX));
		if (draft !== current.draft) {
			current.draft = draft;
			onDraft?.(draft);
		}
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		const step = event.shiftKey ? SPLITTER_LARGE_STEP : SPLITTER_STEP;
		switch (event.key) {
			case 'ArrowLeft':
				commit(shown - direction * step);
				break;
			case 'ArrowRight':
				commit(shown + direction * step);
				break;
			case 'Home':
				commit(min);
				break;
			case 'End':
				commit(max);
				break;
			case 'Enter':
				onToggleCollapse?.();
				break;
			case 'Escape':
				if (!drag.current) {
					return;
				}
				endDrag(event.currentTarget, false);
				break;
			default:
				return;
		}
		event.preventDefault();
	};

	return (
		<div className={styles.slot}>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label={label}
				aria-controls={controls}
				aria-valuenow={shown}
				aria-valuemin={min}
				aria-valuemax={Math.max(min, max)}
				tabIndex={0}
				{...ownsKeysProps}
				className={mergeClasses(styles.handle, dragging && styles.dragging)}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={(event) => endDrag(event.currentTarget, true)}
				onPointerCancel={(event) => endDrag(event.currentTarget, false)}
				onLostPointerCapture={(event) => endDrag(event.currentTarget, false)}
				onKeyDown={onKeyDown}
			/>
		</div>
	);
}
