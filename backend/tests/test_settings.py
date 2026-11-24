from pathlib import Path

import pytest

import run_backend
from app import settings
from app.settings import AppPaths


def test_for_root_computes_the_layout_without_io(tmp_path: Path) -> None:
    root = tmp_path / "not-created"

    paths = AppPaths.for_root(root)

    assert paths.state_file == root / "app_state.json"
    assert paths.library_file == root / "library.json"
    assert paths.output_dir == root / "output"
    assert paths.trash_dir == root / "trash"
    assert paths.stores_dir == root / "stores"
    assert not root.exists()


def test_ensure_dirs_creates_every_data_directory(tmp_path: Path) -> None:
    paths = AppPaths.for_root(tmp_path / "data")

    paths.ensure_dirs()
    paths.ensure_dirs()  # idempotent

    for directory in (paths.root, paths.output_dir, paths.trash_dir, paths.stores_dir):
        assert directory.is_dir()
    assert not paths.state_file.exists()


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
