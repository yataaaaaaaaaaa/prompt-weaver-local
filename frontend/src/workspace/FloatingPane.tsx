// Movable/resizable window surface of the workspace (panes and category cards). The layout lives in the
// workspace store; only the rect being dragged/resized is local (ephemeral), committed on release.
import { Button, Caption1Strong, makeStyles, mergeClasses, tokens, Tooltip } from '@fluentui/react-components';
import {
	ArrowMaximizeTopLeftBottomRightRegular,
	DismissRegular,
	PositionToBackRegular,
	ReOrderDotsVerticalRegular,
	type FluentIcon,
} from '@fluentui/react-icons';
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from 'react';
import { moveRect, resizeRect, type Rect, type WindowKey } from '../domain/layout';
import { useIsTopWindow, useWindowLayout, useWorkspaceStore } from '../stores/workspaceStore';
import { ownsKeysProps } from '../ui/keyboard';

export const DEFAULT_MIN_WIDTH = 280;
export const DEFAULT_MIN_HEIGHT = 180;
/** Keyboard move/resize step (px); Shift uses the large step. */
export const KEYBOARD_STEP = 8;
export const KEYBOARD_STEP_LARGE = 40;

export type FloatingPaneProps = {
	windowKey: WindowKey;
	/** Rect used while the store has no layout for this window. */
	defaultLayout: Rect;
	/** Visible header title (also the window's accessible name). */
	title?: string;
	/** Accessible name when there is no visible title. */
	ariaLabel?: string;
	icon?: FluentIcon;
	/** Shows a close button (registered panes). */
	onClose?: () => void;
	minWidth?: number;
	minHeight?: number;
	children: ReactNode;
};

type InteractionKind = 'move' | 'resize';

type Interaction = {
	kind: InteractionKind;
	pointerId: number;
	startClientX: number;
	startClientY: number;
	start: Rect;
};

const ARROW_DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1],
};

const INTERACTION_CURSORS: Record<InteractionKind, string> = { move: 'grabbing', resize: 'nwse-resize' };

const useStyles = makeStyles({
	window: {
		position: 'absolute',
		display: 'flex',
		flexDirection: 'column',
		overflow: 'hidden',
		backgroundColor: tokens.colorNeutralBackground1,
		color: tokens.colorNeutralForeground1,
		border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		borderRadius: tokens.borderRadiusLarge,
		boxShadow: tokens.shadow16,
		transitionProperty: 'box-shadow',
		transitionDuration: tokens.durationFaster,
		transitionTimingFunction: tokens.curveEasyEase,
	},
	top: {
		boxShadow: tokens.shadow28,
	},
	header: {
		display: 'flex',
		alignItems: 'center',
		flexShrink: 0,
		gap: tokens.spacingHorizontalXS,
		padding: `${tokens.spacingVerticalXXS} ${tokens.spacingHorizontalXS}`,
		borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
		backgroundColor: tokens.colorNeutralBackground3,
	},
	dragRegion: {
		display: 'flex',
		alignItems: 'center',
		alignSelf: 'stretch',
		flex: 1,
		minWidth: 0,
		gap: tokens.spacingHorizontalXS,
		cursor: 'grab',
		touchAction: 'none',
		userSelect: 'none',
	},
	dragging: {
		cursor: 'grabbing',
	},
	handle: {
		cursor: 'inherit',
		touchAction: 'none',
	},
	titleIcon: {
		flexShrink: 0,
		fontSize: tokens.fontSizeBase400,
		color: tokens.colorNeutralForeground3,
	},
	title: {
		minWidth: 0,
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap',
	},
	actions: {
		display: 'flex',
		alignItems: 'center',
		flexShrink: 0,
		gap: tokens.spacingHorizontalXXS,
	},
	body: {
		position: 'relative',
		flex: 1,
		minHeight: 0,
		overflow: 'auto',
	},
	resizeGrip: {
		position: 'absolute',
		right: 0,
		bottom: 0,
		minWidth: 'auto',
		cursor: 'nwse-resize',
		touchAction: 'none',
		color: tokens.colorNeutralForeground3,
		borderTopLeftRadius: tokens.borderRadiusMedium,
		borderTopRightRadius: 0,
		borderBottomLeftRadius: 0,
		borderBottomRightRadius: tokens.borderRadiusLarge,
	},
});

