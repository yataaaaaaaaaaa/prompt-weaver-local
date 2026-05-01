import json
from pathlib import Path

from app.storage import Storage


def test_storage_loads_new_sidecar_when_write_was_interrupted(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("PROMPT_WEAVER_DATA_DIR", str(tmp_path))
    from app import settings as settings_module

    settings_module.get_paths.cache_clear()
    storage = Storage()

    state_path = storage.paths.state_file
    new_path = state_path.with_name(f"{state_path.name}.new")
    payload = storage.load_state().model_dump(mode="json")
    payload["width"] = 1536
    new_path.write_text(json.dumps(payload), encoding="utf-8")

    loaded = storage.load_state()
    assert loaded.width == 1536
    assert not new_path.exists()

    settings_module.get_paths.cache_clear()
