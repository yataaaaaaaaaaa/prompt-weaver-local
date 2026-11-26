import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LoRASpec, ModelSpec } from '../../api/types';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useCharactersStore } from '../../stores/charactersStore';
import { useGenerationSettingsStore, type GenerationSettingsState } from '../../stores/generationSettingsStore';
import { useGenerationStore } from '../../stores/generationStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useNavigationStore } from '../../stores/navigationStore';
import { useTasksStore } from '../../stores/tasksStore';
import { ALICE_ID, BOB, character } from '../../test/characterData';
import { renderWithProviders } from '../../test/render';
import { seedCharacterActions, seedIpAdapterActions } from '../../test/characterStores';
import { hasActionIntent } from '../../test/stateClasses';
import { GENERATION_LABELS } from './generationLabels';
import { GenerationActionsCompact, GenerationPanel } from './GenerationPanel';

// Several user-event interactions with Fluent popovers and tooltips per test: slow on a busy machine.

const MODEL: ModelSpec = { id: 'm1', name: 'Model One', path: 'C:/models/one.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };

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

describe('GenerationPanel - generation actions', () => {
	it('disables Generate and Continuous without a model', () => {
		seedGeneration({ withModel: false });
		renderWithProviders(<GenerationPanel />);

		expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Continuous' })).toBeDisabled();
	});

	it('generates', async () => {
		const actions = seedGeneration();
		const { user } = renderWithProviders(<GenerationPanel />);

		await user.click(screen.getByRole('button', { name: 'Generate' }));

		expect(actions.generate).toHaveBeenCalledTimes(1);
	});

	it('shows Generating… and disables Generate while a generation runs', () => {
		seedGeneration({ generating: true });
		renderWithProviders(<GenerationPanel />);

		expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
	});

	it('cancels only while a generation or a continuous run is active', async () => {
		const actions = seedGeneration();
		const { user } = renderWithProviders(<GenerationPanel />);
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
		const { user } = renderWithProviders(<GenerationPanel />);
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

	it('colors the actions by intent (disabled buttons keep the Fluent disabled look)', () => {
		seedGeneration();
		renderWithProviders(<GenerationPanel />);
		const generate = screen.getByRole('button', { name: 'Generate' });
		const continuous = screen.getByRole('button', { name: 'Continuous' });
		const cancel = screen.getByRole('button', { name: 'Cancel' });

		// Idle: Generate is the primary action; Cancel is the (disabled) warning action, the unchecked toggle is plain.
		expect(hasActionIntent(generate, 'filled', 'primary')).toBe(true);
		expect(hasActionIntent(continuous, 'filled', 'primary')).toBe(false);
		expect(cancel).toBeDisabled();
		expect(hasActionIntent(cancel, 'subtle', 'warning')).toBe(true);

		// A continuous run: the checked toggle is primary, Cancel is the warning action, Generate is disabled.
		act(() => useGenerationStore.setState({ continuous: true, generating: true }));
		expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
		expect(hasActionIntent(continuous, 'filled', 'primary')).toBe(true);
		expect(hasActionIntent(cancel, 'subtle', 'warning')).toBe(true);
	});

	it('renders the progress view', () => {
		seedGeneration();
		renderWithProviders(<GenerationPanel />);

		expect(screen.getByRole('progressbar', { name: 'Generation progress' })).toBeInTheDocument();
	});
});

describe('GenerationPanel - settings', () => {
	it('commits typed sizes and steps', async () => {
		seedGeneration();
		const setters = seedSettings();
		const { user } = renderWithProviders(<GenerationPanel />);

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
		const { user } = renderWithProviders(<GenerationPanel />);

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
		const { user } = renderWithProviders(<GenerationPanel />);

		const width = screen.getByRole('spinbutton', { name: 'Width' });
		await user.clear(width);
		await user.type(width, 'abc{Enter}');

		expect(setters.setWidth).not.toHaveBeenCalled();
	});

	it('edits the seeds and the negative prompt', async () => {
		seedGeneration();
		const setters = seedSettings();
		const { user } = renderWithProviders(<GenerationPanel />);

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
		const { user } = renderWithProviders(<GenerationPanel />);

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
		renderWithProviders(<GenerationPanel />);

		const promptSeed = screen.getByRole('textbox', { name: 'Prompt seed' });
		expect(promptSeed).toBeDisabled();
		expect(promptSeed).toHaveAttribute('placeholder', 'Managed automatically per category');
		expect(screen.getByText(/Each active category advances on its own counter/)).toBeInTheDocument();
	});

	it('keeps the prompt seed editable in the other modes', () => {
		seedGeneration();
		seedSettings({ promptSeedBehavior: 'increment' });
		renderWithProviders(<GenerationPanel />);

		expect(screen.getByRole('textbox', { name: 'Prompt seed' })).toBeEnabled();
		expect(screen.queryByText(/Each active category advances on its own counter/)).not.toBeInTheDocument();
	});
});

describe('GenerationPanel - character', () => {
	it('offers to activate or create a character when none is active', async () => {
		seedGeneration();
		const actions = seedCharacterActions();
		useCharactersStore.setState({ loadStatus: 'ready', characters: [character(), BOB] });
		const { user } = renderWithProviders(<GenerationPanel />);

		const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
		expect(headings.indexOf('Character')).toBe(1);
		await user.click(screen.getByRole('combobox', { name: 'Active character' }));
		await user.click(screen.getByRole('option', { name: 'Alice' }));
		expect(actions.setActive).toHaveBeenCalledWith(ALICE_ID);
		await user.click(screen.getByRole('button', { name: 'New character' }));
		expect(actions.startCreate).toHaveBeenCalledTimes(1);
	});

	it('shows the active character with Deactivate and its reference strength', async () => {
		seedGeneration();
		const actions = seedCharacterActions();
		seedIpAdapterActions();
		useCharactersStore.setState({ loadStatus: 'ready', characters: [character(), BOB], activeId: ALICE_ID });
		const { user } = renderWithProviders(<GenerationPanel />);

		expect(screen.getByText('Alice')).toBeInTheDocument();
		expect(screen.getByRole('slider', { name: 'Reference strength' })).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Deactivate' }));
		expect(actions.toggleActive).toHaveBeenCalledWith(ALICE_ID);
	});
});

describe('GenerationPanel - accessibility', () => {
	it('names every button and labels every field', () => {
		seedGeneration();
		renderWithProviders(<GenerationPanel />);

		for (const role of ['button', 'spinbutton', 'textbox', 'combobox'] as const) {
			for (const element of screen.getAllByRole(role)) {
				expect(element).toHaveAccessibleName();
			}
		}
		expect(screen.getByRole('heading', { name: 'Model' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'LoRAs' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Character' })).toBeInTheDocument();
	});
});

describe('GenerationPanel - layout', () => {
	it('puts the actions and the progress in the action area, outside the scrolling body', () => {
		seedGeneration();
		renderWithProviders(<GenerationPanel />);

		const actions = screen.getByRole('group', { name: GENERATION_LABELS.actions });
		for (const name of ['Generate', 'Continuous', 'Cancel']) {
			expect(within(actions).getByRole('button', { name })).toBeInTheDocument();
		}
		expect(within(actions).getByRole('progressbar', { name: 'Generation progress' })).toBeInTheDocument();
		// The body scrolls on its own; the action area is its sibling (never scrolled away).
		const body = screen.getByRole('heading', { name: 'Model' }).closest('section')?.parentElement?.parentElement as HTMLElement;
		expect(getComputedStyle(body).overflowY).toBe('auto');
		expect(body.contains(actions)).toBe(false);
		expect(getComputedStyle(actions).flexShrink).toBe('0');
	});

	it('orders the sections: model, character, LoRAs, image settings, seeds, negative prompt, then More options', () => {
		seedGeneration();
		renderWithProviders(<GenerationPanel />);

		expect(screen.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
			'Model',
			'Character',
			'LoRAs',
			'Image settings',
			'Seeds',
			'Negative prompt',
			'More options',
		]);
		// Character: the region rendered by the characters feature, placed as is.
		expect(screen.getByRole('region', { name: 'Character' })).toBeInTheDocument();
	});

	it('leaves the board and the viewer actions to them: no Add category, Copy prompt or data directory here', () => {
		seedGeneration();
		renderWithProviders(<GenerationPanel />);

		expect(screen.queryByRole('button', { name: 'Add category' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Copy prompt' })).not.toBeInTheDocument();
		expect(screen.queryByText(/^Data directory:/)).not.toBeInTheDocument();
		expect(screen.queryByText(/^Categories:/)).not.toBeInTheDocument();
	});

	it('says when it is ready to generate, and what is missing without a model', () => {
		seedGeneration();
		const { unmount } = renderWithProviders(<GenerationPanel />);
		expect(screen.getByText('Ready to generate')).toBeInTheDocument();
		unmount();

		seedGeneration({ withModel: false });
		renderWithProviders(<GenerationPanel />);
		expect(screen.getByText('Pick a checkpoint to generate')).toBeInTheDocument();
	});
});

describe('GenerationPanel - model', () => {
	it('offers the checkpoint picker and the way to the Models section', async () => {
		seedGeneration();
		const { user } = renderWithProviders(<GenerationPanel />);

		expect(screen.getByRole('combobox', { name: 'Checkpoint' })).toHaveTextContent('Model One');
		expect(screen.queryByText('No model yet')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Browse models' }));
		expect(useNavigationStore.getState().section).toBe('models');
	});

	it('without a model: a call to action to add a model file or browse Models', async () => {
		seedGeneration({ withModel: false });
		const addModelFile = vi.fn(async () => undefined);
		useLibraryStore.setState({ addModelFile });
		const { user } = renderWithProviders(<GenerationPanel />);

		expect(screen.getByText('No model yet')).toBeInTheDocument();
		expect(screen.getByRole('combobox', { name: 'Checkpoint' })).toBeDisabled();
		await user.click(screen.getByRole('button', { name: 'Add model file' }));
		expect(addModelFile).toHaveBeenCalledTimes(1);
		await user.click(screen.getByRole('button', { name: 'Browse models' }));
		expect(useNavigationStore.getState().section).toBe('models');
	});
});

describe('GenerationPanel - More options', () => {
	const LINKED: LoRASpec = { id: 'linked', name: 'linked_style.safetensors', path: 'C:/loras/linked.safetensors', source: null };

	it('is collapsed by default and discloses the file actions and the prompt link details', async () => {
		seedGeneration();
		const actions = {
			addModelFile: vi.fn(async () => undefined),
			addModelDirectory: vi.fn(async () => undefined),
			addLoraFiles: vi.fn(async () => undefined),
			addLoraDirectory: vi.fn(async () => undefined),
		};
		useLibraryStore.setState({ ...actions, loras: [LINKED], selectedLoras: [] });
		const unlinkLora = vi.fn();
		useCategoriesStore.setState({
			unlinkLora,
			categories: [{ text: 'Main', activation_text: '', priority: 1, state: 'normal', subPrompts: [{ text: 'x', state: 'normal', extraLoraIds: ['linked'] }] }],
		});
		const { user } = renderWithProviders(<GenerationPanel />);
		const more = screen.getByRole('button', { name: 'More options' });
		expect(more).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByRole('button', { name: 'Add model folder' })).not.toBeInTheDocument();

		await user.click(more);

		expect(more).toHaveAttribute('aria-expanded', 'true');
		await user.click(screen.getByRole('button', { name: 'Add model file' }));
		await user.click(screen.getByRole('button', { name: 'Add model folder' }));
		await user.click(screen.getByRole('button', { name: 'Add LoRA files' }));
		await user.click(screen.getByRole('button', { name: 'Add LoRA folder' }));
		expect(actions.addModelFile).toHaveBeenCalledTimes(1);
		expect(actions.addModelDirectory).toHaveBeenCalledTimes(1);
		expect(actions.addLoraFiles).toHaveBeenCalledTimes(1);
		expect(actions.addLoraDirectory).toHaveBeenCalledTimes(1);
		const group = screen.getByRole('group', { name: 'Prompt-linked LoRAs' });
		expect(within(group).getByText('Default selected: 0 · Prompt-linked: 1 · Possible active: 1')).toBeInTheDocument();
		await user.click(within(group).getByRole('button', { name: 'Remove prompt links to linked_style.safetensors' }));
		expect(unlinkLora).toHaveBeenCalledWith('linked');
	});
});

describe('GenerationActionsCompact', () => {
	it('offers the same actions, icon-only, with tooltips naming the shortcuts', async () => {
		const actions = seedGeneration();
		const { user } = renderWithProviders(<GenerationActionsCompact />);
		const group = screen.getByRole('group', { name: GENERATION_LABELS.actions });

		const generate = within(group).getByRole('button', { name: 'Generate' });
		const continuous = within(group).getByRole('button', { name: 'Continuous' });
		const cancel = within(group).getByRole('button', { name: 'Cancel' });
		for (const button of [generate, continuous, cancel]) {
			expect(button).toHaveTextContent('');
		}
		expect(generate).toHaveAttribute('aria-keyshortcuts', 'Control+G');
		expect(continuous).toHaveAttribute('aria-keyshortcuts', 'Control+T');
		expect(hasActionIntent(generate, 'filled', 'primary')).toBe(true);
		expect(hasActionIntent(cancel, 'subtle', 'warning')).toBe(true);
		expect(cancel).toBeDisabled();

		await user.click(generate);
		await user.click(continuous);
		expect(actions.generate).toHaveBeenCalledTimes(1);
		expect(actions.toggleContinuous).toHaveBeenCalledTimes(1);

		await user.hover(generate);
		expect(await screen.findByRole('tooltip')).toHaveTextContent('Generate one image with the current prompt and settings (Ctrl+G)');
	});

	it('shows a compact progress bar colored by the outcome, with the step count', () => {
		seedGeneration({ generating: true });
		const { container } = renderWithProviders(<GenerationActionsCompact />);
		act(() =>
			useTasksStore
				.getState()
				.applyEvent({ type: 'generation', task_id: 'generation', stage: 'sampling', message: 'Sampling step 3/12', current: 3, total: 12 }),
		);

		expect(container.querySelector('[data-generation-outcome]')).toHaveAttribute('data-generation-outcome', 'running');
		const bar = screen.getByRole('progressbar', { name: 'Generation progress' });
		expect(bar).toHaveAttribute('aria-valuenow', String(3 / 12));
		expect(bar).toHaveAttribute('aria-valuetext', 'Sampling step 3/12');
		expect(screen.getByText('3/12')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
	});
});
