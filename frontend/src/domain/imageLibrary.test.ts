import { describe, expect, it } from 'vitest';
import { IMAGE_SEARCH_QUERY_DEFAULTS, LORA_WEIGHT_DEFAULTS } from '../api/defaults.gen';
import type { InstalledModel, RemoteModel } from '../api/types';
import {
	ADD_DETAIL_RESOURCE,
	CHILLOUT,
	CHILLOUT_RESOURCE,
	DETAIL_IMAGE,
	DETAIL_IMAGE_RESOLUTION,
	imageParams,
	imageResource,
	KIM_LORA,
	KIM_RESOURCE,
	NAME_ONLY_RESOURCE,
	remoteImage,
	resolvedResource,
} from '../test/imageLibraryData';
import { DETAIL_TWEAKER, DETAIL_TWEAKER_FILE, DETAIL_TWEAKER_VERSION, installedModel, modelSource } from '../test/modelLibraryData';
import {
	appliedLoraWeight,
	buildImageSearchQuery,
	DEFAULT_IMAGE_FILTERS,
	imageCheckpointRow,
	imageKey,
	imageLoraRows,
	imageResourceRow,
	imageTags,
	isInstallableRow,
	isPeriodApplicable,
	resolvedInstallKeys,
	resolvedModelVersion,
	resourceLibraryEntryId,
	skippedResourcesText,
	type ImageResolution,
	type ImageResourceContext,
	type ImageResourceRow,
} from './imageLibrary';
import { addLoraPaths, addModelPath, registerInstalledEntry } from './library';
import { installKey } from './modelCatalog';

// ---------------------------------------------------------------------------
// Fixtures: DETAIL_IMAGE (src/test/imageLibraryData.ts) = [CHILLOUT checkpoint, add_detail 1, kim_v_1 0.6, name-only]
// ---------------------------------------------------------------------------

const ADD_DETAIL_KEY = installKey('civitai', DETAIL_TWEAKER_VERSION, null);
const KIM_VERSION = KIM_LORA.versions[0];
const KIM_KEY = installKey('civitai', KIM_VERSION, null);
const CHILLOUT_KEY = installKey('civitai', CHILLOUT.versions[0], null);

const SIZE = { width: 512, height: 768 };
type Library = ImageResourceContext['library'];

/** A library of picked files (no provenance), built by the library domain: LoRA files, checkpoint files. */
function pickedFiles(loraPaths: string[], modelPaths: string[] = []): Library {
	return {
		loras: addLoraPaths([], loraPaths, 'file').loras,
		models: modelPaths.reduce<Library['models']>((models, path) => addModelPath(models, path, SIZE).models, []),
	};
}

/** A library holding these installed LoRAs (registerInstalledEntry of the library domain). */
function installedLoras(...installed: InstalledModel[]): Library {
	return installed.reduce<Library>((library, item) => registerInstalledEntry(library, item, SIZE), { models: [], loras: [] });
}

const ready = (items = DETAIL_IMAGE_RESOLUTION): ImageResolution => ({ status: 'ready', items, error: null });

function context(overrides: Partial<ImageResourceContext> = {}): ImageResourceContext {
	return { resolution: ready(), library: { models: [], loras: [] }, installs: {}, ...overrides };
}

/** The row of DETAIL_IMAGE.resources[index]. */
const row = (index: number, overrides: Partial<ImageResourceContext> = {}): ImageResourceRow => imageResourceRow(DETAIL_IMAGE, index, context(overrides));

/** DETAIL_IMAGE with resources[index] resolved to `model` (versions [version]) instead. */
function resolvedAs(index: number, model: RemoteModel): ImageResolution {
	return ready(DETAIL_IMAGE_RESOLUTION.map((item, position) => (position === index ? resolvedResource(item.resource, model) : item)));
}

describe('search queries and keys', () => {
	it('starts from the backend ImageSearchQuery defaults and builds page requests', () => {
		const { provider, query, sort, period, nsfw, usable_only } = IMAGE_SEARCH_QUERY_DEFAULTS;
		expect(DEFAULT_IMAGE_FILTERS).toEqual({ provider, query, sort, period, nsfw, usable_only });
		expect(buildImageSearchQuery({ ...DEFAULT_IMAGE_FILTERS, query: ' castle ' }, 'c1')).toEqual({
			...DEFAULT_IMAGE_FILTERS,
			query: 'castle',
			limit: IMAGE_SEARCH_QUERY_DEFAULTS.limit,
			cursor: 'c1',
		});
		expect(imageKey(DETAIL_IMAGE)).toBe('civitai:148522541');
		expect(isPeriodApplicable({ query: '  ' })).toBe(true);
		expect(isPeriodApplicable({ query: 'castle' })).toBe(false);
	});
});

