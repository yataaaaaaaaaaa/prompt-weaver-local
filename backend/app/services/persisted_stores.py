"""Frontend persisted zustand stores, stored as <stores_dir>/<name>/state.json.

File format: the zustand persist envelope {"state": {...}, "version": n}. Must keep reading the
formats written by the former Electron file-backed storage:
  - <name>/state.json containing an envelope (current format),
  - <name>/state.json containing JSON null (never written) -> no data,
  - <name>/state.json or legacy flat <stores_dir>/<name>.json containing a string map
    {"<name>": "<envelope JSON string>"} (or a map with a single string value).

Content that exists but cannot be interpreted raises PersistedStoreUnreadable instead of reading as
"no data": the frontend then refuses to persist that store, so the file is never overwritten.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ..schemas import STORE_NAME_PATTERN, PersistedStoreEnvelope
from .json_files import path_lock, read_json, read_resilient_json, sidecar_paths, write_json_atomic

_STORE_NAME_RE = re.compile(STORE_NAME_PATTERN, re.ASCII)
_STATE_FILE_NAME = "state.json"
_LEGACY_FLAT_SUFFIX = ".json"


class PersistedStoreUnreadable(ValueError):
    """A store file exists but holds neither an envelope, JSON null nor a legacy string map."""


def _require_valid_name(name: str) -> str:
    if not _STORE_NAME_RE.fullmatch(name):
        raise ValueError(f"Invalid store name {name!r}.")
    return name


_MISSING = object()


def _read_file(path: Path) -> Any:
    """Parsed content of `path` (sidecar-resilient); _MISSING when no file exists.
    Raises PersistedStoreUnreadable when files exist but none of them is valid JSON.
    Holds the path's lock throughout, so a concurrent write of the same store is never seen half done."""
    with path_lock(path):
        payload = read_resilient_json(path)
        if payload is not None:
            return payload
        # read_resilient_json returns None both for JSON null and for "nothing readable".
        if path.exists():
            try:
                return read_json(path)
            except (OSError, ValueError) as exc:
                raise PersistedStoreUnreadable(f"{path} is not valid JSON: {exc}") from exc
        if any(sidecar.exists() for sidecar in sidecar_paths(path)):
            raise PersistedStoreUnreadable(f"{path} could not be recovered from its .new/.old copies.")
        return _MISSING


def _legacy_mapped_value(payload: dict[str, Any], name: str) -> str | None:
    """Inner envelope string of a legacy {"<name>": "<envelope JSON>"} map (or its single string value)."""
    direct = payload.get(name)
    if isinstance(direct, str):
        return direct
    values = [value for value in payload.values() if isinstance(value, str)]
    return values[0] if len(values) == 1 else None


def _to_envelope(payload: Any, name: str, source: Path) -> PersistedStoreEnvelope | None:
    if payload is None:
        return None
    if isinstance(payload, dict) and "state" not in payload:
        inner = _legacy_mapped_value(payload, name)
        if inner is None:
            raise PersistedStoreUnreadable(f"{source} holds neither a store envelope nor a legacy string map.")
        try:
            payload = json.loads(inner)
        except ValueError as exc:
            raise PersistedStoreUnreadable(f"{source} holds an invalid legacy envelope string: {exc}") from exc
        if payload is None:
            return None
    try:
        return PersistedStoreEnvelope.model_validate(payload)
    except ValidationError as exc:
        raise PersistedStoreUnreadable(f"{source} is not a valid store envelope: {exc}") from exc


class PersistedStoreRepository:
    def __init__(self, stores_dir: Path) -> None:
        self._stores_dir = stores_dir

    def _state_file(self, name: str) -> Path:
        return self._stores_dir / _require_valid_name(name) / _STATE_FILE_NAME

    def _legacy_flat_file(self, name: str) -> Path:
        return self._stores_dir / f"{_require_valid_name(name)}{_LEGACY_FLAT_SUFFIX}"

    def read(self, name: str) -> PersistedStoreEnvelope | None:
        """The persisted envelope, None when nothing was persisted. Raises PersistedStoreUnreadable."""
        state_file = self._state_file(name)
        payload = _read_file(state_file)
        if payload is not _MISSING:
            return _to_envelope(payload, name, state_file)
        legacy_file = self._legacy_flat_file(name)
        payload = _read_file(legacy_file)
        if payload is not _MISSING:
            return _to_envelope(payload, name, legacy_file)
        return None

    def write(self, name: str, envelope: PersistedStoreEnvelope) -> None:
        """Atomic write of <name>/state.json (json_files.write_json_atomic)."""
        write_json_atomic(self._state_file(name), envelope.model_dump(mode="json"))

    def delete(self, name: str) -> None:
        """Remove <name>/state.json (and its sidecars) and the legacy flat <name>.json.
        Other files in the store directory are left alone; the directory is removed when empty."""
        state_file = self._state_file(name)
        legacy_file = self._legacy_flat_file(name)
        with path_lock(state_file), path_lock(legacy_file):
            for path in (state_file, *sidecar_paths(state_file), legacy_file, *sidecar_paths(legacy_file)):
                path.unlink(missing_ok=True)
        try:
            state_file.parent.rmdir()
        except OSError:
            pass

    def names_with_data(self) -> list[str]:
        """Sorted names for which read() returns an envelope.

        Unreadable stores count as having data: they must not be re-seeded (and overwritten) from legacy data."""
        try:
            entries = list(self._stores_dir.iterdir())
        except FileNotFoundError:
            return []
        candidates = {
            entry.name if entry.is_dir() else entry.name[: -len(_LEGACY_FLAT_SUFFIX)]
            for entry in entries
            if entry.is_dir() or entry.name.endswith(_LEGACY_FLAT_SUFFIX)
        }
        names: list[str] = []
        for name in sorted(candidate for candidate in candidates if _STORE_NAME_RE.fullmatch(candidate)):
            try:
                has_data = self.read(name) is not None
            except PersistedStoreUnreadable:
                has_data = True
            if has_data:
                names.append(name)
        return names
