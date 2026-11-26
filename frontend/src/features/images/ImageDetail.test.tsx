import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryKeyOf, makeCategory } from '../../domain/categories';
import { imageKey, type ImageResourceRow } from '../../domain/imageLibrary';
import { installKey } from '../../domain/modelCatalog';
import { useCategoriesStore } from '../../stores/categoriesStore';
import { useCharactersStore } from '../../stores/charactersStore';
import { useImageCheckpointRow, useImageLibraryStore, useImageLoraRows, useImageTags } from '../../stores/imageLibraryStore';
import { useModelCatalogStore } from '../../stores/modelCatalogStore';
import { useDownloadProgress } from '../../stores/tasksStore';
import {
	CHILLOUT,
	DETAIL_IMAGE,
	favoriteImage,
	imageParams,
	KIM_LORA,
	remoteImage,
} from '../../test/imageLibraryData';
import { DETAIL_TWEAKER, DETAIL_TWEAKER_VERSION, downloadProgress, installEntry } from '../../test/modelLibraryData';
import { renderWithProviders } from '../../test/render';
import { ImageDetail } from './ImageDetail';

vi.mock('../../stores/imageLibraryStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/imageLibraryStore')>();
	return { ...actual, useImageTags: vi.fn(), useImageLoraRows: vi.fn(), useImageCheckpointRow: vi.fn() };
});

vi.mock('../../stores/tasksStore', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../stores/tasksStore')>();
	return { ...actual, useDownloadProgress: vi.fn() };
});

const KEY = imageKey(DETAIL_IMAGE);
const TAGS = ['masterpiece', 'best quality', 'portrait', 'snowing'];
const KIM_VERSION = KIM_LORA.versions[0];
const CHILLOUT_VERSION = CHILLOUT.versions[0];

/** The row the store hooks compute for DETAIL_IMAGE.resources[index] (neutral defaults: resolved nothing yet). */
function resourceRow(index: number, overrides: Partial<ImageResourceRow> = {}): ImageResourceRow {
	const resource = DETAIL_IMAGE.resources[index];
	return {
		index,
		resource,
		name: resource.name ?? 'Unnamed model',
		weight: resource.kind === 'lora' ? (resource.weight ?? 1) : null,
		weightPublished: resource.weight !== null,
		status: 'remote',
		reason: null,
		libraryEntryId: null,
		installKey: null,
		model: null,
		version: null,
		pageUrl: null,
		...overrides,
	};
}

const CHECKPOINT_ROW = resourceRow(0, {
	name: 'ChilloutMix - NiPrunedFp32Fix',
	model: CHILLOUT,
	version: CHILLOUT_VERSION,
	installKey: installKey('civitai', CHILLOUT_VERSION, null),
	pageUrl: CHILLOUT_VERSION.page_url,
});
const ADD_DETAIL_ROW = resourceRow(1, {
	name: 'Detail Tweaker LoRA - v1.0',
	status: 'in_library',
	libraryEntryId: 'lora-add-detail',
	model: DETAIL_TWEAKER,
	version: DETAIL_TWEAKER_VERSION,
	installKey: installKey('civitai', DETAIL_TWEAKER_VERSION, null),
	pageUrl: DETAIL_TWEAKER_VERSION.page_url,
});
const KIM_ROW = resourceRow(2, {
	name: 'Kim LoRA - v1',
	status: 'installing',
	model: KIM_LORA,
	version: KIM_VERSION,
	installKey: installKey('civitai', KIM_VERSION, null),
	pageUrl: KIM_VERSION.page_url,
});
const NAME_ONLY_ROW = resourceRow(3, { status: 'unresolved', reason: 'No version id or hash published.' });
const LORA_ROWS = [ADD_DETAIL_ROW, KIM_ROW, NAME_ONLY_ROW];

