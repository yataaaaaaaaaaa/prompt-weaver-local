"""Characters: the backend-owned collection of reusable subjects and their images (character consistency).

Storage (AppPaths):
- characters_file (<data dir>/characters/characters.json), format version 1:
      {"version": 1, "active_id": "<id>" | null, "items": [Character as JSON, ...]}   (creation order)
  read with services/json_files.py read_resilient_json, written with write_json_atomic (crash-resilient, atomic);
  a missing file means no characters; invalid entries are skipped (logged); an active_id naming no character
  reads as null. A file that exists but cannot be read, or has another version, raises CharactersFileError on
  every call: it is never overwritten (like the frontend persisted stores);
- character_images_dir (<data dir>/characters/images/<image id>.png): one PNG per CharacterImage (reference images
  downscaled to at most REFERENCE_IMAGE_MAX_SIDE, thumbnails to THUMBNAIL_MAX_SIDE). Deleting a character, or one
  of its images, deletes the files.

Images are imported from a CharacterImageSource: an output (OutputRepository.image_path), a local file (PNG, JPEG,
WebP, BMP opened with Pillow), a URL (downloaded through the shared HttpClientFactory, services/http.py, at most
MAX_IMAGE_DOWNLOAD_BYTES) or another image of the same character.

Loaded lazily on first use (construction performs no IO); thread-safe (routes run in the threadpool). Ids:
"chr-<12 hex>" and "img-<12 hex>" (schemas.CHARACTER_ID_PATTERN / CHARACTER_IMAGE_ID_PATTERN).

Every change is all or nothing: a source is downloaded and decoded first (outside the lock), then its PNG files are
written and characters.json saved under the lock; when anything fails the files written for the change are deleted
and the in-memory collection is left unchanged (a failed write raises OSError). Files replaced or removed by a
change are deleted once it is saved.
"""

from __future__ import annotations

import io
import logging
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from PIL import Image, ImageOps
from pydantic import ValidationError

from ..schemas import (
    REFERENCE_DEFAULTS,
    Character,
    CharacterCollection,
    CharacterCreateRequest,
    CharacterDraft,
    CharacterImage,
    CharacterImageCopySource,
    CharacterImageSource,
    FileImageSource,
    OutputImageSource,
)
from ..settings import AppPaths
from .files import remove_quietly
from .http import HttpClientFactory, describe_http_error
from .ids import new_id, utc_now
from .json_files import read_resilient_json, sidecar_paths, write_json_atomic
from .outputs import OutputNotFound, OutputRepository
from .pictures import fit_within

logger = logging.getLogger(__name__)

CHARACTERS_FORMAT_VERSION = 1
REFERENCE_IMAGE_MAX_SIDE = 1024
THUMBNAIL_MAX_SIDE = 384
MAX_IMAGE_DOWNLOAD_BYTES = 25 * 1024 * 1024

# Pillow format names of the importable images (MPO: the multi-picture JPEGs of many phone cameras).
IMPORTABLE_IMAGE_FORMATS = frozenset({"PNG", "JPEG", "MPO", "WEBP", "BMP"})

CHARACTER_ID_PREFIX = "chr-"
CHARACTER_IMAGE_ID_PREFIX = "img-"
_IMAGE_SUFFIX = ".png"


class CharacterNotFound(LookupError):
    """No character with this id (HTTP 404)."""


class CharacterImageNotFound(LookupError):
    """The character has no image with this id (HTTP 404)."""


class CharacterSourceNotFound(LookupError):
    """The image source does not exist: unknown output, missing file (HTTP 404)."""


class CharacterImageError(ValueError):
    """The source is not a usable image (not an image, unsupported format, too large, refused source kind)
    (HTTP 422)."""


class CharacterImageFetchError(RuntimeError):
    """Downloading a URL source failed (network error, HTTP error) (HTTP 502)."""


class TooManyReferenceImages(ValueError):
    """The character already has REFERENCE_DEFAULTS.max_images reference images (HTTP 409)."""


