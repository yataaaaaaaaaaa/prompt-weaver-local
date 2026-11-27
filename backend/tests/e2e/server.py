"""The e2e backend: the real app (app.factory.create_app) on synthetic data, without GPU or network.

    cd backend && uv run python tests/e2e/server.py --port 18100

Never imported by production code. Every reset (POST /__e2e__/reset, body options.E2EResetRequest) replaces the
running app with a new one on a fresh data dir and model folders under the session root (a temp dir, deleted at
exit): seeded from the committed synthetic fixtures (seed.py), a paced fake generator (support.FakeGenerator: a
deterministic picture, one progress event per step, cancellable), a synthetic Civitai / Hugging Face on
support.FakeHttp (fake_civitai.py) and, as the user's Codex, the fake app-server of tests/fake_codex.py (options.codex;
POST /__e2e__/codex changes its scenario during a test). The previous app is shut down like at exit (its WebSockets
close, its Codex process stops). Every other request goes to the current app. GET /__e2e__/state reports the dirs and
the requests the synthetic network could not answer. GET /__e2e__/remote?url=... answers a URL through the same synthetic network: the Playwright suite routes
every request the browser makes to a non-local host there (frontend/e2e/support/network.ts), so the browser and the
backend see the same synthetic internet.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import shutil
import sys
import tempfile
from collections.abc import Sequence
from contextlib import AsyncExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[2]
TESTS_DIR = BACKEND_DIR / "tests"
# Run as a script: the app package (backend/) and the test support module (backend/tests/support.py) must import
# the same way pytest imports them (pytest.ini pythonpath = . and the rootdir-based tests/ path).
for _path in (str(BACKEND_DIR), str(TESTS_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import uvicorn  # noqa: E402
from fastapi import FastAPI, HTTPException, Response  # noqa: E402
from pydantic import ValidationError  # noqa: E402
from starlette.types import Receive, Scope, Send  # noqa: E402

from app.factory import create_app  # noqa: E402
from app.services.generation import GenerationFailed  # noqa: E402
from app.services.ip_adapters import IP_ADAPTER_CATALOG  # noqa: E402
from app.settings import AppPaths  # noqa: E402
from e2e.fake_civitai import SyntheticCivitai, load_catalog  # noqa: E402
from e2e.images import picture  # noqa: E402
from codex_support import FAKE_CODEX_SCRIPT, FakeCodex  # noqa: E402
from e2e.options import CodexOptions, E2EResetRequest, E2EState  # noqa: E402
from e2e.seed import seed  # noqa: E402
from support import CountingFactory, FakeGenerator, FakeHttp  # noqa: E402

logger = logging.getLogger("prompt_weaver_e2e")

CONTROL_PREFIX = "/__e2e__"


def generated_picture(request: Any, seed_value: int) -> Any:
    """What the fake generator 'paints': deterministic for (seed, prompt)."""
    return picture(f"generated:{seed_value}:{request.prompt}", request.width, request.height, label=f"seed {seed_value}")


@dataclass
class _Running:
    app: FastAPI
    stack: AsyncExitStack
    http: FakeHttp
    civitai: SyntheticCivitai
    generator: FakeGenerator
    paths: AppPaths
    codex: FakeCodex


def build_app(paths: AppPaths, request: E2EResetRequest, codex_home: Path) -> _Running:
    """The real app over `paths` with the e2e fakes (no IO until its lifespan starts)."""
    generator = FakeGenerator(
        reported_steps=None,
        step_delay_s=request.generator.step_delay_ms / 1000,
        image_factory=generated_picture,
        error=GenerationFailed(request.generator.fail_message) if request.generator.fail_message else None,
    )
    http = FakeHttp()
    civitai = SyntheticCivitai(load_catalog(), request.network)
    civitai.install(http)
    civitai.install_hugging_face(http, [file.url for variant in IP_ADAPTER_CATALOG.variants for file in variant.files])
    codex = FakeCodex(codex_home, request.codex.scenario(), installed=request.codex.installed)
    app = create_app(
        paths=paths,
        generator_factory=CountingFactory(generator),
        http_client_factory=http.client_factory,
        codex_runtime=codex.runtime(),
        install_signal_handlers=False,
    )
    downloads = app.state.services.downloads
    cancel = downloads.cancel

    def cancel_and_release(task_id: str) -> bool:
        # The download manager notices a cancel between chunks only: release the synthetic stalled streams.
        cancelled = cancel(task_id)
        civitai.release_stalls()
        return cancelled

    downloads.cancel = cancel_and_release
    return _Running(app=app, stack=AsyncExitStack(), http=http, civitai=civitai, generator=generator, paths=paths, codex=codex)


class E2EBackend:
    """ASGI app: /__e2e__/* control routes, everything else to the current app (replaced on every reset)."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.resets = 0
        self._running: _Running | None = None
        self._lock = asyncio.Lock()
        self._control = self._control_app()

    def _control_app(self) -> FastAPI:
        control = FastAPI(title="Prompt Weaver Local e2e control", openapi_url=None, docs_url=None, redoc_url=None)

        @control.post(f"{CONTROL_PREFIX}/reset", response_model=E2EState)
        async def reset(request: E2EResetRequest | None = None) -> E2EState:
            await self.reset(request or E2EResetRequest())
            return self.state()

        @control.get(f"{CONTROL_PREFIX}/state", response_model=E2EState)
        async def state() -> E2EState:
            return self.state()

        @control.post(f"{CONTROL_PREFIX}/codex", response_model=E2EState)
        async def codex(changes: dict[str, Any]) -> E2EState:
            # Validated as CodexOptions fields (e.g. {"account": "chatgpt"}: the user signed in meanwhile).
            try:
                CodexOptions.model_validate(changes)
            except ValidationError as exc:
                raise HTTPException(status_code=422, detail=exc.errors(include_url=False)) from exc
            self._require().codex.update_scenario(**{key: value for key, value in changes.items() if key != "installed"})
            return self.state()

        @control.get(f"{CONTROL_PREFIX}/remote")
        def remote(url: str) -> Response:
            # Sync route (threadpool): paced synthetic answers must not block the event loop.
            with self._require().http.client_factory() as client:
                upstream = client.get(url)
            return Response(
                content=upstream.content,
                status_code=upstream.status_code,
                media_type=upstream.headers.get("content-type"),
            )

        return control

    def state(self) -> E2EState:
        running = self._require()
        return E2EState(
            data_dir=str(running.paths.root),
            models_root=str(running.paths.models_root),
            resets=self.resets,
            unexpected_requests=list(running.http.unexpected),
            generations=len(running.generator.calls),
            codex_path=str(FAKE_CODEX_SCRIPT),
            codex_starts=len(running.codex.starts()),
        )

    def _require(self) -> _Running:
        if self._running is None:
            raise RuntimeError("The e2e backend is not started")
        return self._running

    async def reset(self, request: E2EResetRequest) -> None:
        async with self._lock:
            self.resets += 1
            data_dir = self.root / f"data-{self.resets}"
            models_root = self.root / f"models-{self.resets}"
            await asyncio.to_thread(seed, data_dir, models_root, request)
            running = build_app(AppPaths.for_root(data_dir, models_root=models_root), request, self.root / f"codex-{self.resets}")
            await running.stack.enter_async_context(running.app.router.lifespan_context(running.app))
            previous, self._running = self._running, running
            if previous is not None:
                await self._stop(previous)

    async def _stop(self, running: _Running) -> None:
        running.civitai.close()
        try:
            await running.stack.aclose()
        except Exception:
            logger.exception("Stopping a previous e2e app failed")
        await asyncio.to_thread(shutil.rmtree, running.paths.root, True)
        await asyncio.to_thread(shutil.rmtree, running.paths.models_root, True)
        await asyncio.to_thread(shutil.rmtree, running.codex.home, True)

    async def shutdown(self) -> None:
        async with self._lock:
            running, self._running = self._running, None
            if running is not None:
                await self._stop(running)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "lifespan":
            await self._lifespan(receive, send)
            return
        if scope.get("path", "").startswith(f"{CONTROL_PREFIX}/"):
            await self._control(scope, receive, send)
            return
        await self._require().app(scope, receive, send)

    async def _lifespan(self, receive: Receive, send: Send) -> None:
        while True:
            message = await receive()
            if message["type"] == "lifespan.startup":
                try:
                    await self.reset(E2EResetRequest())
                except Exception as exc:
                    logger.exception("Starting the e2e backend failed")
                    await send({"type": "lifespan.startup.failed", "message": str(exc)})
                    return
                await send({"type": "lifespan.startup.complete"})
            elif message["type"] == "lifespan.shutdown":
                await self.shutdown()
                await send({"type": "lifespan.shutdown.complete"})
                return


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Prompt Weaver Local e2e backend (synthetic data).")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--root", type=Path, default=None, help="Session root (default: a new temp dir).")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.WARNING)
    owns_root = args.root is None
    root = (Path(tempfile.mkdtemp(prefix="prompt-weaver-e2e-")) if owns_root else args.root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    print(f"[e2e backend] session root {root}", flush=True)
    try:
        uvicorn.run(
            E2EBackend(root),
            host=args.host,
            port=args.port,
            http="h11",
            ws="websockets",
            log_level="warning",
            # Longer than any test: the test runner's request context reuses its connections, and a connection the
            # server closes after the 5 s default idle time fails the next control call with ECONNRESET.
            timeout_keep_alive=300,
            timeout_graceful_shutdown=1,
        )
    finally:
        if owns_root:
            with contextlib.suppress(OSError):
                shutil.rmtree(root, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