function seedActions() {
	const actions = {
		toggleFavorite: vi.fn(async () => undefined),
		copyPrompt: vi.fn(async () => undefined),
		addTagsToCategory: vi.fn(),
		applyImageLoras: vi.fn(async () => undefined),
		switchToImageCheckpoint: vi.fn(async () => undefined),
		resolveResources: vi.fn(async () => undefined),
	};
	useImageLibraryStore.setState({ ...actions, results: [DETAIL_IMAGE] });
	useModelCatalogStore.setState({ cancelInstall: vi.fn(async () => undefined) });
	return actions;
}

function renderDetail(key = KEY) {
	const onClose = vi.fn();
	return { onClose, ...renderWithProviders(<ImageDetail imageKey={key} onClose={onClose} />) };
}

function section(name: string): HTMLElement {
	return screen.getByRole('region', { name });
}

beforeEach(() => {
	vi.mocked(useImageTags).mockReset().mockReturnValue(TAGS);
	vi.mocked(useImageLoraRows).mockReset().mockReturnValue(LORA_ROWS);
	vi.mocked(useImageCheckpointRow).mockReset().mockReturnValue(CHECKPOINT_ROW);
	vi.mocked(useDownloadProgress).mockReset().mockReturnValue(null);
});

// Fluent components render slowly on a busy machine: more than the default 5 s per test.
describe('ImageDetail overview', () => {
	it('shows the large preview, the author and the base model', () => {
		seedActions();
		renderDetail();

		expect(screen.getByRole('heading', { name: 'Image by alice' })).toBeInTheDocument();
		const preview = screen.getByRole('img', { name: 'Image by alice' });
		expect(preview).toHaveAttribute('src', DETAIL_IMAGE.url);
		expect(preview).toHaveAttribute('width', '512');
		expect(preview).toHaveAttribute('height', '768');
		expect(screen.getByText('by alice')).toBeInTheDocument();
		expect(screen.getByText('SD 1.5')).toBeInTheDocument();
		expect(screen.queryByText('Not supported locally')).not.toBeInTheDocument();
		expect(screen.queryByText('NSFW')).not.toBeInTheDocument();
	});

	it('flags a base model the local runtime cannot load', () => {
		seedActions();
		const flux = remoteImage({ id: '77', base_model: 'Flux.1 D', architecture: null, nsfw: true, username: null });
		useImageLibraryStore.setState({ results: [flux] });
		renderDetail(imageKey(flux));

		expect(screen.getByText('Flux.1 D')).toBeInTheDocument();
		expect(screen.getByText('Not supported locally')).toBeInTheDocument();
		expect(screen.getByText('NSFW')).toBeInTheDocument();
		expect(screen.getByText('Anonymous upload')).toBeInTheDocument();
	});

	it('finds the image among the favorites too', () => {
		seedActions();
		useImageLibraryStore.setState({ results: [], favorites: [favoriteImage(DETAIL_IMAGE)] });
		renderDetail();

		expect(screen.getByRole('img', { name: 'Image by alice' })).toBeInTheDocument();
	});

	it('renders nothing when the image is no longer listed (the section shows its empty detail)', () => {
		seedActions();
		useImageLibraryStore.setState({ results: [] });
		renderDetail();

		expect(screen.queryByRole('heading')).not.toBeInTheDocument();
		expect(screen.queryByRole('img')).not.toBeInTheDocument();
		expect(screen.queryByRole('button')).not.toBeInTheDocument();
	});

	it('toggles the favorite', async () => {
		const actions = seedActions();
		const { user } = renderDetail();

		const favorite = screen.getByRole('button', { name: 'Favorite' });
		expect(favorite).toHaveAttribute('aria-pressed', 'false');
		await user.click(favorite);
		expect(actions.toggleFavorite).toHaveBeenCalledWith(KEY);

		act(() => useImageLibraryStore.setState({ favorites: [favoriteImage(DETAIL_IMAGE)] }));
		expect(favorite).toHaveAttribute('aria-pressed', 'true');
	});

	it('copies the prompt, unless the image publishes none', async () => {
		const actions = seedActions();
		const { user, unmount } = renderDetail();

		await user.click(screen.getByRole('button', { name: 'Copy prompt' }));
		expect(actions.copyPrompt).toHaveBeenCalledWith(KEY);
		unmount();

		const bare = remoteImage({ id: '88', params: null });
		useImageLibraryStore.setState({ results: [bare] });
		renderDetail(imageKey(bare));
		expect(screen.getByRole('button', { name: 'Copy prompt' })).toBeDisabled();
	});

	it('creates a character from the image', async () => {
		seedActions();
		const startCreateFromImage = vi.fn(async () => undefined);
		useCharactersStore.setState({ startCreateFromImage });
		const { user } = renderDetail();

		await user.click(screen.getByRole('button', { name: 'Create character' }));

		expect(startCreateFromImage).toHaveBeenCalledWith(KEY);
	});

	it('disables Create character while this image prepares it', () => {
		seedActions();
		useCharactersStore.setState({ preparingImageKey: KEY });
		const { unmount } = renderDetail();

		const create = screen.getByRole('button', { name: 'Create character' });
		expect(create).toBeDisabled();
		expect(within(create).getByRole('progressbar')).toBeInTheDocument();
		unmount();

		useCharactersStore.setState({ preparingImageKey: 'civitai:other' });
		renderDetail();
		expect(screen.getByRole('button', { name: 'Create character' })).toBeEnabled();
	});

	it('links to the image page in a new browser window', () => {
		seedActions();
		renderDetail();

		const link = screen.getByRole('link', { name: 'Open on civitai.com' });
		expect(link).toHaveAttribute('href', DETAIL_IMAGE.page_url);
		expect(link).toHaveAttribute('target', '_blank');
		expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	});
});

