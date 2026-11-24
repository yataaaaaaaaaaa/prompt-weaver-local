import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModelSpec, OutputRecord } from '../../api/types';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useGenerationSettingsStore, type GenerationSettingsState } from '../../stores/generationSettingsStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useOutputsStore } from '../../stores/outputsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { renderWithProviders } from '../../test/render';
import { ControlsPane } from './ControlsPane';

const MODEL: ModelSpec = { id: 'm1', name: 'Model One', path: 'C:/models/one.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16' };

function seedGeneration({ withModel = true, generating = false, continuous = false } = {}) {
	const actions = { generate: vi.fn(async () => undefined), toggleContinuous: vi.fn(async () => undefined), cancel: vi.fn(async () => undefined) };
	useGenerationStore.setState({ generating, continuous, ...actions });
	useLibraryStore.setState({ models: withModel ? [MODEL] : [], selectedModelId: withModel ? MODEL.id : '' });
	return actions;
}

/** Setters recorded by vi.fn but still applied, so controlled inputs behave like the real app. */
function seedSettings(initial: Partial<GenerationSettingsState> = {}) {
	const set = (patch: Partial<GenerationSettingsState>) => useGenerationSettingsStore.setState(patch);
	const setters = {
		setWidth: vi.fn((width: number) => set({ width })),
		setHeight: vi.fn((height: number) => set({ height })),
		setSteps: vi.fn((steps: number) => set({ steps })),
		setGuidanceScale: vi.fn((guidanceScale: number) => set({ guidanceScale })),
		setNegativePrompt: vi.fn((negativePrompt: string) => set({ negativePrompt })),
		setPromptSeedInput: vi.fn((promptSeedInput: string) => set({ promptSeedInput })),
		setSeedInput: vi.fn((seedInput: string) => set({ seedInput })),
		setPromptSeedBehavior: vi.fn((promptSeedBehavior: GenerationSettingsState['promptSeedBehavior']) => set({ promptSeedBehavior })),
		setImageSeedBehavior: vi.fn((imageSeedBehavior: GenerationSettingsState['imageSeedBehavior']) => set({ imageSeedBehavior })),
	};
	useGenerationSettingsStore.setState({ ...initial, ...setters });
	return setters;
}

