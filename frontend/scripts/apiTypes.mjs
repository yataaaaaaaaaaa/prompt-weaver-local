// Single generator of the frontend files derived from the backend OpenAPI snapshot:
// - src/api/schema.gen.ts: TypeScript types of every schema (openapi-typescript);
// - src/api/defaults.gen.ts: the field defaults of the schemas flagged "x-export-defaults"
//   (backend @export_defaults models, e.g. GenerationDefaults -> GENERATION_DEFAULTS).
// Used by scripts/generate-api-types.mjs (npm run gen:api) and by src/api/apiTypes.test.ts
// (which fails when a committed generated file is stale).
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
export const OPENAPI_SNAPSHOT_PATH = resolve(SCRIPTS_DIR, '../../backend/openapi.json');
export const GENERATED_TYPES_PATH = resolve(SCRIPTS_DIR, '../src/api/schema.gen.ts');
export const GENERATED_DEFAULTS_PATH = resolve(SCRIPTS_DIR, '../src/api/defaults.gen.ts');

/** OpenAPI extension set by the backend (app/schemas.py EXPORT_DEFAULTS_FLAG). */
export const EXPORT_DEFAULTS_FLAG = 'x-export-defaults';

/** Normalizes line endings so the comparison is immune to git autocrlf. */
export function normalizeNewlines(text) {
	return text.replace(/\r\n/g, '\n');
}

/** @param {string} openapiJsonText */
export async function generateApiTypes(openapiJsonText) {
	const ast = await openapiTS(JSON.parse(openapiJsonText));
	return normalizeNewlines(COMMENT_HEADER + astToString(ast));
}

/** 'GenerationDefaults' -> 'GENERATION_DEFAULTS', 'ModelSearchQuery' -> 'MODEL_SEARCH_QUERY_DEFAULTS'. */
export function defaultsConstantName(schemaName) {
	const base = schemaName.replace(/Defaults$/, '');
	return `${base.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()}_DEFAULTS`;
}

/** @param {string} openapiJsonText */
export function generateApiDefaults(openapiJsonText) {
	const schemas = JSON.parse(openapiJsonText).components?.schemas ?? {};
	const exported = Object.keys(schemas)
		.filter((name) => schemas[name][EXPORT_DEFAULTS_FLAG] === true)
		.sort();
	const lines = [
		'// This file is auto-generated from backend/openapi.json by `npm run gen:api` (scripts/apiTypes.mjs).',
		'// Do not make direct changes to the file: the defaults are defined once, in backend/app/schemas.py.',
		"import type { components } from './schema.gen';",
	];
	for (const name of exported) {
		const properties = schemas[name].properties ?? {};
		const fields = Object.keys(properties).sort();
		const missing = fields.filter((field) => !('default' in properties[field]));
		if (missing.length) {
			throw new Error(`Schema ${name} is flagged ${EXPORT_DEFAULTS_FLAG} but has fields without a default: ${missing.join(', ')}`);
		}
		const values = Object.fromEntries(fields.map((field) => [field, properties[field].default]));
		const body = JSON.stringify(values, null, '\t');
		lines.push('', `/** Defaults of the backend schema ${name}. */`);
		lines.push(`export const ${defaultsConstantName(name)}: Readonly<components['schemas']['${name}']> = Object.freeze(${body});`);
	}
	return normalizeNewlines(`${lines.join('\n')}\n`);
}

export async function generateFromSnapshot() {
	return generateApiTypes(await readFile(OPENAPI_SNAPSHOT_PATH, 'utf8'));
}

export async function generateDefaultsFromSnapshot() {
	return generateApiDefaults(await readFile(OPENAPI_SNAPSHOT_PATH, 'utf8'));
}
