"""Picture helpers shared by every feature that stores or serves downscaled pictures: character reference images and
thumbnails (services/characters.py) and output thumbnails (services/outputs.py). One downscaling rule for all of them."""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

from .files import remove_quietly


def fit_within(image: Image.Image, max_side: int) -> Image.Image:
    """A copy of `image` downscaled so that neither side exceeds `max_side` (aspect ratio kept, LANCZOS). Never
    upscales: a smaller image is copied as it is."""
    fitted = image.copy()
    fitted.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    return fitted


def save_picture_atomic(image: Image.Image, target: Path, *, format: str, **options: object) -> None:
    """Writes `image` to `<target>.new`, then replaces `target` with it: a reader never sees a half-written file. The
    temporary file is removed when the write fails."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f"{target.name}.new")
    try:
        image.save(temporary, format=format, **options)
        os.replace(temporary, target)
    except BaseException:
        remove_quietly(temporary)
        raise
