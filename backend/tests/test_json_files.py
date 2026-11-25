import json
import os
import threading
from pathlib import Path
from typing import Any

import pytest

from app.schemas import PersistedStoreEnvelope
from app.services.json_files import read_resilient_json, sidecar_paths, write_json_atomic
from app.services.persisted_stores import PersistedStoreRepository


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


def test_concurrent_reads_never_break_writes_of_the_same_file(tmp_path: Path) -> None:
    # The stores endpoints run in a thread pool: a GET of a store racing a PUT of the same store used to delete the
    # .new/.old copies the write was using, or (on Windows) make its replace fail while the reader held the file.
    path = tmp_path / "stores" / "workspace-store" / "state.json"
    write_json_atomic(path, {"revision": -1})
    errors: list[BaseException] = []
    reads: list[Any] = []
    stop = threading.Event()

    def writer() -> None:
        try:
            for revision in range(200):
                write_json_atomic(path, {"revision": revision})
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)
        finally:
            stop.set()

    def reader() -> None:
        try:
            while not stop.is_set():
                reads.append(read_resilient_json(path))
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=writer), *(threading.Thread(target=reader) for _ in range(3))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert errors == []
    assert reads, "the readers ran"
    assert all(isinstance(payload, dict) and "revision" in payload for payload in reads)
    assert read_resilient_json(path) == {"revision": 199}
    assert [candidate.exists() for candidate in sidecar_paths(path)] == [False, False]


def test_concurrent_store_reads_and_writes_through_the_repository(tmp_path: Path) -> None:
    repository = PersistedStoreRepository(tmp_path / "stores")
    errors: list[BaseException] = []
    stop = threading.Event()

    def writer() -> None:
        try:
            for revision in range(150):
                repository.write("workspace-store", PersistedStoreEnvelope(state={"revision": revision}, version=0))
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)
        finally:
            stop.set()

    def reader() -> None:
        try:
            while not stop.is_set():
                repository.read("workspace-store")
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=writer), *(threading.Thread(target=reader) for _ in range(3))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    assert errors == []
    envelope = repository.read("workspace-store")
    assert envelope is not None and envelope.state == {"revision": 149}


def test_a_replace_meeting_a_sharing_violation_is_retried(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "library.json"
    write_json_atomic(path, {"models": []})
    real_replace = Path.replace
    failures = {"left": 2}

    def flaky_replace(self: Path, target: Any) -> Path:
        if failures["left"] > 0:
            failures["left"] -= 1
            raise PermissionError(32, "The process cannot access the file because it is being used by another process")
        return real_replace(self, target)

    monkeypatch.setattr(Path, "replace", flaky_replace)
    write_json_atomic(path, {"models": ["a"]})

    assert failures["left"] == 0
    assert read_resilient_json(path) == {"models": ["a"]}


def test_a_lasting_sharing_violation_is_raised(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "library.json"
    write_json_atomic(path, {"models": []})

    def locked_replace(self: Path, target: Any) -> Path:
        raise PermissionError(32, "locked")

    monkeypatch.setattr(Path, "replace", locked_replace)
    monkeypatch.setattr("app.services.json_files._FILE_OP_PAUSE_S", 0)
    with pytest.raises(PermissionError):
        write_json_atomic(path, {"models": ["a"]})
