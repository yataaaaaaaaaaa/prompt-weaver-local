// Single owner of backend URLs in the frontend. The origin itself comes from config/appConfig.cjs
// (via the Vite `define` __BACKEND_URL__), which the launcher can override with --host/--backend-port.
import type { paths } from './schema.gen';

export const BACKEND_URL: string = __BACKEND_URL__;

/** WebSocket streaming TaskEvent messages (backend app/routers/tasks.py). */
export const TASKS_WS_URL = `${BACKEND_URL.replace(/^http/, 'ws')}/ws/tasks`;

const OUTPUT_IMAGE_PATH = '/api/outputs/{output_id}/image' satisfies keyof paths;

/** URL of a generated PNG, usable directly as <img src>. */
export function outputImageUrl(outputId: string): string {
	return `${BACKEND_URL}${OUTPUT_IMAGE_PATH.replace('{output_id}', encodeURIComponent(outputId))}`;
}

const OUTPUT_THUMBNAIL_PATH = '/api/outputs/{output_id}/thumbnail' satisfies keyof paths;

/** URL of a generated picture's small WebP copy (filmstrips, lists), usable directly as <img src>. */
export function outputThumbnailUrl(outputId: string): string {
	return `${BACKEND_URL}${OUTPUT_THUMBNAIL_PATH.replace('{output_id}', encodeURIComponent(outputId))}`;
}

const CHARACTER_IMAGE_PATH = '/api/characters/{character_id}/images/{image_id}' satisfies keyof paths;

/** URL of a character image (a reference image or the thumbnail, CharacterImage.id), usable directly as <img src>. */
export function characterImageUrl(characterId: string, imageId: string): string {
	return `${BACKEND_URL}${CHARACTER_IMAGE_PATH.replace('{character_id}', encodeURIComponent(characterId)).replace('{image_id}', encodeURIComponent(imageId))}`;
}
