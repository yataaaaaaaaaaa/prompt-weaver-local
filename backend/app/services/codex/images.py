"""The pictures a co-writer tool shows Codex (view_images): the frontend names them in its result
(CodexToolResult.images: an output, or a character's reference image), the broker asks this reader for their MCP
content. Each picture is downscaled with THE picture rule (services/pictures.py fit_within) to at most
TOOL_IMAGE_MAX_SIDE pixels and sent as JPEG after a text block naming it, so Codex can compare scenes and characters
without paying for full-size pictures. A picture that cannot be read becomes a text block saying so (the call still
succeeds). Pure IO on the backend-owned files: nothing is written.
"""

from __future__ import annotations

import base64
import io
import logging
from pathlib import Path
from typing import Any

from PIL import Image, UnidentifiedImageError

from ...schemas import CodexToolImage
from ..characters import CharacterImageNotFound, CharacterNotFound, CharacterStore
from ..outputs import OutputNotFound, OutputRepository
from ..pictures import fit_within

logger = logging.getLogger(__name__)

TOOL_IMAGE_MAX_SIDE = 640
TOOL_IMAGE_MIME_TYPE = "image/jpeg"
_JPEG_QUALITY = 85


class ToolImageReader:
    def __init__(self, *, outputs: OutputRepository, characters: CharacterStore) -> None:
        self._outputs = outputs
        self._characters = characters

    def content(self, images: list[CodexToolImage]) -> list[dict[str, Any]]:
        """The MCP content blocks of the pictures, in order: for each one its label (text), then the picture (image)
        or why it cannot be shown (text)."""
        blocks: list[dict[str, Any]] = []
        for image in images:
            blocks.append({"type": "text", "text": image.label})
            try:
                data = self._jpeg(self._path(image))
            except (OutputNotFound, CharacterNotFound, CharacterImageNotFound, ValueError):
                blocks.append({"type": "text", "text": f"({image.label}: this picture no longer exists.)"})
                continue
            except (OSError, UnidentifiedImageError) as exc:
                logger.warning("A co-writer picture could not be read: %s", exc)
                blocks.append({"type": "text", "text": f"({image.label}: this picture cannot be read.)"})
                continue
            blocks.append({"type": "image", "data": base64.b64encode(data).decode("ascii"), "mimeType": TOOL_IMAGE_MIME_TYPE})
        return blocks

    def _path(self, image: CodexToolImage) -> Path:
        if image.output_id is not None:
            return self._outputs.image_path(image.output_id)
        if image.character_id is not None and image.image_id is not None:
            return self._characters.image_path(image.character_id, image.image_id)
        raise ValueError("No picture named")

    @staticmethod
    def _jpeg(path: Path) -> bytes:
        with Image.open(path) as picture:
            fitted = fit_within(picture.convert("RGB"), TOOL_IMAGE_MAX_SIDE)
        buffer = io.BytesIO()
        fitted.save(buffer, format="JPEG", quality=_JPEG_QUALITY)
        return buffer.getvalue()
