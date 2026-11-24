from __future__ import annotations

import argparse
from typing import Sequence

import uvicorn

from app.settings import load_shared_config


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    shared = load_shared_config()
    parser = argparse.ArgumentParser(description="Run the Prompt Weaver Local backend.")
    parser.add_argument("--host", default=shared.host)
    parser.add_argument("--port", type=int, default=shared.backendPort)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    uvicorn.run(
        "app.main:app",
        host=args.host,
        port=args.port,
        reload=False,
        http="h11",
        ws="websockets",
        timeout_graceful_shutdown=1,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
