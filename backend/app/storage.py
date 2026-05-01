from __future__ import annotations

import base64
from io import BytesIO
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from PIL import Image

from .schemas import AppState, LibraryState, OutputRecord, OutputSummary
from .settings import get_paths


DEFAULT_LIBRARY = {
    "models": [],
    "loras": [],
}


DEFAULT_STATE = {
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
    "forbidden_rules": [],
    "last_model_id": None,
    "last_lora_ids": [],
    "last_model_dir": None,
    "last_lora_dir": None,
    "width": 1024,
    "height": 1024,
    "steps": 30,
    "guidance_scale": 7.0,
    "prompt_seed": None,
    "seed": None,
    "seed_mode": "manual",
    "seed_advance_mode": "keep",
    "prompt_seed_behavior": "fixed",
    "image_seed_behavior": "fixed",
    "negative_prompt": "",
    "workspace": {
        "image": {"x": 420, "y": 24, "width": 760, "height": 760, "z_index": 3},
        "controls": {"x": 24, "y": 24, "width": 420, "height": 720, "z_index": 4},
        "details": {"x": 1210, "y": 24, "width": 360, "height": 780, "z_index": 5},
        "used": {"x": 690, "y": 320, "width": 790, "height": 420, "z_index": 6},
    },
    "editor": {
        "overlays_hidden": False,
        "visibility_mode": "all",
        "selected_category_id": None,
        "selected_prompt_id": None,
        "editing_target": {"kind": "none", "category_id": None, "prompt_id": None},
    },
    "last_output_id": None,
}


