"""Deterministic synthetic pictures for the e2e backend: the fake generator's outputs, the seeded outputs, the
character images and the synthetic Civitai images. Same key -> same pixels (stable visual baselines); different
keys -> clearly different pictures (navigation is visible)."""

from __future__ import annotations

import colorsys
import hashlib
import io

from PIL import Image, ImageDraw

# Long side of every synthetic picture: big enough to look like an image, small enough to stay fast.
MAX_SIDE = 512


def _fit(width: int, height: int) -> tuple[int, int]:
    width, height = max(width, 1), max(height, 1)
    scale = min(1.0, MAX_SIDE / max(width, height))
    return max(int(width * scale), 16), max(int(height * scale), 16)


def _rgb(hue: float, saturation: float, value: float) -> tuple[int, int, int]:
    red, green, blue = colorsys.hsv_to_rgb(hue % 1.0, saturation, value)
    return int(red * 255), int(green * 255), int(blue * 255)


def picture(key: str, width: int = 512, height: int = 512, *, label: str | None = None) -> Image.Image:
    """A vertical two-color gradient with a few discs, hues derived from `key`, optionally labelled."""
    digest = hashlib.sha256(key.encode("utf-8")).digest()
    width, height = _fit(width, height)
    hue = digest[0] / 255
    top, bottom = _rgb(hue, 0.55, 0.95), _rgb(hue + 0.18, 0.75, 0.45)
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / max(height - 1, 1)
        draw.line([(0, y), (width, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    for index in range(4):
        cx = digest[1 + index] / 255 * width
        cy = digest[5 + index] / 255 * height
        radius = (0.08 + digest[9 + index] / 255 * 0.18) * min(width, height)
        draw.ellipse(
            [cx - radius, cy - radius, cx + radius, cy + radius],
            fill=_rgb(hue + 0.4 + index * 0.12, 0.6, 0.85),
            outline=(255, 255, 255),
            width=2,
        )
    if label:
        draw.rectangle([0, height - 22, width, height], fill=(0, 0, 0))
        draw.text((6, height - 18), label[:60], fill=(255, 255, 255))
    return image


def png_bytes(key: str, width: int = 512, height: int = 512, *, label: str | None = None) -> bytes:
    buffer = io.BytesIO()
    picture(key, width, height, label=label).save(buffer, format="PNG")
    return buffer.getvalue()


def jpeg_bytes(key: str, width: int = 512, height: int = 512) -> bytes:
    buffer = io.BytesIO()
    picture(key, width, height).save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()
