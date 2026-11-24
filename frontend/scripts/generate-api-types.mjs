// npm run gen:api
// 1. dumps the FastAPI OpenAPI document (no server) into backend/openapi.json
// 2. regenerates src/api/schema.gen.ts (types) and src/api/defaults.gen.ts (exported defaults) from it
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
	generateDefaultsFromSnapshot,
	generateFromSnapshot,
	GENERATED_DEFAULTS_PATH,
	GENERATED_TYPES_PATH,
	OPENAPI_SNAPSHOT_PATH,
} from './apiTypes.mjs';

const backendDir = dirname(OPENAPI_SNAPSHOT_PATH);
const env = { ...process.env };
delete env.VIRTUAL_ENV; // uv must use backend/.venv even when another venv is active

const dump = spawnSync('uv', ['run', 'python', '-m', 'app.openapi_export', OPENAPI_SNAPSHOT_PATH], {
	cwd: backendDir,
	env,
	stdio: 'inherit',
});
if (dump.status !== 0) {
	console.error('OpenAPI export failed.');
	process.exit(dump.status ?? 1);
}

await writeFile(GENERATED_TYPES_PATH, await generateFromSnapshot(), 'utf8');
console.log(`Wrote ${GENERATED_TYPES_PATH}`);
await writeFile(GENERATED_DEFAULTS_PATH, await generateDefaultsFromSnapshot(), 'utf8');
console.log(`Wrote ${GENERATED_DEFAULTS_PATH}`);
