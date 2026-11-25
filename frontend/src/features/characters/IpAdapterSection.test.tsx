import { act, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelSpec } from '../../api/types';
import { useIpAdapterStore } from '../../stores/ipAdapterStore';
import { useLibraryStore } from '../../stores/libraryStore';
import { useDownloadProgress } from '../../stores/tasksStore';
import {
	IMAGE_ENCODER_FILE,
	ipAdapterFile,
	ipAdapterStatus,
	ipAdapterVariant,
	READY_SDXL_FACE,
	referenceSupport,
} from '../../test/characterData';
import { downloadProgress } from '../../test/modelLibraryData';
import { renderWithProviders } from '../../test/render';
import { IpAdapterSection } from './IpAdapterSection';
import { ReferenceSupportHint } from './ReferenceSupportHint';
import { seedIpAdapterActions } from '../../test/characterStores';

vi.mock('../../stores/tasksStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/tasksStore')>();
	return { ...actual, useDownloadProgress: vi.fn() };
});

const SDXL_MODEL: ModelSpec = { id: 'm1', name: 'Noobai', path: 'D:/models/noobai.safetensors', default_width: 1024, default_height: 1024, torch_dtype: 'float16', source: null };
const OTHER_MODEL: ModelSpec = { ...SDXL_MODEL, id: 'm2', name: 'Pony', path: 'D:/models/pony.safetensors' };

const ADAPTER_NAME = 'ip-adapter-plus-face_sdxl_vit-h.safetensors';
const MISSING_REASON = 'Download the IP-Adapter to use reference images.';

let actions: ReturnType<typeof seedIpAdapterActions>;

beforeEach(() => {
	actions = seedIpAdapterActions();
	useLibraryStore.setState({ models: [SDXL_MODEL, OTHER_MODEL], selectedModelId: SDXL_MODEL.id });
	vi.mocked(useDownloadProgress).mockReset().mockReturnValue(null);
});

function seedStatus(status = ipAdapterStatus(), extra: Partial<Parameters<typeof useIpAdapterStore.setState>[0]> = {}) {
	useIpAdapterStore.setState({ status, modelPath: SDXL_MODEL.path, loadStatus: 'ready', ...extra });
}

describe('IpAdapterSection status', () => {
	it('refreshes the status on mount and when the selected model changes', () => {
		seedStatus();
		renderWithProviders(<IpAdapterSection />);
		expect(actions.refresh).toHaveBeenCalled();
		const callsOnMount = actions.refresh.mock.calls.length;

		act(() => useLibraryStore.setState({ selectedModelId: OTHER_MODEL.id }));
		expect(actions.refresh.mock.calls.length).toBeGreaterThan(callsOnMount);
		const callsAfterChange = actions.refresh.mock.calls.length;

		// Another state change of the library (same model) does not refresh again.
		act(() => useLibraryStore.setState({ loras: [] }));
		expect(actions.refresh).toHaveBeenCalledTimes(callsAfterChange);
	});

	it('shows a spinner until the status is known', () => {
		useIpAdapterStore.setState({ status: null, loadStatus: 'loading' });
		renderWithProviders(<IpAdapterSection />);

		expect(screen.getByText('Checking the IP-Adapter files…')).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'IP-Adapter variants' })).not.toBeInTheDocument();
	});

	it('shows the error with Retry (forced refresh)', async () => {
		useIpAdapterStore.setState({ status: null, loadStatus: 'failed', loadError: 'The backend is unreachable.' });
		const { user } = renderWithProviders(<IpAdapterSection />);

		expect(screen.getByText('Could not check the IP-Adapter files')).toBeInTheDocument();
		expect(screen.getByText('The backend is unreachable.')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));

		expect(actions.refresh).toHaveBeenLastCalledWith({ force: true });
	});

	it('asks for a model when none is selected', () => {
		useLibraryStore.setState({ selectedModelId: '' });
		seedStatus(ipAdapterStatus({ support: [], architecture: null }));
		renderWithProviders(<IpAdapterSection />);

		expect(screen.getByText('Select a model to check whether reference images can be used with it.')).toBeInTheDocument();
		// The files are listed anyway.
		expect(screen.getByRole('list', { name: 'IP-Adapter variants' })).toBeInTheDocument();
	});
});

