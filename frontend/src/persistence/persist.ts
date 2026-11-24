// The one persistence mechanism of the frontend. Every persisted zustand store is created as
//
//   create<S>()(persist(stateCreator, persistedStoreOptions<S, P>({ name: STORE_NAMES.x, version, partialize, migrate? })))
//
// Guarantees:
// - no automatic hydration: the session store hydrates every persisted store explicitly at boot
//   (hydratePersistedStores) after the backend is reachable;
// - writes are ignored until the store was successfully read once, so defaults can never
//   overwrite persisted data (e.g. when a set() happens before hydration or the read failed);
// - writes are coalesced per store (latest state wins) and serialized;
// - `legacy` lets a store be seeded from older stores when it has no data yet (merge migrations).
import type { PersistOptions, PersistStorage, StorageValue } from 'zustand/middleware';
import { getStoreBackend, type StoredEnvelope } from './storeBackend';
import type { StoreName } from './storeNames';

export type LegacySources = {
	/** Store names read when the store itself has no persisted data. */
	names: readonly string[];
	/** Builds this store's envelope from the legacy envelopes (null = nothing to migrate). */
	combine: (envelopes: Record<string, StoredEnvelope | null>) => StoredEnvelope | null;
};

export type PersistedStoreConfig<S, P> = {
	name: StoreName;
	/** Bump when P changes shape and handle the old versions in `migrate`. */
	version: number;
	partialize: (state: S) => P;
	/** Required as soon as version > 0: receives the persisted state of an older version. */
	migrate?: (persistedState: unknown, version: number) => P;
	/** Defaults to a shallow merge of the persisted state over the initial state. */
	merge?: (persistedState: unknown, currentState: S) => S;
	legacy?: LegacySources;
};

type PersistErrorHandler = (storeName: string, error: unknown) => void;

const hydratedNames = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
const pending = new Map<string, StoredEnvelope>();
let errorHandler: PersistErrorHandler = (storeName, error) => {
	console.error(`[persistence] writing '${storeName}' failed`, error);
};

/** Lets the session store surface write failures as notifications. */
export function setPersistErrorHandler(handler: PersistErrorHandler): void {
	errorHandler = handler;
}

function drain(name: string): Promise<void> {
	const envelope = pending.get(name);
	if (!envelope) {
		inFlight.delete(name);
		return Promise.resolve();
	}
	pending.delete(name);
	const write = getStoreBackend()
		.write(name, envelope)
		.catch((error: unknown) => errorHandler(name, error))
		.then(() => drain(name));
	inFlight.set(name, write);
	return write;
}

function enqueueWrite(name: string, envelope: StoredEnvelope): Promise<void> {
	pending.set(name, envelope);
	return inFlight.get(name) ?? drain(name);
}

async function readEnvelope(name: string, legacy: LegacySources | undefined): Promise<StoredEnvelope | null> {
	const backend = getStoreBackend();
	const envelope = await backend.read(name);
	if (envelope || !legacy) {
		return envelope;
	}
	const legacyEnvelopes: Record<string, StoredEnvelope | null> = {};
	for (const legacyName of legacy.names) {
		legacyEnvelopes[legacyName] = await backend.read(legacyName);
	}
	return legacy.combine(legacyEnvelopes);
}

function createPersistStorage<P>(legacy: LegacySources | undefined): PersistStorage<P> {
	return {
		getItem: async (name) => {
			const envelope = await readEnvelope(name, legacy);
			hydratedNames.add(name);
			return envelope as StorageValue<P> | null;
		},
		setItem: (name, value) => {
			if (!hydratedNames.has(name)) {
				return;
			}
			return enqueueWrite(name, value as unknown as StoredEnvelope);
		},
		removeItem: (name) => getStoreBackend().remove(name),
	};
}

export function persistedStoreOptions<S, P>(config: PersistedStoreConfig<S, P>): PersistOptions<S, P> {
	// Undefined keys would override zustand's defaults (e.g. the default shallow merge).
	return {
		name: config.name,
		version: config.version,
		partialize: config.partialize,
		...(config.migrate ? { migrate: config.migrate } : {}),
		...(config.merge ? { merge: config.merge } : {}),
		skipHydration: true,
		storage: createPersistStorage<P>(config.legacy),
	};
}

/** The subset of a persisted zustand store needed to hydrate it. */
export type HydratableStore = {
	persist: {
		getOptions: () => { name?: string };
		rehydrate: () => Promise<void> | void;
		hasHydrated: () => boolean;
	};
};

/** Hydrates the given stores in parallel; resolves with the names that failed to load. */
export async function hydratePersistedStores(stores: readonly HydratableStore[]): Promise<string[]> {
	await Promise.all(stores.map((store) => store.persist.rehydrate()));
	return stores.filter((store) => !store.persist.hasHydrated()).map((store) => store.persist.getOptions().name ?? '?');
}

/** Resolves when every queued write has reached the backend. */
export async function flushPersistence(): Promise<void> {
	while (inFlight.size > 0) {
		await Promise.all(inFlight.values());
	}
}

/** Test helper: forget hydration state and queued writes. */
export function resetPersistenceForTests(): void {
	hydratedNames.clear();
	inFlight.clear();
	pending.clear();
}