export function FloatingPane({
	windowKey,
	defaultLayout,
	title,
	ariaLabel,
	icon: Icon,
	onClose,
	minWidth = DEFAULT_MIN_WIDTH,
	minHeight = DEFAULT_MIN_HEIGHT,
	children,
}: FloatingPaneProps): JSX.Element {
	const styles = useStyles();
	const layout = useWindowLayout(windowKey, defaultLayout);
	const isTop = useIsTopWindow(windowKey);
	const commitWindowRect = useWorkspaceStore((state) => state.commitWindowRect);
	const focusWindow = useWorkspaceStore((state) => state.focusWindow);
	const sendWindowToBack = useWorkspaceStore((state) => state.sendWindowToBack);

	// Ephemeral interaction state: the rect being dragged/resized (null when idle) and the active gesture.
	const [draft, setDraft] = useState<Rect | null>(null);
	const [activeKind, setActiveKind] = useState<InteractionKind | null>(null);
	const interactionRef = useRef<Interaction | null>(null);
	const latestRectRef = useRef<Rect | null>(null);
	const frameRef = useRef<number | null>(null);
	const detachRef = useRef<(() => void) | null>(null);

	const name = title ?? ariaLabel ?? 'window';
	const current: Rect = { x: layout.x, y: layout.y, width: layout.width, height: layout.height };
	const currentRef = useRef(current);
	currentRef.current = current;
	const shown = draft ?? current;

	const commit = useCallback((rect: Rect) => commitWindowRect(windowKey, rect), [commitWindowRect, windowKey]);

	const scheduleDraft = useCallback((rect: Rect) => {
		latestRectRef.current = rect;
		if (frameRef.current === null) {
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = null;
				setDraft(latestRectRef.current);
			});
		}
	}, []);

	/** Stops the active gesture (if any); commits its last rect when `commitResult`. */
	const endInteraction = useCallback(
		(commitResult: boolean) => {
			const interaction = interactionRef.current;
			if (!interaction) {
				return;
			}
			const rect = latestRectRef.current;
			interactionRef.current = null;
			latestRectRef.current = null;
			detachRef.current?.();
			detachRef.current = null;
			if (frameRef.current !== null) {
				cancelAnimationFrame(frameRef.current);
				frameRef.current = null;
			}
			document.body.style.removeProperty('cursor');
			document.body.style.removeProperty('user-select');
			if (commitResult && rect) {
				commit(rect);
			}
			setDraft(null);
			setActiveKind(null);
		},
		[commit],
	);

	const beginInteraction = useCallback(
		(kind: InteractionKind, event: ReactPointerEvent<HTMLElement>) => {
			if (event.button !== 0) {
				return;
			}
			event.preventDefault();
			endInteraction(false);
			interactionRef.current = {
				kind,
				pointerId: event.pointerId,
				startClientX: event.clientX,
				startClientY: event.clientY,
				start: currentRef.current,
			};

			const handleMove = (moveEvent: PointerEvent) => {
				const interaction = interactionRef.current;
				if (!interaction || moveEvent.pointerId !== interaction.pointerId) {
					return;
				}
				const deltaX = moveEvent.clientX - interaction.startClientX;
				const deltaY = moveEvent.clientY - interaction.startClientY;
				scheduleDraft(
					interaction.kind === 'move'
						? moveRect(interaction.start, deltaX, deltaY)
						: resizeRect(interaction.start, deltaX, deltaY, { width: minWidth, height: minHeight }),
				);
			};
			const handleUp = (upEvent: PointerEvent) => {
				if (interactionRef.current && upEvent.pointerId === interactionRef.current.pointerId) {
					endInteraction(upEvent.type === 'pointerup');
				}
			};
			window.addEventListener('pointermove', handleMove);
			window.addEventListener('pointerup', handleUp);
			window.addEventListener('pointercancel', handleUp);
			detachRef.current = () => {
				window.removeEventListener('pointermove', handleMove);
				window.removeEventListener('pointerup', handleUp);
				window.removeEventListener('pointercancel', handleUp);
			};
			document.body.style.setProperty('cursor', INTERACTION_CURSORS[kind]);
			document.body.style.setProperty('user-select', 'none');
			setActiveKind(kind);
		},
		[endInteraction, scheduleDraft, minWidth, minHeight],
	);

	useEffect(() => () => endInteraction(false), [endInteraction]);

	const handleKeyboard = (kind: InteractionKind, event: ReactKeyboardEvent<HTMLElement>) => {
		const direction = ARROW_DIRECTIONS[event.key];
		if (!direction || event.ctrlKey || event.metaKey || event.altKey) {
			return;
		}
		event.preventDefault();
		const step = event.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP;
		const [deltaX, deltaY] = [direction[0] * step, direction[1] * step];
		commit(kind === 'move' ? moveRect(current, deltaX, deltaY) : resizeRect(current, deltaX, deltaY, { width: minWidth, height: minHeight }));
	};

	return (
		<section
			aria-label={name}
			className={mergeClasses(styles.window, isTop && styles.top)}
			style={{ left: shown.x, top: shown.y, width: shown.width, height: shown.height, zIndex: layout.z }}
			onPointerDownCapture={() => focusWindow(windowKey)}
		>
			<div className={styles.header}>
				<div
					className={mergeClasses(styles.dragRegion, activeKind === 'move' && styles.dragging)}
					onPointerDown={(event) => beginInteraction('move', event)}
				>
					<Tooltip content="Drag to move, or use the arrow keys (Shift for larger steps)" relationship="description">
						<Button
							{...ownsKeysProps}
							appearance="subtle"
							size="small"
							className={styles.handle}
							icon={<ReOrderDotsVerticalRegular />}
							aria-label={`Move ${name}`}
							onKeyDown={(event) => handleKeyboard('move', event)}
						/>
					</Tooltip>
					{Icon ? <Icon aria-hidden className={styles.titleIcon} /> : null}
					{title ? <Caption1Strong className={styles.title}>{title}</Caption1Strong> : null}
				</div>
				<div className={styles.actions}>
					<Tooltip content={`Send ${name} to back`} relationship="label">
						<Button appearance="subtle" size="small" icon={<PositionToBackRegular />} onClick={() => sendWindowToBack(windowKey)} />
					</Tooltip>
					{onClose ? (
						<Tooltip content={`Close ${name}`} relationship="label">
							<Button appearance="subtle" size="small" icon={<DismissRegular />} onClick={onClose} />
						</Tooltip>
					) : null}
				</div>
			</div>
			<div className={styles.body}>{children}</div>
			<Tooltip content="Drag to resize, or use the arrow keys (Shift for larger steps)" relationship="description">
				<Button
					{...ownsKeysProps}
					appearance="subtle"
					size="small"
					className={styles.resizeGrip}
					icon={<ArrowMaximizeTopLeftBottomRightRegular />}
					aria-label={`Resize ${name}`}
					onPointerDown={(event) => beginInteraction('resize', event)}
					onKeyDown={(event) => handleKeyboard('resize', event)}
				/>
			</Tooltip>
		</section>
	);
}
