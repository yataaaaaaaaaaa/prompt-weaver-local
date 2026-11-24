"""Filesystem locations and shared dev config. Single owner of the data directory layout."""

from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import BaseModel

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_CONFIG_FILE = REPO_ROOT / "config" / "defaults.json"

DATA_DIR_ENV = "PROMPT_WEAVER_DATA_DIR"
DEFAULT_WINDOWS_DATA_DIR = Path(r"D:\Anything\storage\prompt-weaver-local-storage")
DEFAULT_PROMPT_LORA_DIR = Path(r"D:\Anything\ComfyUI\ComfyUI\models\loras")
DEFAULT_PROMPT_EMBEDDING_DIR = Path(r"D:\Anything\ComfyUI\ComfyUI\models\embeddings")


class SharedConfig(BaseModel):
    """config/defaults.json (also read by the launcher and the frontend tooling)."""

    host: str
    backendPort: int
    frontendPort: int


def load_shared_config() -> SharedConfig:
    return SharedConfig.model_validate(json.loads(SHARED_CONFIG_FILE.read_text(encoding="utf-8")))


class AppPaths(BaseModel):
    root: Path
    state_file: Path
    library_file: Path
    output_dir: Path
    trash_dir: Path
    stores_dir: Path
    prompt_lora_dir: Path
    prompt_embedding_dir: Path

    @classmethod
    def for_root(
        cls,
        root: Path,
        *,
        prompt_lora_dir: Path = DEFAULT_PROMPT_LORA_DIR,
        prompt_embedding_dir: Path = DEFAULT_PROMPT_EMBEDDING_DIR,
    ) -> "AppPaths":
        """Pure path computation; performs no IO (see ensure_dirs)."""
        return cls(
            root=root,
            state_file=root / "app_state.json",
            library_file=root / "library.json",
            output_dir=root / "output",
            trash_dir=root / "trash",
            stores_dir=root / "stores",
            prompt_lora_dir=prompt_lora_dir,
            prompt_embedding_dir=prompt_embedding_dir,
        )

    def ensure_dirs(self) -> None:
        for directory in (self.root, self.output_dir, self.trash_dir, self.stores_dir):
            directory.mkdir(parents=True, exist_ok=True)


def resolve_data_root() -> Path:
    override = os.environ.get(DATA_DIR_ENV)
    if override:
        return Path(override)
    if os.name == "nt":
        return DEFAULT_WINDOWS_DATA_DIR
    return REPO_ROOT / ".prompt_weaver_local_data"

