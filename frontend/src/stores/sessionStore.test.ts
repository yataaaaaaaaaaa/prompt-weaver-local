import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { AppState, BootstrapResponse, OutputRecord } from '../api/types';
import { flushPersistence } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend, type StoreBackend } from '../persistence/storeBackend';
import { useCategoriesStore } from './categoriesStore';
import { useForbiddenRulesStore } from './forbiddenRulesStore';
import { useGenerationSettingsStore, type GenerationSettingsState } from './generationSettingsStore';
import { useLibraryStore, type LibraryState } from './libraryStore';
import { useModelCatalogStore } from './modelCatalogStore';
import { useNotificationsStore } from './notificationsStore';
import { useOutputsStore } from './outputsStore';
import { BOOTSTRAP_TIMEOUT_MS, useSessionStore } from './sessionStore';
import { useTasksStore } from './tasksStore';
import { useWorkspaceStore } from './workspaceStore';

const legacyState = {
	categories: [
		{
			id: 'style',
			name: 'Main',
			muted: false,
			priority: '1',
			activation_text: '',
			locked_prompt_id: 'style-1',
			locked_prompt_text: null,
			position: { x: 24, y: 24 },
			size: { width: 760, height: 190 },
			z_index: 210,
			prompts: [{ id: 'style-1', text: 'masterpiece', skipped: false, extra_lora_ids: ['alya', 'gone'] }],
		},
	],
	forbidden_rules: [],
	last_model_id: 'model-a',
	last_lora_ids: ['alya'],
	last_model_dir: 'D:\\models',
	last_lora_dir: null,
	width: 832,
	height: 1216,
	steps: 30,
	guidance_scale: 5,
	prompt_seed: 94,
	seed: null,
	seed_mode: 'manual',
	seed_advance_mode: 'keep',
	prompt_seed_behavior: 'increment',
	image_seed_behavior: 'fixed',
	negative_prompt: 'ugly',
	workspace: {
		image: { x: 420, y: 8, width: 542, height: 928, z_index: 228 },
		controls: { x: 43, y: 34, width: 359, height: 752, z_index: 230 },
		details: { x: 1068, y: 47, width: 607, height: 775, z_index: 217 },
		used: { x: 690, y: 320, width: 790, height: 420, z_index: 6 },
	},
	editor: {
		overlays_hidden: false,
		visibility_mode: 'all',
		selected_category_id: null,
		selected_prompt_id: null,
		editing_target: { kind: 'none', category_id: null, prompt_id: null },
	},
	last_output_id: '0000000002',
} as unknown as AppState;

