"""The committed backend/openapi.json must match the live schema.

It feeds frontend/src/api/schema.gen.ts (checked by frontend/src/api/apiTypes.test.ts).
Fix a failure by running, from frontend/:  npm run gen:api
"""

import json

from app.openapi_export import SNAPSHOT_FILE, build_openapi


def test_openapi_snapshot_is_up_to_date() -> None:
    committed = json.loads(SNAPSHOT_FILE.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(build_openapi())), (
        "backend/openapi.json is stale: run `npm run gen:api` in frontend/"
    )
