"""Router registry: create_app() includes every router listed in ROUTERS.

To add an API area, create app/routers/<area>.py exposing
`router = APIRouter(prefix="/api/<area>", tags=["<area>"])` and append it here.
"""

from __future__ import annotations

from fastapi import APIRouter

from . import (
    bootstrap,
    characters,
    codex,
    downloads,
    generation,
    health,
    images,
    ip_adapters,
    model_installs,
    models,
    outputs,
    stores,
    stories,
    tasks,
)

ROUTERS: tuple[APIRouter, ...] = (
    health.router,
    bootstrap.router,
    outputs.router,
    generation.router,
    tasks.router,
    stores.router,
    models.router,
    model_installs.router,
    downloads.router,
    images.router,
    characters.router,
    ip_adapters.router,
    stories.router,
    codex.router,
)
