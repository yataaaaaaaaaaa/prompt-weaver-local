"""Local copies of downloadable files: where a download goes and whether a file is already on disk.

Single owner of the "already on disk" rule for every downloadable file described by a LocalFileSpec (id, name,
size_bytes, sha256): provider model files (RemoteFile, in AppPaths.model_dir(kind): ComfyUI checkpoints / loras /
embeddings by default, through the kind-based methods) and IP-Adapter files (services/ip_adapters.py, in
AppPaths.ip_adapter_dir / image_encoder_dir, through the folder-based *_in methods). The kind-based methods are
the folder-based ones on model_dir(kind).

Folders are searched recursively (users keep LoRAs in sub-folders). "Already downloaded" is detected
- by path: the download target (or a same-named file) exists with the expected size, and
- by hash: any file of the folder with the expected size whose SHA-256 (FileHashCache) matches,
so a file renamed by the user (Civitai's Content-Disposition names differ from the API file names, ComfyUI
users rename IP-Adapter files) is found too. Sizes are exact (size_bytes), so only same-size files are ever
hashed.

File names (single owner: safe_file_name / target_path_in below): the provider file name reduced to its basename
and made safe for Windows; when that name already holds a different file, "<stem>-<version_id><suffix>", then
"<stem>-<version_id>-<file id><suffix>", then "<stem>-<version_id>-<file id>-<n><suffix>" (n = 2, 3, ...).

Never creates, deletes or overwrites anything in the searched folders (it only stats and reads files).
"""

from __future__ import annotations

import os
import re
from collections.abc import Collection, Iterator
from pathlib import Path
from typing import Protocol

from ..schemas import ModelKind
from ..settings import AppPaths
from .downloads import PART_SUFFIX
from .file_hashes import FileHashCache, file_signature, normalize_sha256, path_key

# Characters Windows refuses in file names (plus path separators) and control characters.
_UNSAFE_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f\x7f]')
_PATH_SEPARATORS = re.compile(r"[\\/]")
_WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL", *(f"COM{index}" for index in range(1, 10)), *(f"LPT{index}" for index in range(1, 10))}
)
# Upper bound of the "-<n>" fallback names (only reached when thousands of different files share a name).
_MAX_NUMBERED_NAMES = 1000


class LocalFileSpec(Protocol):
    """A downloadable file as the on-disk check sees it: schemas.RemoteFile (provider model files) and
    services/ip_adapters.py IpAdapterFileSpec satisfy it. `name` is the preferred local file name (made safe by
    download_file_name), `size_bytes` the exact size and `sha256` the expected SHA-256 (None when unknown: only
    a same-named same-size file then counts)."""

    @property
    def id(self) -> str: ...

    @property
    def name(self) -> str: ...

    @property
    def size_bytes(self) -> int: ...

    @property
    def sha256(self) -> str | None: ...


def _replace_unsafe(text: str) -> str:
    return _UNSAFE_CHARS.sub("_", text)


def safe_file_name(name: str) -> str:
    """`name` reduced to a file name Windows accepts: basename only, reserved characters and control characters
    replaced with '_', no trailing dots or spaces, '_' prefixed to reserved device names (CON, NUL.txt, ...).
    An empty string when nothing usable remains."""
    cleaned = _replace_unsafe(_PATH_SEPARATORS.split(name)[-1]).rstrip(" .")
    if not cleaned:
        return ""
    if cleaned.split(".", 1)[0].rstrip(" ").upper() in _WINDOWS_RESERVED_NAMES:
        cleaned = f"_{cleaned}"
    return cleaned


def download_file_name(file: LocalFileSpec) -> str:
    """Preferred local name of `file`: safe_file_name(file.name), or "<file id>.safetensors" when it is empty."""
    return safe_file_name(file.name) or safe_file_name(f"{file.id}.safetensors") or "model.safetensors"


def _with_parts(name: str, *parts: str) -> str:
    stem, suffix = os.path.splitext(name)
    return f"{_replace_unsafe('-'.join((stem, *parts))).rstrip(' .')}{suffix}"


def _target_names(file: LocalFileSpec, version_id: str) -> Iterator[str]:
    """Download target candidates of `file`, in order of preference (see the module docstring)."""
    name = download_file_name(file)
    yield name
    yield _with_parts(name, version_id)
    yield _with_parts(name, version_id, file.id)
    for index in range(2, _MAX_NUMBERED_NAMES + 2):
        yield _with_parts(name, version_id, file.id, str(index))


def _expected_sha256(file: LocalFileSpec) -> str | None:
    return normalize_sha256(file.sha256)


def _is_inside(path: Path, folder: Path) -> bool:
    return path_key(path).startswith(os.path.join(path_key(folder), ""))


def _regular_file_size(path: Path) -> int | None:
    signature = file_signature(path)
    return signature.size if signature is not None else None


