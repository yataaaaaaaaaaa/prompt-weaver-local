"""Crash-resilient JSON files (write to .new, keep .old, recover the newest readable copy).

Reads and writes of one path are serialized by a per-path lock (path_lock): the HTTP endpoints run in a thread
pool, and a read racing a write of the same file would otherwise promote or delete the .new/.old copies the write
is using, or (on Windows) make the write's replace fail because the reader holds the file open. A replace or
delete that still meets a sharing violation (another process, e.g. a virus scanner, holding the file for a moment)
is retried briefly before the error is raised.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

_T = TypeVar("_T")

_LOCKS_GUARD = threading.Lock()
_PATH_LOCKS: dict[str, threading.RLock] = {}

# Sharing violations (PermissionError on Windows) are retried with a growing pause: about 1 s in total.
_FILE_OP_ATTEMPTS = 10
_FILE_OP_PAUSE_S = 0.02


def path_lock(path: Path) -> threading.RLock:
    """The lock serializing every read and write of `path` in this process (reentrant: a reader may hold it across
    several reads of the same file)."""
    key = os.path.normcase(os.path.abspath(path))
    with _LOCKS_GUARD:
        lock = _PATH_LOCKS.get(key)
        if lock is None:
            lock = _PATH_LOCKS[key] = threading.RLock()
        return lock


def _retry_sharing_violations(operation: Callable[[], _T]) -> _T:
    for attempt in range(1, _FILE_OP_ATTEMPTS + 1):
        try:
            return operation()
        except PermissionError:
            if attempt == _FILE_OP_ATTEMPTS:
                raise
            time.sleep(_FILE_OP_PAUSE_S * attempt)
    raise AssertionError("unreachable")


def _replace(source: Path, target: Path) -> None:
    _retry_sharing_violations(lambda: source.replace(target))


def _unlink(path: Path) -> None:
    _retry_sharing_violations(lambda: path.unlink(missing_ok=True))


def sidecar_paths(path: Path) -> tuple[Path, Path]:
    return (path.with_name(f"{path.name}.new"), path.with_name(f"{path.name}.old"))


def _cleanup_sidecars(path: Path) -> None:
    for candidate in sidecar_paths(path):
        _unlink(candidate)


def _dump(payload: Any) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_resilient_json(path: Path) -> Any | None:
    """Return the newest readable payload among path, path.new and path.old (None when none exists).

    When a sidecar wins it is promoted to `path`; the sidecars are removed afterwards.
    """
    with path_lock(path):
        new_path, old_path = sidecar_paths(path)
        parsed: list[tuple[float, Path, Any]] = []
        for candidate in (path, new_path, old_path):
            if not candidate.exists():
                continue
            try:
                payload = read_json(candidate)
            except Exception:
                continue
            parsed.append((candidate.stat().st_mtime, candidate, payload))

        if not parsed:
            return None

        parsed.sort(key=lambda item: item[0], reverse=True)
        _, winning_path, winning_payload = parsed[0]
        if winning_path != path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(_dump(winning_payload), encoding="utf-8")
        _cleanup_sidecars(path)
        return winning_payload


def write_json_atomic(path: Path, payload: Any) -> None:
    """Write `payload` via path.new -> path (keeping path.old during the swap). UTF-8, indent=2, ensure_ascii=False."""
    text = _dump(payload)
    with path_lock(path):
        new_path, old_path = sidecar_paths(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        new_path.write_text(text, encoding="utf-8")
        _unlink(old_path)
        if path.exists():
            _replace(path, old_path)
        _replace(new_path, path)
        _unlink(old_path)
