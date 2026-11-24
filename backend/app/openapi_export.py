"""Dump the OpenAPI document without starting a server.

    uv run python -m app.openapi_export            # prints to stdout
    uv run python -m app.openapi_export out.json   # writes a file

frontend `npm run gen:api` writes backend/openapi.json with this module and regenerates
frontend/src/api/schema.gen.ts from it. tests/test_openapi_snapshot.py keeps the snapshot fresh.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from .factory import create_app
from .settings import AppPaths

SNAPSHOT_FILE = Path(__file__).resolve().parents[1] / "openapi.json"


def build_openapi() -> dict[str, Any]:
    # The path is never touched: the lifespan does not run and services do no IO on construction.
    app = create_app(paths=AppPaths.for_root(Path("unused-openapi-export")), install_signal_handlers=False)
    return app.openapi()


def render_openapi() -> str:
    return json.dumps(build_openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    text = render_openapi()
    if len(argv) > 1:
        Path(argv[1]).write_text(text, encoding="utf-8", newline="\n")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
