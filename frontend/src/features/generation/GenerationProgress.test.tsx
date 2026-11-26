import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GenerationTaskEvent, ModelSpec } from '../../api/types';
import { GENERATION_FAILED_TITLE } from '../../stores/generationStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useTasksStore } from '../../stores/tasksStore';
import { renderWithProviders } from '../../test/render';
import { GenerationProgress, IDLE_MESSAGES } from './GenerationProgress';

const MODEL: ModelSpec = { id: 'm1', name: 'Model One', path: 'C:/models/one.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };

function publish(overrides: Partial<GenerationTaskEvent>): void {
	act(() =>
		useTasksStore.getState().applyEvent({ type: 'generation', task_id: 'generation', stage: 'idle', message: '', current: 0, total: 0, ...overrides }),
	);
}

function bar(): HTMLElement {
	return screen.getByRole('progressbar', { name: 'Generation progress' });
}

function outcome(container: HTMLElement): string | null {
	return container.querySelector('[data-generation-outcome]')?.getAttribute('data-generation-outcome') ?? null;
}

describe('GenerationProgress', () => {
	it('says it is ready, with an empty bar, when a checkpoint is selected and nothing ran yet', () => {
		useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id });
		const { container } = renderWithProviders(<GenerationProgress />);

		expect(screen.getByText(IDLE_MESSAGES.ready)).toBeInTheDocument();
		expect(bar()).toHaveAttribute('aria-valuenow', '0');
		expect(outcome(container)).toBe('idle');
	});

	it('names what is missing when no checkpoint is selected', () => {
		renderWithProviders(<GenerationProgress />);

		expect(screen.getByText(IDLE_MESSAGES.noModel)).toBeInTheDocument();
	});

	it("replaces the backend's idle message by its own", () => {
		useLibraryStore.setState({ models: [MODEL], selectedModelId: MODEL.id });
		renderWithProviders(<GenerationProgress />);
		publish({ stage: 'idle', message: 'Idle' });

		expect(screen.getByText(IDLE_MESSAGES.ready)).toBeInTheDocument();
		expect(screen.queryByText('Idle')).not.toBeInTheDocument();
	});

	it('compact: the colored bar and the step count, the message as the value text', () => {
		const { container } = renderWithProviders(<GenerationProgress compact />);
		publish({ stage: 'sampling', message: 'Sampling step 3/12', current: 3, total: 12 });

		expect(screen.queryByText('Sampling step 3/12')).not.toBeInTheDocument();
		expect(bar()).toHaveAttribute('aria-valuetext', 'Sampling step 3/12');
		expect(screen.getByText('3/12')).toBeInTheDocument();
		expect(outcome(container)).toBe('running');

		publish({ stage: 'error', message: 'CUDA out of memory' });
		expect(outcome(container)).toBe('error');
		expect(bar()).toHaveAttribute('aria-valuetext', GENERATION_FAILED_TITLE);
		expect(screen.queryByText('CUDA out of memory')).not.toBeInTheDocument();
	});

	it('shows the step message, the step count and the ratio while sampling', () => {
		const { container } = renderWithProviders(<GenerationProgress />);
		publish({ stage: 'sampling', message: 'Sampling step 3/12', current: 3, total: 12 });

		expect(screen.getByText('Sampling step 3/12')).toBeInTheDocument();
		expect(screen.getByText('3/12')).toBeInTheDocument();
		expect(bar()).toHaveAttribute('aria-valuenow', String(3 / 12));
		expect(bar()).toHaveAttribute('aria-valuemax', '1');
		expect(outcome(container)).toBe('running');
	});

	it('is indeterminate while loading the model, full while saving', () => {
		renderWithProviders(<GenerationProgress />);
		publish({ stage: 'loading_model', message: 'Loading model and LoRAs for Studio' });

		expect(screen.getByText('Loading model and LoRAs for Studio')).toBeInTheDocument();
		expect(bar()).not.toHaveAttribute('aria-valuenow');
		expect(screen.queryByText('0/0')).not.toBeInTheDocument();

		publish({ stage: 'saving', message: 'Saving output' });
		expect(screen.getByText('Saving output')).toBeInTheDocument();
		expect(bar()).toHaveAttribute('aria-valuenow', '1');
	});

	it('shows a complete generation with a full bar', () => {
		const { container } = renderWithProviders(<GenerationProgress />);
		publish({ stage: 'complete', message: 'Complete', current: 12, total: 12 });

		expect(screen.getByText('Complete')).toBeInTheDocument();
		expect(screen.getByText('12/12')).toBeInTheDocument();
		expect(bar()).toHaveAttribute('aria-valuenow', '1');
		expect(outcome(container)).toBe('complete');
	});

	it('names a failure and shows its message (with the full bar in the error state)', () => {
		const { container } = renderWithProviders(<GenerationProgress />);
		publish({ stage: 'error', message: 'Could not start the diffusion runtime: out of memory' });

		expect(screen.getByText(GENERATION_FAILED_TITLE)).toBeInTheDocument();
		expect(screen.getByText('Could not start the diffusion runtime: out of memory')).toBeInTheDocument();
		expect(bar()).toHaveAttribute('aria-valuenow', '1');
		expect(bar()).toHaveAccessibleDescription('Could not start the diffusion runtime: out of memory');
		expect(outcome(container)).toBe('error');
	});

	it('shows a cancelled generation', () => {
		const { container } = renderWithProviders(<GenerationProgress />);
		publish({ stage: 'cancelled', message: 'Generation cancelled' });

		expect(screen.getByText('Generation cancelled')).toBeInTheDocument();
		expect(bar()).toHaveAttribute('aria-valuenow', '1');
		expect(outcome(container)).toBe('cancelled');
	});
});