class CharactersFileError(RuntimeError):
    """characters.json exists but cannot be read (or has another version): refused rather than overwritten
    (HTTP 503)."""


@dataclass(frozen=True)
class _Collection:
    """The in-memory collection (what characters.json holds)."""

    items: tuple[Character, ...]
    active_id: str | None

    def find(self, character_id: str) -> Character:
        for character in self.items:
            if character.id == character_id:
                return character
        raise CharacterNotFound(f"Unknown character {character_id}.")

    def replacing(self, character: Character) -> _Collection:
        return _Collection(
            items=tuple(character if item.id == character.id else item for item in self.items),
            active_id=self.active_id,
        )

    def payload(self) -> dict[str, Any]:
        return {
            "version": CHARACTERS_FORMAT_VERSION,
            "active_id": self.active_id,
            "items": [character.model_dump(mode="json") for character in self.items],
        }

    def api(self) -> CharacterCollection:
        return CharacterCollection(items=list(self.items), active_id=self.active_id)


_EMPTY = _Collection(items=(), active_id=None)


class CharacterStore:
    def __init__(self, *, paths: AppPaths, outputs: OutputRepository, http_client_factory: HttpClientFactory) -> None:
        self._paths = paths
        self._outputs = outputs
        self._http_client_factory = http_client_factory
        self._lock = threading.Lock()
        # None until read from characters_file (first use); stays None while the file is unreadable.
        self._state: _Collection | None = None

    def __repr__(self) -> str:
        return f"{type(self).__name__}(characters_file={str(self._paths.characters_file)!r})"

    def collection(self) -> CharacterCollection:
        """Every character, in creation order, and the active id."""
        with self._lock:
            return self._loaded().api()

    def get(self, character_id: str) -> Character:
        """Raises CharacterNotFound."""
        with self._lock:
            return self._loaded().find(character_id)

    def create(self, request: CharacterCreateRequest) -> Character:
        """New character (id, created_at = updated_at = now UTC) with the imported reference images, in order; the
        first one also becomes the thumbnail. All or nothing: when an import fails nothing is saved (image files
        written meanwhile are deleted) and the import error is raised."""
        if any(isinstance(source, CharacterImageCopySource) for source in request.reference_sources):
            raise CharacterImageError("A new character has no image to copy yet: import its reference images instead.")
        with self._lock:
            self._loaded()  # an unreadable characters.json fails before anything is downloaded
        prepared = [
            (self._decoded(source, None, REFERENCE_IMAGE_MAX_SIDE), source) for source in request.reference_sources
        ]
        now = utc_now()
        with self._lock:
            state = self._loaded()
            with _PendingImages(self._paths.character_images_dir) as files:
                references = [files.store(image, source) for image, source in prepared]
                thumbnail = files.store_thumbnail(prepared[0][0], references[0]) if references else None
                character = Character(
                    **_draft_fields(request),
                    id=new_id(CHARACTER_ID_PREFIX),
                    reference_images=references,
                    thumbnail=thumbnail,
                    created_at=now,
                    updated_at=now,
                )
                self._save(_Collection(items=(*state.items, character), active_id=state.active_id))
        return character

    def update(self, character_id: str, draft: CharacterDraft) -> Character:
        """Replaces the editable fields (images, id and created_at kept; updated_at = now)."""
        with self._lock:
            state = self._loaded()
            updated = state.find(character_id).model_copy(update={**_draft_fields(draft), "updated_at": utc_now()})
            self._save(state.replacing(updated))
        return updated

    def delete(self, character_id: str) -> None:
        """Removes the character and its image files; clears active_id when it was the active one."""
        with self._lock:
            state = self._loaded()
            character = state.find(character_id)
            self._save(
                _Collection(
                    items=tuple(item for item in state.items if item.id != character_id),
                    active_id=None if state.active_id == character_id else state.active_id,
                )
            )
        self._remove_images(image.id for image in _images_of(character))

    def set_active(self, character_id: str | None) -> CharacterCollection:
        """Activates the character (None deactivates). Raises CharacterNotFound."""
        with self._lock:
            state = self._loaded()
            if character_id is not None:
                state.find(character_id)
            if state.active_id != character_id:
                state = _Collection(items=state.items, active_id=character_id)
                self._save(state)
            return state.api()

    def add_reference_image(self, character_id: str, source: CharacterImageSource) -> Character:
        """Appends an imported reference image (the thumbnail is set from it when the character has none). Raises
        TooManyReferenceImages, CharacterSourceNotFound, CharacterImageError, CharacterImageFetchError."""
        image = self._decoded(source, _with_room(self.get(character_id)), REFERENCE_IMAGE_MAX_SIDE)
        with self._lock:
            state = self._loaded()
            current = _with_room(state.find(character_id))
            with _PendingImages(self._paths.character_images_dir) as files:
                reference = files.store(image, source)
                thumbnail = current.thumbnail
                if thumbnail is None:
                    thumbnail = files.store_thumbnail(image, reference)
                updated = current.model_copy(
                    update={
                        "reference_images": [*current.reference_images, reference],
                        "thumbnail": thumbnail,
                        "updated_at": utc_now(),
                    }
                )
                self._save(state.replacing(updated))
        return updated

    def remove_reference_image(self, character_id: str, image_id: str) -> Character:
        """Raises CharacterImageNotFound (the thumbnail is not a reference image)."""
        with self._lock:
            state = self._loaded()
            current = state.find(character_id)
            remaining = [image for image in current.reference_images if image.id != image_id]
            if len(remaining) == len(current.reference_images):
                raise CharacterImageNotFound(f"{current.name} has no reference image {image_id}.")
            updated = current.model_copy(update={"reference_images": remaining, "updated_at": utc_now()})
            self._save(state.replacing(updated))
        self._remove_images([image_id])
        return updated

    def set_thumbnail(self, character_id: str, source: CharacterImageSource) -> Character:
        """Replaces the thumbnail with a downscaled copy of the source (any kind, 'character_image' included)."""
        image = self._decoded(source, self.get(character_id), THUMBNAIL_MAX_SIDE)
        with self._lock:
            state = self._loaded()
            current = state.find(character_id)
            with _PendingImages(self._paths.character_images_dir) as files:
                updated = current.model_copy(update={"thumbnail": files.store(image, source), "updated_at": utc_now()})
                self._save(state.replacing(updated))
        if current.thumbnail is not None:
            self._remove_images([current.thumbnail.id])
        return updated

    def clear_thumbnail(self, character_id: str) -> Character:
        with self._lock:
            state = self._loaded()
            current = state.find(character_id)
            if current.thumbnail is None:
                return current
            updated = current.model_copy(update={"thumbnail": None, "updated_at": utc_now()})
            self._save(state.replacing(updated))
        self._remove_images([current.thumbnail.id])
        return updated

    def image_path(self, character_id: str, image_id: str) -> Path:
        """PNG of a reference image or of the thumbnail. Raises CharacterNotFound / CharacterImageNotFound."""
        character = self.get(character_id)
        if _image_of(character, image_id) is None:
            raise CharacterImageNotFound(f"{character.name} has no image {image_id}.")
        path = self._image_file(image_id)
        if not path.is_file():
            raise CharacterImageNotFound(f"The file of image {image_id} of {character.name} is missing.")
        return path

    def reference_image_paths(self, character: Character) -> list[Path]:
        """PNG paths of the character's reference images, in order (files missing on disk are skipped)."""
        paths = [self._image_file(image.id) for image in character.reference_images]
        return [path for path in paths if path.is_file()]

    # -- storage -------------------------------------------------------------------------------------------------

    def _loaded(self) -> _Collection:
        """The in-memory collection, read from characters_file on first use. Call with the lock held. Raises
        CharactersFileError (on every call, nothing cached) while the file cannot be used."""
        if self._state is None:
            self._state = self._read()
        return self._state

    def _read(self) -> _Collection:
        path = self._paths.characters_file
        try:
            payload = read_resilient_json(path)
        except OSError as exc:
            raise CharactersFileError(f"{path} cannot be read ({exc}); it is left untouched.") from exc
        if payload is None:
            if any(candidate.exists() for candidate in (path, *sidecar_paths(path))):
                raise CharactersFileError(f"{path} is not valid JSON; it is left untouched.")
            return _EMPTY
        return _parse(payload, path)

    def _save(self, state: _Collection) -> None:
        """Writes `state` then makes it the in-memory state. Call with the lock held, after _loaded()."""
        write_json_atomic(self._paths.characters_file, state.payload())
        self._state = state

    # -- images --------------------------------------------------------------------------------------------------

    def _image_file(self, image_id: str) -> Path:
        return self._paths.character_images_dir / f"{image_id}{_IMAGE_SUFFIX}"

    def _remove_images(self, image_ids: Iterable[str]) -> None:
        for image_id in image_ids:
            remove_quietly(self._image_file(image_id))

    def _decoded(self, source: CharacterImageSource, character: Character | None, max_side: int) -> Image.Image:
        """The source image as RGB, EXIF orientation applied, downscaled to at most `max_side` (aspect ratio kept).
        `character`: the character the image is for (None while creating it: 'character_image' is refused)."""
        if isinstance(source, OutputImageSource):
            try:
                path = self._outputs.image_path(source.output_id)
            except OutputNotFound:
                raise CharacterSourceNotFound(f"Output {source.output_id} does not exist.") from None
            image = _decode(path, f"Output {source.output_id}")
        elif isinstance(source, FileImageSource):
            path = Path(source.path)
            if not path.is_file():
                raise CharacterSourceNotFound(f"{path} does not exist.")
            image = _decode(path, str(path))
        elif isinstance(source, CharacterImageCopySource):
            if character is None:
                raise CharacterImageError("A new character has no image to copy yet.")
            path = self._image_file(source.image_id)
            if _image_of(character, source.image_id) is None or not path.is_file():
                raise CharacterSourceNotFound(f"{character.name} has no image {source.image_id}.")
            image = _decode(path, f"Image {source.image_id}")
        else:
            image = _decode(self._download(source.url), _display_url(source.url))
        return fit_within(image, max_side)

    def _download(self, url: str) -> bytes:
        """The body of `url` (redirects followed). Raises CharacterImageFetchError (network or HTTP error) and
        CharacterImageError (invalid URL, larger than MAX_IMAGE_DOWNLOAD_BYTES). Messages never quote the URL's
        query string (it may hold credentials)."""
        shown = _display_url(url)
        chunks: list[bytes] = []
        received = 0
        try:
            with self._http_client_factory() as client, client.stream("GET", url) as response:
                if not response.is_success:
                    raise CharacterImageFetchError(f"Downloading {shown} failed: HTTP {response.status_code}.")
                for chunk in response.iter_bytes():
                    received += len(chunk)
                    if received > MAX_IMAGE_DOWNLOAD_BYTES:
                        raise CharacterImageError(
                            f"{shown} is larger than {MAX_IMAGE_DOWNLOAD_BYTES // (1024 * 1024)} MB."
                        )
                    chunks.append(chunk)
        except httpx.InvalidURL:
            raise CharacterImageError(f"{shown} is not a valid image URL.") from None
        except httpx.HTTPError as exc:
            raise CharacterImageFetchError(f"Downloading {shown} failed: {describe_http_error(exc)}.") from None
        return b"".join(chunks)


