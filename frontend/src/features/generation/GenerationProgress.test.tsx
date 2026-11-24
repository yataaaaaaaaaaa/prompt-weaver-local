import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOutputsStore } from '../../stores/outputsStore';
import { useGenerationProgress, type GenerationProgress as Progress } from '../../stores/tasksStore';
import { renderWithProviders } from '../../test/render';
import { GenerationProgress } from './GenerationProgress';

vi.mock('../../stores/tasksStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/tasksStore')>();
	return { ...actual, useGenerationProgress: vi.fn() };
});

const IDLE: Progress = { stage: null, message: '', current: 0, total: 0, ratio: 0, active: false };

beforeEach(() => {
	vi.mocked(useGenerationProgress).mockReset().mockReturnValue(IDLE);
});

describe('GenerationProgress', () => {
	it('shows Idle and an empty bar without progress or output', () => {
		renderWithProviders(<GenerationProgress />);

		expect(screen.getByText('Idle')).toBeInTheDocument();
		expect(screen.getByRole('progressbar', { name: 'Generation progress' })).toHaveAttribute('aria-valuenow', '0');
	});

	it('names the viewed output when idle', () => {
		useOutputsStore.setState({ currentId: '0000000042' });
		renderWithProviders(<GenerationProgress />);

		expect(screen.getByText('Viewing output #0000000042')).toBeInTheDocument();
	});

	it('shows the progress message, the step count and the ratio', () => {
		useOutputsStore.setState({ currentId: '0000000042' });
		vi.mocked(useGenerationProgress).mockReturnValue({ stage: 'sampling', message: 'Sampling', current: 3, total: 10, ratio: 0.3, active: true });
		renderWithProviders(<GenerationProgress />);

		expect(screen.getByText('Sampling')).toBeInTheDocument();
		expect(screen.getByText('3/10')).toBeInTheDocument();
		const bar = screen.getByRole('progressbar', { name: 'Generation progress' });
		expect(bar).toHaveAttribute('aria-valuenow', '0.3');
		expect(bar).toHaveAttribute('aria-valuemax', '1');
	});

	it('is indeterminate while active without a total', () => {
		vi.mocked(useGenerationProgress).mockReturnValue({ stage: 'loading_model', message: 'Loading model', current: 0, total: 0, ratio: 0, active: true });
		renderWithProviders(<GenerationProgress />);

		expect(screen.getByText('Loading model')).toBeInTheDocument();
		expect(screen.getByRole('progressbar', { name: 'Generation progress' })).not.toHaveAttribute('aria-valuenow');
		expect(screen.queryByText('0/0')).not.toBeInTheDocument();
	});
});
