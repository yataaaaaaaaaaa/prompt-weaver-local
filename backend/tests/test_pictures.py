"""Shared picture helpers (services/pictures.py): one downscaling rule, atomic picture writes."""

from pathlib import Path

import pytest
from PIL import Image

from app.services.pictures import fit_within, save_picture_atomic


def test_fit_within_downscales_the_longest_side_and_keeps_the_aspect_ratio() -> None:
    image = Image.new("RGB", (800, 400))

    fitted = fit_within(image, 200)

    assert fitted.size == (200, 100)
    assert image.size == (800, 400)


def test_fit_within_never_upscales() -> None:
    image = Image.new("RGB", (40, 20))

    fitted = fit_within(image, 200)

    assert fitted.size == (40, 20)
    assert fitted is not image


def test_save_picture_atomic_replaces_the_target(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "picture.webp"
    save_picture_atomic(Image.new("RGB", (4, 4), (255, 0, 0)), target, format="WEBP")
    save_picture_atomic(Image.new("RGB", (8, 2), (0, 255, 0)), target, format="WEBP")

    with Image.open(target) as written:
        assert written.size == (8, 2)
    assert list(target.parent.iterdir()) == [target]


def test_save_picture_atomic_leaves_no_temporary_file_when_the_write_fails(tmp_path: Path) -> None:
    target = tmp_path / "picture.unknown"

    with pytest.raises((KeyError, ValueError, OSError)):
        save_picture_atomic(Image.new("RGB", (4, 4)), target, format="NOT-A-FORMAT")

    assert list(tmp_path.iterdir()) == []
