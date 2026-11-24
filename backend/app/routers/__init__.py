"""Router registry: create_app() includes every router listed in ROUTERS.

To add an API area, create app/routers/<area>.py exposing
`router = APIRouter(prefix="/api/<area>", tags=["<area>"])` and append it here.
"""

from __future__ import annotations

from fastapi import APIRouter

from . import bootstrap, downloads, generation, health, model_installs, models, outputs, stores, tasks

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
)
