// Characters and IP-Adapter test data, shared by the domain, store and view tests (imported by tests only): builders
// with neutral defaults (override what a test is about), with the shapes the backend sends (Character,
// CharacterImage, CharacterCollection, IpAdapterStatus with the real catalog names and sizes of
// backend/app/services/ip_adapters.py, OutputCharacter).
import { REFERENCE_DEFAULTS } from '../api/defaults.gen';
import type {
	Character,
	CharacterCollection,
	CharacterImage,
	IpAdapterFile,
	IpAdapterStatus,
	IpAdapterVariant,
	OutputCharacter,
	ReferenceSupport,
} from '../api/types';

export const ALICE_ID = 'chr-a11ce0000001';
export const BOB_ID = 'chr-b0b000000002';
export const REFERENCE_IMAGE_ID = 'img-0000000000a1';
export const THUMBNAIL_IMAGE_ID = 'img-0000000000f1';

export function characterImage(overrides: Partial<CharacterImage> = {}): CharacterImage {
	return {
		id: REFERENCE_IMAGE_ID,
		width: 832,
		height: 1216,
		source: { kind: 'output', output_id: '0000000042' },
		added_at: '2026-11-20T10:00:00Z',
		...overrides,
	};
}

export function character(overrides: Partial<Character> = {}): Character {
	return {
		id: ALICE_ID,
		name: 'Alice',
		identity_tags: ['1girl', 'silver hair', 'blue eyes'],
		outfit_tags: ['school uniform'],
		negative_tags: ['short hair'],
		loras: [],
		seed: 1234,
		seed_locked: false,
		reference_strength: REFERENCE_DEFAULTS.strength,
		reference_focus: REFERENCE_DEFAULTS.focus,
		reference_images: [characterImage()],
		thumbnail: characterImage({ id: THUMBNAIL_IMAGE_ID, width: 263, height: 384, source: { kind: 'character_image', image_id: REFERENCE_IMAGE_ID } }),
		created_at: '2026-11-20T10:00:00Z',
		updated_at: '2026-11-20T10:00:00Z',
		...overrides,
	};
}

export const BOB: Character = character({
	id: BOB_ID,
	name: 'Bob',
	identity_tags: ['1boy', 'black hair'],
	outfit_tags: [],
	negative_tags: [],
	seed: null,
	reference_images: [],
	thumbnail: null,
});

export function characterCollection(items: Character[] = [character(), BOB], activeId: string | null = null): CharacterCollection {
	return { items, active_id: activeId };
}

export function outputCharacter(overrides: Partial<OutputCharacter> = {}): OutputCharacter {
	return {
		id: ALICE_ID,
		name: 'Alice',
		reference: { applied: true, variant_id: 'sdxl-face', strength: REFERENCE_DEFAULTS.strength, image_ids: [REFERENCE_IMAGE_ID], reason: null },
		...overrides,
	};
}

// IP-Adapter files and variants (names and sizes of the backend catalog, services/ip_adapters.py).
export const IMAGE_ENCODER_FILE: IpAdapterFile = {
	id: 'image-encoder-vit-h',
	role: 'image_encoder',
	name: 'CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors',
	size_bytes: 2528373448,
	local_path: null,
	task_id: null,
};

export function ipAdapterFile(overrides: Partial<IpAdapterFile> = {}): IpAdapterFile {
	return {
		id: 'ip-adapter-plus-face-sdxl-vit-h',
		role: 'adapter',
		name: 'ip-adapter-plus-face_sdxl_vit-h.safetensors',
		size_bytes: 847517512,
		local_path: null,
		task_id: null,
		...overrides,
	};
}

export function ipAdapterVariant(overrides: Partial<IpAdapterVariant> = {}): IpAdapterVariant {
	return {
		id: 'sdxl-face',
		label: 'SDXL face (IP-Adapter Plus Face ViT-H)',
		architecture: 'sdxl',
		focus: 'face',
		files: [ipAdapterFile(), IMAGE_ENCODER_FILE],
		ready: false,
		...overrides,
	};
}

/** The SDXL face variant with both files on disk. */
export const READY_SDXL_FACE: IpAdapterVariant = ipAdapterVariant({
	ready: true,
	files: [
		ipAdapterFile({ local_path: 'D:/models/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors' }),
		{ ...IMAGE_ENCODER_FILE, local_path: 'D:/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors' },
	],
});

export function referenceSupport(overrides: Partial<ReferenceSupport> = {}): ReferenceSupport {
	return { focus: 'face', variant_id: 'sdxl-face', ready: false, reason: 'Download the IP-Adapter to use reference images.', ...overrides };
}

export function ipAdapterStatus(overrides: Partial<IpAdapterStatus> = {}): IpAdapterStatus {
	return {
		variants: [ipAdapterVariant()],
		folders: { adapter: 'D:/models/ipadapter', image_encoder: 'D:/models/clip_vision' },
		architecture: 'sdxl',
		support: [referenceSupport(), referenceSupport({ focus: 'general', variant_id: 'sdxl-general' })],
		...overrides,
	};
}
