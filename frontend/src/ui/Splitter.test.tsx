import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { commandForKeyEvent } from '../app/commands';
import { renderWithProviders } from '../test/render';
import { Splitter, SPLITTER_LARGE_STEP, SPLITTER_STEP, type SplitterProps } from './Splitter';

function renderSplitter(props: Partial<SplitterProps> = {}) {
	const handlers = { onCommit: vi.fn(), onDraft: vi.fn(), onToggleCollapse: vi.fn() };
	const result = renderWithProviders(
		<Splitter label="Resize Current image" controls="viewer-region" value={500} min={320} max={800} controlledSide="after" {...handlers} {...props} />,
	);
	return { ...result, ...handlers, splitter: screen.getByRole('separator', { name: 'Resize Current image' }) };
}

describe('Splitter', () => {
	it('is a focusable vertical window splitter valued in px of the region it controls', () => {
		const { splitter } = renderSplitter();

		expect(splitter).toHaveAttribute('aria-orientation', 'vertical');
		expect(splitter).toHaveAttribute('aria-controls', 'viewer-region');
		expect(splitter).toHaveAttribute('aria-valuenow', '500');
		expect(splitter).toHaveAttribute('aria-valuemin', '320');
		expect(splitter).toHaveAttribute('aria-valuemax', '800');
		expect(splitter).toHaveAttribute('tabindex', '0');
	});

	it('shows the value inside its range and never a maximum below the minimum', () => {
		const { splitter } = renderSplitter({ value: 1200, max: 200 });

		expect(splitter).toHaveAttribute('aria-valuemax', '320');
		expect(splitter).toHaveAttribute('aria-valuenow', '320');
	});

	it('moves with the arrow keys: left widens a region after it, right narrows it, Shift moves further', () => {
		const { splitter, onCommit } = renderSplitter();

		fireEvent.keyDown(splitter, { key: 'ArrowLeft' });
		expect(onCommit).toHaveBeenLastCalledWith(500 + SPLITTER_STEP);
		fireEvent.keyDown(splitter, { key: 'ArrowRight' });
		expect(onCommit).toHaveBeenLastCalledWith(500 - SPLITTER_STEP);
		fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });
		expect(onCommit).toHaveBeenLastCalledWith(500 + SPLITTER_LARGE_STEP);
	});

	it('moves the other way for a region before it', () => {
		const { splitter, onCommit } = renderSplitter({ controlledSide: 'before' });

		fireEvent.keyDown(splitter, { key: 'ArrowRight' });
		expect(onCommit).toHaveBeenLastCalledWith(500 + SPLITTER_STEP);
	});

	it('goes to the minimum and the maximum with Home and End, and stays inside the range', () => {
		const { splitter, onCommit } = renderSplitter({ value: 790 });

		fireEvent.keyDown(splitter, { key: 'Home' });
		expect(onCommit).toHaveBeenLastCalledWith(320);
		fireEvent.keyDown(splitter, { key: 'End' });
		expect(onCommit).toHaveBeenLastCalledWith(800);
		onCommit.mockClear();
		fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });
		expect(onCommit).toHaveBeenLastCalledWith(800);
	});

	it('commits nothing when the width does not change', () => {
		const { splitter, onCommit } = renderSplitter({ value: 800 });

		fireEvent.keyDown(splitter, { key: 'End' });
		fireEvent.keyDown(splitter, { key: 'ArrowLeft' });

		expect(onCommit).not.toHaveBeenCalled();
	});

	it('toggles the collapse of the region with Enter', () => {
		const { splitter, onToggleCollapse, onCommit } = renderSplitter();

		fireEvent.keyDown(splitter, { key: 'Enter' });

		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
		expect(onCommit).not.toHaveBeenCalled();
	});

	it('leaves modified keys to the app shortcuts, and owns its plain keys (they never browse outputs)', () => {
		const { splitter, onCommit } = renderSplitter();

		fireEvent.keyDown(splitter, { key: 'ArrowLeft', ctrlKey: true });

		expect(onCommit).not.toHaveBeenCalled();
		const press = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, target: splitter };
		expect(commandForKeyEvent({ ...press, key: 'ArrowRight' })).toBeNull();
		expect(commandForKeyEvent({ ...press, key: 'F6' })).toBe('next-region');
	});

	it('drags with the pointer: drafts the width live and commits it once, on release', () => {
		const { splitter, onCommit, onDraft } = renderSplitter();

		fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 1000 });
		fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 960 });
		fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 900 });

		expect(onDraft).toHaveBeenNthCalledWith(1, 540);
		expect(onDraft).toHaveBeenNthCalledWith(2, 600);
		expect(onCommit).not.toHaveBeenCalled();
		expect(splitter).toHaveFocus();

		fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 900 });

		expect(onDraft).toHaveBeenLastCalledWith(null);
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith(600);
	});

	it('commits the drag even when the owner already draws the draft as its value', () => {
		const handlers = { onCommit: vi.fn(), onDraft: vi.fn() };
		const props = { label: 'Resize Current image', controls: 'viewer-region', min: 320, max: 800, controlledSide: 'after' as const, ...handlers };
		const { rerender } = renderWithProviders(<Splitter {...props} value={500} />);
		const splitter = screen.getByRole('separator');

		fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 1000 });
		fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 900 });
		rerender(<Splitter {...props} value={600} />);
		fireEvent.pointerUp(splitter, { pointerId: 1 });

		expect(handlers.onCommit).toHaveBeenCalledWith(600);
	});

	it('commits nothing for a click without a move', () => {
		const { splitter, onCommit } = renderSplitter();

		fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 1000 });
		fireEvent.pointerUp(splitter, { pointerId: 1, clientX: 1000 });

		expect(onCommit).not.toHaveBeenCalled();
	});

	it('keeps a dragged width inside the range', () => {
		const { splitter, onCommit, onDraft } = renderSplitter();

		fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 1000 });
		fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 1500 });
		fireEvent.pointerUp(splitter, { pointerId: 1 });

		expect(onDraft).toHaveBeenNthCalledWith(1, 320);
		expect(onCommit).toHaveBeenCalledWith(320);
	});

	it('cancels a drag with Escape or a lost pointer capture: nothing is committed', () => {
		const { splitter, onCommit, onDraft } = renderSplitter();

		fireEvent.pointerDown(splitter, { button: 0, pointerId: 1, clientX: 1000 });
		fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 900 });
		fireEvent.keyDown(splitter, { key: 'Escape' });
		fireEvent.pointerUp(splitter, { pointerId: 1 });

		fireEvent.pointerDown(splitter, { button: 0, pointerId: 2, clientX: 1000 });
		fireEvent.pointerMove(splitter, { pointerId: 2, clientX: 900 });
		fireEvent.lostPointerCapture(splitter, { pointerId: 2 });
		fireEvent.pointerUp(splitter, { pointerId: 2 });

		expect(onDraft).toHaveBeenLastCalledWith(null);
		expect(onCommit).not.toHaveBeenCalled();
	});

	it('ignores other mouse buttons', () => {
		const { splitter, onDraft } = renderSplitter();

		fireEvent.pointerDown(splitter, { button: 2, pointerId: 1, clientX: 1000 });
		fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 900 });

		expect(onDraft).not.toHaveBeenCalled();
	});
});