describe('tags', () => {
	it('splits the prompt without its LoRA tags into unique tags', () => {
		expect(imageTags(DETAIL_IMAGE)).toEqual(['masterpiece', 'best quality', 'portrait', 'snowing']);
	});

	it('counts line breaks as separators', () => {
		const image = remoteImage({ params: imageParams({ clean_prompt: 'castle, sky\nsnow\r\n, Castle,\r(night:1.2) ,  ' }) });
		expect(imageTags(image)).toEqual(['castle', 'sky', 'snow', '(night:1.2)']);
	});

	it('is empty without generation data', () => {
		expect(imageTags(remoteImage({ params: null }))).toEqual([]);
		expect(imageTags(remoteImage({ params: imageParams({ prompt: null, clean_prompt: null }) }))).toEqual([]);
	});
});

describe('appliedLoraWeight', () => {
	it('applies the published weight, the default when unpublished, within the accepted range', () => {
		expect(appliedLoraWeight(imageResource({ weight: 0.6 }))).toBe(0.6);
		expect(appliedLoraWeight(imageResource({ weight: null }))).toBe(LORA_WEIGHT_DEFAULTS.weight);
		expect(appliedLoraWeight(imageResource({ weight: 25 }))).toBe(LORA_WEIGHT_DEFAULTS.max);
		expect(appliedLoraWeight(imageResource({ weight: -12 }))).toBe(LORA_WEIGHT_DEFAULTS.min);
	});
});

describe('resolution helpers', () => {
	it('reads the resolved model and version of an item', () => {
		expect(resolvedModelVersion(DETAIL_IMAGE_RESOLUTION[1])).toEqual({ model: DETAIL_TWEAKER, version: DETAIL_TWEAKER_VERSION });
		expect(resolvedModelVersion(DETAIL_IMAGE_RESOLUTION[3])).toBeNull();
		expect(resolvedModelVersion(null)).toBeNull();
		expect(resolvedModelVersion(resolvedResource(KIM_RESOURCE, { ...KIM_LORA, versions: [] }))).toBeNull();
	});

	it('lists the install keys of the resolved versions (ready resolutions only)', () => {
		expect(resolvedInstallKeys(ready())).toEqual([CHILLOUT_KEY, ADD_DETAIL_KEY, KIM_KEY]);
		expect(resolvedInstallKeys(ready([...DETAIL_IMAGE_RESOLUTION, DETAIL_IMAGE_RESOLUTION[1]]))).toEqual([CHILLOUT_KEY, ADD_DETAIL_KEY, KIM_KEY]);
		expect(resolvedInstallKeys({ status: 'loading', items: [], error: null })).toEqual([]);
		expect(resolvedInstallKeys(undefined)).toEqual([]);
	});
});

