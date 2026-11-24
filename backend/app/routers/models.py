"""Model library catalog: providers, online search, version / hash lookups, provider API tokens.

Route signatures (paths, parameters, response models, `responses`) are the API contract mirrored in
backend/openapi.json and frontend/src/api/schema.gen.ts: change them only together with `npm run gen:api`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query

from ..dependencies import ServicesDep
from ..schemas import (
    ModelLibraryInfo,
    ModelProviderInfo,
    ModelSearchPage,
    ModelSearchQuery,
    ProviderTokenUpdate,
    RemoteModel,
)
from ..services.model_catalog import TokenNotSupportedError
from .provider_errors import PROVIDER_ERROR_RESPONSES, provider_http_errors

router = APIRouter(prefix="/api/models", tags=["models"])

# Any case accepted (provider hashes are often uppercase); the service normalizes to lowercase.
Sha256 = Annotated[str, Path(pattern=r"^[0-9a-fA-F]{64}$")]


@router.get("/info", response_model=ModelLibraryInfo)
def model_library_info(services: ServicesDep) -> ModelLibraryInfo:
    """Registered providers (filters, token state) and the local model folders."""
    return services.catalog.info()


@router.get("/search", response_model=ModelSearchPage, responses=PROVIDER_ERROR_RESPONSES)
def search_models(query: Annotated[ModelSearchQuery, Query()], services: ServicesDep) -> ModelSearchPage:
    """One page of online models; files already on disk carry their local_path."""
    with provider_http_errors():
        return services.catalog.search(query)


@router.get(
    "/providers/{provider}/versions/{version_id}",
    response_model=RemoteModel,
    responses=PROVIDER_ERROR_RESPONSES,
)
def get_model_version(provider: str, version_id: str, services: ServicesDep) -> RemoteModel:
    """The model owning a version, with `versions` == [that version]."""
    with provider_http_errors():
        return services.catalog.get_version(provider, version_id)


@router.get("/providers/{provider}/by-hash/{sha256}", response_model=RemoteModel, responses=PROVIDER_ERROR_RESPONSES)
def find_model_by_hash(provider: str, sha256: Sha256, services: ServicesDep) -> RemoteModel:
    """The model version whose file has this SHA-256, same shape as get_model_version."""
    with provider_http_errors():
        return services.catalog.find_by_hash(provider, sha256)


@router.put(
    "/providers/{provider}/token",
    response_model=ModelProviderInfo,
    responses={
        404: PROVIDER_ERROR_RESPONSES[404],
        409: {"description": "The provider takes no API token"},
    },
)
def set_provider_token(provider: str, update: ProviderTokenUpdate, services: ServicesDep) -> ModelProviderInfo:
    """Stores (or, with null / "", removes) the provider's API token. The token is never sent back."""
    token = update.token.get_secret_value() if update.token is not None else None
    try:
        with provider_http_errors():
            return services.catalog.set_token(provider, token)
    except TokenNotSupportedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