describe('ControlsPane - generation actions', () => {
	it('disables Generate and Continuous without a model', () => {
		seedGeneration({ withModel: false });
		renderWithProviders(<ControlsPane />);

		expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Continuous' })).toBeDisabled();
	});

	it('generates', async () => {
		const actions = seedGeneration();
		const { user } = renderWithProviders(<ControlsPane />);

		await user.click(screen.getByRole('button', { name: 'Generate' }));

		expect(actions.generate).toHaveBeenCalledTimes(1);
	});

	it('shows Generating… and disables Generate while a generation runs', () => {
		seedGeneration({ generating: true });
		renderWithProviders(<ControlsPane />);

		expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
	});

	it('cancels only while a generation or a continuous run is active', async () => {
		const actions = seedGeneration();
		const { user } = renderWithProviders(<ControlsPane />);
		const cancel = screen.getByRole('button', { name: 'Cancel' });
		expect(cancel).toBeDisabled();

		act(() => useGenerationStore.setState({ generating: true }));
		expect(cancel).toBeEnabled();
		await user.click(cancel);
		expect(actions.cancel).toHaveBeenCalledTimes(1);

		act(() => useGenerationStore.setState({ generating: false, continuous: true }));
		expect(cancel).toBeEnabled();
	});

	it('toggles continuous generation (pressed while running, stoppable without a model)', async () => {
		const actions = seedGeneration();
		const { user } = renderWithProviders(<ControlsPane />);
		const continuous = screen.getByRole('button', { name: 'Continuous' });
		expect(continuous).toHaveAttribute('aria-pressed', 'false');

		await user.click(continuous);
		expect(actions.toggleContinuous).toHaveBeenCalledTimes(1);

		act(() => {
			useGenerationStore.setState({ continuous: true });
			useLibraryStore.setState({ selectedModelId: '' });
		});
		expect(continuous).toHaveAttribute('aria-pressed', 'true');
		expect(continuous).toBeEnabled();
	});

	it('copies the current prompt only when there is one', async () => {
		seedGeneration();
		const copyCurrentPrompt = vi.fn(async () => undefined);
		useOutputsStore.setState({ copyCurrentPrompt });
		const { user } = renderWithProviders(<ControlsPane />);
		expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeDisabled();

		act(() => {
			useOutputsStore.setState({ currentId: '0000000001', record: { prompt: 'a cat' } as OutputRecord });
		});
		await user.click(screen.getByRole('button', { name: 'Copy prompt' }));

		expect(copyCurrentPrompt).toHaveBeenCalledTimes(1);
	});

	it('adds a category and shows the session captions', async () => {
		seedGeneration();
		const addCategory = vi.fn(() => 'new-category');
		useCategoriesStore.setState({
			addCategory,
			categories: [
				{ text: 'A', activation_text: '', priority: 1, state: 'normal', subPrompts: [] },
				{ text: 'B', activation_text: '', priority: 2, state: 'normal', subPrompts: [] },
			],
		});
		useSessionStore.setState({ dataDir: 'D:/data' });
		const { user } = renderWithProviders(<ControlsPane />);

		expect(screen.getByText('Data directory: D:/data')).toBeInTheDocument();
		expect(screen.getByText('Categories: 2')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Add category' }));
		expect(addCategory).toHaveBeenCalledTimes(1);
	});

	it('renders the progress view', () => {
		seedGeneration();
		renderWithProviders(<ControlsPane />);

		expect(screen.getByRole('progressbar', { name: 'Generation progress' })).toBeInTheDocument();
	});
});

describe('ControlsPane - settings', () => {
	it('commits typed sizes and steps', async () => {
		seedGeneration();
		const setters = seedSettings();
		const { user } = renderWithProviders(<ControlsPane />);

		const width = screen.getByRole('spinbutton', { name: 'Width' });
		await user.clear(width);
		await user.type(width, '512{Enter}');
		expect(setters.setWidth).toHaveBeenLastCalledWith(512);
		expect(width).toHaveValue('512');

		const steps = screen.getByRole('spinbutton', { name: 'Steps' });
		await user.clear(steps);
		await user.type(steps, '40');
		await user.tab();
		expect(setters.setSteps).toHaveBeenLastCalledWith(40);
	});

	it('steps with the arrow keys (height by 64, CFG by 0.5)', async () => {
		seedGeneration();
		const setters = seedSettings({ height: 1024, guidanceScale: 7 });
		const { user } = renderWithProviders(<ControlsPane />);

		await user.click(screen.getByRole('spinbutton', { name: 'Height' }));
		await user.keyboard('{ArrowUp}');
		expect(setters.setHeight).toHaveBeenLastCalledWith(1088);

		await user.click(screen.getByRole('spinbutton', { name: 'CFG' }));
		await user.keyboard('{ArrowUp}');
		expect(setters.setGuidanceScale).toHaveBeenLastCalledWith(7.5);
	});

	it('ignores unparseable numbers', async () => {
		seedGeneration();
		const setters = seedSettings();
		const { user } = renderWithProviders(<ControlsPane />);

		const width = screen.getByRole('spinbutton', { name: 'Width' });
		await user.clear(width);
		await user.type(width, 'abc{Enter}');

		expect(setters.setWidth).not.toHaveBeenCalled();
	});

	it('edits the seeds and the negative prompt', async () => {
		seedGeneration();
		const setters = seedSettings();
		const { user } = renderWithProviders(<ControlsPane />);

		await user.type(screen.getByRole('textbox', { name: 'Prompt seed' }), '42');
		await user.type(screen.getByRole('textbox', { name: 'Image seed' }), '7');
		await user.type(screen.getByRole('textbox', { name: 'Negative prompt' }), 'blurry');

		expect(setters.setPromptSeedInput).toHaveBeenLastCalledWith('42');
		expect(setters.setSeedInput).toHaveBeenLastCalledWith('7');
		expect(setters.setNegativePrompt).toHaveBeenLastCalledWith('blurry');
	});

	it('picks seed behaviors from the domain option lists', async () => {
		seedGeneration();
		const setters = seedSettings();
		const { user } = renderWithProviders(<ControlsPane />);

		const promptBehavior = screen.getByRole('combobox', { name: 'Prompt seed behavior' });
		expect(promptBehavior).toHaveTextContent('Fixed');
		await user.click(promptBehavior);
		expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
			'Fixed',
			'Auto increment',
			'Randomize',
			'Per-category cycle (random restart)',
		]);
		await user.click(screen.getByRole('option', { name: 'Randomize' }));
		expect(setters.setPromptSeedBehavior).toHaveBeenCalledWith('randomize');

		await user.click(screen.getByRole('combobox', { name: 'Image seed behavior' }));
		const listbox = screen.getByRole('listbox');
		expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual(['Fixed', 'Auto increment', 'Randomize']);
		await user.click(within(listbox).getByRole('option', { name: 'Auto increment' }));
		expect(setters.setImageSeedBehavior).toHaveBeenCalledWith('increment');
	});

	it('disables the prompt seed in per-category mode and explains it', () => {
		seedGeneration();
		seedSettings({ promptSeedBehavior: 'per_category_cycle' });
		renderWithProviders(<ControlsPane />);

		const promptSeed = screen.getByRole('textbox', { name: 'Prompt seed' });
		expect(promptSeed).toBeDisabled();
		expect(promptSeed).toHaveAttribute('placeholder', 'Managed automatically per category');
		expect(screen.getByText(/Each active category advances on its own counter/)).toBeInTheDocument();
	});

	it('keeps the prompt seed editable in the other modes', () => {
		seedGeneration();
		seedSettings({ promptSeedBehavior: 'increment' });
		renderWithProviders(<ControlsPane />);

		expect(screen.getByRole('textbox', { name: 'Prompt seed' })).toBeEnabled();
		expect(screen.queryByText(/Each active category advances on its own counter/)).not.toBeInTheDocument();
	});
});

describe('ControlsPane - accessibility', () => {
	it('names every button and labels every field', () => {
		seedGeneration();
		renderWithProviders(<ControlsPane />);

		for (const role of ['button', 'spinbutton', 'textbox', 'combobox'] as const) {
			for (const element of screen.getAllByRole(role)) {
				expect(element).toHaveAccessibleName();
			}
		}
		expect(screen.getByRole('heading', { name: 'Model' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'LoRAs' })).toBeInTheDocument();
	});
});