function payload(overrides: Partial<BootstrapResponse> = {}): BootstrapResponse {
	return {
		data_dir: 'C:\\temp\\prompt-weaver',
		legacy_state: legacyState,
		legacy_library: {
			models: [{ id: 'model-a', name: 'Model A', path: 'D:\\models\\a.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null }],
			loras: [{ id: 'alya', name: 'alya.safetensors', path: 'D:\\loras\\alya.safetensors', source: null }],
		},
		persisted_stores: [],
		output_ids: ['0000000001', '0000000002', '0000000003'],
		current_output_id: '0000000002',
		...overrides,
	};
}

/** Replaces the seeding actions of the other stores (their own tests cover them). */
function spyOnSeeding() {
	const spies = {
		library: vi.fn((library: Partial<LibraryState>) => useLibraryStore.setState(library)),
		categories: vi.fn(),
		rules: vi.fn(),
		settings: vi.fn((settings: Partial<GenerationSettingsState>) => useGenerationSettingsStore.setState(settings)),
		windows: vi.fn(),
		connect: vi.fn(),
	};
	useLibraryStore.setState({ replaceAll: spies.library });
	useCategoriesStore.setState({ replaceAll: spies.categories });
	useForbiddenRulesStore.setState({ replaceAll: spies.rules });
	useGenerationSettingsStore.setState({ replaceAll: spies.settings });
	useWorkspaceStore.setState({ replaceWindows: spies.windows });
	useTasksStore.setState({ connect: spies.connect });
	return spies;
}

const record = (outputId: string) => ({ output_id: outputId, selections: [], active_loras: [] }) as unknown as OutputRecord;

beforeEach(() => {
	vi.spyOn(api, 'getOutput').mockImplementation(async (outputId) => record(outputId));
	// No download running in the backend (resumeInstalls at boot).
	vi.spyOn(api, 'listInstalls').mockResolvedValue([]);
});

afterEach(() => {
	vi.useRealTimers();
});

const session = () => useSessionStore.getState();

describe('sessionStore.start', () => {
	it('boots: hydrates, seeds every never-persisted store from the legacy files, shows the current output, connects', async () => {
		vi.spyOn(api, 'bootstrap').mockResolvedValue(payload());
		const spies = spyOnSeeding();

		await session().start();

		expect(session()).toMatchObject({ phase: 'ready', dataDir: 'C:\\temp\\prompt-weaver', bootError: null });
		expect(spies.library).toHaveBeenCalledWith(
			expect.objectContaining({ selectedModelId: 'model-a', selectedLoras: [{ id: 'alya', weight: LORA_WEIGHT_DEFAULTS.weight }], lastModelDir: 'D:\\models' }),
		);
		// Categories are seeded after the library: unknown LoRA links are dropped.
		expect(spies.categories).toHaveBeenCalledWith([
			{
				text: 'Main',
				activation_text: '',
				priority: 1,
				state: 'normal',
				subPrompts: [{ text: 'masterpiece', state: 'lock', extraLoraIds: ['alya'] }],
			},
		]);
		expect(spies.rules).toHaveBeenCalledWith([]);
		expect(spies.settings).toHaveBeenCalledWith(
			expect.objectContaining({ width: 832, guidanceScale: 5, promptSeedInput: '94', seedInput: '', promptCategorySeedState: {} }),
		);
		expect(spies.windows).toHaveBeenCalledWith({
			'pane:image': { x: 420, y: 8, width: 542, height: 928, z: 228 },
			'pane:controls': { x: 43, y: 34, width: 359, height: 752, z: 230 },
			'pane:used': { x: 690, y: 320, width: 790, height: 420, z: 6 },
			'category:main': { x: 24, y: 24, width: 760, height: 190, z: 210 },
		});
		expect(useOutputsStore.getState()).toMatchObject({ ids: payload().output_ids, currentId: '0000000002' });
		expect(spies.connect).toHaveBeenCalledTimes(1);
	});

	it('does not seed stores that were already persisted, nor the workspace when a legacy layout store exists', async () => {
		vi.spyOn(api, 'bootstrap').mockResolvedValue(
			payload({ persisted_stores: ['categorie-store', 'library-store', 'settings-store', 'panel-layouts-store'] }),
		);
		const spies = spyOnSeeding();

		await session().start();

		expect(session().phase).toBe('ready');
		expect(spies.library).not.toHaveBeenCalled();
		expect(spies.categories).not.toHaveBeenCalled();
		expect(spies.settings).not.toHaveBeenCalled();
		expect(spies.windows).not.toHaveBeenCalled();
		expect(spies.rules).toHaveBeenCalledTimes(1);
	});

	it('prefers the persisted current output over the bootstrap one', async () => {
		setStoreBackend(createMemoryStoreBackend({ 'current-image-store': { state: { currentName: 3 }, version: 0 } }));
		vi.spyOn(api, 'bootstrap').mockResolvedValue(payload({ persisted_stores: ['current-image-store'] }));
		spyOnSeeding();

		await session().start();

		expect(useOutputsStore.getState().currentId).toBe('0000000003');
	});

	it('falls back to the bootstrap current output when the persisted one is null', async () => {
		setStoreBackend(createMemoryStoreBackend({ 'current-image-store': { state: { currentId: null }, version: 1 } }));
		vi.spyOn(api, 'bootstrap').mockResolvedValue(payload({ persisted_stores: ['current-image-store'] }));
		spyOnSeeding();

		await session().start();

		expect(useOutputsStore.getState().currentId).toBe('0000000002');
	});

	it('is idempotent while booting or ready', async () => {
		const bootstrap = vi.spyOn(api, 'bootstrap').mockResolvedValue(payload());
		spyOnSeeding();

		await Promise.all([session().start(), session().start()]);
		await session().start();

		expect(bootstrap).toHaveBeenCalledTimes(1);
		expect(session().phase).toBe('ready');
	});

	it('retries the bootstrap every 250 ms while the backend starts', async () => {
		vi.useFakeTimers();
		const bootstrap = vi
			.spyOn(api, 'bootstrap')
			.mockRejectedValueOnce(new Error('connection refused'))
			.mockRejectedValueOnce(new Error('connection refused'))
			.mockResolvedValue(payload());
		spyOnSeeding();

		const starting = session().start();
		expect(session().phase).toBe('booting');
		await vi.advanceTimersByTimeAsync(500);
		await starting;

		expect(bootstrap).toHaveBeenCalledTimes(3);
		expect(session().phase).toBe('ready');
	});

	it('gives up after 15 s with the last error', async () => {
		vi.useFakeTimers();
		let attempt = 0;
		vi.spyOn(api, 'bootstrap').mockImplementation(async () => {
			attempt += 1;
			throw new Error(`connection refused #${attempt}`);
		});
		const spies = spyOnSeeding();

		const starting = session().start();
		await vi.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS + 250);
		await starting;

		expect(session().phase).toBe('failed');
		expect(session().bootError).toContain(`connection refused #${attempt}`);
		expect(attempt).toBeGreaterThan(50);
		expect(spies.connect).not.toHaveBeenCalled();
	});

	it('fails without touching any store when saved data cannot be read', async () => {
		const failing: StoreBackend = {
			read: async (name) => {
				if (name === 'categorie-store') {
					throw new Error('disk error');
				}
				return null;
			},
			write: async () => undefined,
			remove: async () => undefined,
		};
		setStoreBackend(failing);
		vi.spyOn(api, 'bootstrap').mockResolvedValue(payload());
		const spies = spyOnSeeding();

		await session().start();

		expect(session().phase).toBe('failed');
		expect(session().bootError).toContain('categorie-store');
		expect(spies.categories).not.toHaveBeenCalled();
		expect(spies.library).not.toHaveBeenCalled();
		expect(spies.connect).not.toHaveBeenCalled();
	});

	it('reports a failing seeding step as a boot failure', async () => {
		vi.spyOn(api, 'bootstrap').mockResolvedValue(payload());
		spyOnSeeding();
		useCategoriesStore.setState({
			replaceAll: () => {
				throw new Error('invalid categories');
			},
		});

		await session().start();

		expect(session()).toMatchObject({ phase: 'failed', bootError: 'Startup failed: invalid categories' });
	});

	it('surfaces persistence write failures as notifications once ready', async () => {
		const memory = createMemoryStoreBackend();
		setStoreBackend(memory);
		vi.spyOn(api, 'bootstrap').mockResolvedValue(payload());
		spyOnSeeding();
		await session().start();
		await flushPersistence();

		setStoreBackend({ ...memory, write: async () => Promise.reject(new Error('disk full')) });
		useWorkspaceStore.getState().setPaneVisible('used', false);
		await flushPersistence();

		expect(useNotificationsStore.getState().notifications).toMatchObject([
			{ intent: 'error', title: 'Saving failed', message: expect.stringContaining('disk full') },
		]);
	});
});

describe('sessionStore.start: model library installs', () => {
	it('resumes the running installs once the task socket is connected', async () => {
		vi.spyOn(api, 'bootstrap').mockResolvedValue(payload());
		const spies = spyOnSeeding();
		const calls: string[] = [];
		spies.connect.mockImplementation(() => calls.push('connect'));
		const listInstalls = vi.mocked(api.listInstalls).mockImplementation(async () => {
			calls.push('listInstalls');
			return [];
		});

		await session().start();

		expect(session().phase).toBe('ready');
		expect(listInstalls).toHaveBeenCalledTimes(1);
		expect(calls).toEqual(['connect', 'listInstalls']);
	});

	it('neither waits for nor fails on resuming the installs', async () => {
		vi.spyOn(api, 'bootstrap').mockResolvedValue(payload());
		spyOnSeeding();
		vi.mocked(api.listInstalls).mockReturnValue(new Promise(() => undefined));

		await session().start();
		expect(session().phase).toBe('ready');

		useSessionStore.setState({ phase: 'idle' });
		vi.mocked(api.listInstalls).mockRejectedValue(new Error('backend restarting'));
		await session().start();
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(api.listInstalls).toHaveBeenCalledTimes(2);
		expect(session()).toMatchObject({ phase: 'ready', bootError: null });
		expect(useNotificationsStore.getState().notifications).toEqual([]);
		expect(useModelCatalogStore.getState().installs).toEqual({});
	});
});

describe('sessionStore.retry', () => {
	it('starts again after a failure and is a no-op otherwise', async () => {
		vi.useFakeTimers();
		const bootstrap = vi.spyOn(api, 'bootstrap').mockRejectedValue(new Error('down'));
		spyOnSeeding();
		const starting = session().start();
		await vi.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS + 250);
		await starting;
		expect(session().phase).toBe('failed');

		bootstrap.mockResolvedValue(payload());
		await session().retry();
		expect(session()).toMatchObject({ phase: 'ready', bootError: null });

		const calls = bootstrap.mock.calls.length;
		await session().retry();
		expect(bootstrap).toHaveBeenCalledTimes(calls);
	});
});
