import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { renderWithProviders } from '../../test/render';
import { ModelLibraryPane } from './ModelLibraryPane';
import { INFO, installEntry, remoteModel } from '../../test/modelLibraryData';

function seed() {
	const activate = vi.fn(async () => undefined);
	useModelCatalogStore.setState({ activate, info: INFO, infoStatus: 'ready', searchStatus: 'ready' });
	return { activate };
}

describe('ModelLibraryPane', () => {
	it('activates the catalog store once on mount', () => {
		const { activate } = seed();
		const { rerender } = renderWithProviders(<ModelLibraryPane />);
		rerender(<ModelLibraryPane />);

		expect(activate).toHaveBeenCalledTimes(1);
	});

	it('opens on the online search with the provider token action', () => {
		seed();
		renderWithProviders(<ModelLibraryPane />);

		expect(screen.getByRole('tab', { name: 'Online' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel', { name: 'Online' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Search' })).toBeInTheDocument();
		expect(screen.getByRole('searchbox', { name: 'Search models' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Civitai token' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument();
		expect(screen.getByText('No models match this search.')).toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Downloads' })).not.toBeInTheDocument();
	});

	it('shows the downloads of models outside the results', () => {
		seed();
		const model = remoteModel({ id: '9', kind: 'lora' });
		const install = installEntry(model, model.versions[0], { phase: 'checking', taskId: null });
		useModelCatalogStore.setState({ installs: { [install.key]: install } });
		renderWithProviders(<ModelLibraryPane />);

		expect(screen.getByRole('heading', { name: 'Downloads' })).toBeInTheDocument();
		expect(screen.getByText('LoRA download')).toBeInTheDocument();
	});

	it('switches to the local library', async () => {
		seed();
		const { user } = renderWithProviders(<ModelLibraryPane />);

		await user.click(screen.getByRole('tab', { name: 'Local library' }));

		expect(screen.getByRole('tab', { name: 'Local library' })).toHaveAttribute('aria-selected', 'true');
		expect(screen.getByRole('tabpanel', { name: 'Local library' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Checkpoints' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'LoRAs' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Model folders' })).toBeInTheDocument();
		expect(screen.queryByRole('searchbox', { name: 'Search models' })).not.toBeInTheDocument();

		await user.click(screen.getByRole('tab', { name: 'Online' }));
		expect(screen.getByRole('searchbox', { name: 'Search models' })).toBeInTheDocument();
	});

	it('switches tabs from the keyboard', async () => {
		seed();
		const { user } = renderWithProviders(<ModelLibraryPane />);

		await user.tab();
		expect(screen.getByRole('tab', { name: 'Online' })).toHaveFocus();
		// Arrow-key moves between tabs come from tabster, which does not run in jsdom: focus the tab directly.
		act(() => screen.getByRole('tab', { name: 'Local library' }).focus());
		await user.keyboard('{Enter}');
		expect(screen.getByRole('heading', { name: 'Checkpoints' })).toBeInTheDocument();

		act(() => screen.getByRole('tab', { name: 'Online' }).focus());
		await user.keyboard(' ');
		expect(screen.getByRole('searchbox', { name: 'Search models' })).toBeInTheDocument();
	});
});
