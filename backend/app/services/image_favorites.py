"""Image library favorites: the local collection of saved online images, <data dir>/image_favorites.json
(AppPaths.image_favorites_file). The backend is its single owner; the frontend reads and edits it through
/api/images/favorites only.

- file format (version 1): {"version": 1, "items": [FavoriteImage as JSON, ...]} newest first; read with
  services/json_files.py read_resilient_json and written with write_json_atomic (crash-resilient, atomic);
- a missing file means no favorites; an unreadable file or invalid entries: valid entries are kept, invalid ones
  skipped (logged), the file is only rewritten by the next add/remove;
- loaded lazily on first use (construction performs no IO); thread-safe (routes run in the threadpool);
- add(image): keyed by (image.provider, image.id); saving an image again replaces its snapshot and moves it to the
  front (saved_at = now, UTC);
- remove(provider, image_id) -> False when absent.
A failed write raises OSError and leaves the in-memory collection unchanged.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..schemas import FavoriteImage, RemoteImage
from .json_files import read_resilient_json, write_json_atomic

logger = logging.getLogger(__name__)

FAVORITES_FORMAT_VERSION = 1

_FavoriteKey = tuple[str, str]


def _key(image: RemoteImage) -> _FavoriteKey:
    return (image.provider, image.id)


def _parse_items(payload: Any, source: Path) -> list[FavoriteImage]:
    """The valid favorites of a file payload, in file order (the first entry wins over a duplicate)."""
    if payload is None:
        return []
    if not isinstance(payload, dict) or payload.get("version") != FAVORITES_FORMAT_VERSION:
        logger.warning("Ignoring image favorites %s: not a version %d file", source, FAVORITES_FORMAT_VERSION)
        return []
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        logger.warning("Ignoring image favorites %s: 'items' is not a list", source)
        return []
    items: list[FavoriteImage] = []
    seen: set[_FavoriteKey] = set()
    for index, raw_item in enumerate(raw_items):
        try:
            favorite = FavoriteImage.model_validate(raw_item)
        except ValidationError as exc:
            logger.warning(
                "Skipping invalid image favorite #%d in %s (%d error(s))", index, source, exc.error_count()
            )
            continue
        if _key(favorite.image) in seen:
            logger.warning("Skipping duplicate image favorite #%d in %s", index, source)
            continue
        seen.add(_key(favorite.image))
        items.append(favorite)
    return items


class ImageFavoritesStore:
    def __init__(self, favorites_file: Path) -> None:
        self._favorites_file = favorites_file
        self._lock = threading.Lock()
        # Newest first; None until loaded from the file (first use).
        self._items: list[FavoriteImage] | None = None

    def __repr__(self) -> str:
        return f"{type(self).__name__}(favorites_file={str(self._favorites_file)!r})"

    def list(self) -> list[FavoriteImage]:
        """Every favorite, newest first."""
        with self._lock:
            return list(self._loaded())

    def add(self, image: RemoteImage) -> FavoriteImage:
        """Saves `image` at the front (replacing an earlier snapshot of the same provider + id)."""
        favorite = FavoriteImage(image=image, saved_at=datetime.now(UTC))
        key = _key(image)
        with self._lock:
            items = [favorite, *(item for item in self._loaded() if _key(item.image) != key)]
            self._save(items)
        return favorite

    def remove(self, provider: str, image_id: str) -> bool:
        """Removes the favorite; False when there is none with this provider + image id."""
        key = (provider, image_id)
        with self._lock:
            current = self._loaded()
            items = [item for item in current if _key(item.image) != key]
            if len(items) == len(current):
                return False
            self._save(items)
        return True

    def _loaded(self) -> list[FavoriteImage]:
        """The in-memory favorites, read from the file on first use. Call with the lock held."""
        if self._items is None:
            try:
                payload = read_resilient_json(self._favorites_file)
            except OSError:
                logger.warning("Unreadable image favorites %s; starting empty", self._favorites_file, exc_info=True)
                payload = None
            else:
                if payload is None and self._favorites_file.exists():
                    logger.warning("Unreadable image favorites %s (invalid JSON); starting empty", self._favorites_file)
            self._items = _parse_items(payload, self._favorites_file)
        return self._items

    def _save(self, items: list[FavoriteImage]) -> None:
        """Writes `items` then makes them the in-memory state. Call with the lock held."""
        write_json_atomic(
            self._favorites_file,
            {"version": FAVORITES_FORMAT_VERSION, "items": [item.model_dump(mode="json") for item in items]},
        )
        self._items = items
