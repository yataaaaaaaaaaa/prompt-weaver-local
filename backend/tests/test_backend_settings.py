"""BackendSettingsStore: provider API tokens in <data dir>/backend_settings.json."""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

import pytest

from app.services.backend_settings import BackendSettingsStore
from app.settings import AppPaths

TOKEN = "civitai-secret-0123456789abcdef"


@pytest.fixture()
def settings_file(app_paths: AppPaths) -> Path:
    return app_paths.settings_file


@pytest.fixture()
def store(settings_file: Path) -> BackendSettingsStore:
    return BackendSettingsStore(settings_file)


def test_no_file_means_no_token(store: BackendSettingsStore, settings_file: Path) -> None:
    assert store.get_token("civitai") is None
    assert store.has_token("civitai") is False
    assert not settings_file.exists()


def test_set_get_has_and_remove(store: BackendSettingsStore) -> None:
    store.set_token("civitai", TOKEN)

    assert store.get_token("civitai") == TOKEN
    assert store.has_token("civitai") is True
    assert store.get_token("huggingface") is None

    store.set_token("civitai", None)
    assert store.get_token("civitai") is None
    assert store.has_token("civitai") is False


@pytest.mark.parametrize("cleared", [None, "", "   \n"])
def test_none_empty_or_blank_removes_the_token(store: BackendSettingsStore, cleared: str | None) -> None:
    store.set_token("civitai", TOKEN)
    store.set_token("civitai", cleared)

    assert store.has_token("civitai") is False


def test_surrounding_whitespace_is_stripped(store: BackendSettingsStore) -> None:
    store.set_token("civitai", f"  {TOKEN}\n")

    assert store.get_token("civitai") == TOKEN


def test_file_format(store: BackendSettingsStore, settings_file: Path) -> None:
    store.set_token("civitai", TOKEN)
    store.set_token("other", "other-token")
    assert json.loads(settings_file.read_text(encoding="utf-8")) == {
        "version": 1,
        "provider_tokens": {"civitai": TOKEN, "other": "other-token"},
    }

    store.set_token("civitai", None)
    assert json.loads(settings_file.read_text(encoding="utf-8")) == {
        "version": 1,
        "provider_tokens": {"other": "other-token"},
    }


def test_tokens_persist_across_instances(store: BackendSettingsStore, settings_file: Path) -> None:
    store.set_token("civitai", TOKEN)

    reopened = BackendSettingsStore(settings_file)
    assert reopened.get_token("civitai") == TOKEN

    reopened.set_token("civitai", "")
    assert BackendSettingsStore(settings_file).has_token("civitai") is False


def test_reads_an_existing_version_1_file(settings_file: Path) -> None:
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(
        json.dumps({"version": 1, "provider_tokens": {"civitai": f" {TOKEN} ", "blank": " ", "bad": 3}}),
        encoding="utf-8",
    )
    store = BackendSettingsStore(settings_file)

    assert store.get_token("civitai") == TOKEN
    assert store.has_token("blank") is False
    assert store.has_token("bad") is False


@pytest.mark.parametrize(
    "content",
    [
        "{not json",
        "[]",
        json.dumps({"version": 2, "provider_tokens": {"civitai": TOKEN}}),
        json.dumps({"version": 1, "provider_tokens": ["civitai"]}),
    ],
)
def test_corrupt_or_invalid_file_reads_as_empty_and_is_rewritten_on_set(settings_file: Path, content: str) -> None:
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(content, encoding="utf-8")
    store = BackendSettingsStore(settings_file)

    assert store.get_token("civitai") is None

    store.set_token("other", "other-token")
    assert json.loads(settings_file.read_text(encoding="utf-8")) == {
        "version": 1,
        "provider_tokens": {"other": "other-token"},
    }
    assert BackendSettingsStore(settings_file).get_token("other") == "other-token"


def test_concurrent_writers_keep_every_token(store: BackendSettingsStore, settings_file: Path) -> None:
    providers = [f"provider-{index}" for index in range(16)]
    threads = [threading.Thread(target=store.set_token, args=(provider, f"token-{provider}")) for provider in providers]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    reopened = BackendSettingsStore(settings_file)
    assert all(reopened.get_token(provider) == f"token-{provider}" for provider in providers)


def test_the_token_never_appears_in_repr_or_logs(
    store: BackendSettingsStore, settings_file: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)

    store.set_token("civitai", TOKEN)
    store.get_token("civitai")
    store.has_token("civitai")

    assert TOKEN not in repr(store)
    assert TOKEN not in str(store)
    assert TOKEN not in caplog.text
    assert settings_file.name in repr(store)


# ---------------------------------------------------------------------------
# The co-writer's Codex settings (same file)
# ---------------------------------------------------------------------------


def test_codex_settings_default_to_auto_detect_and_the_default_model(store: BackendSettingsStore) -> None:
    assert (store.codex().path, store.codex().model) == (None, None)


def test_codex_settings_are_kept_next_to_the_tokens(store: BackendSettingsStore, settings_file: Path) -> None:
    store.set_token("civitai", TOKEN)
    store.update_codex(path="  C:/Codex/codex.exe ", model="gpt-x")
    store.set_token("other", "other-token")

    assert json.loads(settings_file.read_text(encoding="utf-8")) == {
        "version": 1,
        "provider_tokens": {"civitai": TOKEN, "other": "other-token"},
        "codex": {"path": "C:/Codex/codex.exe", "model": "gpt-x"},
    }
    store.update_codex(model=None)
    assert BackendSettingsStore(settings_file).codex().path == "C:/Codex/codex.exe"
    assert BackendSettingsStore(settings_file).codex().model is None
    store.update_codex(path="")
    assert json.loads(settings_file.read_text(encoding="utf-8")) == {"version": 1, "provider_tokens": {"civitai": TOKEN, "other": "other-token"}}


def test_a_file_written_before_the_codex_settings_loads_unchanged(settings_file: Path) -> None:
    settings_file.parent.mkdir(parents=True, exist_ok=True)
    settings_file.write_text(json.dumps({"version": 1, "provider_tokens": {"civitai": TOKEN}}), encoding="utf-8")

    store = BackendSettingsStore(settings_file)

    assert (store.get_token("civitai"), store.codex().path) == (TOKEN, None)
    store.update_codex(path="D:/codex.exe")
    assert store.get_token("civitai") == TOKEN
