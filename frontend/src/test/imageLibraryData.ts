// Image library test data, shared by the domain, store and view tests (imported by tests only): builders with
// neutral defaults (override what a test is about) and an image modelled on the real Civitai answers of
// backend/tests/fixtures/civitai/images_by_model.json, with the shapes the backend sends (RemoteImage,
// ImageResource, ResolvedImageResource, FavoriteImage).
import type { FavoriteImage, ImageGenerationParams, ImageResource, RemoteImage, RemoteModel, ResolvedImageResource } from '../api/types';
import { installFile } from '../domain/modelCatalog';
import { DETAIL_TWEAKER, DETAIL_TWEAKER_FILE, remoteFile, remoteModel, remoteVersion } from './modelLibraryData';

export function imageParams(overrides: Partial<ImageGenerationParams> = {}): ImageGenerationParams {
	return {
		prompt: 'castle, sky, <lora:add_detail:0.6>',
		clean_prompt: 'castle, sky',
		negative_prompt: 'lowres',
		sampler: 'Euler a',
		steps: 30,
		cfg_scale: 7,
		seed: 1234,
		width: 512,
		height: 768,
		clip_skip: 2,
		...overrides,
	};
}

export function imageResource(overrides: Partial<ImageResource> = {}): ImageResource {
	return { kind: 'lora', name: 'add_detail', weight: 0.6, version_id: null, hash: '7c6bad76eb54', ...overrides };
}

export function remoteImage(overrides: Partial<RemoteImage> = {}): RemoteImage {
	return {
		provider: 'civitai',
		id: '1001',
		url: 'https://image.example/1001/original=true/1001.jpeg',
		thumbnail_url: 'https://image.example/1001/width=450/1001.jpeg',
		width: 512,
		height: 768,
		nsfw: false,
		base_model: 'SD 1.5',
		architecture: 'sd15',
		username: 'alice',
		created_at: '2026-11-01T10:00:00Z',
		reaction_count: 12,
		page_url: 'https://civitai.com/images/1001',
		params: imageParams(),
		resources: [imageResource()],
		...overrides,
	};
}

/** The resolution of `resource` to `model` (versions == [the resolved version]); null model = unresolved. */
export function resolvedResource(
	resource: ImageResource,
	model: RemoteModel | null,
	overrides: Partial<ResolvedImageResource> = {},
): ResolvedImageResource {
	const version = model?.versions[0] ?? null;
	const file = version ? installFile(version) : null;
	return {
		resource,
		model,
		sha256: file?.sha256 ?? null,
		error: model ? null : 'No version id or hash published.',
		...overrides,
	};
}

export function favoriteImage(image: RemoteImage, savedAt = '2026-11-02T10:00:00Z'): FavoriteImage {
	return { image, saved_at: savedAt };
}

// ---------------------------------------------------------------------------
// An image modelled on images_by_model.json (Detail Tweaker LoRA gallery, an A1111 upload)
// ---------------------------------------------------------------------------

/** 'add_detail' at weight 1 (AutoV3 hash): resolves to DETAIL_TWEAKER (modelLibraryData). */
export const ADD_DETAIL_RESOURCE = imageResource({ name: 'add_detail', weight: 1, hash: '7c6bad76eb54' });
/** 'kim_v_1' at weight 0.6 (AutoV3 hash): resolves to KIM_LORA, not in any library. */
export const KIM_RESOURCE = imageResource({ name: 'kim_v_1', weight: 0.6, hash: '1921d0925550' });
/** A LoRA published by name only (inline tag, no hash, no weight): cannot be resolved remotely. */
export const NAME_ONLY_RESOURCE = imageResource({ name: 'realistic filter [IL]', weight: null, hash: null });
/** The checkpoint (AutoV2 hash of 'Model hash'). */
export const CHILLOUT_RESOURCE = imageResource({ kind: 'checkpoint', name: 'chilloutmix_NiPrunedFp32Fix', weight: null, hash: 'fc2511737a' });

export const KIM_LORA = remoteModel({
	id: '7001',
	name: 'Kim LoRA',
	kind: 'lora',
	versions: [
		remoteVersion({
			id: '7101',
			name: 'v1',
			base_model: 'SD 1.5',
			architecture: 'sd15',
			files: [remoteFile({ id: '7201', name: 'kim_v_1.safetensors', size_bytes: 151_110_000, sha256: 'b'.repeat(64) })],
			default_file_id: '7201',
			page_url: 'https://civitai.com/models/7001?modelVersionId=7101',
		}),
	],
});

export const CHILLOUT = remoteModel({
	id: '6424',
	name: 'ChilloutMix',
	kind: 'checkpoint',
	versions: [
		remoteVersion({
			id: '11745',
			name: 'NiPrunedFp32Fix',
			base_model: 'SD 1.5',
			architecture: 'sd15',
			files: [
				remoteFile({
					id: '11274',
					name: 'Chilloutmix-Ni-pruned-fp32-fix.safetensors',
					sha256: 'fc2511737a54c5e80b89ab03e0ab4b98d051ab187f92860f3cd664dc9d08b271',
				}),
			],
			default_file_id: '11274',
			page_url: 'https://civitai.com/models/6424?modelVersionId=11745',
		}),
	],
});

export const DETAIL_IMAGE = remoteImage({
	id: '148522541',
	url: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/detail/original=true/detail.jpeg',
	thumbnail_url: 'https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/detail/width=450/detail.jpeg',
	page_url: 'https://civitai.com/images/148522541',
	params: imageParams({
		prompt: 'masterpiece, best quality, portrait, snowing, <lora:add_detail:1>, <lora:kim_v_1:0.6>',
		clean_prompt: 'masterpiece, best quality, portrait, snowing',
	}),
	resources: [CHILLOUT_RESOURCE, ADD_DETAIL_RESOURCE, KIM_RESOURCE, NAME_ONLY_RESOURCE],
});

/** DETAIL_IMAGE.resources resolved, in order. */
export const DETAIL_IMAGE_RESOLUTION: ResolvedImageResource[] = [
	resolvedResource(CHILLOUT_RESOURCE, CHILLOUT),
	resolvedResource(ADD_DETAIL_RESOURCE, DETAIL_TWEAKER, { sha256: DETAIL_TWEAKER_FILE.sha256 }),
	resolvedResource(KIM_RESOURCE, KIM_LORA),
	resolvedResource(NAME_ONLY_RESOURCE, null),
];
