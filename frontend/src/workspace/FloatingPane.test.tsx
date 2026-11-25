import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_VISIBLE_WINDOW_OFFSET, type Rect, type WindowKey } from '../domain/layout';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { renderWithProviders } from '../test/render';
import { STATE_COLORS } from '../ui/stateColors';
import { FloatingPane, KEYBOARD_STEP, KEYBOARD_STEP_LARGE } from './FloatingPane';

const KEY: WindowKey = 'pane:test';
const DEFAULT_LAYOUT: Rect = { x: 100, y: 120, width: 400, height: 300 };

function stubActions() {
	const actions = { commitWindowRect: vi.fn(), focusWindow: vi.fn(), sendWindowToBack: vi.fn() };
	useWorkspaceStore.setState(actions);
	return actions;
}

function renderPane(props: Partial<Parameters<typeof FloatingPane>[0]> = {}) {
	return renderWithProviders(
		<FloatingPane windowKey={KEY} defaultLayout={DEFAULT_LAYOUT} title="Test pane" minWidth={200} minHeight={150} {...props}>
			<p>Pane content</p>
		</FloatingPane>,
	);
}

const region = () => screen.getByRole('region', { name: 'Test pane' });

let actions: ReturnType<typeof stubActions>;

beforeEach(() => {
	actions = stubActions();
});

describe('FloatingPane layout', () => {
	it('is drawn at the default layout until the store has one', () => {
		renderPane();
		expect(region()).toHaveStyle({ left: '100px', top: '120px', width: '400px', height: '300px', zIndex: '1' });
		expect(screen.getByText('Test pane')).toBeInTheDocument();
		expect(screen.getByText('Pane content')).toBeInTheDocument();
	});

	it('is drawn at the stored layout and z-index', () => {
		useWorkspaceStore.setState({ windows: { [KEY]: { x: 300, y: 40, width: 500, height: 260, z: 7 } } });
		renderPane();
		expect(region()).toHaveStyle({ left: '300px', top: '40px', width: '500px', height: '260px', zIndex: '7' });
	});
});

describe('FloatingPane pointer interactions', () => {
	it('moves by the pointer delta while dragging the header and commits on release', async () => {
		renderPane();
		const handle = screen.getByRole('button', { name: 'Move Test pane' });

		fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 40 });
		await waitFor(() => expect(region()).toHaveStyle({ left: '150px', top: '150px' }));
		expect(actions.commitWindowRect).not.toHaveBeenCalled();

		fireEvent.pointerUp(window, { pointerId: 1, clientX: 60, clientY: 40 });

		expect(actions.commitWindowRect).toHaveBeenCalledTimes(1);
		expect(actions.commitWindowRect).toHaveBeenCalledWith(KEY, { x: 150, y: 150, width: 400, height: 300 });
	});

	it('keeps windows reachable when dragged past the top-left edge', () => {
		renderPane();
		fireEvent.pointerDown(screen.getByText('Test pane'), { button: 0, pointerId: 3, clientX: 500, clientY: 500 });
		fireEvent.pointerMove(window, { pointerId: 3, clientX: 0, clientY: 0 });
		fireEvent.pointerUp(window, { pointerId: 3 });

		expect(actions.commitWindowRect).toHaveBeenCalledWith(KEY, {
			x: MIN_VISIBLE_WINDOW_OFFSET,
			y: MIN_VISIBLE_WINDOW_OFFSET,
			width: DEFAULT_LAYOUT.width,
			height: DEFAULT_LAYOUT.height,
		});
	});

	it('resizes from the grip, respecting the minimum size', () => {
		renderPane();
		const grip = screen.getByRole('button', { name: 'Resize Test pane' });

		fireEvent.pointerDown(grip, { button: 0, pointerId: 2, clientX: 500, clientY: 420 });
		fireEvent.pointerMove(window, { pointerId: 2, clientX: 540, clientY: 0 });
		fireEvent.pointerUp(window, { pointerId: 2 });

		expect(actions.commitWindowRect).toHaveBeenCalledWith(KEY, { x: 100, y: 120, width: 440, height: 150 });
	});

	it('ignores other pointers, secondary buttons and clicks without movement', () => {
		renderPane();
		const handle = screen.getByRole('button', { name: 'Move Test pane' });

		fireEvent.pointerDown(handle, { button: 2, pointerId: 1, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 50 });
		fireEvent.pointerUp(window, { pointerId: 1 });

		fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { pointerId: 9, clientX: 50, clientY: 50 });
		fireEvent.pointerUp(window, { pointerId: 1 });

		expect(actions.commitWindowRect).not.toHaveBeenCalled();
	});

	it('cancels a drag on pointercancel without committing', () => {
		renderPane();
		fireEvent.pointerDown(screen.getByRole('button', { name: 'Move Test pane' }), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 50, clientY: 50 });
		fireEvent.pointerCancel(window, { pointerId: 1 });

		expect(actions.commitWindowRect).not.toHaveBeenCalled();
		expect(region()).toHaveStyle({ left: '100px', top: '120px' });
	});

	it('brings the window to the front on any pointer down inside it', () => {
		renderPane();
		fireEvent.pointerDown(screen.getByText('Pane content'));
		expect(actions.focusWindow).toHaveBeenCalledWith(KEY);
	});
});