class Storage:
    def __init__(self) -> None:
        self.paths = get_paths()
        self._ensure_files_exist()

    def _ensure_files_exist(self) -> None:
        self.paths.root.mkdir(parents=True, exist_ok=True)
        self.paths.output_dir.mkdir(parents=True, exist_ok=True)
        self.paths.trash_dir.mkdir(parents=True, exist_ok=True)

    def _sidecar_paths(self, path: Path) -> tuple[Path, Path]:
        return (path.with_name(f"{path.name}.new"), path.with_name(f"{path.name}.old"))

    def _cleanup_sidecars(self, path: Path, keep: Path | None = None) -> None:
        new_path, old_path = self._sidecar_paths(path)
        for candidate in (new_path, old_path):
            if keep is not None and candidate == keep:
                continue
            if candidate.exists():
                candidate.unlink(missing_ok=True)

    def _read_json(self, path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    def _load_resilient_json(self, path: Path) -> dict[str, Any] | None:
        new_path, old_path = self._sidecar_paths(path)
        candidates = [candidate for candidate in (path, new_path, old_path) if candidate.exists()]
        parsed: list[tuple[float, Path, dict[str, Any]]] = []
        for candidate in candidates:
            try:
                payload = self._read_json(candidate)
            except Exception:
                continue
            parsed.append((candidate.stat().st_mtime, candidate, payload))

        if not parsed:
            return None

        parsed.sort(key=lambda item: item[0], reverse=True)
        _, winning_path, winning_payload = parsed[0]
        if winning_path != path:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(winning_payload, indent=2, ensure_ascii=False), encoding="utf-8")
        self._cleanup_sidecars(path)
        return winning_payload

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        new_path, old_path = self._sidecar_paths(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        new_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        old_path.unlink(missing_ok=True)
        if path.exists():
            path.replace(old_path)
        new_path.replace(path)
        old_path.unlink(missing_ok=True)

    def load_state(self) -> AppState:
        payload = self._load_resilient_json(self.paths.state_file)
        if payload is None:
            payload = DEFAULT_STATE
        return AppState.model_validate(payload)

    def save_state(self, state: AppState) -> AppState:
        self._write_json(self.paths.state_file, state.model_dump(mode="json"))
        return state

    def load_library(self) -> LibraryState:
        payload = self._load_resilient_json(self.paths.library_file)
        if payload is None:
            payload = DEFAULT_LIBRARY
        return LibraryState.model_validate(payload)

    def save_library(self, library: LibraryState) -> LibraryState:
        self._write_json(self.paths.library_file, library.model_dump(mode="json"))
        return library

    def _numeric_output_ids(self) -> list[int]:
        ids: list[int] = []
        for folder in (self.paths.output_dir, self.paths.trash_dir):
            for image_path in folder.glob("*.png"):
                if image_path.stem.isdigit():
                    ids.append(int(image_path.stem))
        return ids

    def next_output_id(self) -> str:
        current_max = max(self._numeric_output_ids(), default=0)
        return f"{current_max + 1:010d}"

    def _summary_from_metadata(self, payload: dict[str, Any]) -> OutputSummary:
        return OutputSummary.model_validate(
            {
                "output_id": payload["output_id"],
                "image_path": payload["image_path"],
                "metadata_path": payload["metadata_path"],
                "generated_at": payload["generated_at"],
                "prompt": payload["prompt"],
                "seed": payload["seed"],
                "width": payload["width"],
                "height": payload["height"],
            }
        )

    def _metadata_path(self, output_id: str, in_trash: bool = False) -> Path:
        root = self.paths.trash_dir if in_trash else self.paths.output_dir
        return root / f"{output_id}.json"

    def _image_path(self, output_id: str, in_trash: bool = False) -> Path:
        root = self.paths.trash_dir if in_trash else self.paths.output_dir
        return root / f"{output_id}.png"

    def list_outputs(self) -> list[OutputSummary]:
        summaries: list[OutputSummary] = []
        for metadata_path in sorted(self.paths.output_dir.glob("*.json")):
            payload = self._read_json(metadata_path)
            try:
                summaries.append(self._summary_from_metadata(payload))
            except Exception:
                continue
        summaries.sort(key=lambda item: item.output_id)
        return summaries

    def load_output(self, output_id: str) -> OutputRecord:
        metadata = self._read_json(self._metadata_path(output_id))
        image_path = self._image_path(output_id)
        image_base64 = None
        if image_path.exists():
            with Image.open(image_path) as image:
                image_base64 = self._image_to_base64(image.copy())
        metadata["image_base64"] = image_base64
        return OutputRecord.model_validate(metadata)

    def save_output(self, image: Image.Image, metadata: dict[str, Any]) -> OutputRecord:
        output_id = metadata["output_id"]
        image_path = self._image_path(output_id)
        metadata_path = self._metadata_path(output_id)
        image.save(image_path)
        payload = {
            **metadata,
            "image_path": str(image_path),
            "metadata_path": str(metadata_path),
        }
        self._write_json(metadata_path, payload)
        payload["image_base64"] = self._image_to_base64(image)
        return OutputRecord.model_validate(payload)


    @staticmethod
    def _image_to_base64(image: Image.Image) -> str:
        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode("ascii")

    def delete_output(self, output_id: str) -> None:
        image_path = self._image_path(output_id)
        metadata_path = self._metadata_path(output_id)
        trash_image_path = self._image_path(output_id, in_trash=True)
        trash_metadata_path = self._metadata_path(output_id, in_trash=True)
        if image_path.exists():
            shutil.move(str(image_path), str(trash_image_path))
        if metadata_path.exists():
            shutil.move(str(metadata_path), str(trash_metadata_path))

    def restore_output(self, output_id: str) -> None:
        image_path = self._image_path(output_id)
        metadata_path = self._metadata_path(output_id)
        trash_image_path = self._image_path(output_id, in_trash=True)
        trash_metadata_path = self._metadata_path(output_id, in_trash=True)
        if trash_image_path.exists():
            shutil.move(str(trash_image_path), str(image_path))
        if trash_metadata_path.exists():
            shutil.move(str(trash_metadata_path), str(metadata_path))

    def latest_output(self) -> OutputRecord | None:
        outputs = self.list_outputs()
        if not outputs:
            return None
        return self.load_output(outputs[-1].output_id)

    @staticmethod
    def utcnow_iso() -> str:
        return datetime.now(timezone.utc).isoformat()
