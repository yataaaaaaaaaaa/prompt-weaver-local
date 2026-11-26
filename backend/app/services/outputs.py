"""Generated outputs: <output_dir>/<10-digit id>.png + .json, app-managed trash, and cached thumbnails of the output
pictures (<output_thumbnails_dir>/<id>.webp, derived data rebuilt whenever it is missing or older than its picture)."""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Any

from PIL import Image

from ..schemas import OUTPUT_ID_PATTERN, OutputRecord
from ..settings import AppPaths
from .json_files import path_lock, read_json, write_json_atomic
from .pictures import fit_within, save_picture_atomic

_OUTPUT_ID_RE = re.compile(OUTPUT_ID_PATTERN, re.ASCII)
_IMAGE_SUFFIX = ".png"
_METADATA_SUFFIX = ".json"
_OUTPUT_ID_WIDTH = 10
_THUMBNAIL_SUFFIX = ".webp"
# Longest side of an output thumbnail (the Create section's filmstrip): sharp at 2x on a 96 px tile.
OUTPUT_THUMBNAIL_MAX_SIDE = 256
_THUMBNAIL_QUALITY = 82


class OutputNotFound(LookupError):
    pass


def _require_valid_id(output_id: str) -> str:
    if not _OUTPUT_ID_RE.fullmatch(output_id):
        raise ValueError(f"Invalid output id {output_id!r}.")
    return output_id


def _stems_by_suffix(folder: Path) -> dict[str, set[str]]:
    """{'.png': {stems}, '.json': {stems}} of the files in `folder`, from directory entries only."""
    stems: dict[str, set[str]] = {_IMAGE_SUFFIX: set(), _METADATA_SUFFIX: set()}
    try:
        entries = list(os.scandir(folder))
    except FileNotFoundError:
        return stems
    for entry in entries:
        stem, dot, suffix = entry.name.rpartition(".")
        if not dot:
            continue
        bucket = stems.get(f".{suffix.lower()}")
        if bucket is not None and entry.is_file():
            bucket.add(stem)
    return stems


class OutputRepository:
    def __init__(self, paths: AppPaths) -> None:
        self._paths = paths

    def _file(self, output_id: str, suffix: str, *, in_trash: bool = False) -> Path:
        folder = self._paths.trash_dir if in_trash else self._paths.output_dir
        return folder / f"{_require_valid_id(output_id)}{suffix}"

    def list_ids(self) -> list[str]:
        """Ids with both .png and .json in the output dir, ascending (reads file names only)."""
        stems = _stems_by_suffix(self._paths.output_dir)
        complete = stems[_IMAGE_SUFFIX] & stems[_METADATA_SUFFIX]
        return sorted(stem for stem in complete if _OUTPUT_ID_RE.fullmatch(stem))

    def latest_id(self) -> str | None:
        ids = self.list_ids()
        return ids[-1] if ids else None

    def load(self, output_id: str) -> OutputRecord:
        """Metadata of one output. Raises OutputNotFound."""
        try:
            payload = read_json(self._file(output_id, _METADATA_SUFFIX))
        except FileNotFoundError as exc:
            raise OutputNotFound(output_id) from exc
        return OutputRecord.model_validate(payload)

    def image_path(self, output_id: str) -> Path:
        """Path of the PNG. Raises OutputNotFound."""
        path = self._file(output_id, _IMAGE_SUFFIX)
        if not path.is_file():
            raise OutputNotFound(output_id)
        return path

    def thumbnail_path(self, output_id: str) -> Path:
        """Path of the output's thumbnail (WebP, at most OUTPUT_THUMBNAIL_MAX_SIDE on its longest side), made from its
        picture when missing or older than the picture (an id reused after the trash was emptied gets a new one).
        Raises OutputNotFound when the output has no picture."""
        source = self.image_path(output_id)
        target = self._paths.output_thumbnails_dir / f"{output_id}{_THUMBNAIL_SUFFIX}"
        with path_lock(target):
            if not _is_up_to_date(target, source):
                with Image.open(source) as picture:
                    thumbnail = fit_within(picture.convert("RGB"), OUTPUT_THUMBNAIL_MAX_SIDE)
                save_picture_atomic(thumbnail, target, format="WEBP", quality=_THUMBNAIL_QUALITY)
        return target

    def next_id(self) -> str:
        """max(numeric ids in output dir and trash) + 1, zero-padded to 10 digits.

        Lone .json files count too, so a new output never overwrites an orphaned metadata file."""
        current_max = 0
        for folder in (self._paths.output_dir, self._paths.trash_dir):
            for bucket in _stems_by_suffix(folder).values():
                for stem in bucket:
                    if stem.isascii() and stem.isdigit():
                        current_max = max(current_max, int(stem))
        return f"{current_max + 1:0{_OUTPUT_ID_WIDTH}d}"

    def save(self, image: Image.Image, metadata: dict[str, Any]) -> OutputRecord:
        """Write <id>.png and <id>.json (adds image_path/metadata_path)."""
        output_id = metadata["output_id"]
        image_path = self._file(output_id, _IMAGE_SUFFIX)
        metadata_path = self._file(output_id, _METADATA_SUFFIX)
        image_path.parent.mkdir(parents=True, exist_ok=True)
        image.save(image_path, format="PNG")
        payload = {**metadata, "image_path": str(image_path), "metadata_path": str(metadata_path)}
        write_json_atomic(metadata_path, payload)
        return OutputRecord.model_validate(payload)

    def trash(self, output_id: str) -> None:
        """Move png+json into the trash dir. Raises OutputNotFound when neither file exists."""
        self._move(output_id, to_trash=True)

    def restore(self, output_id: str) -> None:
        """Move png+json back from the trash dir. Raises OutputNotFound when neither file is in the trash."""
        self._move(output_id, to_trash=False)

    def _move(self, output_id: str, *, to_trash: bool) -> None:
        moves = [
            (self._file(output_id, suffix, in_trash=not to_trash), self._file(output_id, suffix, in_trash=to_trash))
            for suffix in (_IMAGE_SUFFIX, _METADATA_SUFFIX)
        ]
        present = [(source, target) for source, target in moves if source.is_file()]
        if not present:
            raise OutputNotFound(output_id)
        for source, target in present:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))


def _is_up_to_date(derived: Path, source: Path) -> bool:
    """`derived` exists and was written after `source` was last modified."""
    try:
        return derived.stat().st_mtime_ns >= source.stat().st_mtime_ns
    except FileNotFoundError:
        return False
