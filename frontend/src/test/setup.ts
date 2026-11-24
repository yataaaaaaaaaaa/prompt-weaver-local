// Vitest setup for every test file (logic, store and component tests).
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { resetPersistenceForTests } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';

// Resets every zustand store to its initial state after each test (see __mocks__/zustand.ts).
vi.mock('zustand');

// Persisted stores never reach the network in tests: each test starts with an empty in-memory backend.
// Tests needing seeded data call setStoreBackend(createMemoryStoreBackend({...})) themselves.
beforeEach(() => {
	resetPersistenceForTests();
	setStoreBackend(createMemoryStoreBackend());
});

afterEach(() => {
	cleanup();
});

// jsdom gaps used by Fluent UI (skipped in `@vitest-environment node` files).
if (typeof window !== 'undefined' && !window.matchMedia) {
	Object.defineProperty(window, 'matchMedia', {
		writable: true,
		value: (query: string): MediaQueryList => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => undefined,
			removeListener: () => undefined,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			dispatchEvent: () => false,
		}),
	});
}

if (!('ResizeObserver' in globalThis)) {
	class ResizeObserverStub {
		public observe(): void {}
		public unobserve(): void {}
		public disconnect(): void {}
	}
	(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
	Element.prototype.scrollIntoView = () => undefined;
}
