"""Stories: the backend-owned illustrated storyboards (story mode). THE owner of the stories, their scenes, the scene
order and the scenes' illustrations (variants); the frontend story store edits them through /api/stories only.

Storage (AppPaths):
- stories_file (<data dir>/stories/stories.json), format version 1:
      {"version": 1, "items": [Story as JSON, ...]}   (creation order; each story's scenes in reading order)
  read with services/json_files.py read_resilient_json, written with write_json_atomic (crash-resilient, atomic); a
  missing file means no stories. Invalid stories are skipped (logged), and so are the invalid scenes of a valid story;
  a chosen illustration that is not one of the scene's variants reads as none. A file that exists but cannot be read,
  or has another version, raises StoriesFileError on every call: it is never overwritten (like characters.json).

Illustrations (THE variant rules, used by the API and by generation):
- a scene's variants are outputs (services/outputs.py), oldest first; a variant is added by a generation for the scene
  (GenerateRequest.story, services/generation.py: add_variant) or from an existing output (Add to story, "use this
  output"); the added variant becomes the scene's chosen illustration (`chosen_output_id`); adding an output that is
  already a variant only chooses it;
- choosing takes one of the variants; removing one keeps the output on disk, and when it was the chosen one the latest
  remaining variant becomes the chosen one (none without variants);
- deleting a scene or a story keeps its outputs (they stay normal outputs, with their OutputRecord.story link).

Scenes: a new scene gets the title 'Scene <n>' (n = the scene count after adding) unless the request names one; a
duplicate is inserted right after its original with every field, its variants and its chosen illustration, titled
'<title> (copy)'. Every change of a scene also updates its story's updated_at.

Loaded lazily on first use (construction performs no IO); thread-safe (routes run in the threadpool). Ids:
"sty-<12 hex>" and "scn-<12 hex>" (schemas.STORY_ID_PATTERN / SCENE_ID_PATTERN).
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..schemas import (
    OutputStory,
    Scene,
    SceneCreateRequest,
    ScenePatch,
    SceneVariant,
    Story,
    StoryCollection,
    StoryCreateRequest,
    StoryPatch,
)
from ..settings import AppPaths
from .ids import new_id, utc_now
from .json_files import read_resilient_json, sidecar_paths, write_json_atomic
from .outputs import OutputNotFound, OutputRepository
from .story_export import render_story_html

logger = logging.getLogger(__name__)

STORIES_FORMAT_VERSION = 1
STORY_ID_PREFIX = "sty-"
SCENE_ID_PREFIX = "scn-"
DEFAULT_SCENE_TITLE = "Scene {number}"
COPY_TITLE_SUFFIX = " (copy)"
_MAX_TITLE_LENGTH = 200


class StoryNotFound(LookupError):
    """No story with this id (HTTP 404)."""


class SceneNotFound(LookupError):
    """The story has no scene with this id (HTTP 404)."""


class VariantNotFound(LookupError):
    """The scene has no variant with this output id (HTTP 404)."""


class StoryOutputNotFound(LookupError):
    """The output to add as a variant does not exist (HTTP 404)."""


class SceneOrderError(ValueError):
    """A new scene order that is not exactly the story's scene ids (HTTP 422)."""


class StoriesFileError(RuntimeError):
    """stories.json exists but cannot be read (or has another version): refused rather than overwritten (HTTP 503)."""


@dataclass(frozen=True)
class _Collection:
    """The in-memory collection (what stories.json holds)."""

    items: tuple[Story, ...]

    def find(self, story_id: str) -> Story:
        for story in self.items:
            if story.id == story_id:
                return story
        raise StoryNotFound(f"Unknown story {story_id}.")

    def replacing(self, story: Story) -> _Collection:
        return _Collection(items=tuple(story if item.id == story.id else item for item in self.items))

    def payload(self) -> dict[str, Any]:
        return {"version": STORIES_FORMAT_VERSION, "items": [story.model_dump(mode="json") for story in self.items]}

    def api(self) -> StoryCollection:
        return StoryCollection(items=list(self.items))


_EMPTY = _Collection(items=())


