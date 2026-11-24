"""Application factory. Tests call create_app(paths=AppPaths.for_root(tmp_path, models_root=...),
generator_factory=Fake..., http_client_factory=FakeHttp..., install_signal_handlers=False) and use
`with TestClient(app) as client:` so the lifespan runs."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import ROUTERS
from .schemas import EXPORT_DEFAULTS_FLAG, EXPORTED_DEFAULTS_SCHEMAS
from .services.container import build_services
from .services.generation import GeneratorFactory, GeneratorPort
from .services.http import HttpClientFactory, default_http_client
from .services.signals import install_cancel_signal_handlers
from .settings import AppPaths, resolve_data_root

logger = logging.getLogger(__name__)

def _default_generator_factory() -> GeneratorPort:
    # Lazy: importing the runtime loads torch (~25 s), so it only happens on the first generation.
    from .services.runtime_adapter import create_runtime_generator

    return create_runtime_generator()


def _install_exported_schemas(app: FastAPI) -> None:
    """Adds the @export_defaults schemas (app/schemas.py) to the OpenAPI components, flagged, so that
    `npm run gen:api` exports their defaults to frontend/src/api/defaults.gen.ts."""
    build_openapi = app.openapi

    def openapi() -> dict[str, Any]:
        if app.openapi_schema is None:
            schema = build_openapi()
            components = schema.setdefault("components", {}).setdefault("schemas", {})
            for model in EXPORTED_DEFAULTS_SCHEMAS:
                model_schema = model.model_json_schema(mode="serialization", ref_template="#/components/schemas/{model}")
                if "$defs" in model_schema:
                    raise ValueError(f"@export_defaults model {model.__name__} must not nest other models.")
                components[model.__name__] = {**model_schema, EXPORT_DEFAULTS_FLAG: True}
            app.openapi_schema = schema
        return app.openapi_schema

    app.openapi = openapi  # type: ignore[method-assign]


def create_app(
    *,
    paths: AppPaths | None = None,
    generator_factory: GeneratorFactory | None = None,
    http_client_factory: HttpClientFactory | None = None,
    install_signal_handlers: bool = True,
) -> FastAPI:
    """Build the FastAPI app. Performs no filesystem or network IO until the lifespan starts."""
    services = build_services(
        paths or AppPaths.for_root(resolve_data_root()),
        generator_factory or _default_generator_factory,
        http_client_factory or default_http_client,
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
                await asyncio.to_thread(services.downloads.shutdown)
            except Exception:
                logger.exception("Shutting down the download manager failed")
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
    _install_exported_schemas(app)
    return app
