import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteModel, RemoteModelVersion } from '../../api/types';
import { useModelCatalogStore, useVersionStatus, type InstallOutcome, type VersionStatus } from '../../stores/modelCatalogStore';
import { renderWithProviders } from '../../test/render';
import { downloadProgress, GB, installEntry, remoteFile, remoteModel, remoteVersion, versionStatus } from '../../test/modelLibraryData';
import { ModelDetail } from './ModelDetail';

// useVersionStatus combines three stores (tested with the catalog store): the panel is tested against its contract.
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
	};
	useModelCatalogStore.setState(actions);
	return actions;
}

function withStatus(build: (model: RemoteModel, version: RemoteModelVersion) => Partial<VersionStatus>) {
	vi.mocked(useVersionStatus).mockImplementation((model, version) => versionStatus(model, version, build(model, version)));
}

const V2 = remoteVersion({
	id: '12',
	name: 'v2.0',
	base_model: 'SD 1.5',
	default_file_id: '201',
	files: [
		remoteFile({ id: '201', name: 'model_v2.safetensors', size_bytes: 2 * GB }),
		remoteFile({ id: '202', name: 'model_v2_full.safetensors', size_bytes: 4 * GB, precision: 'fp32', variant: 'full', primary: false }),
	],
	images: [{ url: 'https://image.example/v2.jpeg', width: 450, height: 600, nsfw: false }],
	trigger_words: ['blue hair', 'smile'],
	page_url: 'https://civitai.com/models/1?modelVersionId=12',
});
const V1 = remoteVersion();
const MODEL = remoteModel({ kind: 'lora', versions: [V2, V1] });

beforeEach(() => {
	vi.mocked(useVersionStatus).mockReset();
	withStatus(() => ({}));
});

