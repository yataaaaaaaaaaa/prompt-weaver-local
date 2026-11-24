// This file is auto-generated from backend/openapi.json by `npm run gen:api` (scripts/apiTypes.mjs).
// Do not make direct changes to the file: the defaults are defined once, in backend/app/schemas.py.
import type { components } from './schema.gen';

/** Defaults of the backend schema GenerationDefaults. */
export const GENERATION_DEFAULTS: Readonly<components['schemas']['GenerationDefaults']> = Object.freeze({
	"guidance_scale": 7,
	"height": 1024,
	"image_seed_behavior": "fixed",
	"negative_prompt": "",
	"prompt_seed": null,
	"prompt_seed_behavior": "fixed",
	"seed": null,
	"steps": 30,
	"torch_dtype": "float16",
	"width": 1024
});

/** Defaults of the backend schema ModelSearchQuery. */
export const MODEL_SEARCH_QUERY_DEFAULTS: Readonly<components['schemas']['ModelSearchQuery']> = Object.freeze({
	"base_models": [],
	"cursor": null,
	"kinds": [],
	"limit": 20,
	"nsfw": false,
	"provider": "civitai",
	"query": "",
	"sort": "most_downloaded"
});
