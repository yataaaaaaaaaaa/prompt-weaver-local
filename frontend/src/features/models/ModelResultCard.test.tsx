import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteModel, RemoteModelVersion } from '../../api/types';
import { useLibraryStore } from '../../stores/libraryStore';
import { useModelCatalogStore, useVersionStatus, type InstallOutcome, type VersionStatus } from '../../stores/modelCatalogStore';
import { renderWithProviders } from '../../test/render';
import { ModelResultCard } from './ModelResultCard';
import { downloadProgress, GB, installEntry, remoteFile, remoteModel, remoteVersion, versionStatus } from '../../test/modelLibraryData';

// useVersionStatus combines three stores (tested with the catalog store): the card is tested against its contract.
vi.mock('../../stores/modelCatalogStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/modelCatalogStore')>();
	return { ...actual, useVersionStatus: vi.fn() };
});

function seedActions() {
	const actions = {
		install: vi.fn(async (): Promise<InstallOutcome> => ({ status: 'cancelled' })),
		cancelInstall: vi.fn(async () => undefined),
		dismissInstallError: vi.fn(),
		pickVersion: vi.fn(),
		copyTriggerWords: vi.fn(async () => undefined),
		copyEmbeddingToken: vi.fn(async () => undefined),
	};
	useModelCatalogStore.setState(actions);
	return actions;
}

function withStatus(build: (model: RemoteModel, version: RemoteModelVersion) => Partial<VersionStatus>) {
	vi.mocked(useVersionStatus).mockImplementation((model, version) => versionStatus(model, version, build(model, version)));
}

const MODEL = remoteModel();
const VERSION = MODEL.versions[0];

beforeEach(() => {
	vi.mocked(useVersionStatus).mockReset();
	withStatus(() => ({}));
});

