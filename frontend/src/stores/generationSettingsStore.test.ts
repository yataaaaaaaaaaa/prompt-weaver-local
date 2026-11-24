import { describe, expect, it } from 'vitest';
import { flushPersistence, hydratePersistedStores } from '../persistence/persist';
import { createMemoryStoreBackend, setStoreBackend } from '../persistence/storeBackend';
import {
	DEFAULT_GENERATION_SETTINGS,
	selectGenerationSettings,
	selectPromptSeedManagedPerCategory,
	selectSeedSnapshot,
	useGenerationSettingsStore,
} from './generationSettingsStore';

const store = () => useGenerationSettingsStore.getState();

// Trimmed copy of a real settings-store/state.json.
const REAL_SETTINGS = {
	width: 768,
	height: 1344,
	steps: 30,
	guidanceScale: 3,
	negativePrompt: 'ugly,  pale skin, embedding:lazyloli, \n',
	promptSeedInput: '1859594862',
	seedInput: '718048748',
	promptSeedBehavior: 'per_category_cycle',
	imageSeedBehavior: 'increment',
	promptCategorySeedState: {
		main: { seed: 484998770, remaining: 2, prompt_count: 2 },
		'day-moment': { seed: 933776099, remaining: 12, prompt_count: 16 },
	},
} as const;

describe('actions and selectors', () => {
	it('starts from the defaults', () => {
		expect(selectGenerationSettings(store())).toEqual(DEFAULT_GENERATION_SETTINGS);
	});

	it('sets every field', () => {
		store().setWidth(832);
		store().setHeight(1216);
		store().setSteps(24);
		store().setGuidanceScale(4.5);
		store().setNegativePrompt('blurry');
		store().setPromptSeedInput('1');
		store().setSeedInput('2');
		store().setPromptSeedBehavior('per_category_cycle');
		store().setImageSeedBehavior('randomize');
		expect(selectGenerationSettings(store())).toEqual({
			width: 832,
			height: 1216,
			steps: 24,
			guidanceScale: 4.5,
			negativePrompt: 'blurry',
			promptSeedInput: '1',
			seedInput: '2',
			promptSeedBehavior: 'per_category_cycle',
			imageSeedBehavior: 'randomize',
			promptCategorySeedState: {},
		});
		expect(selectPromptSeedManagedPerCategory(store())).toBe(true);
	});

	it('applies and snapshots seed settings (generation advance / undo)', () => {
		store().applySeedSnapshot({ seedInput: '9', promptCategorySeedState: { main: { seed: 1, remaining: 1, prompt_count: 1 } } });
		expect(selectSeedSnapshot(store())).toEqual({
			promptSeedInput: '',
			seedInput: '9',
			promptSeedBehavior: 'fixed',
			imageSeedBehavior: 'fixed',
			promptCategorySeedState: { main: { seed: 1, remaining: 1, prompt_count: 1 } },
		});
	});

	it('replaceAll keeps valid values and falls back for invalid ones', () => {
		store().replaceAll({ width: 640, steps: -5, imageSeedBehavior: 'per_category_cycle' });
		expect(store()).toMatchObject({ width: 640, steps: 30, imageSeedBehavior: 'fixed', height: 1024 });
	});
});

describe('persistence', () => {
	it('round-trips the real settings-store format (with promptCategorySeedState)', async () => {
		const backend = createMemoryStoreBackend({ 'settings-store': { state: REAL_SETTINGS, version: 0 } });
		setStoreBackend(backend);

		expect(await hydratePersistedStores([useGenerationSettingsStore])).toEqual([]);
		expect(selectGenerationSettings(store())).toEqual(REAL_SETTINGS);

		store().setSeedInput('718048749');
		await flushPersistence();

		expect(backend.snapshot()['settings-store']).toEqual({ state: { ...REAL_SETTINGS, seedInput: '718048749' }, version: 0 });
	});

	it('repairs invalid persisted values on hydration', async () => {
		setStoreBackend(
			createMemoryStoreBackend({
				'settings-store': { state: { width: 'wide', promptSeedInput: 1234, promptSeedBehavior: 'keep', promptCategorySeedState: { x: 'bad' } }, version: 0 },
			}),
		);
		await hydratePersistedStores([useGenerationSettingsStore]);
		expect(selectGenerationSettings(store())).toEqual({ ...DEFAULT_GENERATION_SETTINGS, promptSeedInput: '1234' });
	});

	it('keeps the defaults when nothing is persisted', async () => {
		await hydratePersistedStores([useGenerationSettingsStore]);
		expect(selectGenerationSettings(store())).toEqual(DEFAULT_GENERATION_SETTINGS);
	});
});
