// @vitest-environment node
// Fails when src/api/schema.gen.ts or src/api/defaults.gen.ts no longer matches backend/openapi.json.
// (backend/tests/test_openapi_snapshot.py checks openapi.json against the live FastAPI app.)
// Fix: run `npm run gen:api` in frontend/.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
	defaultsConstantName,
	EXPORT_DEFAULTS_FLAG,
	generateApiDefaults,
	generateDefaultsFromSnapshot,
	generateFromSnapshot,
	GENERATED_DEFAULTS_PATH,
	GENERATED_TYPES_PATH,
	normalizeNewlines,
} from '../../scripts/apiTypes.mjs';

describe('generated API types', () => {
	it('are up to date with backend/openapi.json', async () => {
		const committed = normalizeNewlines(await readFile(GENERATED_TYPES_PATH, 'utf8'));
		expect(committed === (await generateFromSnapshot()), 'src/api/schema.gen.ts is stale: run `npm run gen:api`').toBe(true);
	});
});

describe('generated API defaults', () => {
	it('are up to date with backend/openapi.json', async () => {
		const committed = normalizeNewlines(await readFile(GENERATED_DEFAULTS_PATH, 'utf8'));
		expect(committed === (await generateDefaultsFromSnapshot()), 'src/api/defaults.gen.ts is stale: run `npm run gen:api`').toBe(true);
	});

	it('names the constants after the schema', () => {
		expect(defaultsConstantName('GenerationDefaults')).toBe('GENERATION_DEFAULTS');
		expect(defaultsConstantName('ModelSearchQuery')).toBe('MODEL_SEARCH_QUERY_DEFAULTS');
	});

	it('exports only flagged schemas and refuses fields without a default', () => {
		const document = (properties: Record<string, unknown>, flagged = true) =>
			JSON.stringify({ components: { schemas: { Flagged: { properties, ...(flagged ? { [EXPORT_DEFAULTS_FLAG]: true } : {}) }, Other: { properties } } } });

		const generated = generateApiDefaults(document({ b: { default: [] }, a: { default: 1 } }));
		expect(generated).toContain("export const FLAGGED_DEFAULTS: Readonly<components['schemas']['Flagged']> = Object.freeze({\n\t\"a\": 1,\n\t\"b\": []\n});");
		expect(generated).not.toContain('OTHER_DEFAULTS');
		expect(() => generateApiDefaults(document({ a: { type: 'integer' } }))).toThrow(/without a default: a/);
	});
});