def _scene_index(story: Story, scene_id: str) -> int:
    for index, scene in enumerate(story.scenes):
        if scene.id == scene_id:
            return index
    raise SceneNotFound(f"{story.title} has no scene {scene_id}.")


def _with_scenes(story: Story, scenes: list[Scene]) -> Story:
    return story.model_copy(update={"scenes": scenes, "updated_at": utc_now()})


def _with_variant(scene: Scene, output_id: str) -> Scene:
    """`scene` with `output_id` as a variant (appended unless it is one already) and as its chosen illustration."""
    variants = scene.variants
    if not any(variant.output_id == output_id for variant in variants):
        variants = [*variants, SceneVariant(output_id=output_id, added_at=utc_now())]
    return scene.model_copy(update={"variants": variants, "chosen_output_id": output_id, "updated_at": utc_now()})


def _sent(patch: StoryPatch | ScenePatch) -> dict[str, Any]:
    """The fields of a patch that were sent, as validated values (nested models stay models)."""
    return {name: getattr(patch, name) for name in patch.model_fields_set}


def _copy_title(title: str) -> str:
    return f"{title[: _MAX_TITLE_LENGTH - len(COPY_TITLE_SUFFIX)]}{COPY_TITLE_SUFFIX}"


class StoryStore:
    def __init__(self, *, paths: AppPaths, outputs: OutputRepository) -> None:
        self._paths = paths
        self._outputs = outputs
        self._lock = threading.Lock()
        # None until read from stories_file (first use); stays None while the file is unreadable.
        self._state: _Collection | None = None

    def __repr__(self) -> str:
        return f"{type(self).__name__}(stories_file={str(self._paths.stories_file)!r})"

    # -- stories -------------------------------------------------------------------------------------------------

    def collection(self) -> StoryCollection:
        """Every story, in creation order."""
        with self._lock:
            return self._loaded().api()

    def get(self, story_id: str) -> Story:
        """Raises StoryNotFound."""
        with self._lock:
            return self._loaded().find(story_id)

    def create(self, request: StoryCreateRequest) -> Story:
        """A new story without scenes (id, created_at = updated_at = now UTC)."""
        now = utc_now()
        story = Story(
            title=request.title,
            character_ids=request.character_ids,
            id=new_id(STORY_ID_PREFIX),
            scenes=[],
            created_at=now,
            updated_at=now,
        )
        with self._lock:
            state = self._loaded()
            self._save(_Collection(items=(*state.items, story)))
        return story

    def update(self, story_id: str, patch: StoryPatch) -> Story:
        """Changes the fields sent (title, characters)."""
        return self._change_story(story_id, lambda story: story.model_copy(update={**_sent(patch), "updated_at": utc_now()}))

    def delete(self, story_id: str) -> None:
        """Removes the story and its scenes (their outputs are kept)."""
        with self._lock:
            state = self._loaded()
            state.find(story_id)
            self._save(_Collection(items=tuple(item for item in state.items if item.id != story_id)))

    # -- scenes --------------------------------------------------------------------------------------------------

    def add_scene(self, story_id: str, request: SceneCreateRequest) -> Story:
        """Inserts a new scene at request.index (appended when null or past the end); with request.output_id that
        output is its first variant and chosen illustration (StoryOutputNotFound when it does not exist)."""
        if request.output_id is not None:
            self._require_output(request.output_id)
        fields = request.model_dump(exclude={"title", "index", "output_id"})

        def change(story: Story) -> Story:
            now = utc_now()
            title = request.title or DEFAULT_SCENE_TITLE.format(number=len(story.scenes) + 1)
            scene = Scene(**fields, id=new_id(SCENE_ID_PREFIX), title=title, created_at=now, updated_at=now)
            if request.output_id is not None:
                scene = _with_variant(scene, request.output_id)
            index = len(story.scenes) if request.index is None else min(request.index, len(story.scenes))
            return _with_scenes(story, [*story.scenes[:index], scene, *story.scenes[index:]])

        return self._change_story(story_id, change)

    def update_scene(self, story_id: str, scene_id: str, patch: ScenePatch) -> Story:
        """Changes the fields sent (title, text, tags, locks, characters, seed)."""
        update = {**_sent(patch), "updated_at": utc_now()}
        return self._change_scene(story_id, scene_id, lambda scene: scene.model_copy(update=update))

    def duplicate_scene(self, story_id: str, scene_id: str) -> Story:
        """Inserts a copy of the scene right after it (every field, its variants and chosen illustration; title
        '<title> (copy)')."""

        def change(story: Story) -> Story:
            index = _scene_index(story, scene_id)
            original = story.scenes[index]
            now = utc_now()
            copy = original.model_copy(
                update={"id": new_id(SCENE_ID_PREFIX), "title": _copy_title(original.title), "created_at": now, "updated_at": now},
                deep=True,
            )
            return _with_scenes(story, [*story.scenes[: index + 1], copy, *story.scenes[index + 1 :]])

        return self._change_story(story_id, change)

    def delete_scene(self, story_id: str, scene_id: str) -> Story:
        """Removes the scene (its outputs are kept)."""

        def change(story: Story) -> Story:
            _scene_index(story, scene_id)
            return _with_scenes(story, [scene for scene in story.scenes if scene.id != scene_id])

        return self._change_story(story_id, change)

    def reorder_scenes(self, story_id: str, scene_ids: list[str]) -> Story:
        """Puts the scenes in the order of `scene_ids`, which must hold every scene id of the story exactly once
        (SceneOrderError otherwise)."""

        def change(story: Story) -> Story:
            by_id = {scene.id: scene for scene in story.scenes}
            if len(scene_ids) != len(by_id) or set(scene_ids) != set(by_id):
                raise SceneOrderError(f"The new order must list each of the {len(by_id)} scenes of {story.title} once.")
            return _with_scenes(story, [by_id[scene_id] for scene_id in scene_ids])

        return self._change_story(story_id, change)

    # -- illustrations (variants) --------------------------------------------------------------------------------

    def add_variant(self, story_id: str, scene_id: str, output_id: str) -> Story:
        """Adds the output as a variant of the scene and makes it its chosen illustration (see the module docstring).
        Raises StoryOutputNotFound when the output does not exist."""
        self._require_output(output_id)
        return self._change_scene(story_id, scene_id, lambda scene: _with_variant(scene, output_id))

    def choose_variant(self, story_id: str, scene_id: str, output_id: str) -> Story:
        """Makes one of the scene's variants its chosen illustration (VariantNotFound otherwise)."""

        def change(scene: Scene) -> Scene:
            if not any(variant.output_id == output_id for variant in scene.variants):
                raise VariantNotFound(f"{scene.title} has no variant {output_id}.")
            return scene.model_copy(update={"chosen_output_id": output_id, "updated_at": utc_now()})

        return self._change_scene(story_id, scene_id, change)

    def remove_variant(self, story_id: str, scene_id: str, output_id: str) -> Story:
        """Removes a variant (the output stays); when it was the chosen one, the latest remaining variant is chosen."""

        def change(scene: Scene) -> Scene:
            remaining = [variant for variant in scene.variants if variant.output_id != output_id]
            if len(remaining) == len(scene.variants):
                raise VariantNotFound(f"{scene.title} has no variant {output_id}.")
            chosen = scene.chosen_output_id
            if chosen == output_id:
                chosen = remaining[-1].output_id if remaining else None
            return scene.model_copy(update={"variants": remaining, "chosen_output_id": chosen, "updated_at": utc_now()})

        return self._change_scene(story_id, scene_id, change)

    # -- generation and export -----------------------------------------------------------------------------------

    def scene_link(self, story_id: str, scene_id: str) -> OutputStory:
        """What an output generated for the scene records (OutputRecord.story). Raises StoryNotFound / SceneNotFound."""
        with self._lock:
            story = self._loaded().find(story_id)
            scene = story.scenes[_scene_index(story, scene_id)]
        return OutputStory(story_id=story.id, scene_id=scene.id, story_title=story.title, scene_title=scene.title)

    def export_html(self, story_id: str) -> str:
        """The story as one self-contained HTML document (services/story_export.py): every chosen illustration
        embedded; a scene without one (or whose output is gone) shows its text only."""
        story = self.get(story_id)
        return render_story_html(story, self._illustration_path)

    # -- storage -------------------------------------------------------------------------------------------------

    def _illustration_path(self, output_id: str) -> Path | None:
        try:
            return self._outputs.image_path(output_id)
        except (OutputNotFound, ValueError):
            return None

    def _require_output(self, output_id: str) -> None:
        try:
            self._outputs.image_path(output_id)
        except OutputNotFound:
            raise StoryOutputNotFound(f"Output {output_id} does not exist.") from None

    def _change_story(self, story_id: str, change: Callable[[Story], Story]) -> Story:
        """Applies `change` to the story and saves the collection (all or nothing: an exception saves nothing)."""
        with self._lock:
            state = self._loaded()
            updated = change(state.find(story_id))
            self._save(state.replacing(updated))
        return updated

    def _change_scene(self, story_id: str, scene_id: str, change: Callable[[Scene], Scene]) -> Story:
        def change_story(story: Story) -> Story:
            index = _scene_index(story, scene_id)
            scenes = list(story.scenes)
            scenes[index] = change(scenes[index])
            return _with_scenes(story, scenes)

        return self._change_story(story_id, change_story)

    def _loaded(self) -> _Collection:
        """The in-memory collection, read from stories_file on first use. Call with the lock held. Raises
        StoriesFileError (on every call, nothing cached) while the file cannot be used."""
        if self._state is None:
            self._state = self._read()
        return self._state

    def _read(self) -> _Collection:
        path = self._paths.stories_file
        try:
            payload = read_resilient_json(path)
        except OSError as exc:
            raise StoriesFileError(f"{path} cannot be read ({exc}); it is left untouched.") from exc
        if payload is None:
            if any(candidate.exists() for candidate in (path, *sidecar_paths(path))):
                raise StoriesFileError(f"{path} is not valid JSON; it is left untouched.")
            return _EMPTY
        return _parse(payload, str(path))

    def _save(self, state: _Collection) -> None:
        """Writes `state` then makes it the in-memory state. Call with the lock held, after _loaded()."""
        write_json_atomic(self._paths.stories_file, state.payload())
        self._state = state


