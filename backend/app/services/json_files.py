"""Crash-resilient JSON files (write to .new, keep .old, recover the newest readable copy)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def sidecar_paths(path: Path) -> tuple[Path, Path]:
    return (path.with_name(f"{path.name}.new"), path.with_name(f"{path.name}.old"))


def _cleanup_sidecars(path: Path) -> None:
    for candidate in sidecar_paths(path):
        candidate.unlink(missing_ok=True)


def _dump(payload: Any) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_resilient_json(path: Path) -> Any | None:
    """Return the newest readable payload among path, path.new and path.old (None when none exists).

    When a sidecar wins it is promoted to `path`; the sidecars are removed afterwards.
    """
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
    new_path, old_path = sidecar_paths(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    new_path.write_text(_dump(payload), encoding="utf-8")
    old_path.unlink(missing_ok=True)
    if path.exists():
        path.replace(old_path)
    new_path.replace(path)
    old_path.unlink(missing_ok=True)
