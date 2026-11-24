"""FastAPI dependency providers (work for HTTP routes and WebSocket routes)."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from starlette.requests import HTTPConnection

from .services.container import AppServices


def get_services(connection: HTTPConnection) -> AppServices:
    return connection.app.state.services


ServicesDep = Annotated[AppServices, Depends(get_services)]
