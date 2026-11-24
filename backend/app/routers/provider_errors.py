"""HTTP mapping of model provider errors (services/model_providers/base.py), shared by every router that
calls a provider (models.py, model_installs.py)."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from fastapi import HTTPException

from ..services.model_providers import ProviderAuthError, ProviderError, ProviderNotFoundError, UnknownProviderError

PROVIDER_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    403: {"description": "The provider requires an API token, or rejected the stored one"},
    404: {"description": "Unknown provider, model, version or hash"},
    502: {"description": "The provider could not be reached or answered an error"},
}


@contextmanager
def provider_http_errors() -> Iterator[None]:
    """Turns provider exceptions into HTTPException (404 / 403 / 502) with the exception message as detail."""
    try:
        yield
    except (UnknownProviderError, ProviderNotFoundError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProviderAuthError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
