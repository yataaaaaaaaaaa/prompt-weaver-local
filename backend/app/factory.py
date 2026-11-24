"""Application factory. Tests call create_app(paths=AppPaths.for_root(tmp_path), generator_factory=Fake...,
install_signal_handlers=False) and use `with TestClient(app) as client:` so the lifespan runs."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import ROUTERS
from .services.container import build_services
from .services.generation import GeneratorFactory, GeneratorPort
from .services.signals import install_cancel_signal_handlers
from .settings import AppPaths, resolve_data_root

logger = logging.getLogger(__name__)


def _default_generator_factory() -> GeneratorPort:
    # Lazy: importing the runtime loads torch (~25 s), so it only happens on the first generation.
    from .services.runtime_adapter import create_runtime_generator

    return create_runtime_generator()


def create_app(
    *,
    paths: AppPaths | None = None,
    generator_factory: GeneratorFactory | None = None,
    install_signal_handlers: bool = True,
) -> FastAPI:
    """Build the FastAPI app. Performs no filesystem IO until the lifespan starts."""
    services = build_services(
        paths or AppPaths.for_root(resolve_data_root()),
        generator_factory or _default_generator_factory,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        services.paths.ensure_dirs()
        restore_signals = (
            install_cancel_signal_handlers(services.generation.cancel) if install_signal_handlers else None
        )
        try:
            yield
        finally:
            try:
                # Cancelling + unloading can wait for the running generation: keep the event loop free meanwhile.
                await asyncio.to_thread(services.generation.shutdown)
            except Exception:
                logger.exception("Shutting down the generation service failed")
            try:
                await services.tasks.shutdown()
            finally:
                if restore_signals is not None:
                    restore_signals()

    app = FastAPI(title="Prompt Weaver Local", lifespan=lifespan)
    app.state.services = services
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    for router in ROUTERS:
        app.include_router(router)
    return app
