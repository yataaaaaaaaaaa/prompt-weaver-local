from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import BaseModel


class AppPaths(BaseModel):
    root: Path
    state_file: Path
    library_file: Path
    output_dir: Path
    trash_dir: Path
    prompt_lora_dir: Path
    prompt_embedding_dir: Path


DEFAULT_WINDOWS_DATA_DIR = Path(r"D:\Anything\storage\prompt-weaver-local-storage")
DEFAULT_PROMPT_LORA_DIR = Path(r"D:\Anything\ComfyUI\ComfyUI\models\loras")
DEFAULT_PROMPT_EMBEDDING_DIR = Path(r"D:\Anything\ComfyUI\ComfyUI\models\embeddings")


@lru_cache(maxsize=1)
def get_paths() -> AppPaths:
    override = os.environ.get("PROMPT_WEAVER_DATA_DIR")
    if override:
        root = Path(override)
    elif os.name == "nt":
        root = DEFAULT_WINDOWS_DATA_DIR
    else:
        root = Path(__file__).resolve().parents[2] / ".prompt_weaver_local_data"

    root.mkdir(parents=True, exist_ok=True)
    output_dir = root / "output"
    trash_dir = root / "trash"
    output_dir.mkdir(parents=True, exist_ok=True)
    trash_dir.mkdir(parents=True, exist_ok=True)

    return AppPaths(
        root=root,
        state_file=root / "app_state.json",
        library_file=root / "library.json",
        output_dir=output_dir,
        trash_dir=trash_dir,
        prompt_lora_dir=DEFAULT_PROMPT_LORA_DIR,
        prompt_embedding_dir=DEFAULT_PROMPT_EMBEDDING_DIR,
    )
