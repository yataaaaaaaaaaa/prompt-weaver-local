"""Legacy app_state.json / library.json (read-only; they seed frontend stores on first run)."""

from __future__ import annotations

from typing import Any

from ..schemas import AppState, LibraryState
from ..settings import AppPaths
from .json_files import read_resilient_json

DEFAULT_LIBRARY: dict[str, Any] = {
    "models": [],
    "loras": [],
}


# First run without app_state.json: two sample categories; every other field takes the AppState defaults
# (app/schemas.py is the single owner of those).
DEFAULT_STATE: dict[str, Any] = {
    "categories": [
        {
            "id": "subject",
            "name": "Subject",
            "muted": False,
            "priority": "1",
            "activation_text": "",
            "locked_prompt_id": None,
            "position": {"x": 60, "y": 860},
            "size": {"width": 320, "height": 360},
            "z_index": 50,
            "prompts": [
                {"id": "subject-1", "text": "woman, portrait", "skipped": False, "extra_lora_ids": []},
                {"id": "subject-2", "text": "mecha knight, full body", "skipped": False, "extra_lora_ids": []},
            ],
        },
        {
            "id": "style",
            "name": "Style",
            "muted": False,
            "priority": "2",
            "activation_text": "",
            "locked_prompt_id": None,
            "position": {"x": 400, "y": 860},
            "size": {"width": 320, "height": 360},
            "z_index": 51,
            "prompts": [
                {"id": "style-1", "text": "cinematic lighting, detailed", "skipped": False, "extra_lora_ids": []},
                {"id": "style-2", "text": "pixel art, flat shading", "skipped": False, "extra_lora_ids": []},
            ],
        },
    ],
}


class LegacyStateService:
    def __init__(self, paths: AppPaths) -> None:
        self._paths = paths

    def load_state(self) -> AppState:
        """app_state.json (resilient read) or DEFAULT_STATE."""
        payload = read_resilient_json(self._paths.state_file)
        return AppState.model_validate(DEFAULT_STATE if payload is None else payload)

    def load_library(self) -> LibraryState:
        """library.json (resilient read) or DEFAULT_LIBRARY."""
        payload = read_resilient_json(self._paths.library_file)
        return LibraryState.model_validate(DEFAULT_LIBRARY if payload is None else payload)

    def load_state_for_bootstrap(self, library: LibraryState | None = None) -> AppState:
        """load_state() with LoRA ids absent from the library stripped (last_lora_ids and prompt extra_lora_ids).

        `library` defaults to load_library(); pass it when it is already loaded."""
        if library is None:
            library = self.load_library()
        return strip_missing_lora_references(self.load_state(), library)


def strip_missing_lora_references(state: AppState, library: LibraryState) -> AppState:
    """Copy of `state` without the LoRA ids that are not in `library` (order preserved)."""
    valid_lora_ids = {lora.id for lora in library.loras}
    stripped = state.model_copy(deep=True)
    stripped.last_lora_ids = [lora_id for lora_id in stripped.last_lora_ids if lora_id in valid_lora_ids]
    for category in stripped.categories:
        for prompt in category.prompts:
            prompt.extra_lora_ids = [lora_id for lora_id in prompt.extra_lora_ids if lora_id in valid_lora_ids]
    return stripped