describe('FloatingPane keyboard interactions', () => {
	it('moves with the arrow keys on the move handle (Shift for large steps)', async () => {
		const { user } = renderPane();
		screen.getByRole('button', { name: 'Move Test pane' }).focus();

		await user.keyboard('{ArrowRight}');
		expect(actions.commitWindowRect).toHaveBeenLastCalledWith(KEY, { ...DEFAULT_LAYOUT, x: DEFAULT_LAYOUT.x + KEYBOARD_STEP });

		await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
		expect(actions.commitWindowRect).toHaveBeenLastCalledWith(KEY, { ...DEFAULT_LAYOUT, y: DEFAULT_LAYOUT.y + KEYBOARD_STEP_LARGE });
	});

	it('resizes with the arrow keys on the resize grip', async () => {
		const { user } = renderPane();
		screen.getByRole('button', { name: 'Resize Test pane' }).focus();

		await user.keyboard('{ArrowLeft}');
		expect(actions.commitWindowRect).toHaveBeenLastCalledWith(KEY, { ...DEFAULT_LAYOUT, width: DEFAULT_LAYOUT.width - KEYBOARD_STEP });

		await user.keyboard('{Shift>}{ArrowUp}{/Shift}');
		expect(actions.commitWindowRect).toHaveBeenLastCalledWith(KEY, { ...DEFAULT_LAYOUT, height: DEFAULT_LAYOUT.height - KEYBOARD_STEP_LARGE });
	});

	it('ignores other keys', async () => {
		const { user } = renderPane();
		screen.getByRole('button', { name: 'Move Test pane' }).focus();
		await user.keyboard('a');
		expect(actions.commitWindowRect).not.toHaveBeenCalled();
	});
});