class _PendingImages:
    """The image files written for one change: deleted again when the change fails (the `with` block raises)."""

    def __init__(self, folder: Path) -> None:
        self._folder = folder
        self._written: list[Path] = []

    def __enter__(self) -> _PendingImages:
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, traceback: TracebackType | None
    ) -> None:
        if exc_type is not None:
            for path in self._written:
                remove_quietly(path)

    def store(self, image: Image.Image, source: CharacterImageSource) -> CharacterImage:
        """Saves `image` as a new PNG (as is: already downscaled) and describes it."""
        image_id = new_id(CHARACTER_IMAGE_ID_PREFIX)
        path = self._folder / f"{image_id}{_IMAGE_SUFFIX}"
        self._folder.mkdir(parents=True, exist_ok=True)
        self._written.append(path)
        image.save(path, format="PNG")
        return CharacterImage(id=image_id, width=image.width, height=image.height, source=source, added_at=utc_now())

    def store_thumbnail(self, reference_image: Image.Image, reference: CharacterImage) -> CharacterImage:
        """A thumbnail-sized copy of a reference image just stored."""
        thumbnail = fit_within(reference_image, THUMBNAIL_MAX_SIDE)
        return self.store(thumbnail, CharacterImageCopySource(kind="character_image", image_id=reference.id))


