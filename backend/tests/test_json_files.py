import json
import os
from pathlib import Path

from app.services.json_files import read_resilient_json, write_json_atomic


def test_resilient_read_promotes_newer_sidecar_after_interrupted_write(tmp_path: Path) -> None:
    state_path = tmp_path / "app_state.json"
    write_json_atomic(state_path, {"width": 1024})
    new_path = state_path.with_name(f"{state_path.name}.new")
    new_path.write_text(json.dumps({"width": 1536}), encoding="utf-8")
    newer = state_path.stat().st_mtime + 10
    os.utime(new_path, (newer, newer))

    assert read_resilient_json(state_path) == {"width": 1536}
    assert not new_path.exists()
    assert json.loads(state_path.read_text(encoding="utf-8")) == {"width": 1536}


def test_resilient_read_returns_none_when_nothing_exists(tmp_path: Path) -> None:
    assert read_resilient_json(tmp_path / "missing.json") is None


def test_resilient_read_skips_corrupt_primary(tmp_path: Path) -> None:
    path = tmp_path / "library.json"
    path.write_text("{not json", encoding="utf-8")
    path.with_name("library.json.old").write_text(json.dumps({"models": []}), encoding="utf-8")

    assert read_resilient_json(path) == {"models": []}