describe('FloatingPane actions', () => {
	it('sends the window to the back', async () => {
		const { user } = renderPane();
		await user.click(screen.getByRole('button', { name: 'Send Test pane to back' }));
		expect(actions.sendWindowToBack).toHaveBeenCalledWith(KEY);
	});

	it('shows a close button only when closable', async () => {
		const onClose = vi.fn();
		const { user, unmount } = renderPane({ onClose });
		await user.click(screen.getByRole('button', { name: 'Close Test pane' }));
		expect(onClose).toHaveBeenCalledTimes(1);
		unmount();

		renderPane();
		expect(screen.queryByRole('button', { name: 'Close Test pane' })).not.toBeInTheDocument();
	});

	it('uses the aria label when there is no visible title', () => {
		renderWithProviders(
			<FloatingPane windowKey="category:hair" defaultLayout={DEFAULT_LAYOUT} ariaLabel="hair category">
				<p>Card</p>
			</FloatingPane>,
		);
		expect(screen.getByRole('region', { name: 'hair category' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Move hair category' })).toBeInTheDocument();
	});
});

describe('FloatingPane chrome', () => {
	it('is a section of header, content body and footer; the resize grip has the footer to itself', () => {
		renderPane({ onClose: vi.fn(), headerActions: <button>Extra</button> });
		const [header, body, footer, ...rest] = Array.from(region().children);
		expect(rest).toEqual([]);
		expect(header.tagName).toBe('HEADER');
		expect(footer.tagName).toBe('FOOTER');

		// Every window command is in the header; the content is only in the body.
		for (const name of ['Move Test pane', 'Extra', 'Send Test pane to back', 'Close Test pane']) {
			expect(header).toContainElement(screen.getByRole('button', { name }));
		}
		expect(body).toContainElement(screen.getByText('Pane content'));
		expect(body).not.toContainElement(screen.getByRole('button', { name: 'Resize Test pane' }));

		// The grip lives below the body (never over the content) and is the footer's only control.
		const grip = screen.getByRole('button', { name: 'Resize Test pane' });
		expect(footer).toContainElement(grip);
		expect(footer.querySelectorAll('button')).toHaveLength(1);
	});

	it('shows the title next to the icon in the header', () => {
		renderPane({ icon: () => <svg data-testid="pane-icon" /> });
		const header = region().querySelector('header');
		expect(header).toHaveTextContent('Test pane');
		expect(header).toContainElement(screen.getByTestId('pane-icon'));
	});
});

describe('FloatingPane frame state', () => {
	it('shows no state by default', () => {
		renderPane();
		expect(region()).not.toHaveAttribute('data-visual-state');
		expect(region()).not.toHaveAttribute('aria-description');
	});

	it('marks the window with the state, its label and its icon (never color alone)', () => {
		renderPane({ frameState: 'forbidden' });
		expect(region()).toHaveAttribute('data-visual-state', 'forbidden');
		expect(region()).toHaveAttribute('aria-description', STATE_COLORS.forbidden.label);
		expect(screen.getByRole('img', { name: STATE_COLORS.forbidden.label })).toBeInTheDocument();
	});

	it('shows the state icon at the start of the header, next to the move handle, with its label in a tooltip', async () => {
		const { user } = renderPane({ frameState: 'forbidden', headerActions: <button>Extra</button> });
		const header = region().querySelector('header')!;
		const icon = screen.getByRole('img', { name: STATE_COLORS.forbidden.label });
		const move = screen.getByRole('button', { name: 'Move Test pane' });
		const extra = screen.getByRole('button', { name: 'Extra' });
		expect(header).toContainElement(icon);
		// Document order: move handle, state icon, title, then the commands (the icon never reads as a command).
		expect(move.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(icon.compareDocumentPosition(screen.getByText('Test pane')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(icon.compareDocumentPosition(extra) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

		await user.hover(icon);
		expect(await screen.findByRole('tooltip')).toHaveTextContent(STATE_COLORS.forbidden.label);
	});

	it('changes the frame classes with the state', () => {
		const { rerender } = renderPane({ frameState: 'associated' });
		const associatedClasses = region().className;
		rerender(
			<FloatingPane windowKey={KEY} defaultLayout={DEFAULT_LAYOUT} title="Test pane" frameState="indirectlyDisabled">
				<p>Pane content</p>
			</FloatingPane>,
		);
		expect(region().className).not.toBe(associatedClasses);
		expect(region()).toHaveAttribute('data-visual-state', 'indirectlyDisabled');
	});
});

describe('FloatingPane header actions', () => {
	it('shows extra commands in the header without starting a drag', async () => {
		const onAction = vi.fn();
		const { user } = renderPane({ headerActions: <button onClick={onAction}>Extra</button> });
		await user.click(screen.getByRole('button', { name: 'Extra' }));
		expect(onAction).toHaveBeenCalledTimes(1);
		expect(actions.commitWindowRect).not.toHaveBeenCalled();
	});
});

describe('FloatingPane reveal', () => {
	it('scrolls into view when the workspace store reveals it, and only then', () => {
		const scrollIntoView = vi.fn();
		const original = HTMLElement.prototype.scrollIntoView;
		HTMLElement.prototype.scrollIntoView = scrollIntoView;
		try {
			useWorkspaceStore.setState({ revealRequest: { key: 'pane:other', serial: 1 } });
			renderPane();
			expect(scrollIntoView).not.toHaveBeenCalled();

			act(() => useWorkspaceStore.setState({ revealRequest: { key: KEY, serial: 2 } }));
			expect(scrollIntoView).toHaveBeenCalledTimes(1);
			expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
			expect(scrollIntoView.mock.contexts[0]).toBe(region());

			act(() => useWorkspaceStore.setState({ revealRequest: { key: KEY, serial: 3 } }));
			expect(scrollIntoView).toHaveBeenCalledTimes(2);
		} finally {
			HTMLElement.prototype.scrollIntoView = original;
		}
	});
});

describe('FloatingPane with the real workspace store', () => {
	it('stores the dragged rect', () => {
		useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
		renderPane();
		fireEvent.pointerDown(screen.getByRole('button', { name: 'Move Test pane' }), { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
		fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 30 });
		fireEvent.pointerUp(window, { pointerId: 1 });

		expect(useWorkspaceStore.getState().windows[KEY]).toMatchObject({ x: 120, y: 150, width: 400, height: 300 });
		expect(region()).toHaveStyle({ left: '120px', top: '150px' });
	});
});