describe('ImageDetail navigation', () => {
	it('focuses its heading when it opens and closes with Close', async () => {
		seedActions();
		const { user, onClose } = renderDetail();

		expect(screen.getByRole('heading', { name: 'Image by alice', level: 2 })).toHaveFocus();
		await user.click(screen.getByRole('button', { name: 'Close details' }));

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('closes with Escape', async () => {
		seedActions();
		const { user, onClose } = renderDetail();

		act(() => screen.getByRole('button', { name: 'Copy prompt' }).focus());
		await user.keyboard('{Escape}');

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('leaves Escape to an open menu', async () => {
		seedActions();
		const { user, onClose } = renderDetail();

		await user.click(screen.getByRole('button', { name: 'Add to category' }));
		const menu = await screen.findByRole('menu');
		fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'New category' }), { key: 'Escape' });

		expect(onClose).not.toHaveBeenCalled();
	});
});

describe('ImageDetail tags', () => {
	function seedCategories() {
		useCategoriesStore.setState({ categories: [makeCategory('Characters'), makeCategory('Scenery')] });
	}

	it('lists the tags', () => {
		seedActions();
		renderDetail();

		const group = within(section('Tags')).getByRole('toolbar', { name: 'Tags' });
		expect(within(group).getAllByRole('button').map((tag) => tag.textContent)).toEqual(TAGS);
		expect(vi.mocked(useImageTags)).toHaveBeenCalledWith(KEY);
	});

	it('adds every tag to an existing category', async () => {
		const actions = seedActions();
		seedCategories();
		const { user } = renderDetail();

		await user.click(screen.getByRole('button', { name: 'Add to category' }));
		const menu = await screen.findByRole('menu');
		expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Characters', 'Scenery', 'New category']);
		await user.click(within(menu).getByRole('menuitem', { name: 'Scenery' }));

		expect(actions.addTagsToCategory).toHaveBeenCalledWith(KEY, categoryKeyOf('Scenery'), undefined);
	});

	it('adds every tag to a new category', async () => {
		const actions = seedActions();
		seedCategories();
		const { user } = renderDetail();

		await user.click(screen.getByRole('button', { name: 'Add to category' }));
		await user.click(await screen.findByRole('menuitem', { name: 'New category' }));

		expect(actions.addTagsToCategory).toHaveBeenCalledWith(KEY, null, undefined);
	});

	it('adds only the selected tags, in prompt order', async () => {
		const actions = seedActions();
		seedCategories();
		const { user } = renderDetail();

		const group = screen.getByRole('toolbar', { name: 'Tags' });
		await user.click(within(group).getByRole('button', { name: 'snowing' }));
		await user.click(within(group).getByRole('button', { name: 'masterpiece' }));
		await user.click(within(group).getByRole('button', { name: 'portrait' }));
		await user.click(within(group).getByRole('button', { name: 'portrait' }));
		expect(within(group).getByRole('button', { name: 'snowing' })).toHaveAttribute('aria-pressed', 'true');
		expect(within(group).getByRole('button', { name: 'portrait' })).toHaveAttribute('aria-pressed', 'false');

		await user.click(screen.getByRole('button', { name: 'Add 2 to category' }));
		await user.click(await screen.findByRole('menuitem', { name: 'Characters' }));

		expect(actions.addTagsToCategory).toHaveBeenCalledWith(KEY, categoryKeyOf('Characters'), ['masterpiece', 'snowing']);
	});

	it('disables the menu without tags', () => {
		seedActions();
		vi.mocked(useImageTags).mockReturnValue([]);
		renderDetail();

		expect(screen.getByText('This image publishes no prompt tags.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Add to category' })).toBeDisabled();
	});
});

