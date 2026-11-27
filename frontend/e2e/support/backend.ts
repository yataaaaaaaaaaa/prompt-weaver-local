// Client of the e2e backend's control API (backend/tests/e2e/server.py) and of its real API for test setup, plus the
// persisted stores as the tests read, wait for and seed them.
//
// The reset options are defined once, in backend/tests/e2e/options.py (E2EResetRequest: generator, network, codex,
// files, remove). The backend rejects unknown fields (422), so a typo fails the test with the backend's message; field
// names here are passed through untouched.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { STORE_NAMES, type LegacyStoreName, type StoreName } from '../../src/persistence/storeNames';
import { BACKEND_DIR } from './env';

/** E2EResetRequest of backend/tests/e2e/options.py (see there for every field and its default). */
export type E2EResetOptions = {
	/** GeneratorOptions: step_delay_ms, fail_message. */
	generator?: Record<string, unknown>;
	/** NetworkOptions: chunk_delay_ms, download_chunks, stall_at_percent, corrupt_downloads, civitai_error_status,
	 *  civitai_delay_ms. */
	network?: Record<string, unknown>;
	/** CodexOptions, the user's Codex as the co-writer finds it (the fake app-server of backend/tests/fake_codex.py):
	 *  installed, account (null: signed out), delta_delay_ms, rules ({match, steps}), default_steps, fail_start. */
	codex?: Record<string, unknown>;
	/** Data dir files written after the fixture data (relative path -> JSON). See storeFile() and fixtureStoreFile(). */
	files?: Record<string, unknown>;
	/** Data dir files or folders deleted once everything is seeded (relative paths): 'output' for an empty output
	 *  history, 'output/0000000004.png' for an output whose picture is missing, 'characters' for no characters, 'stories'
	 *  for no stories. */
	remove?: string[];
};

/** E2EState of backend/tests/e2e/options.py. */
export type E2EState = {
	data_dir: string;
	models_root: string;
	resets: number;
	unexpected_requests: string[];
	generations: number;
	/** The fake Codex (a path the user can enter in the co-writer panel). */
	codex_path: string;
	/** Codex processes started since the reset (the status probe included). */
	codex_starts: number;
};

/** The fixture categories (backend/tests/e2e/fixtures/data/stores/categorie-store), by priority. */
export const FIXTURE_CATEGORIES = ['Subject', 'Outfit', 'Background', 'Weather effects', 'Lighting', 'Mood', 'Sea creatures'] as const;

/** The zustand envelope a persisted store file holds. */
export type StoreEnvelope<T> = { state: T; version: number };

/** A persisted frontend store file for E2EResetOptions.files (the zustand envelope the backend stores). */
export function storeFile(name: StoreName, state: Record<string, unknown>, version: number): Record<string, unknown> {
	return { [`stores/${name}/state.json`]: { state, version } };
}

/** The envelope of a store in the committed fixture data (backend/tests/e2e/fixtures/data/stores/<name>), legacy
 *  stores included (the migration tests compare them with what the backend holds after the app ran). */
export function fixtureStore<T>(name: StoreName | LegacyStoreName): StoreEnvelope<T> {
	const file = path.join(BACKEND_DIR, 'tests', 'e2e', 'fixtures', 'data', 'stores', name, 'state.json');
	return JSON.parse(readFileSync(file, 'utf8')) as StoreEnvelope<T>;
}

/** E2EResetOptions.files replacing a store with its fixture state changed by `change` (same version). */
export function fixtureStoreFile<T extends Record<string, unknown>>(name: StoreName, change: (state: T) => T): Record<string, unknown> {
	const { state, version } = fixtureStore<T>(name);
	return storeFile(name, change(state), version);
}

/**
 * Resolves with the state of the first successful save of the store `name` by the page (PUT /api/stores/<name>)
 * whose state satisfies `accepts`. Call it BEFORE the action that saves, await it after; the backend then holds that
 * state (persistence coalesces writes, the latest state wins, and serializes them).
 */
export async function savedStore<T>(page: Page, name: StoreName, accepts: (state: T) => boolean): Promise<T> {
	const response = await page.waitForResponse((candidate) => {
		const request = candidate.request();
		if (request.method() !== 'PUT' || new URL(candidate.url()).pathname !== `/api/stores/${name}`) {
			return false;
		}
		const body = request.postDataJSON() as { state?: T } | null;
		return body?.state !== undefined && accepts(body.state);
	});
	expect(response.ok(), `saving ${name}: HTTP ${response.status()}`).toBe(true);
	return (response.request().postDataJSON() as { state: T }).state;
}

export { STORE_NAMES };

export class E2EBackend {
	constructor(private readonly request: APIRequestContext) {}

	/** A fresh app on fresh synthetic data (every test starts with one; call again to change the options). */
	async reset(options: E2EResetOptions = {}): Promise<E2EState> {
		const response = await this.request.post('/__e2e__/reset', { data: options });
		expect(response.ok(), `e2e reset failed: ${response.status()} ${await response.text()}`).toBe(true);
		return (await response.json()) as E2EState;
	}

	async state(): Promise<E2EState> {
		const response = await this.request.get('/__e2e__/state');
		expect(response.ok()).toBe(true);
		return (await response.json()) as E2EState;
	}

	/** Changes the fake Codex's scenario during a test (CodexOptions fields, e.g. { account: 'chatgpt' }: signed in). */
	async codex(changes: Record<string, unknown>): Promise<E2EState> {
		const response = await this.request.post('/__e2e__/codex', { data: changes });
		expect(response.ok(), `e2e codex change failed: ${response.status()} ${await response.text()}`).toBe(true);
		return (await response.json()) as E2EState;
	}

	/** GET a real API route of the current app (test setup and assertions). */
	async get<T>(apiPath: string): Promise<T> {
		const response = await this.request.get(apiPath);
		expect(response.ok(), `GET ${apiPath}: ${response.status()} ${await response.text()}`).toBe(true);
		return (await response.json()) as T;
	}

	/** POST to a real API route of the current app (e.g. start a download before the page loads). */
	async post<T>(apiPath: string, data: unknown): Promise<T> {
		const response = await this.request.post(apiPath, { data });
		expect(response.ok(), `POST ${apiPath}: ${response.status()} ${await response.text()}`).toBe(true);
		return (await response.json()) as T;
	}

	/** The state of a persisted frontend store as the backend holds it (fails when nothing is persisted). */
	async storedState<T>(name: StoreName): Promise<T> {
		const { envelope } = await this.get<{ envelope: StoreEnvelope<T> | null }>(`/api/stores/${name}`);
		expect(envelope, `the persisted store ${name}`).not.toBeNull();
		return envelope!.state;
	}
}
