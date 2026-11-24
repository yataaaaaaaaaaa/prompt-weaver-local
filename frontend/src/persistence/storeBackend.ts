// Where persisted store envelopes live. Production: the backend (/api/stores/{name}, files under
// <data_dir>/stores). Tests: an in-memory backend (installed by src/test/setup.ts).
import { api } from '../api/client';

/** zustand persist envelope ({ state, version }), stored verbatim as <name>/state.json. */
export type StoredEnvelope = {
	state: Record<string, unknown>;
	version: number;
};

export interface StoreBackend {
	read(name: string): Promise<StoredEnvelope | null>;
	write(name: string, envelope: StoredEnvelope): Promise<void>;
	remove(name: string): Promise<void>;
}

export const httpStoreBackend: StoreBackend = {
	read: (name) => api.readStore(name),
	write: (name, envelope) => api.writeStore(name, envelope),
	remove: (name) => api.deleteStore(name),
};

export type MemoryStoreBackend = StoreBackend & {
	snapshot: () => Record<string, StoredEnvelope>;
};

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function createMemoryStoreBackend(initial: Record<string, StoredEnvelope> = {}): MemoryStoreBackend {
	const data = new Map<string, StoredEnvelope>(Object.entries(clone(initial)));
	return {
		read: async (name) => (data.has(name) ? clone(data.get(name)!) : null),
		write: async (name, envelope) => {
			data.set(name, clone(envelope));
		},
		remove: async (name) => {
			data.delete(name);
		},
		snapshot: () => clone(Object.fromEntries(data)),
	};
}

let activeBackend: StoreBackend = httpStoreBackend;

export function getStoreBackend(): StoreBackend {
	return activeBackend;
}

export function setStoreBackend(backend: StoreBackend): void {
	activeBackend = backend;
}
