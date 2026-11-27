// Session store: application boot and backend session (not persisted). The App view calls start() and
// renders phase/bootError; boot orchestration across the stores happens here, never in views.
import { create } from 'zustand';
import { api } from '../api/client';
import { BACKEND_URL } from '../api/config';
import type { BootstrapResponse } from '../api/types';
import {
	legacyCategories,
	legacyForbiddenRules,
	legacyGenerationSettings,
	legacyLibrary,
	legacyWorkspaceWindows,
} from '../domain/legacyImport';
import { hydratePersistedStores, setPersistErrorHandler } from '../persistence/persist';
import { LEGACY_STORE_NAMES, STORE_NAMES } from '../persistence/storeNames';
import { useBoardStore } from './boardStore';
import { useCategoriesStore } from './categoriesStore';
import { useCharactersStore } from './charactersStore';
import { useCodexStore } from './codexStore';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { useGenerationSettingsStore } from './generationSettingsStore';
import { useLayoutStore } from './layoutStore';
import { useLibraryStore } from './libraryStore';
import { useModelCatalogStore } from './modelCatalogStore';
import { describeError, useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { useStoryStore } from './storyStore';
import { useTasksStore } from './tasksStore';

export type SessionPhase = 'idle' | 'booting' | 'ready' | 'failed';

export type SessionState = {
	phase: SessionPhase;
	/** Backend data directory (display only; the backend owns it). */
	dataDir: string;
	bootError: string | null;
};

export type SessionActions = {
	/** Idempotent boot:
	 *  1. api.bootstrap() with retry (250 ms, up to 15 s: the backend may still be starting);
	 *  2. hydratePersistedStores(every persisted store) - failure => phase 'failed';
	 *  3. seed every store absent from payload.persisted_stores from legacy_state/legacy_library
	 *     (src/domain/legacyImport.ts); the layout and board stores only when no layout store at all exists (theirs,
	 *     or a legacy floating-workspace store, which their own `legacy` option already migrated);
	 *  4. useOutputsStore.initialize(payload.output_ids, persisted currentId ?? payload.current_output_id);
	 *  5. useTasksStore.connect() (the co-writer's events go to useCodexStore.applyEvent), then
	 *     useModelCatalogStore.resumeInstalls() in the background (fire and forget: never fails or delays boot);
	 *     setPersistErrorHandler -> notifications; phase 'ready'.
	 *  Right after step 2, useCharactersStore.load() and useStoryStore.load() start in the background (fire and forget:
	 *  they never fail or delay boot; a failure only sets that store's loadError, which its section shows). */
	start: () => Promise<void>;
	/** After 'failed': resets and runs start() again. */
	retry: () => Promise<void>;
};

export type SessionStore = SessionState & SessionActions;

export const BOOTSTRAP_RETRY_DELAY_MS = 250;
export const BOOTSTRAP_TIMEOUT_MS = 15_000;

/** The backend may still be starting: retry every 250 ms, give up after 15 s with the last error. */
async function bootstrapWithRetry(): Promise<BootstrapResponse> {
	const startedAt = Date.now();
	for (;;) {
		try {
			return await api.bootstrap();
		} catch (error) {
			if (Date.now() - startedAt >= BOOTSTRAP_TIMEOUT_MS) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_RETRY_DELAY_MS));
		}
	}
}

/** Every persisted store, hydrated together at boot. */
function persistedStores() {
	return [
		useCategoriesStore,
		useForbiddenRulesStore,
		useLibraryStore,
		useGenerationSettingsStore,
		useOutputsStore,
		useLayoutStore,
		useBoardStore,
		useStoryStore,
	];
}

/** Stores holding a workspace layout: when one exists, app_state.json's window positions are ignored. */
const WORKSPACE_LAYOUT_STORES: readonly string[] = [
	STORE_NAMES.layout,
	STORE_NAMES.board,
	LEGACY_STORE_NAMES.workspace,
	LEGACY_STORE_NAMES.panelLayouts,
	LEGACY_STORE_NAMES.workspaceZIndex,
];

/** Seeds the stores that have never been persisted from app_state.json / library.json. The library goes
 *  first: categories keep only the LoRA links the library knows. */
function seedFromLegacy(payload: BootstrapResponse): void {
	const persisted = new Set(payload.persisted_stores);
	const state = payload.legacy_state;
	if (!persisted.has(STORE_NAMES.library)) {
		useLibraryStore.getState().replaceAll(legacyLibrary(state, payload.legacy_library));
	}
	if (!persisted.has(STORE_NAMES.categories)) {
		const libraryLoraIds = new Set(useLibraryStore.getState().loras.map((lora) => lora.id));
		useCategoriesStore.getState().replaceAll(legacyCategories(state, libraryLoraIds));
	}
	if (!persisted.has(STORE_NAMES.forbiddenRules)) {
		useForbiddenRulesStore.getState().replaceAll(legacyForbiddenRules(state));
	}
	if (!persisted.has(STORE_NAMES.generationSettings)) {
		useGenerationSettingsStore.getState().replaceAll(legacyGenerationSettings(state));
	}
	if (!WORKSPACE_LAYOUT_STORES.some((name) => persisted.has(name))) {
		const legacy = { windows: legacyWorkspaceWindows(state), hiddenPaneIds: [] };
		useLayoutStore.getState().importLegacyWorkspace(legacy);
		useBoardStore.getState().importLegacyWorkspace(legacy);
	}
}

function reportPersistError(storeName: string, error: unknown): void {
	useNotificationsStore.getState().notify('error', `Changes to '${storeName}' could not be saved: ${describeError(error)}`, {
		title: 'Saving failed',
	});
}

export const useSessionStore = create<SessionStore>()((set, get) => ({
	phase: 'idle',
	dataDir: '',
	bootError: null,

	start: async () => {
		if (get().phase === 'booting' || get().phase === 'ready') {
			return;
		}
		set({ phase: 'booting', bootError: null });

		let payload: BootstrapResponse;
		try {
			payload = await bootstrapWithRetry();
		} catch (error) {
			set({ phase: 'failed', bootError: `The backend at ${BACKEND_URL} is not reachable: ${describeError(error)}` });
			return;
		}

		try {
			const failed = await hydratePersistedStores(persistedStores());
			if (failed.length > 0) {
				set({
					phase: 'failed',
					bootError: `Saved data could not be loaded (${failed.join(', ')}). The app stopped so that it cannot overwrite it.`,
				});
				return;
			}
			// The backend-owned characters and stories load meanwhile (load never rejects: failures stay in their store).
			void useCharactersStore.getState().load();
			void useStoryStore.getState().load();
			setPersistErrorHandler(reportPersistError);
			seedFromLegacy(payload);
			const outputs = useOutputsStore.getState();
			await outputs.initialize(payload.output_ids, outputs.currentId ?? payload.current_output_id);
			useTasksStore.getState().connect({ onCodexEvent: (event) => useCodexStore.getState().applyEvent(event) });
			// Downloads started before a reload are followed again (resumeInstalls never rejects).
			void useModelCatalogStore.getState().resumeInstalls();
		} catch (error) {
			set({ phase: 'failed', bootError: `Startup failed: ${describeError(error)}` });
			return;
		}
		set({ phase: 'ready', dataDir: payload.data_dir, bootError: null });
	},

	retry: async () => {
		if (get().phase !== 'failed') {
			return;
		}
		set({ phase: 'idle', bootError: null });
		await get().start();
	},
}));
