import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installIntersectionObserver, type IntersectionObserverControl } from '../test/intersectionObserver';
import { INFINITE_SCROLL_ROOT_MARGIN, useInfiniteScroll, type InfiniteScrollOptions } from './useInfiniteScroll';

function List({ scrolls = false, ...options }: InfiniteScrollOptions & { scrolls?: boolean }): JSX.Element {
	const sentinelRef = useInfiniteScroll(options);
	return (
		<div data-testid="container" style={scrolls ? { overflowY: 'auto' } : undefined}>
			<div data-testid="sentinel" ref={sentinelRef} />
		</div>
	);
}

describe('useInfiniteScroll', () => {
	let io: IntersectionObserverControl;

	beforeEach(() => {
		io = installIntersectionObserver();
	});

	afterEach(() => {
		io.restore();
	});

	it('calls onReach when the sentinel becomes visible', () => {
		const onReach = vi.fn();
		render(<List onReach={onReach} enabled />);
		const sentinel = screen.getByTestId('sentinel');

		expect(io.observing(sentinel)).toHaveLength(1);
		io.intersect(sentinel, false);
		expect(onReach).not.toHaveBeenCalled();
		io.intersect(sentinel);
		expect(onReach).toHaveBeenCalledTimes(1);
		io.intersect(sentinel, false);
		io.intersect(sentinel);
		expect(onReach).toHaveBeenCalledTimes(2);
	});

	it('ignores intersections while disabled and uses the latest callback', () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = render(<List onReach={first} enabled={false} />);
		const sentinel = screen.getByTestId('sentinel');

		io.intersect(sentinel);
		expect(first).not.toHaveBeenCalled();

		rerender(<List onReach={second} enabled />);
		// Neither the flag nor the callback re-creates the observer.
		expect(io.observers).toHaveLength(1);
		io.intersect(sentinel);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledTimes(1);
	});

	it('re-checks the sentinel when the reset key changes, not on unrelated renders', () => {
		const onReach = vi.fn();
		const pageOne = ['a'];
		const { rerender } = render(<List onReach={onReach} enabled resetKey={pageOne} />);
		rerender(<List onReach={onReach} enabled resetKey={pageOne} />);
		expect(io.observers).toHaveLength(1);

		rerender(<List onReach={onReach} enabled resetKey={['a', 'b']} />);
		expect(io.observers).toHaveLength(2);
		expect(io.observers[0].disconnected).toBe(true);
		expect(io.observing(screen.getByTestId('sentinel'))).toEqual([io.observers[1]]);
	});

	it('observes inside the nearest scroll container with the root margin', () => {
		render(<List onReach={vi.fn()} enabled scrolls />);
		const observer = io.observing(screen.getByTestId('sentinel'))[0];

		expect(observer.root).toBe(screen.getByTestId('container'));
		expect(observer.rootMargin).toBe(INFINITE_SCROLL_ROOT_MARGIN);
	});

	it('falls back to the viewport and accepts a custom margin', () => {
		render(<List onReach={vi.fn()} enabled rootMargin="100px" />);
		const observer = io.observing(screen.getByTestId('sentinel'))[0];

		expect(observer.root).toBeNull();
		expect(observer.rootMargin).toBe('100px');
	});

	it('disconnects on unmount', () => {
		const { unmount } = render(<List onReach={vi.fn()} enabled />);
		unmount();

		expect(io.observers[0].disconnected).toBe(true);
	});
});

describe('useInfiniteScroll without IntersectionObserver', () => {
	it('does nothing', () => {
		expect(typeof IntersectionObserver).toBe('undefined');
		const onReach = vi.fn();
		const { unmount } = render(<List onReach={onReach} enabled />);

		expect(screen.getByTestId('sentinel')).toBeInTheDocument();
		unmount();
		expect(onReach).not.toHaveBeenCalled();
	});
});