// Fluent components render slowly on a busy machine: more than the default 5 s per test.
describe('ModelDetail', () => {
	it('shows the picked version: preview, creator, badges, version, trigger words, files and the page link', () => {
		seedActions();
		renderWithProviders(<ModelDetail model={MODEL} onClose={vi.fn()} />);

		expect(screen.getByRole('heading', { name: 'Model One', level: 2 })).toBeInTheDocument();
		expect(screen.getByRole('img', { name: 'Preview of Model One v2.0' })).toHaveAttribute('src', 'https://image.example/v2.jpeg');
		expect(screen.getByText('by alice · 1,000 downloads')).toBeInTheDocument();
		expect(screen.getByText('LoRA')).toBeInTheDocument();
		expect(screen.getByText('SD 1.5')).toBeInTheDocument();
		expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v2.0');
		const words = within(screen.getByRole('list', { name: 'Trigger words' })).getAllByRole('listitem');
		expect(words.map((word) => word.textContent)).toEqual(['blue hair', 'smile']);

		const files = within(screen.getByRole('list', { name: 'Files of this version' })).getAllByRole('listitem');
		expect(files).toHaveLength(2);
		expect(within(files[0]).getByText('model_v2.safetensors')).toBeInTheDocument();
		expect(within(files[0]).getByText('2.0 GB')).toBeInTheDocument();
		expect(within(files[0]).getByText('Default file')).toBeInTheDocument();
		expect(within(files[0]).getByText('SafeTensor · fp16 · pruned')).toBeInTheDocument();
		expect(within(files[1]).getByText('4.0 GB')).toBeInTheDocument();
		expect(within(files[1]).queryByText('Default file')).not.toBeInTheDocument();
		expect(within(files[1]).getByText('SafeTensor · fp32 · full')).toBeInTheDocument();

		const link = screen.getByRole('link', { name: /Open on civitai\.com/ });
		expect(link).toHaveAttribute('href', 'https://civitai.com/models/1?modelVersionId=12');
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	});

	it('picks another version', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ModelDetail model={MODEL} onClose={vi.fn()} />);

		await user.click(screen.getByRole('combobox', { name: 'Version' }));
		await user.click(screen.getByRole('option', { name: 'v1.0' }));

		expect(actions.pickVersion).toHaveBeenCalledWith('civitai:1', '11');
	});

	it('shows the version picked earlier, with the model page when the version has none', () => {
		seedActions();
		useModelCatalogStore.setState({ pickedVersionIds: { 'civitai:1': '11' } });
		const model = remoteModel({ versions: [V2, remoteVersion({ page_url: null })] });
		renderWithProviders(<ModelDetail model={model} onClose={vi.fn()} />);

		expect(screen.getByRole('combobox', { name: 'Version' })).toHaveTextContent('v1.0');
		expect(screen.getByText('Illustrious')).toBeInTheDocument();
		expect(screen.queryByRole('list', { name: 'Trigger words' })).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Open on civitai\.com/ })).toHaveAttribute('href', 'https://civitai.com/models/1');
		expect(vi.mocked(useVersionStatus)).toHaveBeenLastCalledWith(model, model.versions[1]);
	});

	it('copies the trigger words', async () => {
		const actions = seedActions();
		const { user } = renderWithProviders(<ModelDetail model={MODEL} onClose={vi.fn()} />);

		await user.click(screen.getByRole('button', { name: 'Copy trigger words' }));

		expect(actions.copyTriggerWords).toHaveBeenCalledWith(['blue hair', 'smile']);
	});

	it('installs the picked version, shows its progress with Cancel and its failure with Retry / Dismiss', async () => {
		const actions = seedActions();
		const { user, unmount } = renderWithProviders(<ModelDetail model={MODEL} onClose={vi.fn()} />);
		await user.click(screen.getByRole('button', { name: 'Download and use' }));
		expect(actions.install).toHaveBeenCalledWith(MODEL, V2);
		unmount();

		withStatus((model, version) => ({ kind: 'installing', install: installEntry(model, version), progress: downloadProgress({ ratio: 0.5 }) }));
		const progress = renderWithProviders(<ModelDetail model={MODEL} onClose={vi.fn()} />);
		expect(screen.getByText('Downloading')).toBeInTheDocument();
		expect(screen.getByRole('progressbar', { name: /^Installing / })).toHaveAttribute('aria-valuenow', '0.5');
		await progress.user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(actions.cancelInstall).toHaveBeenCalledWith('civitai:12:201');
		progress.unmount();

		withStatus((model, version) => ({ kind: 'failed', reason: 'SHA-256 mismatch', install: installEntry(model, version, { phase: 'failed', error: 'SHA-256 mismatch' }) }));
		const failed = renderWithProviders(<ModelDetail model={MODEL} onClose={vi.fn()} />);
		expect(screen.getByText('SHA-256 mismatch')).toBeInTheDocument();
		await failed.user.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(actions.dismissInstallError).toHaveBeenCalledWith('civitai:12:201');
	});

	it('says why a version cannot be installed', () => {
		seedActions();
		withStatus(() => ({ kind: 'unavailable', reason: 'Flux.1 D models cannot run locally.' }));
		renderWithProviders(<ModelDetail model={MODEL} onClose={vi.fn()} />);

		expect(screen.getByText('Not supported')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Download and use' })).toBeDisabled();
		expect(screen.getByText('Flux.1 D models cannot run locally.')).toBeInTheDocument();
	});

	it('shows a model without versions or files', () => {
		seedActions();
		const { unmount } = renderWithProviders(<ModelDetail model={remoteModel({ versions: [] })} onClose={vi.fn()} />);
		expect(screen.getByText('No version available.')).toBeInTheDocument();
		expect(vi.mocked(useVersionStatus)).not.toHaveBeenCalled();
		unmount();

		renderWithProviders(<ModelDetail model={remoteModel({ versions: [remoteVersion({ files: [], images: [] })] })} onClose={vi.fn()} />);
		expect(screen.getByText('This version publishes no file.')).toBeInTheDocument();
		expect(screen.queryByRole('img')).not.toBeInTheDocument();
	});

	it('takes the focus on its heading and closes with Close or Escape', async () => {
		seedActions();
		const onClose = vi.fn();
		const { user } = renderWithProviders(<ModelDetail model={MODEL} onClose={onClose} />);

		expect(screen.getByRole('heading', { name: 'Model One' })).toHaveFocus();
		await user.keyboard('{Escape}');
		await user.click(screen.getByRole('button', { name: 'Close details' }));

		expect(onClose).toHaveBeenCalledTimes(2);
	});

	it('names every control', () => {
		seedActions();
		withStatus((model, version) => ({ kind: 'installing', install: installEntry(model, version), progress: downloadProgress() }));
		renderWithProviders(<ModelDetail model={MODEL} onClose={vi.fn()} />);

		for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('combobox'), ...screen.getAllByRole('link')]) {
			expect(control).toHaveAccessibleName();
		}
		expect(screen.getByRole('progressbar')).toHaveAccessibleName();
	});
});
