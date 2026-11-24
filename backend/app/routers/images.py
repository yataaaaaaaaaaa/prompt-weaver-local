"""Image library: online image search, resolution of an image's models, favorites.

Route signatures (paths, parameters, response models, `responses`) are the API contract mirrored in
backend/openapi.json and frontend/src/api/schema.gen.ts: change them only together with `npm run gen:api`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from ..dependencies import ServicesDep
from ..schemas import (
    FavoriteImage,
    ImageSearchPage,
    ImageSearchQuery,
    OkResponse,
    RemoteImage,
    ResolvedImageResource,
    ResolveImageResourcesRequest,
)
from ..services.image_library import FavoriteNotFound, InvalidImageCursor
from .provider_errors import PROVIDER_ERROR_RESPONSES, provider_http_errors

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get(
    "/search",
    response_model=ImageSearchPage,
    responses={**PROVIDER_ERROR_RESPONSES, 422: {"description": "Invalid parameters or cursor"}},
)
def search_images(query: Annotated[ImageSearchQuery, Query()], services: ServicesDep) -> ImageSearchPage:
    """One page of online images with their generation data and resources (keyword search: see
    services/image_library.py)."""
    try:
        with provider_http_errors():
            return services.images.search(query)
    except InvalidImageCursor as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post(
    "/resolve",
    response_model=list[ResolvedImageResource],
    responses={404: PROVIDER_ERROR_RESPONSES[404]},
)
def resolve_image_resources(request: ResolveImageResourcesRequest, services: ServicesDep) -> list[ResolvedImageResource]:
    """The provider model version of each resource (files carry local_path), in order; a resource that cannot
    be resolved carries an error instead of failing the request."""
    with provider_http_errors():
        return services.images.resolve_resources(request)


@router.get("/favorites", response_model=list[FavoriteImage])
def list_favorite_images(services: ServicesDep) -> list[FavoriteImage]:
    """The local favorites collection, newest first."""
    return services.images.favorites()


@router.put("/favorites", response_model=FavoriteImage)
def add_favorite_image(image: RemoteImage, services: ServicesDep) -> FavoriteImage:
    """Saves (or refreshes and moves to the front) an image in the favorites."""
    return services.images.add_favorite(image)


@router.delete(
    "/favorites/{provider}/{image_id}",
    response_model=OkResponse,
    responses={404: {"description": "No such favorite"}},
)
def remove_favorite_image(provider: str, image_id: str, services: ServicesDep) -> OkResponse:
    try:
        services.images.remove_favorite(provider, image_id)
    except FavoriteNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return OkResponse()
