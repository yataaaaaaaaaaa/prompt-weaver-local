"""Filesystem locations and shared dev config. Single owner of the data directory layout and of the model
folders (download targets of the model library, also used to resolve inline prompt LoRAs and embeddings)."""

from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import BaseModel

from .schemas import ModelDirs, ModelKind

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_CONFIG_FILE = REPO_ROOT / "config" / "defaults.json"

DATA_DIR_ENV = "PROMPT_WEAVER_DATA_DIR"
DEFAULT_WINDOWS_DATA_DIR = Path(r"D:\Anything\storage\prompt-weaver-local-storage")

# ComfyUI models folder: checkpoints, LoRAs and embeddings live in its sub-folders (MODEL_KIND_SUBDIRS).
DEFAULT_MODELS_ROOT = Path(r"D:\Anything\ComfyUI\ComfyUI\models")
MODEL_KIND_SUBDIRS: dict[ModelKind, str] = {
    "checkpoint": "checkpoints",
    "lora": "loras",
    "embedding": "embeddings",
}
# IP-Adapter files (character reference images), ComfyUI folders too: the adapters and their CLIP vision encoders.
IP_ADAPTER_SUBDIR = "ipadapter"
IMAGE_ENCODER_SUBDIR = "clip_vision"


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
    # Backend-only settings (provider API tokens). Never sent to the frontend in clear.
    settings_file: Path
    # Derived data that can be rebuilt at any time (e.g. the file hash cache).
    cache_dir: Path
    # Image library favorites (services/image_favorites.py).
    image_favorites_file: Path
    # Characters (services/characters.py): characters_file + one PNG per character image in character_images_dir.
    characters_dir: Path
    characters_file: Path
    character_images_dir: Path
    models_root: Path
    checkpoint_dir: Path
    # LoRA folder: download target of LoRAs and the folder inline <lora:name:weight> tags resolve against.
    prompt_lora_dir: Path
    # Embedding folder: download target of embeddings and the folder `embedding:name` resolves against.
    prompt_embedding_dir: Path
    # IP-Adapter weights and their image encoders (services/ip_adapters.py: found there, downloaded there).
    ip_adapter_dir: Path
    image_encoder_dir: Path

    @classmethod
    def for_root(cls, root: Path, *, models_root: Path | None = None) -> "AppPaths":
        """Pure path computation; performs no IO (see ensure_dirs). `models_root` defaults to DEFAULT_MODELS_ROOT,
        read at call time (tests/conftest.py points it at a temp dir for every test)."""
        if models_root is None:
            models_root = DEFAULT_MODELS_ROOT
        return cls(
            root=root,
            state_file=root / "app_state.json",
            library_file=root / "library.json",
            output_dir=root / "output",
            trash_dir=root / "trash",
            stores_dir=root / "stores",
            settings_file=root / "backend_settings.json",
            cache_dir=root / "cache",
            image_favorites_file=root / "image_favorites.json",
            characters_dir=root / "characters",
            characters_file=root / "characters" / "characters.json",
            character_images_dir=root / "characters" / "images",
            models_root=models_root,
            checkpoint_dir=models_root / MODEL_KIND_SUBDIRS["checkpoint"],
            prompt_lora_dir=models_root / MODEL_KIND_SUBDIRS["lora"],
            prompt_embedding_dir=models_root / MODEL_KIND_SUBDIRS["embedding"],
            ip_adapter_dir=models_root / IP_ADAPTER_SUBDIR,
            image_encoder_dir=models_root / IMAGE_ENCODER_SUBDIR,
        )

    def model_dir(self, kind: ModelKind) -> Path:
        """Folder holding (and receiving downloads of) models of `kind`."""
        return {
            "checkpoint": self.checkpoint_dir,
            "lora": self.prompt_lora_dir,
            "embedding": self.prompt_embedding_dir,
        }[kind]

    def model_dirs(self) -> ModelDirs:
        return ModelDirs(
            checkpoint=str(self.checkpoint_dir),
            lora=str(self.prompt_lora_dir),
            embedding=str(self.prompt_embedding_dir),
        )

    def ensure_dirs(self) -> None:
        """Creates the data directories. The model folders are created on demand by the downloads, the characters
        folders by the first character write."""
        for directory in (self.root, self.output_dir, self.trash_dir, self.stores_dir, self.cache_dir):
            directory.mkdir(parents=True, exist_ok=True)


def resolve_data_root() -> Path:
    override = os.environ.get(DATA_DIR_ENV)
    if override:
        return Path(override)
    if os.name == "nt":
        return DEFAULT_WINDOWS_DATA_DIR
    return REPO_ROOT / ".prompt_weaver_local_data"