describe('ImageDetail LoRAs', () => {
	function loraItems(): HTMLElement[] {
		return within(screen.getByRole('list', { name: 'LoRAs of this image' })).getAllByRole('listitem');
	}

	it('shows each LoRA with its name, weight and status', () => {
		seedActions();
		renderDetail();

		expect(vi.mocked(useImageLoraRows)).toHaveBeenCalledWith(KEY);
		const [addDetail, kim, nameOnly] = loraItems();
		expect(within(addDetail).getByRole('link', { name: 'Detail Tweaker LoRA - v1.0' })).toHaveAttribute('href', DETAIL_TWEAKER_VERSION.page_url);
		expect(within(addDetail).getByText('Weight 1')).toBeInTheDocument();
		expect(within(addDetail).getByText('In library')).toBeInTheDocument();

		expect(within(kim).getByRole('link', { name: 'Kim LoRA - v1' })).toHaveAttribute('target', '_blank');
		expect(within(kim).getByText('Weight 0.6')).toBeInTheDocument();
		expect(within(kim).getByText('Downloading')).toBeInTheDocument();

		expect(within(nameOnly).queryByRole('link')).not.toBeInTheDocument();
		expect(within(nameOnly).getByText('realistic filter [IL]')).toBeInTheDocument();
		expect(within(nameOnly).getByText('Weight 1 (unpublished, default)')).toBeInTheDocument();
		const status = within(nameOnly).getByText('Not identified');
		expect(status).toHaveAccessibleDescription('No version id or hash published.');
		expect(status).toHaveAttribute('tabindex', '0');
	});

	it('labels every status', () => {
		seedActions();
		vi.mocked(useImageLoraRows).mockReturnValue([
			resourceRow(1, { status: 'on_disk' }),
			resourceRow(1, { index: 11, status: 'remote' }),
			resourceRow(1, { index: 12, status: 'failed', reason: 'Disk full' }),
			resourceRow(1, { index: 13, status: 'unavailable', reason: 'Flux LoRAs cannot run locally.' }),
			resourceRow(1, { index: 14, status: 'resolving' }),
		]);
		renderDetail();

		expect(loraItems().map((item) => within(item).getAllByText(/./).at(-1)?.textContent)).toEqual([
			'On disk',
			'Available to download',
			'Failed',
			'Not supported',
			'Resolving',
		]);
		expect(screen.getByText('Failed')).toHaveAccessibleDescription('Disk full');
		expect(screen.getByText('Not supported')).toHaveAccessibleDescription('Flux LoRAs cannot run locally.');
		expect(screen.getByText('Resolving')).not.toHaveAttribute('tabindex');
	});

	it('shows the progress of a downloading LoRA', () => {
		seedActions();
		const install = installEntry(KIM_LORA, KIM_VERSION, { taskId: 'task-kim' });
		expect(install.key).toBe(KIM_ROW.installKey);
		useModelCatalogStore.setState({ installs: { [install.key]: install } });
		vi.mocked(useDownloadProgress).mockImplementation((taskId) =>
			taskId === 'task-kim' ? downloadProgress({ title: 'Kim LoRA - v1', current: 75_555_000, total: 151_110_000, ratio: 0.5 }) : null,
		);
		renderDetail();

		const kim = loraItems()[1];
		expect(within(kim).getByRole('progressbar', { name: 'Installing Kim LoRA - v1' })).toHaveAttribute('aria-valuenow', '0.5');
		expect(within(kim).getByText('72.1 MB of 144.1 MB')).toBeInTheDocument();
		expect(within(kim).getByRole('button', { name: 'Cancel' })).toBeEnabled();
		expect(vi.mocked(useDownloadProgress)).toHaveBeenCalledWith('task-kim');
		// The other rows have no install.
		expect(screen.getAllByRole('progressbar')).toHaveLength(1);
	});

	it('uses these LoRAs in one click', async () => {
		const actions = seedActions();
		const { user } = renderDetail();

		expect(screen.getByText('Sets exactly these LoRAs with these weights; missing ones are downloaded first.')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Use these LoRAs' }));

		expect(actions.applyImageLoras).toHaveBeenCalledWith(KEY);
	});

	it('disables Use these LoRAs while it runs', () => {
		seedActions();
		useImageLibraryStore.setState({ applyingLoras: { [KEY]: true } });
		renderDetail();

		const use = screen.getByRole('button', { name: 'Use these LoRAs' });
		expect(use).toBeDisabled();
		expect(within(use).getByRole('progressbar')).toBeInTheDocument();
	});

	it('disables Use these LoRAs without LoRAs', () => {
		seedActions();
		vi.mocked(useImageLoraRows).mockReturnValue([]);
		renderDetail();

		expect(screen.getByText('This image publishes no LoRAs.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Use these LoRAs' })).toBeDisabled();
	});

	it('retries a failed resolution', async () => {
		const actions = seedActions();
		useImageLibraryStore.setState({ resolutions: { [KEY]: { status: 'failed', items: [], error: 'Civitai is unreachable' } } });
		const { user } = renderDetail();

		expect(screen.getByText('Could not identify the models')).toBeInTheDocument();
		expect(screen.getByText('Civitai is unreachable')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry' }));

		expect(actions.resolveResources).toHaveBeenCalledWith(KEY);
	});

	it('offers no Retry while the resolution is fine', () => {
		seedActions();
		useImageLibraryStore.setState({ resolutions: { [KEY]: { status: 'loading', items: [], error: null } } });
		renderDetail();

		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
	});
});

describe('ImageDetail checkpoint', () => {
	it('shows the checkpoint and switches to it', async () => {
		const actions = seedActions();
		const { user } = renderDetail();

		const checkpoint = section('Checkpoint');
		expect(vi.mocked(useImageCheckpointRow)).toHaveBeenCalledWith(KEY);
		expect(within(checkpoint).getByRole('link', { name: 'ChilloutMix - NiPrunedFp32Fix' })).toHaveAttribute('href', CHILLOUT_VERSION.page_url);
		expect(within(checkpoint).getByText('Available to download')).toBeInTheDocument();
		await user.click(within(checkpoint).getByRole('button', { name: 'Use this checkpoint' }));

		expect(actions.switchToImageCheckpoint).toHaveBeenCalledWith(KEY);
	});

	it('disables the switch while it runs', () => {
		seedActions();
		useImageLibraryStore.setState({ switchingCheckpoint: { [KEY]: true } });
		renderDetail();

		expect(screen.getByRole('button', { name: 'Use this checkpoint' })).toBeDisabled();
	});

	it('disables the switch with the reason when the checkpoint cannot be used', () => {
		seedActions();
		vi.mocked(useImageCheckpointRow).mockReturnValue(
			resourceRow(0, { name: 'chilloutmix_NiPrunedFp32Fix', status: 'unresolved', reason: 'Unknown at the provider.' }),
		);
		renderDetail();

		const checkpoint = section('Checkpoint');
		expect(within(checkpoint).getByRole('button', { name: 'Use this checkpoint' })).toBeDisabled();
		expect(within(checkpoint).getByText('Not identified')).toBeInTheDocument();
		expect(within(checkpoint).getAllByText('Unknown at the provider.').length).toBeGreaterThan(0);
	});

	it('shows the download of the checkpoint', () => {
		seedActions();
		const install = installEntry(CHILLOUT, CHILLOUT_VERSION, { phase: 'checking', taskId: null });
		useModelCatalogStore.setState({ installs: { [install.key]: install } });
		vi.mocked(useImageCheckpointRow).mockReturnValue({ ...CHECKPOINT_ROW, status: 'installing' });
		renderDetail();

		const checkpoint = section('Checkpoint');
		expect(within(checkpoint).getByText('Checking for a local copy…')).toBeInTheDocument();
		expect(within(checkpoint).getByRole('button', { name: 'Use this checkpoint' })).toBeDisabled();
	});

	it('says when the image publishes no checkpoint', () => {
		seedActions();
		vi.mocked(useImageCheckpointRow).mockReturnValue(null);
		renderDetail();

		expect(within(section('Checkpoint')).getByText('This image publishes no checkpoint.')).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Use this checkpoint' })).not.toBeInTheDocument();
	});
});

describe('ImageDetail generation parameters', () => {
	function param(name: string): string | null {
		return within(screen.getByRole('group', { name })).getAllByText(/./).at(-1)?.textContent ?? null;
	}

	it('shows every parameter', () => {
		seedActions();
		renderDetail();

		expect(param('Prompt')).toBe(DETAIL_IMAGE.params!.prompt);
		expect(param('Negative prompt')).toBe('lowres');
		expect(param('Sampler')).toBe('Euler a');
		expect(param('Steps')).toBe('30');
		expect(param('CFG scale')).toBe('7');
		expect(param('Seed')).toBe('1234');
		expect(param('Size')).toBe('512 × 768');
		expect(param('Clip skip')).toBe('2');
	});

	it('shows missing values as an em dash', () => {
		seedActions();
		const sparse = remoteImage({
			id: '99',
			params: imageParams({ negative_prompt: '', sampler: null, seed: null, clip_skip: null, width: null, cfg_scale: 4.5 }),
		});
		useImageLibraryStore.setState({ results: [sparse] });
		renderDetail(imageKey(sparse));

		expect(param('Negative prompt')).toBe('—');
		expect(param('Sampler')).toBe('—');
		expect(param('Seed')).toBe('—');
		expect(param('Size')).toBe('—');
		expect(param('Clip skip')).toBe('—');
		expect(param('CFG scale')).toBe('4.5');
	});

	it('says when the image publishes no generation data', () => {
		seedActions();
		const bare = remoteImage({ id: '88', params: null });
		useImageLibraryStore.setState({ results: [bare] });
		renderDetail(imageKey(bare));

		expect(within(section('Generation parameters')).getByText('This image publishes no generation data.')).toBeInTheDocument();
		expect(screen.queryByRole('group', { name: 'Prompt' })).not.toBeInTheDocument();
	});
});

describe('ImageDetail accessibility', () => {
	it('names every button, link and toggle', () => {
		seedActions();
		renderDetail();

		for (const control of [...screen.getAllByRole('button'), ...screen.getAllByRole('link')]) {
			expect(control).toHaveAccessibleName();
		}
		for (const name of ['Tags', 'LoRAs', 'Checkpoint', 'Generation parameters']) {
			expect(section(name)).toBeInTheDocument();
		}
	});
});
