"""Characters: the backend-owned character collection, the active character and the characters' images.

Route signatures (paths, parameters, response models, `responses`) are the API contract mirrored in
backend/openapi.json and frontend/src/api/schema.gen.ts: change them only together with `npm run gen:api`.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import FileResponse

from ..dependencies import ServicesDep
from ..schemas import (
    CHARACTER_ID_PATTERN,
    CHARACTER_IMAGE_ID_PATTERN,
    ActiveCharacterUpdate,
    Character,
    CharacterCollection,
    CharacterCreateRequest,
    CharacterDraft,
    CharacterImageRequest,
    OkResponse,
)
from ..services.characters import (
    CharacterImageError,
    CharacterImageFetchError,
    CharacterImageNotFound,
    CharacterNotFound,
    CharactersFileError,
    CharacterSourceNotFound,
    TooManyReferenceImages,
)

router = APIRouter(prefix="/api/characters", tags=["characters"])

CharacterId = Annotated[str, Path(pattern=CHARACTER_ID_PATTERN)]
CharacterImageId = Annotated[str, Path(pattern=CHARACTER_IMAGE_ID_PATTERN)]

_NOT_FOUND = {404: {"description": "Unknown character or image"}}
_UNAVAILABLE = {503: {"description": "characters.json cannot be read (it is never overwritten)"}}
_IMPORT_ERRORS = {
    404: {"description": "Unknown character, or the image source does not exist"},
    422: {"description": "The source is not a usable image"},
    502: {"description": "The image could not be downloaded"},
}


@contextmanager
def character_http_errors() -> Iterator[None]:
    """Character service errors -> HTTP errors (the message is the detail)."""
    try:
        yield
    except (CharacterNotFound, CharacterImageNotFound, CharacterSourceNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TooManyReferenceImages as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except CharacterImageError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except CharacterImageFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except CharactersFileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("", response_model=CharacterCollection, responses=_UNAVAILABLE)
def list_characters(services: ServicesDep) -> CharacterCollection:
    """Every character, in creation order, and the active one."""
    with character_http_errors():
        return services.characters.collection()


@router.post("", response_model=Character, responses={**_IMPORT_ERRORS, **_UNAVAILABLE})
def create_character(request: CharacterCreateRequest, services: ServicesDep) -> Character:
    """Creates a character, importing its reference images (all or nothing)."""
    with character_http_errors():
        return services.characters.create(request)


@router.put("/active", response_model=CharacterCollection, responses={**_NOT_FOUND, **_UNAVAILABLE})
def set_active_character(update: ActiveCharacterUpdate, services: ServicesDep) -> CharacterCollection:
    """Activates a character for generation (null deactivates)."""
    with character_http_errors():
        return services.characters.set_active(update.id)


@router.put("/{character_id}", response_model=Character, responses={**_NOT_FOUND, **_UNAVAILABLE})
def update_character(character_id: CharacterId, draft: CharacterDraft, services: ServicesDep) -> Character:
    """Replaces the editable fields of a character (its images are kept)."""
    with character_http_errors():
        return services.characters.update(character_id, draft)


@router.delete("/{character_id}", response_model=OkResponse, responses={**_NOT_FOUND, **_UNAVAILABLE})
def delete_character(character_id: CharacterId, services: ServicesDep) -> OkResponse:
    """Deletes a character and its images (deactivating it when it was active)."""
    with character_http_errors():
        services.characters.delete(character_id)
    return OkResponse()


@router.post(
    "/{character_id}/reference-images",
    response_model=Character,
    responses={**_IMPORT_ERRORS, 409: {"description": "The character has the maximum number of reference images"}, **_UNAVAILABLE},
)
def add_character_reference_image(
    character_id: CharacterId, request: CharacterImageRequest, services: ServicesDep
) -> Character:
    """Imports a reference image (appended; it becomes the thumbnail when the character has none)."""
    with character_http_errors():
        return services.characters.add_reference_image(character_id, request.source)


@router.delete(
    "/{character_id}/reference-images/{image_id}",
    response_model=Character,
    responses={**_NOT_FOUND, **_UNAVAILABLE},
)
def remove_character_reference_image(
    character_id: CharacterId, image_id: CharacterImageId, services: ServicesDep
) -> Character:
    with character_http_errors():
        return services.characters.remove_reference_image(character_id, image_id)


@router.put("/{character_id}/thumbnail", response_model=Character, responses={**_IMPORT_ERRORS, **_UNAVAILABLE})
def set_character_thumbnail(character_id: CharacterId, request: CharacterImageRequest, services: ServicesDep) -> Character:
    """Replaces the thumbnail with a downscaled copy of the source (e.g. one of the reference images)."""
    with character_http_errors():
        return services.characters.set_thumbnail(character_id, request.source)


@router.delete("/{character_id}/thumbnail", response_model=Character, responses={**_NOT_FOUND, **_UNAVAILABLE})
def clear_character_thumbnail(character_id: CharacterId, services: ServicesDep) -> Character:
    with character_http_errors():
        return services.characters.clear_thumbnail(character_id)


@router.get(
    "/{character_id}/images/{image_id}",
    response_class=FileResponse,
    responses={200: {"content": {"image/png": {}}}, **_NOT_FOUND, **_UNAVAILABLE},
)
def get_character_image(character_id: CharacterId, image_id: CharacterImageId, services: ServicesDep) -> FileResponse:
    """PNG of a reference image or of the thumbnail."""
    with character_http_errors():
        return FileResponse(services.characters.image_path(character_id, image_id), media_type="image/png")
