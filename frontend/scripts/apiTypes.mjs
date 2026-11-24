// Single generator of frontend/src/api/schema.gen.ts from the backend OpenAPI snapshot.
// Used by scripts/generate-api-types.mjs (npm run gen:api) and by src/api/apiTypes.test.ts
// (which fails when the committed generated file is stale).
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString, COMMENT_HEADER } from 'openapi-typescript';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
export const OPENAPI_SNAPSHOT_PATH = resolve(SCRIPTS_DIR, '../../backend/openapi.json');
export const GENERATED_TYPES_PATH = resolve(SCRIPTS_DIR, '../src/api/schema.gen.ts');

/** Normalizes line endings so the comparison is immune to git autocrlf. */
export function normalizeNewlines(text) {
	return text.replace(/\r\n/g, '\n');
}

/** @param {string} openapiJsonText */
export async function generateApiTypes(openapiJsonText) {
	const ast = await openapiTS(JSON.parse(openapiJsonText));
	return normalizeNewlines(COMMENT_HEADER + astToString(ast));
}

export async function generateFromSnapshot() {
	return generateApiTypes(await readFile(OPENAPI_SNAPSHOT_PATH, 'utf8'));
}
