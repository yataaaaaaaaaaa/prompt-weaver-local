"""Story export: one self-contained HTML picture book (StoryStore.export_html, GET /api/stories/{story_id}/export).

Every scene is a page, in reading order: its chosen illustration (embedded as a JPEG data URI, at most
EXPORT_PICTURE_MAX_SIDE on its longest side: services/pictures.py fit_within), its title and its text (line breaks
kept). A scene without an illustration, or whose picture is gone or unreadable, shows its text only. The document
needs nothing else: no external file, script or font; it follows the reader's light or dark color scheme and prints
one scene per page. Every text is HTML-escaped.
"""

from __future__ import annotations

import base64
import html
import io
from collections.abc import Callable
from pathlib import Path

from PIL import Image

from ..schemas import Scene, Story
from .pictures import fit_within

EXPORT_PICTURE_MAX_SIDE = 1600
EXPORT_JPEG_QUALITY = 88
GENERATOR_NAME = "Prompt Weaver Local"

# The picture book's look: system colors (light and dark), the Segoe UI stack of the app, one scene per printed page.
_STYLE = """
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", system-ui, -apple-system, sans-serif; line-height: 1.5;
  background: Canvas; color: CanvasText; }
header { padding: 48px 24px 24px; text-align: center; }
h1 { margin: 0; font-size: 2.25rem; font-weight: 600; }
.count { margin: 8px 0 0; opacity: 0.7; }
main { max-width: 1100px; margin: 0 auto; padding: 0 24px 48px; }
.page { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 32px; align-items: center;
  padding: 32px 0; border-top: 1px solid color-mix(in srgb, CanvasText 15%, transparent); }
.page.text-only { grid-template-columns: minmax(0, 1fr); }
figure { margin: 0; }
figure img { display: block; width: 100%; height: auto; max-height: 80vh; object-fit: contain; border-radius: 8px; }
.number { margin: 0; font-size: 0.875rem; opacity: 0.7; }
h2 { margin: 4px 0 12px; font-size: 1.5rem; font-weight: 600; }
.text { margin: 0; white-space: pre-wrap; font-size: 1.0625rem; }
footer { padding: 24px; text-align: center; font-size: 0.875rem; opacity: 0.6; }
@media (max-width: 720px) { .page { grid-template-columns: minmax(0, 1fr); } }
@media print { header, .page { break-after: page; } .page { border-top: none; } footer { display: none; } }
"""


def picture_data_uri(path: Path) -> str | None:
    """The picture at `path` as a JPEG data URI (downscaled to EXPORT_PICTURE_MAX_SIDE); None when it cannot be read."""
    try:
        with Image.open(path) as opened:
            picture = fit_within(opened.convert("RGB"), EXPORT_PICTURE_MAX_SIDE)
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", quality=EXPORT_JPEG_QUALITY)
    return f"data:image/jpeg;base64,{base64.b64encode(buffer.getvalue()).decode('ascii')}"


def _scene_page(scene: Scene, number: int, total: int, illustration: str | None) -> str:
    title = html.escape(scene.title)
    figure = (
        f'<figure><img src="{illustration}" alt="{html.escape(f"Illustration of {scene.title}", quote=True)}"></figure>'
        if illustration
        else ""
    )
    text = f'<p class="text">{html.escape(scene.text)}</p>' if scene.text.strip() else ""
    classes = "page" if illustration else "page text-only"
    return (
        f'<section class="{classes}" id="scene-{number}" aria-label="{html.escape(f"Page {number} of {total}", quote=True)}">'
        f'{figure}<div><p class="number">{number} / {total}</p><h2>{title}</h2>{text}</div></section>'
    )


def render_story_html(story: Story, illustration_path: Callable[[str], Path | None]) -> str:
    """The HTML document of `story`. `illustration_path(output_id)`: the picture file of an output, None when it is
    gone."""
    total = len(story.scenes)
    pages: list[str] = []
    for number, scene in enumerate(story.scenes, start=1):
        path = illustration_path(scene.chosen_output_id) if scene.chosen_output_id else None
        pages.append(_scene_page(scene, number, total, picture_data_uri(path) if path is not None else None))
    title = html.escape(story.title)
    count = f"{total} scene" if total == 1 else f"{total} scenes"
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f'<meta name="generator" content="{GENERATOR_NAME}">\n'
        f"<title>{title}</title>\n<style>{_STYLE}</style>\n</head>\n<body>\n"
        f'<header><h1>{title}</h1><p class="count">{count}</p></header>\n'
        f"<main>\n{chr(10).join(pages)}\n</main>\n"
        f"<footer>Made with {GENERATOR_NAME}</footer>\n</body>\n</html>\n"
    )
