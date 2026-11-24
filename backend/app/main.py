"""ASGI entry point for uvicorn ("app.main:app"). Tests must use app.factory.create_app instead."""

from __future__ import annotations

from .factory import create_app

app = create_app()
