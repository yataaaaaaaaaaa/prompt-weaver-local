import { PointerEvent as ReactPointerEvent, ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { usePanelLayout } from "../stores/panelLayoutState";
import { useCategoryZIndex, usePaneZIndex, useWorkspaceZIndexStore } from "../stores/workspaceZIndex";
import type { PaneKey } from "../types";

type FloatingPaneDefaults = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type FloatingPaneChildrenProps = ReturnType<typeof usePanelLayout> & {
	zIndex: number;
};

type FloatingPaneProps = {
	identifier: string;
	defaultLayout: FloatingPaneDefaults;
	className?: string;
	children: (props: FloatingPaneChildrenProps) => ReactNode;
	minWidth?: number;
	minHeight?: number;
	kind?: "pane" | "category";
};

type PaneLayout = {
	x: number;
	y: number;
	width: number;
	height: number;
};

type DragState = {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startX: number;
	startY: number;
};

type ResizeState = {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	startWidth: number;
	startHeight: number;
};

function clamp(value: number, minimum: number): number {
	return value < minimum ? minimum : value;
}

function clampPosition(value: number): number {
	return clamp(value, 8);
}

function DragIcon(): JSX.Element {
	return (
		<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
			<path fill="currentColor" d="M2 2h8v1H2zm0 3h8v1H2zm0 3h8v1H2z" />
		</svg>
	);
}

function ReduceIcon(): JSX.Element {
	return (
		<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
			<path fill="currentColor" d="M2 3h8v1H2zm1 3h6v1H3zm1 3h4v1H4z" />
		</svg>
	);
}

function FloatingPane({
	identifier,
	defaultLayout,
	className = "",
	children,
	minWidth = 280,
	minHeight = 180,
	kind = "pane",
}: FloatingPaneProps): JSX.Element {
	const layout = usePanelLayout(identifier, defaultLayout);
	const { x, y, width, height, patchLayout } = layout;
	const zIndex = kind === "pane"
		? usePaneZIndex(identifier.replace(/^pane-/, "") as PaneKey)
		: useCategoryZIndex(identifier);
	const { focusPane, focusCategory, lowerPane, lowerCategory } = useWorkspaceZIndexStore();

	const displayLayoutRef = useRef<PaneLayout>({ x, y, width, height });
	const [displayLayout, setDisplayLayout] = useState<PaneLayout>({ x, y, width, height });
	const dragStateRef = useRef<DragState | null>(null);
	const resizeStateRef = useRef<ResizeState | null>(null);
	const rafHandleRef = useRef<number | null>(null);

	useEffect(() => {
		if (dragStateRef.current !== null || resizeStateRef.current !== null) {
			return;
		}
		const nextLayout = { x, y, width, height };
		displayLayoutRef.current = nextLayout;
		setDisplayLayout(nextLayout);
	}, [x, y, width, height]);

	const flushDisplayLayout = useCallback((nextLayout: PaneLayout) => {
		displayLayoutRef.current = nextLayout;
		if (rafHandleRef.current !== null) {
			cancelAnimationFrame(rafHandleRef.current);
		}
		rafHandleRef.current = requestAnimationFrame(() => {
			rafHandleRef.current = null;
			setDisplayLayout(displayLayoutRef.current);
		});
	}, []);

	const focusSelf = useCallback(() => {
		if (kind === "pane") {
			focusPane(identifier.replace(/^pane-/, "") as PaneKey);
			return;
		}
		focusCategory(identifier);
	}, [focusCategory, focusPane, identifier, kind]);

	const reduceSelf = useCallback(() => {
		if (kind === "pane") {
			lowerPane(identifier.replace(/^pane-/, "") as PaneKey);
			return;
		}
		lowerCategory(identifier);
	}, [identifier, kind, lowerCategory, lowerPane]);

	const stopInteractions = useCallback(() => {
		const current = displayLayoutRef.current;
		const wasDragging = dragStateRef.current !== null;
		const wasResizing = resizeStateRef.current !== null;

		dragStateRef.current = null;
		resizeStateRef.current = null;
		document.body.style.userSelect = "";
		document.body.style.cursor = "";

		if (wasDragging || wasResizing) {
			patchLayout(current);
		}
	}, [patchLayout]);

	useEffect(() => {
		return () => {
			if (rafHandleRef.current !== null) {
				cancelAnimationFrame(rafHandleRef.current);
			}
			stopInteractions();
		};
	}, [stopInteractions]);

	const handleSectionPointerDown = useCallback(() => {
		focusSelf();
	}, [focusSelf]);

	const beginDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		event.stopPropagation();
		focusSelf();

		const current = displayLayoutRef.current;
		dragStateRef.current = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startX: current.x,
			startY: current.y,
		};
		resizeStateRef.current = null;

		event.currentTarget.setPointerCapture?.(event.pointerId);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "grabbing";
	}, [focusSelf]);

	const beginResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
		event.preventDefault();
		event.stopPropagation();
		focusSelf();

		const current = displayLayoutRef.current;
		resizeStateRef.current = {
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startWidth: current.width,
			startHeight: current.height,
		};
		dragStateRef.current = null;

		event.currentTarget.setPointerCapture?.(event.pointerId);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "nwse-resize";
	}, [focusSelf]);

	useEffect(() => {
		function handlePointerMove(event: PointerEvent): void {
			const dragState = dragStateRef.current;
			if (dragState !== null && dragState.pointerId === event.pointerId) {
				flushDisplayLayout({
					...displayLayoutRef.current,
					x: clampPosition(dragState.startX + event.clientX - dragState.startClientX),
					y: clampPosition(dragState.startY + event.clientY - dragState.startClientY),
				});
				return;
			}

			const resizeState = resizeStateRef.current;
			if (resizeState === null || resizeState.pointerId !== event.pointerId) {
				return;
			}

			const widthDelta = event.clientX - resizeState.startClientX;
			const heightDelta = event.clientY - resizeState.startClientY;
			flushDisplayLayout({
				...displayLayoutRef.current,
				width: clamp(resizeState.startWidth + widthDelta, minWidth),
				height: clamp(resizeState.startHeight + heightDelta, minHeight),
			});
		}

		function handlePointerUp(event: PointerEvent): void {
			const dragState = dragStateRef.current;
			const resizeState = resizeStateRef.current;
			if (
				(dragState !== null && dragState.pointerId === event.pointerId) ||
				(resizeState !== null && resizeState.pointerId === event.pointerId)
			) {
				stopInteractions();
			}
		}

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		window.addEventListener("pointercancel", handlePointerUp);
		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
			window.removeEventListener("pointercancel", handlePointerUp);
		};
	}, [flushDisplayLayout, minHeight, minWidth, stopInteractions]);

	return (
		<section
			className={["floating-pane", className].filter(Boolean).join(" ")}
			style={{
				position: "absolute",
				left: displayLayout.x,
				top: displayLayout.y,
				width: displayLayout.width,
				height: displayLayout.height,
				zIndex,
			}}
			onPointerDown={handleSectionPointerDown}
		>
			<button
				type="button"
				className="floating-pane-drag-handle"
				title="Drag pane"
				aria-label="Drag pane"
				onPointerDown={beginDrag}
			>
				<DragIcon />
			</button>
			<button
				type="button"
				className="floating-pane-reduce-handle"
				title="Send pane to back"
				aria-label="Send pane to back"
				onClick={reduceSelf}
			>
				<ReduceIcon />
			</button>
			{children({ ...layout, x: displayLayout.x, y: displayLayout.y, width: displayLayout.width, height: displayLayout.height, zIndex })}
			<button
				type="button"
				className="floating-pane-resize-handle"
				title="Resize pane"
				aria-label="Resize pane"
				onPointerDown={beginResize}
			/>
		</section>
	);
}

export default FloatingPane;