describe('ModelResultCard', () => {
	it('shows the picked version preview, name, creator, downloads, badges and size', () => {
		seedActions();
		renderWithProviders(<ModelResultCard model={MODEL} />);

		const card = screen.getByRole('group', { name: 'Model One' });
		expect(within(card).getByText('by alice · 1,000 downloads')).toBeInTheDocument();
		expect(within(card).queryByText('NSFW')).not.toBeInTheDocument();
		expect(within(card).getByRole('img', { name: 'Model One' })).toHaveAttribute('src', 'https://image.example/v1.jpeg');
		expect(within(card).getByRole('img', { name: 'Model One' })).toHaveAttribute('loading', 'lazy');
		expect(within(card).getByText('Checkpoint')).toBeInTheDocument();
		expect(within(card).getByText('Illustrious')).toBeInTheDocument();
		expect(within(card).getByText('6.9 GB')).toBeInTheDocument();
		expect(within(card).getByRole('combobox', { name: 'Version' })).toHaveTextContent('v1.0');
	});

	it('shows the download count alone without creator, and the NSFW badge of an NSFW model', () => {
		seedActions();
		renderWithProviders(<ModelResultCard model={remoteModel({ creator: null, download_count: 48210, nsfw: true })} />);

		const card = screen.getByRole('group', { name: 'Model One' });
		expect(within(card).getByText('48,210 downloads')).toBeInTheDocument();
		expect(within(card).getByText('NSFW')).toBeInTheDocument();
	});

	it('shows a placeholder without preview image', () => {
		seedActions();
		const model = remoteModel({ versions: [remoteVersion({ images: [] })] });
		renderWithProviders(<ModelResultCard model={model} />);

		expect(screen.getByRole('group', { name: 'Model One' })).toBeInTheDocument();
		expect(screen.queryByRole('img')).not.toBeInTheDocument();
	});

	it('remote: downloads and uses the picked version', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ModelResultCard model={MODEL} />);

		// No status badge for a remote version: the card offers 'Download and use'.
		expect(screen.queryByText('On disk')).not.toBeInTheDocument();
		expect(screen.queryByText('Available to download')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Download and use' }));

		expect(actions.install).toHaveBeenCalledWith(MODEL, VERSION);
		expect(vi.mocked(useVersionStatus)).toHaveBeenLastCalledWith(MODEL, VERSION);
	});

	it('on_disk: shows On disk (the shared status label) and uses the local copy', async () => {
		const actions = seedActions();
		withStatus(() => ({ kind: 'on_disk' }));
		const { user } = renderWithProviders(<ModelResultCard model={MODEL} />);

		expect(screen.getByText('On disk')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Download and use' })).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Use' }));

		expect(actions.install).toHaveBeenCalledWith(MODEL, VERSION);
	});

	it('in_library: shows In library, or Selected when the entry is the selected model', async () => {
		const actions = seedActions();
		withStatus(() => ({ kind: 'in_library', libraryEntryId: 'model-one' }));
		const { user, unmount } = renderWithProviders(<ModelResultCard model={MODEL} />);

		expect(screen.getByText('In library')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Use' }));
		expect(actions.install).toHaveBeenCalledWith(MODEL, VERSION);
		unmount();

		useLibraryStore.setState({ selectedModelId: 'model-one' });
		renderWithProviders(<ModelResultCard model={MODEL} />);
		expect(screen.getByText('Selected')).toBeInTheDocument();
		expect(screen.queryByText('In library')).not.toBeInTheDocument();
	});

	it('in_library: a LoRA is Selected when it is among the selected LoRAs', () => {
		seedActions();
		const lora = remoteModel({ kind: 'lora', name: 'Lora One' });
		withStatus(() => ({ kind: 'in_library', libraryEntryId: 'lora-one' }));
		useLibraryStore.setState({ selectedModelId: 'lora-one', selectedLoras: [] });
		const { unmount } = renderWithProviders(<ModelResultCard model={lora} />);
		expect(screen.getByText('In library')).toBeInTheDocument();
		unmount();

		useLibraryStore.setState({ selectedLoras: [{ id: 'lora-one', weight: 0.6 }] });
		renderWithProviders(<ModelResultCard model={lora} />);
		expect(screen.getByText('Selected')).toBeInTheDocument();
		expect(screen.getByText('LoRA')).toBeInTheDocument();
	});

	it('installing: shows the download ratio, the transferred bytes and cancels', async () => {
		const actions = seedActions();
		withStatus((model, version) => ({
			kind: 'installing',
			install: installEntry(model, version),
			progress: downloadProgress({ current: Math.round(1.2 * GB), total: Math.round(4.8 * GB), ratio: 0.25 }),
		}));
		const { user } = renderWithProviders(<ModelResultCard model={MODEL} />);

		expect(screen.getByText('Downloading')).toBeInTheDocument();
		const bar = screen.getByRole('progressbar', { name: 'Installing Model One - v1.0' });
		expect(bar).toHaveAttribute('aria-valuenow', '0.25');
		expect(bar).toHaveAttribute('aria-valuetext', '1.2 GB of 4.8 GB');
		expect(screen.getByText('1.2 GB of 4.8 GB')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Download and use' })).not.toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(actions.cancelInstall).toHaveBeenCalledWith('civitai:11:101');
	});

	it('installing: is indeterminate while checking, without cancel', () => {
		seedActions();
		withStatus((model, version) => ({ kind: 'installing', install: installEntry(model, version, { phase: 'checking', taskId: null }) }));
		renderWithProviders(<ModelResultCard model={MODEL} />);

		// No download task yet: named after the model until the task title (backend display name) is known.
		expect(screen.getByRole('progressbar', { name: 'Installing Model One' })).not.toHaveAttribute('aria-valuenow');
		expect(screen.getByText('Checking for a local copy…')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	});

	it('installing: is indeterminate while registering', () => {
		seedActions();
		withStatus((model, version) => ({
			kind: 'installing',
			install: installEntry(model, version, { phase: 'registering' }),
			progress: downloadProgress({ stage: 'complete', ratio: 1, current: 10, total: 10, active: false }),
		}));
		renderWithProviders(<ModelResultCard model={MODEL} />);

		expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
		expect(screen.getByText('Adding to the library…')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	});

	it('installing: is indeterminate with the task message while the size is unknown', () => {
		seedActions();
		withStatus((model, version) => ({
			kind: 'installing',
			install: installEntry(model, version),
			progress: downloadProgress({ stage: 'queued', message: 'Queued', current: 0, total: 0, ratio: null }),
		}));
		renderWithProviders(<ModelResultCard model={MODEL} />);

		expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
		expect(screen.getByText('Queued')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
	});

	it('failed: shows the reason, retries and dismisses', async () => {
		const actions = seedActions();
		withStatus((model, version) => ({
			kind: 'failed',
			reason: 'SHA-256 mismatch',
			install: installEntry(model, version, { phase: 'failed', error: 'SHA-256 mismatch', taskId: null }),
		}));
		const { user } = renderWithProviders(<ModelResultCard model={MODEL} />);

		expect(screen.getByText('Failed')).toBeInTheDocument();
		expect(screen.getByText('Install failed')).toBeInTheDocument();
		expect(screen.getByText('SHA-256 mismatch')).toBeInTheDocument();

		await user.click(screen.getByRole('button', { name: 'Retry' }));
		expect(actions.install).toHaveBeenCalledWith(MODEL, VERSION);
		await user.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(actions.dismissInstallError).toHaveBeenCalledWith('civitai:11:101');
	});

	it('unavailable: disables the download and shows the reason', () => {
		seedActions();
		withStatus(() => ({ kind: 'unavailable', reason: 'Flux.1 D models cannot run locally.', sizeBytes: null }));
		renderWithProviders(<ModelResultCard model={MODEL} />);

		expect(screen.getByText('Not supported')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Download and use' })).toBeDisabled();
		expect(screen.getByText('Flux.1 D models cannot run locally.')).toBeInTheDocument();
		expect(screen.queryByText('6.9 GB')).not.toBeInTheDocument();
	});

	it('picks another version and shows the picked one', async () => {
		const actions = seedActions();
		const v2 = remoteVersion({
			id: '12',
			name: 'v2.0',
			base_model: 'SD 1.5',
			default_file_id: '201',
			files: [remoteFile({ id: '201', size_bytes: 2 * GB })],
			images: [{ url: 'https://image.example/v2.jpeg', width: null, height: null, nsfw: false }],
		});
		const model = remoteModel({ versions: [v2, VERSION] });
		const { user, unmount } = renderWithProviders(<ModelResultCard model={model} />);

		expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v2.0');
		await user.click(screen.getByRole('combobox', { name: 'Version' }));
		await user.click(screen.getByRole('option', { name: 'v1.0' }));
		expect(actions.pickVersion).toHaveBeenCalledWith('civitai:1', '11');
		unmount();

		useModelCatalogStore.setState({ pickedVersionIds: { 'civitai:1': '11' } });
		renderWithProviders(<ModelResultCard model={model} />);
		expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v1.0');
		expect(screen.getByRole('img', { name: 'Model One' })).toHaveAttribute('src', 'https://image.example/v1.jpeg');
		expect(screen.getByText('Illustrious')).toBeInTheDocument();
		expect(vi.mocked(useVersionStatus)).toHaveBeenLastCalledWith(model, VERSION);
	});

	it('shows the trigger words and copies them', async () => {
		const actions = seedActions();
		const model = remoteModel({ kind: 'lora', versions: [remoteVersion({ trigger_words: ['blue hair', 'smile'] })] });
		const { user } = renderWithProviders(<ModelResultCard model={model} />);

		const words = within(screen.getByRole('list', { name: 'Trigger words' })).getAllByRole('listitem');
		expect(words.map((word) => word.textContent)).toEqual(['blue hair', 'smile']);
		await user.click(screen.getByRole('button', { name: 'Copy trigger words' }));

		expect(actions.copyTriggerWords).toHaveBeenCalledWith(['blue hair', 'smile']);
	});

	it('hides the trigger words without any', () => {
		seedActions();
		renderWithProviders(<ModelResultCard model={MODEL} />);

		expect(screen.queryByRole('list', { name: 'Trigger words' })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Copy trigger words' })).not.toBeInTheDocument();
	});

	it('copies the prompt token of a local embedding', async () => {
		const actions = seedActions();
		const path = 'D:/models/embeddings/easynegative.safetensors';
		const embedding = remoteModel({ kind: 'embedding', versions: [remoteVersion({ files: [remoteFile({ local_path: path })] })] });
		withStatus(() => ({ kind: 'on_disk' }));
		const { user } = renderWithProviders(<ModelResultCard model={embedding} />);

		await user.click(screen.getByRole('button', { name: 'Copy prompt token' }));
		expect(actions.copyEmbeddingToken).toHaveBeenCalledWith(path);
	});

	it('offers no prompt token without a local path or for other kinds', () => {
		seedActions();
		withStatus(() => ({ kind: 'on_disk' }));
		const embedding = remoteModel({ kind: 'embedding' });
		const { unmount } = renderWithProviders(<ModelResultCard model={embedding} />);
		expect(screen.queryByRole('button', { name: 'Copy prompt token' })).not.toBeInTheDocument();
		unmount();

		const checkpoint = remoteModel({ versions: [remoteVersion({ files: [remoteFile({ local_path: 'D:/models/checkpoints/model.safetensors' })] })] });
		renderWithProviders(<ModelResultCard model={checkpoint} />);
		expect(screen.queryByRole('button', { name: 'Copy prompt token' })).not.toBeInTheDocument();
	});

	it('shows a model without versions', () => {
		seedActions();
		renderWithProviders(<ModelResultCard model={remoteModel({ versions: [] })} />);

		expect(screen.getByText('No version available.')).toBeInTheDocument();
		expect(screen.queryByRole('combobox', { name: 'Version' })).not.toBeInTheDocument();
		expect(vi.mocked(useVersionStatus)).not.toHaveBeenCalled();
	});

	it('names every control', () => {
		seedActions();
		const model = remoteModel({ kind: 'lora', versions: [remoteVersion({ trigger_words: ['smile'] })] });
		withStatus((item, version) => ({ kind: 'installing', install: installEntry(item, version), progress: downloadProgress() }));
		renderWithProviders(<ModelResultCard model={model} />);

		for (const button of screen.getAllByRole('button')) {
			expect(button).toHaveAccessibleName();
		}
		expect(screen.getByRole('combobox', { name: 'Version' })).toBeInTheDocument();
		expect(screen.getByRole('progressbar')).toHaveAccessibleName();
	});
});
