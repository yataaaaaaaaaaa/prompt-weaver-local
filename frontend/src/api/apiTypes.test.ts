// @vitest-environment node
// Fails when src/api/schema.gen.ts no longer matches backend/openapi.json.
// (backend/tests/test_openapi_snapshot.py checks openapi.json against the live FastAPI app.)
// Fix: run `npm run gen:api` in frontend/.
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateFromSnapshot, GENERATED_TYPES_PATH, normalizeNewlines } from '../../scripts/apiTypes.mjs';

describe('generated API types', () => {
	it('are up to date with backend/openapi.json', async () => {
		const committed = normalizeNewlines(await readFile(GENERATED_TYPES_PATH, 'utf8'));
		expect(committed === (await generateFromSnapshot()), 'src/api/schema.gen.ts is stale: run `npm run gen:api`').toBe(true);
	});
});
