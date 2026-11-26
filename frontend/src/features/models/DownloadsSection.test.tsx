import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { useDownloadProgress } from '../../stores/tasksStore';
import { renderWithProviders } from '../../test/render';
import { DownloadsSection } from './DownloadsSection';
import { downloadProgress, GB, installEntry, remoteModel, remoteVersion } from '../../test/modelLibraryData';

vi.mock('../../stores/tasksStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/tasksStore')>();
	return { ...actual, useDownloadProgress: vi.fn() };
});

const SHOWN = remoteModel();
const HIDDEN = remoteModel({ id: '2', name: 'Lora Two', kind: 'lora', versions: [remoteVersion({ id: '21', default_file_id: '211' })] });
const SHOWN_INSTALL = installEntry(SHOWN, SHOWN.versions[0], { taskId: 'task-shown' });
const HIDDEN_INSTALL = installEntry(HIDDEN, HIDDEN.versions[0], { taskId: 'task-hidden' });

function seedActions() {
	const actions = { cancelInstall: vi.fn(async () => undefined), dismissInstallError: vi.fn() };
	useModelCatalogStore.setState(actions);
	return actions;
}

beforeEach(() => {
	vi.mocked(useDownloadProgress)
		.mockReset()
		.mockImplementation((taskId) =>
			taskId === 'task-hidden'
				? downloadProgress({ title: 'Lora Two - v1.0', current: Math.round(1.2 * GB), total: Math.round(4.8 * GB), ratio: 0.25 })
				: null,
		);
});

// Fluent components render slowly on a busy machine: more than the default 5 s per test.
describe('DownloadsSection', () => {
	it('is hidden without installs outside the results', () => {
		seedActions();
		useModelCatalogStore.setState({ results: [SHOWN], installs: { [SHOWN_INSTALL.key]: SHOWN_INSTALL } });
		renderWithProviders(<DownloadsSection />);

		expect(screen.queryByRole('heading', { name: 'Downloads' })).not.toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'Downloads' })).not.toBeInTheDocument();
	});

	it('lists the installs whose model is not among the results, with title and progress', () => {
		seedActions();
		useModelCatalogStore.setState({
			results: [SHOWN],
			installs: { [SHOWN_INSTALL.key]: SHOWN_INSTALL, [HIDDEN_INSTALL.key]: HIDDEN_INSTALL },
		});
		renderWithProviders(<DownloadsSection />);

		expect(screen.getByRole('heading', { name: 'Downloads' })).toBeInTheDocument();
		const items = within(screen.getByRole('list', { name: 'Downloads' })).getAllByRole('listitem');
		expect(items).toHaveLength(1);
		expect(within(items[0]).getByText('Lora Two - v1.0')).toBeInTheDocument();
		expect(within(items[0]).getByText('1.2 GB of 4.8 GB')).toBeInTheDocument();
		expect(within(items[0]).getByRole('progressbar', { name: 'Installing Lora Two - v1.0' })).toHaveAttribute('aria-valuenow', '0.25');
		expect(vi.mocked(useDownloadProgress)).toHaveBeenCalledWith('task-hidden');
	});

	it('lists the install of a version the result card does not show', () => {
		seedActions();
		const v2 = remoteVersion({ id: '12', name: 'v2.0', default_file_id: '201' });
		const model = remoteModel({ versions: [remoteVersion(), v2] });
		const otherVersion = installEntry(model, v2, { taskId: 'task-hidden' });
		useModelCatalogStore.setState({ results: [model], installs: { [otherVersion.key]: otherVersion } });
		const { unmount } = renderWithProviders(<DownloadsSection />);
		expect(within(screen.getByRole('list', { name: 'Downloads' })).getAllByRole('listitem')).toHaveLength(1);
		unmount();

		// Once that version is picked, its card shows the install.
		useModelCatalogStore.setState({ pickedVersionIds: { 'civitai:1': '12' } });
		renderWithProviders(<DownloadsSection />);
		expect(screen.queryByRole('list', { name: 'Downloads' })).not.toBeInTheDocument();
	});

	it('cancels a download', async () => {
		const actions = seedActions();
		useModelCatalogStore.setState({ results: [], installs: { [HIDDEN_INSTALL.key]: HIDDEN_INSTALL } });
		const { user } = renderWithProviders(<DownloadsSection />);

		await user.click(screen.getByRole('button', { name: 'Cancel' }));

		expect(actions.cancelInstall).toHaveBeenCalledWith(HIDDEN_INSTALL.key);
	});

	it('names an install by its kind before the first progress event', () => {
		seedActions();
		const checking = { ...HIDDEN_INSTALL, phase: 'checking' as const, taskId: null };
		useModelCatalogStore.setState({ results: [], installs: { [checking.key]: checking } });
		renderWithProviders(<DownloadsSection />);

		expect(screen.getByText('LoRA download')).toBeInTheDocument();
		expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	});

	it('shows a failed install and dismisses it', async () => {
		const actions = seedActions();
		const failed = { ...HIDDEN_INSTALL, phase: 'failed' as const, error: 'Download interrupted' };
		useModelCatalogStore.setState({ results: [], installs: { [failed.key]: failed } });
		const { user } = renderWithProviders(<DownloadsSection />);

		expect(screen.getByText('Download interrupted')).toBeInTheDocument();
		expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Dismiss' }));

		expect(actions.dismissInstallError).toHaveBeenCalledWith(failed.key);
	});
});