describe('IpAdapterSection support', () => {
	it('shows the support of every focus: ready, or the reason with Download', async () => {
		seedStatus(
			ipAdapterStatus({
				variants: [READY_SDXL_FACE, ipAdapterVariant({ id: 'sdxl-general', label: 'SDXL general (IP-Adapter Plus ViT-H)', focus: 'general' })],
				support: [referenceSupport({ ready: true, reason: null }), referenceSupport({ focus: 'general', variant_id: 'sdxl-general' })],
			}),
		);
		const { user } = renderWithProviders(<IpAdapterSection />);

		const [face, general] = within(screen.getByRole('list', { name: 'Reference support' })).getAllByRole('listitem');
		expect(within(face).getByText('Face')).toBeInTheDocument();
		expect(within(face).getByText(`Reference images apply with ${READY_SDXL_FACE.label}.`)).toBeInTheDocument();
		expect(within(face).queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();

		expect(within(general).getByText('Whole subject')).toBeInTheDocument();
		expect(within(general).getByText(MISSING_REASON)).toBeInTheDocument();
		await user.click(within(general).getByRole('button', { name: 'Download' }));
		expect(actions.install).toHaveBeenCalledWith('sdxl-general');
	});

	it('shows the reason without Download when no variant fits the model', () => {
		seedStatus(
			ipAdapterStatus({
				architecture: null,
				support: [referenceSupport({ variant_id: null, reason: 'Flux models have no IP-Adapter here: generation works without references.' })],
			}),
		);
		renderWithProviders(<ReferenceSupportHint focus="face" />);

		expect(screen.getByText('Flux models have no IP-Adapter here: generation works without references.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
	});

	it('shows the progress of each file download with Cancel while the variant installs', async () => {
		const downloading = ipAdapterVariant({ files: [ipAdapterFile({ task_id: 'task-adapter' }), { ...IMAGE_ENCODER_FILE, local_path: 'D:/models/clip_vision/encoder.safetensors' }] });
		seedStatus(ipAdapterStatus({ variants: [downloading] }), { installing: { 'sdxl-face': true } });
		vi.mocked(useDownloadProgress).mockImplementation((taskId) =>
			taskId === 'task-adapter' ? downloadProgress({ title: ADAPTER_NAME, current: 202_000_000, total: 808_000_000, ratio: 0.25 }) : null,
		);
		const { user } = renderWithProviders(<ReferenceSupportHint focus="face" />);

		expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
		expect(screen.getByText(`Downloading ${downloading.label}: reference images apply once it is installed.`)).toBeInTheDocument();
		const downloads = screen.getByRole('list', { name: `Downloads of ${downloading.label}` });
		// Each bar is named on screen by its file.
		expect(within(downloads).getByText(ADAPTER_NAME)).toBeVisible();
		const bar = within(downloads).getByRole('progressbar', { name: `Downloading ${ADAPTER_NAME}` });
		expect(bar).toHaveAttribute('aria-valuenow', '0.25');
		expect(bar).toHaveAttribute('aria-valuetext', '192.6 MB of 770.6 MB');
		expect(screen.getAllByRole('progressbar')).toHaveLength(1);
		expect(vi.mocked(useDownloadProgress)).toHaveBeenCalledWith('task-adapter');

		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(actions.cancelInstall).toHaveBeenCalledWith('sdxl-face');
	});

	it('is indeterminate, without Cancel, until the downloads start', () => {
		seedStatus(ipAdapterStatus(), { installing: { 'sdxl-face': true } });
		renderWithProviders(<ReferenceSupportHint focus="face" />);

		const bar = screen.getByRole('progressbar', { name: `Downloading ${ipAdapterVariant().label}` });
		expect(bar).not.toHaveAttribute('aria-valuenow');
		expect(screen.getByText('Starting the download…')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	});

	it('shows a failed install with what failed and Retry, until it installs again', async () => {
		seedStatus(ipAdapterStatus(), { installFailures: { 'sdxl-face': { [ipAdapterFile().id]: 'Size mismatch: expected 847517512 bytes, received 6291456' } } });
		const { user } = renderWithProviders(<ReferenceSupportHint focus="face" />);

		expect(screen.getByText(`${ipAdapterVariant().label} could not be downloaded`)).toBeInTheDocument();
		expect(screen.getByText(`${ADAPTER_NAME}: Size mismatch: expected 847517512 bytes, received 6291456.`)).toBeInTheDocument();
		expect(screen.queryByText(MISSING_REASON)).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Download' })).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));
		expect(actions.install).toHaveBeenCalledWith('sdxl-face');

		// Installing again: the progress replaces the failure.
		act(() => useIpAdapterStore.setState({ installing: { 'sdxl-face': true } }));
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
	});

	it('shows no failure once the failed file is on disk', () => {
		seedStatus(ipAdapterStatus({ variants: [READY_SDXL_FACE], support: [referenceSupport({ ready: true, reason: null })] }), {
			installFailures: { 'sdxl-face': { [ipAdapterFile().id]: 'Size mismatch.' } },
		});
		renderWithProviders(<ReferenceSupportHint focus="face" />);

		expect(screen.getByText(`Reference images apply with ${READY_SDXL_FACE.label}.`)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});

	it('shows nothing before the status is known', () => {
		useIpAdapterStore.setState({ status: null, loadStatus: 'loading' });
		const { container } = renderWithProviders(<ReferenceSupportHint focus="face" />);

		// Only the Fluent provider is rendered.
		expect(container.textContent).toBe('');
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
		expect(actions.refresh).toHaveBeenCalled();
	});
});

describe('IpAdapterSection files', () => {
	it('shows a failed file download as Failed', () => {
		seedStatus(ipAdapterStatus(), { installFailures: { 'sdxl-face': { [ipAdapterFile().id]: 'Size mismatch.' } } });
		renderWithProviders(<IpAdapterSection />);

		const files = within(screen.getByRole('list', { name: `Files of ${ipAdapterVariant().label}` })).getAllByRole('listitem');
		expect(within(files[0]).getByText('Failed')).toBeInTheDocument();
		expect(within(files[1]).getByText('Available to download')).toBeInTheDocument();
	});

	it('names the selected model above its reference support', () => {
		seedStatus();
		renderWithProviders(<IpAdapterSection />);

		expect(screen.getByRole('heading', { name: `With the selected model ${SDXL_MODEL.name}` })).toBeInTheDocument();
		// No heading or region repeats the section's own name.
		expect(screen.getAllByRole('region', { name: 'Reference images (IP-Adapter)' })).toHaveLength(1);
	});

	it('lists every variant with the shared status of each file, and the folders', () => {
		const general = ipAdapterVariant({
			id: 'sdxl-general',
			label: 'SDXL general (IP-Adapter Plus ViT-H)',
			focus: 'general',
			files: [ipAdapterFile({ id: 'ip-adapter-plus-sdxl-vit-h', name: 'ip-adapter-plus_sdxl_vit-h.safetensors', task_id: 'task-general' }), IMAGE_ENCODER_FILE],
		});
		seedStatus(ipAdapterStatus({ variants: [READY_SDXL_FACE, general] }));
		renderWithProviders(<IpAdapterSection />);

		const [face, sdxlGeneral] = within(screen.getByRole('list', { name: 'IP-Adapter variants' })).getAllByRole('listitem', { name: /SDXL/ });
		expect(within(face).getByText('Ready')).toBeInTheDocument();
		const faceFiles = within(within(face).getByRole('list', { name: `Files of ${READY_SDXL_FACE.label}` })).getAllByRole('listitem');
		expect(faceFiles.map((file) => file.textContent)).toEqual([
			`${ADAPTER_NAME}Adapter · 808.3 MBOn disk`,
			`${IMAGE_ENCODER_FILE.name}Image encoder · 2.4 GBOn disk`,
		]);

		expect(within(sdxlGeneral).queryByText('Ready')).not.toBeInTheDocument();
		const generalFiles = within(within(sdxlGeneral).getByRole('list', { name: `Files of ${general.label}` })).getAllByRole('listitem');
		expect(within(generalFiles[0]).getByText('Downloading')).toBeInTheDocument();
		expect(within(generalFiles[1]).getByText('Available to download')).toBeInTheDocument();

		expect(screen.getByRole('heading', { name: 'IP-Adapter files' })).toBeInTheDocument();
		const folders = within(screen.getByLabelText('IP-Adapter folders'));
		expect(folders.getByText('Adapter folder').closest('dt')?.nextElementSibling).toHaveTextContent('D:/models/ipadapter');
		expect(folders.getByText('Image encoder folder').closest('dt')?.nextElementSibling).toHaveTextContent('D:/models/clip_vision');
	});
});