class LocalModelFiles:
    def __init__(self, *, paths: AppPaths, hashes: FileHashCache) -> None:
        self._paths = paths
        self._hashes = hashes

    # -- model files: the folder of their kind ----------------------------------------------------------

    def target_path(
        self, kind: ModelKind, file: LocalFileSpec, *, version_id: str, reserved: Collection[Path] = ()
    ) -> Path:
        """target_path_in(model_dir(kind), ...)."""
        return self.target_path_in(self._paths.model_dir(kind), file, version_id=version_id, reserved=reserved)

    def known_path(self, kind: ModelKind, file: LocalFileSpec) -> Path | None:
        """known_path_in(model_dir(kind), ...): annotates search results."""
        return self.known_path_in(self._paths.model_dir(kind), file)

    def locate(self, kind: ModelKind, file: LocalFileSpec, *, version_id: str | None = None) -> Path | None:
        """locate_in(model_dir(kind), ...): checked before installing a model."""
        return self.locate_in(self._paths.model_dir(kind), file, version_id=version_id)

    # -- any folder ----------------------------------------------------------------------------------------

    def target_path_in(
        self, folder: Path, file: LocalFileSpec, *, version_id: str, reserved: Collection[Path] = ()
    ) -> Path:
        """Download target: folder / <file.name made safe for Windows (no separators, reserved characters,
        trailing dots/spaces)>. When that path already holds a *different* file (other size, or another hash
        when file.sha256 is set) or is in `reserved` (destinations of other running downloads),
        <stem>-<version_id><suffix> instead, then <stem>-<version_id>-<file.id><suffix>, then numbered names.
        An existing path is returned only when it holds this very file. Creates nothing; may hash (cached) a
        same-size file holding the name."""
        taken = {path_key(path) for path in reserved}
        for name in _target_names(file, version_id):
            candidate = folder / name
            if path_key(candidate) not in taken and not self._holds_other_file(candidate, file):
                return candidate
        raise FileExistsError(f"No free file name for '{file.name}' in {folder}.")

    def known_path_in(self, folder: Path, file: LocalFileSpec) -> Path | None:
        """Cheap check (never hashes): a file of `folder` named like the target with file.size_bytes (unless
        its cached hash differs from file.sha256), or a cached hash match (FileHashCache.paths_with_hash)
        inside `folder`."""
        expected = _expected_sha256(file)
        named = folder / download_file_name(file)
        if _regular_file_size(named) == file.size_bytes:
            cached = self._hashes.cached_sha256(named) if expected is not None else None
            if cached is None or cached == expected:
                return named
        if expected is not None:
            for path in self._hashes.paths_with_hash(expected):
                if _is_inside(path, folder):
                    return path
        return None

    def locate_in(self, folder: Path, file: LocalFileSpec, *, version_id: str | None = None) -> Path | None:
        """Full check used before downloading: known_path_in() verified by hash when file.sha256 is set, else
        every file of `folder` (recursive, '.part' files skipped) whose size is file.size_bytes, hashed (cached)
        and compared with file.sha256, target-named files first. Without a provider hash, only a same-named
        same-size file counts: the download target (target_path_in for `version_id`, when given) or a file
        with the target's name in a sub-folder. None when absent or when the folder does not exist."""
        if not folder.is_dir():
            return None
        name_key = download_file_name(file).casefold()
        expected = _expected_sha256(file)
        if expected is None:
            target = (
                self.target_path_in(folder, file, version_id=version_id)
                if version_id is not None
                else folder / download_file_name(file)
            )
            if _regular_file_size(target) == file.size_bytes:
                return target
            return next(
                (path for path in self._same_size_files(folder, file.size_bytes) if path.name.casefold() == name_key),
                None,
            )

        known = self.known_path_in(folder, file)
        if known is not None and self._has_hash(known, expected):
            return known
        candidates = sorted(
            self._same_size_files(folder, file.size_bytes), key=lambda path: path.name.casefold() != name_key
        )
        return next(
            (path for path in candidates if path != known and self._has_hash(path, expected)),
            None,
        )

    def remember(self, path: Path, sha256: str) -> None:
        """Records a verified file (a finished download) so the next locate() / locate_in() needs no hashing
        (and known_path() / known_path_in() find it by hash). Usable as a DownloadManager on_complete."""
        self._hashes.remember(path, sha256)

    # -- internals --------------------------------------------------------------------------------------

    def _holds_other_file(self, path: Path, file: LocalFileSpec) -> bool:
        """True when `path` exists but is not `file` (not a regular file, other size, or other hash)."""
        size = _regular_file_size(path)
        if size is None:
            # A folder (or anything else that is not a readable regular file) holds the name.
            return os.path.lexists(path)
        if size != file.size_bytes:
            return True
        expected = _expected_sha256(file)
        return expected is not None and not self._has_hash(path, expected)

    def _has_hash(self, path: Path, expected: str) -> bool:
        try:
            return self._hashes.sha256(path) == expected
        except OSError:
            return False

    @staticmethod
    def _same_size_files(folder: Path, size: int) -> list[Path]:
        """Regular files of `folder` (recursive, sorted, top-level first) whose size is `size`, without the
        '.part' files of running downloads. Unreadable entries are skipped."""
        found: list[Path] = []
        for root, dirnames, filenames in os.walk(folder):
            dirnames.sort(key=str.casefold)
            for name in sorted(filenames, key=str.casefold):
                if name.casefold().endswith(PART_SUFFIX):
                    continue
                path = Path(root, name)
                if _regular_file_size(path) == size:
                    found.append(path)
        return found

