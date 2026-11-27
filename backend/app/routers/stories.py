"""Stories: the backend-owned illustrated storyboards, their scenes, the scene order, the scenes' illustrations
(variants) and the HTML export. Every scene change answers the whole story (the frontend story store replaces it).

Route signatures (paths, parameters, response models, `responses`) are the API contract mirrored in
backend/openapi.json and frontend/src/api/schema.gen.ts: change them only together with `npm run gen:api`.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import HTMLResponse

from ..dependencies import ServicesDep
from ..schemas import (
    OUTPUT_ID_PATTERN,
    SCENE_ID_PATTERN,
    STORY_ID_PATTERN,
    OkResponse,
    SceneCreateRequest,
    SceneOrderUpdate,
    ScenePatch,
    SceneVariantRequest,
    Story,
    StoryCollection,
    StoryCreateRequest,
    StoryPatch,
)
from ..services.stories import (
    SceneNotFound,
    SceneOrderError,
    StoriesFileError,
    StoryNotFound,
    StoryOutputNotFound,
    VariantNotFound,
)

router = APIRouter(prefix="/api/stories", tags=["stories"])

StoryId = Annotated[str, Path(pattern=STORY_ID_PATTERN)]
SceneId = Annotated[str, Path(pattern=SCENE_ID_PATTERN)]
OutputId = Annotated[str, Path(pattern=OUTPUT_ID_PATTERN)]

_NOT_FOUND = {404: {"description": "Unknown story, scene, variant or output"}}
_UNAVAILABLE = {503: {"description": "stories.json cannot be read (it is never overwritten)"}}
_ERRORS = {**_NOT_FOUND, **_UNAVAILABLE}


@contextmanager
def story_http_errors() -> Iterator[None]:
    """Story service errors -> HTTP errors (the message is the detail)."""
    try:
        yield
    except (StoryNotFound, SceneNotFound, VariantNotFound, StoryOutputNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SceneOrderError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except StoriesFileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("", response_model=StoryCollection, responses=_UNAVAILABLE)
def list_stories(services: ServicesDep) -> StoryCollection:
    """Every story with its scenes, in creation order."""
    with story_http_errors():
        return services.stories.collection()


@router.post("", response_model=Story, responses=_UNAVAILABLE)
def create_story(request: StoryCreateRequest, services: ServicesDep) -> Story:
    """Creates a story without scenes."""
    with story_http_errors():
        return services.stories.create(request)


@router.get("/{story_id}", response_model=Story, responses=_ERRORS)
def get_story(story_id: StoryId, services: ServicesDep) -> Story:
    with story_http_errors():
        return services.stories.get(story_id)


@router.patch("/{story_id}", response_model=Story, responses=_ERRORS)
def update_story(story_id: StoryId, patch: StoryPatch, services: ServicesDep) -> Story:
    """Changes the fields sent (title, characters)."""
    with story_http_errors():
        return services.stories.update(story_id, patch)


@router.delete("/{story_id}", response_model=OkResponse, responses=_ERRORS)
def delete_story(story_id: StoryId, services: ServicesDep) -> OkResponse:
    """Deletes the story and its scenes (their outputs are kept)."""
    with story_http_errors():
        services.stories.delete(story_id)
    return OkResponse()


@router.get(
    "/{story_id}/export",
    response_class=HTMLResponse,
    responses={200: {"content": {"text/html": {}}}, **_ERRORS},
)
def export_story(story_id: StoryId, services: ServicesDep) -> HTMLResponse:
    """The story as one self-contained HTML picture book (the chosen illustrations embedded)."""
    with story_http_errors():
        return HTMLResponse(services.stories.export_html(story_id))


@router.put(
    "/{story_id}/scene-order",
    response_model=Story,
    responses={**_ERRORS, 422: {"description": "The order does not list every scene of the story exactly once"}},
)
def reorder_scenes(story_id: StoryId, update: SceneOrderUpdate, services: ServicesDep) -> Story:
    """Puts the scenes in the given order (every scene id of the story, once)."""
    with story_http_errors():
        return services.stories.reorder_scenes(story_id, update.scene_ids)


@router.post("/{story_id}/scenes", response_model=Story, responses=_ERRORS)
def add_scene(story_id: StoryId, request: SceneCreateRequest, services: ServicesDep) -> Story:
    """Adds a scene (at `index`, else at the end); with `output_id` that output illustrates it."""
    with story_http_errors():
        return services.stories.add_scene(story_id, request)


@router.patch("/{story_id}/scenes/{scene_id}", response_model=Story, responses=_ERRORS)
def update_scene(story_id: StoryId, scene_id: SceneId, patch: ScenePatch, services: ServicesDep) -> Story:
    """Changes the fields sent (title, text, tags, locked sub-prompts, characters, seed)."""
    with story_http_errors():
        return services.stories.update_scene(story_id, scene_id, patch)


@router.delete("/{story_id}/scenes/{scene_id}", response_model=Story, responses=_ERRORS)
def delete_scene(story_id: StoryId, scene_id: SceneId, services: ServicesDep) -> Story:
    """Deletes the scene (its outputs are kept)."""
    with story_http_errors():
        return services.stories.delete_scene(story_id, scene_id)


@router.post("/{story_id}/scenes/{scene_id}/duplicate", response_model=Story, responses=_ERRORS)
def duplicate_scene(story_id: StoryId, scene_id: SceneId, services: ServicesDep) -> Story:
    """Inserts a copy of the scene right after it."""
    with story_http_errors():
        return services.stories.duplicate_scene(story_id, scene_id)


@router.post("/{story_id}/scenes/{scene_id}/variants", response_model=Story, responses=_ERRORS)
def add_scene_variant(
    story_id: StoryId, scene_id: SceneId, request: SceneVariantRequest, services: ServicesDep
) -> Story:
    """Adds an existing output to the scene's variants and makes it the chosen illustration."""
    with story_http_errors():
        return services.stories.add_variant(story_id, scene_id, request.output_id)


@router.put("/{story_id}/scenes/{scene_id}/chosen", response_model=Story, responses=_ERRORS)
def choose_scene_variant(
    story_id: StoryId, scene_id: SceneId, request: SceneVariantRequest, services: ServicesDep
) -> Story:
    """Makes one of the scene's variants its chosen illustration."""
    with story_http_errors():
        return services.stories.choose_variant(story_id, scene_id, request.output_id)


@router.delete("/{story_id}/scenes/{scene_id}/variants/{output_id}", response_model=Story, responses=_ERRORS)
def remove_scene_variant(story_id: StoryId, scene_id: SceneId, output_id: OutputId, services: ServicesDep) -> Story:
    """Removes a variant from the scene (the output is kept)."""
    with story_http_errors():
        return services.stories.remove_variant(story_id, scene_id, output_id)
