"""SHA-256 of local files, with a persistent cache (<data dir>/cache/file_hashes.json).

Hashing a multi-GB checkpoint takes seconds, so every hash is cached by absolute path and stays valid while
the file's size and mtime_ns are unchanged. The cache is derived data: deleting it only costs re-hashing.

Cache file format (version 1):
    {"version": 1, "entries": {"<absolute path>": {"size": int, "mtime_ns": int, "sha256": "<lowercase hex>"}}}
Read resiliently and written atomically (services/json_files.py); an unreadable cache is treated as empty.
Thread-safe (installs and downloads run on worker threads). Hashes are lowercase hex everywhere.

Paths are compared through path_key() (absolute, case-insensitive on Windows); the file keeps the absolute path
as given, so paths_with_hash returns paths with their original case. The cache is loaded on first use
(constructing it performs no IO) and rewritten after every change; a failed write is logged and the in-memory
entry kept (the next run only re-hashes). Entries of deleted files stay in the file but never match.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import stat
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, NamedTuple

from ..schemas import SHA256_PATTERN
from .json_files import read_resilient_json, write_json_atomic

logger = logging.getLogger(__name__)

HASH_CHUNK_SIZE = 4 * 1024 * 1024
CACHE_FORMAT_VERSION = 1

_SHA256_RE = re.compile(SHA256_PATTERN)


def normalize_sha256(value: str | None) -> str | None:
    """`value` as a lowercase hex SHA-256 digest (surrounding whitespace ignored); None when it is empty or not a
    SHA-256. The single normalization of hashes from providers, requests and download specs."""
    if not value:
        return None
    normalized = value.strip().lower()
    return normalized if _SHA256_RE.fullmatch(normalized) else None


def sha256_file(path: Path, *, chunk_size: int = HASH_CHUNK_SIZE) -> str:
    """Lowercase hex SHA-256 of the file's content (streamed; never loads the file in memory)."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def path_key(path: Path | str) -> str:
    """Comparison key of a local path: absolute and normalized (case-insensitive on Windows)."""
    return os.path.normcase(os.path.abspath(path))


class FileSignature(NamedTuple):
    size: int
    mtime_ns: int


def file_signature(path: Path) -> FileSignature | None:
    """Size and mtime of a regular file; None when it does not exist, is not a regular file or cannot be read."""
    try:
        result = os.stat(path)
    except (OSError, ValueError):
        return None
    if not stat.S_ISREG(result.st_mode):
        return None
    return FileSignature(result.st_size, result.st_mtime_ns)


@dataclass(frozen=True)
class _Entry:
    path: str  # absolute path as given (original case)
    signature: FileSignature
    sha256: str

    def to_json(self) -> dict[str, Any]:
        return {"size": self.signature.size, "mtime_ns": self.signature.mtime_ns, "sha256": self.sha256}


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _parse_entry(path: Any, payload: Any) -> _Entry | None:
    if not isinstance(path, str) or not path or not isinstance(payload, dict):
        return None
    size, mtime_ns, sha256 = payload.get("size"), payload.get("mtime_ns"), payload.get("sha256")
    if not _is_int(size) or not _is_int(mtime_ns) or not isinstance(sha256, str) or not _SHA256_RE.fullmatch(sha256):
        return None
    return _Entry(path=path, signature=FileSignature(size, mtime_ns), sha256=sha256)


def _required_sha256(sha256: str) -> str:
    normalized = normalize_sha256(sha256)
    if normalized is None:
        raise ValueError(f"Not a SHA-256 hex digest: {sha256!r}.")
    return normalized


class FileHashCache:
    def __init__(self, cache_file: Path) -> None:
        self._cache_file = cache_file
        self._lock = threading.Lock()
        # path_key -> entry; None until loaded (first use).
        self._entries: dict[str, _Entry] | None = None

    def sha256(self, path: Path) -> str:
        """Cached hash when still valid, else computed with sha256_file and cached."""
        cached = self.cached_sha256(path)
        if cached is not None:
            return cached
        # Hash outside the lock (seconds for a checkpoint); cache it only if the file did not change meanwhile.
        before = file_signature(path)
        digest = sha256_file(path)
        if before is not None and file_signature(path) == before:
            self._store(path, before, digest)
        return digest

    def cached_sha256(self, path: Path) -> str | None:
        """The cached hash when the entry is still valid (same size and mtime_ns); never hashes."""
        with self._lock:
            entry = self._loaded().get(path_key(path))
        if entry is None or file_signature(path) != entry.signature:
            return None
        return entry.sha256

    def remember(self, path: Path, sha256: str) -> None:
        """Records the hash of a file just verified elsewhere (e.g. computed while downloading it)."""
        digest = _required_sha256(sha256)
        signature = file_signature(path)
        if signature is None:
            raise FileNotFoundError(f"Cannot remember the hash of a missing file: {path}")
        self._store(path, signature, digest)

    def paths_with_hash(self, sha256: str) -> list[Path]:
        """Existing files whose valid cached hash equals `sha256` (no hashing)."""
        digest = normalize_sha256(sha256)
        if digest is None:
            return []
        with self._lock:
            entries = [entry for entry in self._loaded().values() if entry.sha256 == digest]
        return [Path(entry.path) for entry in entries if file_signature(Path(entry.path)) == entry.signature]

    def _store(self, path: Path, signature: FileSignature, digest: str) -> None:
        entry = _Entry(path=os.path.abspath(path), signature=signature, sha256=digest)
        with self._lock:
            entries = self._loaded()
            key = path_key(path)
            if entries.get(key) == entry:
                return
            entries[key] = entry
            self._save(entries)

    def _loaded(self) -> dict[str, _Entry]:
        """The in-memory entries, read from the cache file on first use. Call with the lock held."""
        if self._entries is None:
            self._entries = self._read()
        return self._entries

    def _read(self) -> dict[str, _Entry]:
        try:
            payload = read_resilient_json(self._cache_file)
        except OSError:
            logger.warning("Unreadable file hash cache %s; starting empty", self._cache_file, exc_info=True)
            return {}
        if not isinstance(payload, dict) or payload.get("version") != CACHE_FORMAT_VERSION:
            return {}
        raw_entries = payload.get("entries")
        if not isinstance(raw_entries, dict):
            return {}
        entries: dict[str, _Entry] = {}
        for raw_path, raw_entry in raw_entries.items():
            entry = _parse_entry(raw_path, raw_entry)
            if entry is not None:
                entries[path_key(entry.path)] = entry
        return entries

    def _save(self, entries: dict[str, _Entry]) -> None:
        payload = {
            "version": CACHE_FORMAT_VERSION,
            "entries": {entry.path: entry.to_json() for entry in entries.values()},
        }
        try:
            write_json_atomic(self._cache_file, payload)
        except OSError:
            logger.warning("Could not write the file hash cache %s", self._cache_file, exc_info=True)
