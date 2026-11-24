from pathlib import Path

import pytest

import run_backend
from app import settings
from app.settings import AppPaths


def test_for_root_computes_the_layout_without_io(tmp_path: Path) -> None:
    root = tmp_path / "not-created"
    models = tmp_path / "models-not-created"

    paths = AppPaths.for_root(root, models_root=models)

    assert paths.state_file == root / "app_state.json"
    assert paths.library_file == root / "library.json"
    assert paths.output_dir == root / "output"
    assert paths.trash_dir == root / "trash"
    assert paths.stores_dir == root / "stores"
    assert paths.settings_file == root / "backend_settings.json"
    assert paths.cache_dir == root / "cache"
    assert paths.models_root == models
    assert paths.checkpoint_dir == models / "checkpoints"
    assert paths.prompt_lora_dir == models / "loras"
    assert paths.prompt_embedding_dir == models / "embeddings"
    assert paths.characters_dir == root / "characters"
    assert paths.characters_file == root / "characters" / "characters.json"
    assert paths.character_images_dir == root / "characters" / "images"
    assert paths.ip_adapter_dir == models / "ipadapter"
    assert paths.image_encoder_dir == models / "clip_vision"
    assert not root.exists()
    assert not models.exists()


def test_model_dirs_follow_the_model_kind(tmp_path: Path) -> None:
    paths = AppPaths.for_root(tmp_path, models_root=tmp_path / "models")

    assert paths.model_dir("checkpoint") == paths.checkpoint_dir
    assert paths.model_dir("lora") == paths.prompt_lora_dir
    assert paths.model_dir("embedding") == paths.prompt_embedding_dir
    assert paths.model_dirs().model_dump() == {
        "checkpoint": str(paths.checkpoint_dir),
        "lora": str(paths.prompt_lora_dir),
        "embedding": str(paths.prompt_embedding_dir),
    }


def test_the_default_model_folders_are_read_at_call_time_and_isolated_in_tests(tmp_path: Path) -> None:
    paths = AppPaths.for_root(Path("unused"))

    # conftest.py points DEFAULT_MODELS_ROOT (the ComfyUI models folder) at a temp dir for every test.
    assert paths.models_root == settings.DEFAULT_MODELS_ROOT == tmp_path / "default-models"
    assert paths.checkpoint_dir == settings.DEFAULT_MODELS_ROOT / "checkpoints"


def test_ensure_dirs_creates_every_data_directory_but_not_the_model_folders(tmp_path: Path) -> None:
    paths = AppPaths.for_root(tmp_path / "data", models_root=tmp_path / "models")

    paths.ensure_dirs()
    paths.ensure_dirs()  # idempotent

    for directory in (paths.root, paths.output_dir, paths.trash_dir, paths.stores_dir, paths.cache_dir):
        assert directory.is_dir()
    assert not paths.state_file.exists()
    assert not paths.models_root.exists()


def test_data_root_honors_the_env_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv(settings.DATA_DIR_ENV, str(tmp_path / "elsewhere"))

    assert settings.resolve_data_root() == tmp_path / "elsewhere"


def test_shared_config_reads_config_defaults_json() -> None:
    config = settings.load_shared_config()

    assert config.host
    assert 0 < config.backendPort < 65536
    assert 0 < config.frontendPort < 65536
    assert config.backendPort != config.frontendPort


def test_run_backend_defaults_come_from_the_shared_config() -> None:
    config = settings.load_shared_config()

    defaults = run_backend.parse_args([])
    assert (defaults.host, defaults.port) == (config.host, config.backendPort)
    overridden = run_backend.parse_args(["--host", "0.0.0.0", "--port", "9000"])
    assert (overridden.host, overridden.port) == ("0.0.0.0", 9000)
