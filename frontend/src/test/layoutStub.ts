// Test support for the app bar density (useToolbarDensity): jsdom does no layout, so the tests describe it. Every
// HTMLElement gets the same box width (the toolbar's available width) and a content width computed from the element
// (e.g. from its data-density), and ResizeObserver becomes controllable. Never imported by production code.
type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

export type LayoutStub = {
	/** The width of every element's box (clientWidth). */
	setAvailableWidth: (width: number) => void;
	/** The width every element's content needs (scrollWidth is the larger of this and the box width). */
	setNaturalWidth: (naturalWidth: (element: Element) => number) => void;
	/** Changes the box width and notifies the resize observers (call inside act()). */
	resize: (width: number) => void;
	/** Elements currently observed by resize observers. */
	observed: () => number;
	restore: () => void;
};

export function installLayoutStub(naturalWidth: (element: Element) => number): LayoutStub {
	let available = 0;
	let natural = naturalWidth;
	const observers = new Set<StubResizeObserver>();

	class StubResizeObserver {
		private readonly targets = new Set<Element>();

		constructor(private readonly callback: ResizeCallback) {}

		observe(target: Element): void {
			this.targets.add(target);
			observers.add(this);
		}

		unobserve(target: Element): void {
			this.targets.delete(target);
		}

		disconnect(): void {
			this.targets.clear();
			observers.delete(this);
		}

		notify(): void {
			const entries = [...this.targets].map((target) => ({ target }) as unknown as ResizeObserverEntry);
			if (entries.length > 0) {
				this.callback(entries, this as unknown as ResizeObserver);
			}
		}

		size(): number {
			return this.targets.size;
		}
	}

	const originalObserver = globalThis.ResizeObserver;
	globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => available });
	Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
		configurable: true,
		get(this: Element) {
			return Math.max(available, natural(this));
		},
	});

	return {
		setAvailableWidth: (width) => {
			available = width;
		},
		setNaturalWidth: (next) => {
			natural = next;
		},
		resize: (width) => {
			available = width;
			for (const observer of [...observers]) {
				observer.notify();
			}
		},
		observed: () => [...observers].reduce((count, observer) => count + observer.size(), 0),
		restore: () => {
			globalThis.ResizeObserver = originalObserver;
			// The stubs shadow jsdom's Element.prototype getters: removing them restores those.
			delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
			delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
		},
	};
}
