import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { flushPersistence, hydratePersistedStores, persistedStoreOptions } from './persist';
import { createMemoryStoreBackend, setStoreBackend, type StoreBackend } from './storeBackend';
import { STORE_NAMES } from './storeNames';

type CounterState = { count: number; label: string; transient: number; bump: () => void };

function makeCounterStore(options: Partial<Parameters<typeof persistedStoreOptions<CounterState, { count: number; label: string }>>[0]> = {}) {
	return create<CounterState>()(
		persist(
			(set) => ({
				count: 0,
				label: 'initial',
				transient: 0,
				bump: () => set((state) => ({ count: state.count + 1, transient: state.transient + 1 })),
			}),
			persistedStoreOptions<CounterState, { count: number; label: string }>({
				name: STORE_NAMES.generationSettings,
				version: 0,
				partialize: (state) => ({ count: state.count, label: state.label }),
				...options,
			}),
		),
	);
}

describe('persistedStoreOptions', () => {
	it('does not hydrate automatically and ignores writes before hydration', async () => {
		const backend = createMemoryStoreBackend({ 'settings-store': { state: { count: 5, label: 'saved' }, version: 0 } });
		setStoreBackend(backend);
		const store = makeCounterStore();

		expect(store.getState().count).toBe(0);
		store.getState().bump();
		await flushPersistence();

		expect(backend.snapshot()['settings-store'].state).toEqual({ count: 5, label: 'saved' });
	});

	it('hydrates explicitly, then persists the partialized state', async () => {
		const backend = createMemoryStoreBackend({ 'settings-store': { state: { count: 5, label: 'saved' }, version: 0 } });
		setStoreBackend(backend);
		const store = makeCounterStore();

		expect(await hydratePersistedStores([store])).toEqual([]);
		expect(store.getState().count).toBe(5);

		store.getState().bump();
		await flushPersistence();

		expect(backend.snapshot()['settings-store']).toEqual({ state: { count: 6, label: 'saved' }, version: 0 });
	});

	it('reports stores whose read failed and never writes them', async () => {
		const writes: string[] = [];
		const failing: StoreBackend = {
			read: async () => {
				throw new Error('backend down');
			},
			write: async (name) => {
				writes.push(name);
			},
			remove: async () => undefined,
		};
		setStoreBackend(failing);
		const store = makeCounterStore();

		expect(await hydratePersistedStores([store])).toEqual(['settings-store']);
		store.getState().bump();
		await flushPersistence();
		expect(writes).toEqual([]);
	});

	it('runs migrate for older versions and writes the migrated state back', async () => {
		const backend = createMemoryStoreBackend({ 'settings-store': { state: { total: 3 }, version: 0 } });
		setStoreBackend(backend);
		const store = makeCounterStore({
			version: 1,
			migrate: (persisted) => ({ count: (persisted as { total: number }).total, label: 'migrated' }),
		});

		await hydratePersistedStores([store]);
		await flushPersistence();

		expect(store.getState().count).toBe(3);
		expect(backend.snapshot()['settings-store']).toEqual({ state: { count: 3, label: 'migrated' }, version: 1 });
	});

	it('seeds a store from legacy sources when it has no data', async () => {
		const backend = createMemoryStoreBackend({ 'old-a': { state: { n: 2 }, version: 0 }, 'old-b': { state: { s: 'b' }, version: 0 } });
		setStoreBackend(backend);
		const store = makeCounterStore({
			legacy: {
				names: ['old-a', 'old-b'],
				combine: (envelopes) => ({
					state: { count: envelopes['old-a']?.state.n as number, label: envelopes['old-b']?.state.s as string },
					version: 0,
				}),
			},
		});

		await hydratePersistedStores([store]);

		expect(store.getState()).toMatchObject({ count: 2, label: 'b' });
	});

	it('coalesces bursts of writes to the latest state', async () => {
		const written: unknown[] = [];
		const memory = createMemoryStoreBackend();
		setStoreBackend({
			...memory,
			write: async (name, envelope) => {
				written.push(envelope.state);
				await memory.write(name, envelope);
			},
		});
		const store = makeCounterStore();
		await hydratePersistedStores([store]);

		store.getState().bump();
		store.getState().bump();
		store.getState().bump();
		await flushPersistence();

		expect(written.at(-1)).toEqual({ count: 3, label: 'initial' });
		expect(written.length).toBeLessThanOrEqual(2);
	});
});