def _parse(payload: Any, source: Path) -> _Collection:
    """The valid characters of a file payload, in file order (the first entry wins over a duplicate id). Raises
    CharactersFileError when the payload is not a version 1 characters file."""
    version = payload.get("version") if isinstance(payload, dict) else None
    if version != CHARACTERS_FORMAT_VERSION:
        raise CharactersFileError(
            f"{source} is not a version {CHARACTERS_FORMAT_VERSION} characters file (version {version!r}); it is "
            "left untouched."
        )
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise CharactersFileError(f"{source} has no 'items' list; it is left untouched.")
    items: list[Character] = []
    for index, raw_item in enumerate(raw_items):
        try:
            character = Character.model_validate(raw_item)
        except ValidationError as exc:
            logger.warning("Skipping invalid character #%d in %s (%d error(s))", index, source, exc.error_count())
            continue
        if any(item.id == character.id for item in items):
            logger.warning("Skipping duplicate character #%d (%s) in %s", index, character.id, source)
            continue
        items.append(character)
    active_id = payload.get("active_id")
    if active_id is not None and not any(item.id == active_id for item in items):
        logger.warning("Ignoring the active character %r of %s: no such character", active_id, source)
        active_id = None
    return _Collection(items=tuple(items), active_id=active_id)


def _decode(data: Path | bytes, label: str) -> Image.Image:
    """The image in a file or in downloaded bytes as RGB with its EXIF orientation applied. Raises
    CharacterImageError (not an image, or not one of IMPORTABLE_IMAGE_FORMATS)."""
    try:
        with Image.open(data if isinstance(data, Path) else io.BytesIO(data)) as opened:
            if opened.format not in IMPORTABLE_IMAGE_FORMATS:
                raise CharacterImageError(
                    f"{label} is a {opened.format or 'unknown'} image: use a PNG, JPEG, WebP or BMP image."
                )
            oriented = ImageOps.exif_transpose(opened)  # a copy (None only with in_place=True)
            return (opened if oriented is None else oriented).convert("RGB")
    except CharacterImageError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError) as exc:  # UnidentifiedImageError is an OSError
        raise CharacterImageError(f"{label} is not a readable image.") from exc


def _display_url(url: str) -> str:
    """`url` without credentials, query string or fragment (safe to show and log)."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc.rpartition("@")[2], parts.path, "", ""))


def _with_room(character: Character) -> Character:
    """`character`, when it can take one more reference image. Raises TooManyReferenceImages."""
    if len(character.reference_images) >= REFERENCE_DEFAULTS.max_images:
        raise TooManyReferenceImages(
            f"{character.name} already has {REFERENCE_DEFAULTS.max_images} reference images: remove one first."
        )
    return character


def _images_of(character: Character) -> list[CharacterImage]:
    """Every stored image of the character: its reference images, then its thumbnail."""
    return [*character.reference_images, *([character.thumbnail] if character.thumbnail is not None else [])]


def _image_of(character: Character, image_id: str) -> CharacterImage | None:
    return next((image for image in _images_of(character) if image.id == image_id), None)


def _draft_fields(draft: CharacterDraft) -> dict[str, Any]:
    """The editable fields (CharacterDraft) of a draft, a create request or a character."""
    return {name: getattr(draft, name) for name in CharacterDraft.model_fields}