describe('resource rows', () => {
	it('while resolving: the published data only', () => {
		const resolving = context({ resolution: { status: 'loading', items: [], error: null } });
		expect(imageResourceRow(DETAIL_IMAGE, 2, resolving)).toEqual({
			index: 2,
			resource: KIM_RESOURCE,
			name: 'kim_v_1',
			weight: 0.6,
			weightPublished: true,
			status: 'resolving',
			reason: null,
			libraryEntryId: null,
			installKey: null,
			model: null,
			version: null,
			pageUrl: null,
		});
		// 'resolving' comes first, even for a library match by name.
		const library = pickedFiles(['D:/models/loras/kim_v_1.safetensors']);
		expect(imageResourceRow(DETAIL_IMAGE, 2, { ...resolving, library }).status).toBe('resolving');
	});

	it('remote: resolved, nothing local', () => {
		expect(row(1)).toEqual({
			index: 1,
			resource: ADD_DETAIL_RESOURCE,
			name: 'Detail Tweaker LoRA - v1.0',
			weight: 1,
			weightPublished: true,
			status: 'remote',
			reason: null,
			libraryEntryId: null,
			installKey: ADD_DETAIL_KEY,
			model: DETAIL_TWEAKER,
			version: DETAIL_TWEAKER_VERSION,
			pageUrl: 'https://civitai.com/models/58390?modelVersionId=62833',
		});
		// The model page when the version has none.
		const noPage = { ...KIM_LORA, versions: [{ ...KIM_VERSION, page_url: null }] };
		expect(row(2, { resolution: resolvedAs(2, noPage) }).pageUrl).toBe(KIM_LORA.page_url);
	});

	it('checkpoints have no weight', () => {
		expect(row(0)).toMatchObject({ name: 'ChilloutMix - NiPrunedFp32Fix', weight: null, weightPublished: false, status: 'remote', installKey: CHILLOUT_KEY });
	});

	it('unresolved: with the resolution error, the request error, or none when never resolved', () => {
		expect(row(3)).toMatchObject({
			name: 'realistic filter [IL]',
			weight: LORA_WEIGHT_DEFAULTS.weight,
			weightPublished: false,
			status: 'unresolved',
			reason: 'No version id or hash published.',
			installKey: null,
			model: null,
			pageUrl: null,
		});
		const failed: ImageResolution = { status: 'failed', items: [], error: 'Civitai is not reachable' };
		expect(row(1, { resolution: failed })).toMatchObject({ name: 'add_detail', status: 'unresolved', reason: 'Civitai is not reachable' });
		expect(row(1, { resolution: undefined })).toMatchObject({ status: 'unresolved', reason: null });
	});

	it('names resources that publish no name after their kind', () => {
		const image = remoteImage({
			resources: [imageResource({ name: null }), imageResource({ kind: 'checkpoint', name: null }), imageResource({ kind: 'embedding', name: '' })],
		});
		const names = image.resources.map((_, index) => imageResourceRow(image, index, context({ resolution: undefined })).name);
		expect(names).toEqual(['Unknown LoRA', 'Unknown checkpoint', 'Unknown embedding']);
	});

	it('in_library by SHA-256, even when the provider could not resolve it', () => {
		const source = modelSource({ version_id: 'another-version', sha256: DETAIL_TWEAKER_FILE.sha256 });
		const library = installedLoras({ kind: 'lora', name: 'Detail', path: 'D:/models/loras/detail.safetensors', source });
		expect(row(1, { library })).toMatchObject({ status: 'in_library', libraryEntryId: 'detail', installKey: ADD_DETAIL_KEY, reason: null });

		const unresolved = resolvedResource(ADD_DETAIL_RESOURCE, null, { sha256: DETAIL_TWEAKER_FILE.sha256, error: 'Unknown at the provider.' });
		const resolution = ready(DETAIL_IMAGE_RESOLUTION.map((item, index) => (index === 1 ? unresolved : item)));
		expect(row(1, { library, resolution })).toMatchObject({ status: 'in_library', libraryEntryId: 'detail', name: 'add_detail', reason: null });
	});

	it('in_library by provenance (resolved version, else the published version id)', () => {
		const installed = installedModel(KIM_LORA, KIM_VERSION, 'D:/models/loras/renamed.safetensors');
		const library = installedLoras({ ...installed, source: { ...installed.source, sha256: null } });
		expect(row(2, { library })).toMatchObject({ status: 'in_library', libraryEntryId: 'renamed' });

		const image = remoteImage({ resources: [imageResource({ name: 'kim', hash: null, version_id: KIM_VERSION.id })] });
		const failed: ImageResolution = { status: 'failed', items: [], error: 'timeout' };
		expect(imageResourceRow(image, 0, context({ library, resolution: failed }))).toMatchObject({ status: 'in_library', libraryEntryId: 'renamed', reason: null });
	});

	it('in_library by file name of the same kind (case-insensitive, without extension)', () => {
		const library = pickedFiles(
			['D:/models/loras/Realistic Filter [IL].safetensors'],
			['D:\\models\\checkpoints\\ChilloutMix_NiPrunedFp32Fix.safetensors', 'D:\\models\\checkpoints\\kim_v_1.safetensors'],
		);
		expect(row(0, { library })).toMatchObject({ status: 'in_library', libraryEntryId: 'chilloutmix-niprunedfp32fix-safetensors' });
		expect(row(3, { library })).toMatchObject({ status: 'in_library', libraryEntryId: 'realistic-filter-il', reason: null });
		// A checkpoint file never stands for a LoRA.
		expect(row(2, { library })).toMatchObject({ status: 'remote', libraryEntryId: null });
		expect(resourceLibraryEntryId(library, 'civitai', imageResource({ kind: 'embedding', name: 'kim_v_1' }), null)).toBeNull();
	});

	it('a library match wins over the version status (unavailable, installing)', () => {
		const unavailable = { ...KIM_LORA, versions: [{ ...KIM_VERSION, unavailable_reason: 'Unsupported base model: Flux.1 D' }] };
		const library = pickedFiles(['D:/models/loras/kim_v_1.safetensors']);
		const installs = { [KIM_KEY]: { phase: 'downloading' as const, error: null } };
		expect(row(2, { library, installs, resolution: resolvedAs(2, unavailable) })).toMatchObject({ status: 'in_library', reason: null });
	});

	it('then the version status: unavailable, installing, failed, on_disk', () => {
		const unavailable = { ...KIM_LORA, versions: [{ ...KIM_VERSION, unavailable_reason: 'Unsupported base model: Flux.1 D' }] };
		expect(row(2, { resolution: resolvedAs(2, unavailable) })).toMatchObject({ status: 'unavailable', reason: 'Unsupported base model: Flux.1 D' });

		expect(row(2, { installs: { [KIM_KEY]: { phase: 'checking', error: null } } })).toMatchObject({ status: 'installing', reason: null, installKey: KIM_KEY });
		expect(row(2, { installs: { [KIM_KEY]: { phase: 'failed', error: 'Disk full' } } })).toMatchObject({ status: 'failed', reason: 'Disk full' });
		// Another version's install does not count.
		expect(row(2, { installs: { [ADD_DETAIL_KEY]: { phase: 'downloading', error: null } } }).status).toBe('remote');

		const onDisk = { ...KIM_LORA, versions: [{ ...KIM_VERSION, files: [{ ...KIM_VERSION.files[0], local_path: 'D:/models/loras/kim_v_1.safetensors' }] }] };
		expect(row(2, { resolution: resolvedAs(2, onDisk) })).toMatchObject({ status: 'on_disk', reason: null });
	});

	it('builds the LoRA rows in order and the checkpoint row', () => {
		expect(imageLoraRows(DETAIL_IMAGE, context()).map((item) => [item.index, item.name, item.weight])).toEqual([
			[1, 'Detail Tweaker LoRA - v1.0', 1],
			[2, 'Kim LoRA - v1', 0.6],
			[3, 'realistic filter [IL]', 1],
		]);
		expect(imageCheckpointRow(DETAIL_IMAGE, context())).toEqual(row(0));

		const loraOnly = remoteImage({ resources: [ADD_DETAIL_RESOURCE, CHILLOUT_RESOURCE, { ...CHILLOUT_RESOURCE, name: 'second' }] });
		expect(imageCheckpointRow(loraOnly, context({ resolution: undefined }))?.index).toBe(1);
		expect(imageCheckpointRow(remoteImage({ resources: [ADD_DETAIL_RESOURCE] }), context())).toBeNull();
		expect(imageLoraRows(remoteImage({ resources: [] }), context())).toEqual([]);
	});

	it('tells which rows the catalog store can install', () => {
		const statusRow = (status: ImageResourceRow['status']): ImageResourceRow => ({ ...row(1), status });
		expect(isInstallableRow(statusRow('remote'))).toBe(true);
		expect(isInstallableRow(statusRow('on_disk'))).toBe(true);
		expect(isInstallableRow(statusRow('installing'))).toBe(true);
		expect(isInstallableRow(statusRow('failed'))).toBe(true);
		expect(isInstallableRow(statusRow('unavailable'))).toBe(false);
		expect(isInstallableRow(statusRow('in_library'))).toBe(false);
		expect(isInstallableRow(statusRow('resolving'))).toBe(false);
		expect(isInstallableRow(row(3))).toBe(false);
		expect(isInstallableRow({ ...row(3), status: 'remote' })).toBe(false);
	});
});

describe('notification texts', () => {
	it('lists skipped resources with their reasons', () => {
		expect(skippedResourcesText([{ name: 'realistic filter [IL]', problem: 'No version id or hash published.' }])).toBe(
			'realistic filter [IL]: No version id or hash published.',
		);
		expect(skippedResourcesText([{ name: 'a', problem: 'Disk full' }, { name: 'b', problem: ' Unsupported base model. ' }])).toBe('a: Disk full; b: Unsupported base model.');
	});
});