def _parse(payload: Any, source: str) -> _Collection:
    """The valid stories of a file payload, in file order (the first entry wins over a duplicate id), each with its
    valid scenes. Raises StoriesFileError when the payload is not a version 1 stories file."""
    version = payload.get("version") if isinstance(payload, dict) else None
    if version != STORIES_FORMAT_VERSION:
        raise StoriesFileError(
            f"{source} is not a version {STORIES_FORMAT_VERSION} stories file (version {version!r}); it is left untouched."
        )
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise StoriesFileError(f"{source} has no 'items' list; it is left untouched.")
    items: list[Story] = []
    for index, raw_item in enumerate(raw_items):
        story = _parse_story(raw_item, f"story #{index} of {source}")
        if story is None:
            continue
        if any(item.id == story.id for item in items):
            logger.warning("Skipping duplicate story #%d (%s) in %s", index, story.id, source)
            continue
        items.append(story)
    return _Collection(items=tuple(items))


def _parse_story(raw: Any, label: str) -> Story | None:
    raw_scenes = raw.get("scenes") if isinstance(raw, dict) else None
    try:
        story = Story.model_validate({**raw, "scenes": []} if isinstance(raw, dict) else raw)
    except ValidationError as exc:
        logger.warning("Skipping invalid %s (%d error(s))", label, exc.error_count())
        return None
    scenes: list[Scene] = []
    for index, raw_scene in enumerate(raw_scenes if isinstance(raw_scenes, list) else []):
        try:
            scene = Scene.model_validate(raw_scene)
        except ValidationError as exc:
            logger.warning("Skipping invalid scene #%d of %s (%d error(s))", index, label, exc.error_count())
            continue
        if any(item.id == scene.id for item in scenes):
            logger.warning("Skipping duplicate scene #%d (%s) of %s", index, scene.id, label)
            continue
        if scene.chosen_output_id is not None and not any(v.output_id == scene.chosen_output_id for v in scene.variants):
            logger.warning("Ignoring the chosen illustration of scene %s of %s: not one of its variants", scene.id, label)
            scene = scene.model_copy(update={"chosen_output_id": None})
        scenes.append(scene)
    return story.model_copy(update={"scenes": scenes})
