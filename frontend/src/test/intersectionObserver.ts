// Controllable IntersectionObserver for component tests (jsdom has none): install() replaces the global with a
// stub that records every observer (callback, options, observed elements) and reports intersections only when a
// test calls intersect(). restore() puts the previous global back (call it in afterEach).
import { act } from '@testing-library/react';

export class StubIntersectionObserver {
	public readonly root: Element | Document | null;
	public readonly rootMargin: string;
	public readonly thresholds: readonly number[];
	public readonly targets = new Set<Element>();
	public disconnected = false;

	public constructor(
		private readonly callback: IntersectionObserverCallback,
		options: IntersectionObserverInit = {},
	) {
		this.root = options.root ?? null;
		this.rootMargin = options.rootMargin ?? '0px';
		const threshold = options.threshold ?? 0;
		this.thresholds = Array.isArray(threshold) ? threshold : [threshold];
	}

	public observe(target: Element): void {
		this.targets.add(target);
	}

	public unobserve(target: Element): void {
		this.targets.delete(target);
	}

	public disconnect(): void {
		this.targets.clear();
		this.disconnected = true;
	}

	public takeRecords(): IntersectionObserverEntry[] {
		return [];
	}

	/** Calls the observer's callback with one entry for `target`. */
	public report(target: Element, isIntersecting: boolean): void {
		const rect = target.getBoundingClientRect();
		const entry = {
			target,
			isIntersecting,
			intersectionRatio: isIntersecting ? 1 : 0,
			boundingClientRect: rect,
			intersectionRect: isIntersecting ? rect : new DOMRect(),
			rootBounds: null,
			time: performance.now(),
		} as IntersectionObserverEntry;
		this.callback([entry], this as unknown as IntersectionObserver);
	}
}

export type IntersectionObserverControl = {
	/** Every observer created since install(), disconnected ones included (flagged). */
	readonly observers: readonly StubIntersectionObserver[];
	/** The live observers watching `target`. */
	observing: (target: Element) => StubIntersectionObserver[];
	/** Reports `target` entering (true, default) or leaving the root to every live observer watching it (in act). */
	intersect: (target: Element, isIntersecting?: boolean) => void;
	/** Puts the previous global back. */
	restore: () => void;
};

export function installIntersectionObserver(): IntersectionObserverControl {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
	const observers: StubIntersectionObserver[] = [];

	class RecordingIntersectionObserver extends StubIntersectionObserver {
		public constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
			super(callback, options);
			observers.push(this);
		}
	}

	Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, writable: true, value: RecordingIntersectionObserver });

	const observing = (target: Element) => observers.filter((observer) => !observer.disconnected && observer.targets.has(target));
	return {
		observers,
		observing,
		intersect: (target, isIntersecting = true) => {
			act(() => {
				for (const observer of observing(target)) {
					observer.report(target, isIntersecting);
				}
			});
		},
		restore: () => {
			if (previous) {
				Object.defineProperty(globalThis, 'IntersectionObserver', previous);
			} else {
				delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
			}
		},
	};
}
