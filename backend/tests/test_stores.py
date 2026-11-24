"""Frontend persisted stores: PersistedStoreRepository and /api/stores/{name}."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.schemas import PersistedStoreEnvelope
from app.services.persisted_stores import PersistedStoreRepository, PersistedStoreUnreadable
from app.settings import AppPaths

from support import write_json_file

# Trimmed copies of what the former Electron file-backed storage wrote.
CURRENT_IMAGE_ENVELOPE = {"state": {"currentName": None}, "version": 0}
CATEGORIES_ENVELOPE = {
    "state": {
        "categories": [
            {"text": "girl frontline", "activation_text": "", "priority": 1, "state": "skip", "subPrompts": []}
        ]
    },
    "version": 0,
}


@pytest.fixture()
def stores_dir(app_paths: AppPaths) -> Path:
    return app_paths.stores_dir


@pytest.fixture()
def repository(stores_dir: Path) -> PersistedStoreRepository:
    return PersistedStoreRepository(stores_dir)


def write_store_file(stores_dir: Path, name: str, payload: object) -> Path:
    return write_json_file(stores_dir / name / "state.json", payload)


# ---------------------------------------------------------------------------
# Reading the formats found on disk
# ---------------------------------------------------------------------------


def test_read_envelope(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "current-image-store", CURRENT_IMAGE_ENVELOPE)

    assert repository.read("current-image-store") == PersistedStoreEnvelope.model_validate(CURRENT_IMAGE_ENVELOPE)


def test_read_envelope_without_version_defaults_to_zero(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "settings-store", {"state": {"width": 768}})

    envelope = repository.read("settings-store")

    assert envelope is not None
    assert envelope.version == 0
    assert envelope.state == {"width": 768}


def test_read_absent_store_is_none(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    (stores_dir / "outputs-store").mkdir(parents=True)

    assert repository.read("outputs-store") is None
    assert repository.read("never-seen") is None


def test_read_json_null_file_is_none(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "library-store", None)
    write_json_file(stores_dir / "library-store.json", {"library-store": json.dumps(CATEGORIES_ENVELOPE)})

    # A null state.json means "removed": the legacy flat file is not consulted (former Electron behavior).
    assert repository.read("library-store") is None


def test_read_legacy_string_map_in_the_primary_file(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "categorie-store", {"categorie-store": json.dumps(CATEGORIES_ENVELOPE)})

    assert repository.read("categorie-store") == PersistedStoreEnvelope.model_validate(CATEGORIES_ENVELOPE)


def test_read_legacy_map_with_a_single_string_value(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "categorie-store", {"old-name": json.dumps(CATEGORIES_ENVELOPE), "count": 3})

    assert repository.read("categorie-store") == PersistedStoreEnvelope.model_validate(CATEGORIES_ENVELOPE)


def test_read_legacy_map_holding_null(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "categorie-store", {"categorie-store": "null"})

    assert repository.read("categorie-store") is None


def test_read_legacy_flat_file_when_the_primary_file_is_absent(
    repository: PersistedStoreRepository, stores_dir: Path
) -> None:
    write_json_file(stores_dir / "panel-layouts-store.json", {"panel-layouts-store": json.dumps(CURRENT_IMAGE_ENVELOPE)})

    assert repository.read("panel-layouts-store") == PersistedStoreEnvelope.model_validate(CURRENT_IMAGE_ENVELOPE)


def test_primary_file_wins_over_the_legacy_flat_file(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "settings-store", {"state": {"width": 1}, "version": 2})
    write_json_file(stores_dir / "settings-store.json", {"settings-store": json.dumps({"state": {"width": 9}})})

    envelope = repository.read("settings-store")

    assert envelope is not None
    assert envelope.state == {"width": 1}
    assert envelope.version == 2


def test_read_recovers_an_interrupted_write(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_json_file(stores_dir / "settings-store" / "state.json.new", {"state": {"width": 5}, "version": 0})

    envelope = repository.read("settings-store")

    assert envelope is not None
    assert envelope.state == {"width": 5}


@pytest.mark.parametrize(
    "raw",
    [
        "{not json",
        json.dumps({"a": "x", "b": "y"}),  # ambiguous string map
        json.dumps({"settings-store": "{not json"}),
        json.dumps({"state": "not an object"}),
        json.dumps([1, 2]),
    ],
)
def test_unreadable_content_raises_instead_of_reading_as_empty(
    repository: PersistedStoreRepository, stores_dir: Path, raw: str
) -> None:
    path = stores_dir / "settings-store" / "state.json"
    path.parent.mkdir(parents=True)
    path.write_text(raw, encoding="utf-8")

    with pytest.raises(PersistedStoreUnreadable):
        repository.read("settings-store")
    assert path.read_text(encoding="utf-8") == raw


# ---------------------------------------------------------------------------
# Writing, deleting, listing
# ---------------------------------------------------------------------------


def test_write_then_read_round_trip(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    envelope = PersistedStoreEnvelope.model_validate({"state": {"rules": [], "név": "ünïcode"}, "version": 3})

    repository.write("forbidden-associations-store", envelope)

    assert repository.read("forbidden-associations-store") == envelope
    on_disk = json.loads((stores_dir / "forbidden-associations-store" / "state.json").read_text(encoding="utf-8"))
    assert on_disk == {"state": {"rules": [], "név": "ünïcode"}, "version": 3}


def test_write_replaces_a_legacy_string_map(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "categorie-store", {"categorie-store": json.dumps(CATEGORIES_ENVELOPE)})
    envelope = PersistedStoreEnvelope(state={"categories": []}, version=1)

    repository.write("categorie-store", envelope)

    assert repository.read("categorie-store") == envelope


def test_delete_removes_the_data_but_not_foreign_files(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "categorie-store", CATEGORIES_ENVELOPE)
    backup = write_json_file(stores_dir / "categorie-store" / "state - Copie.json", CATEGORIES_ENVELOPE)
    write_json_file(stores_dir / "categorie-store.json", {"categorie-store": json.dumps(CATEGORIES_ENVELOPE)})

    repository.delete("categorie-store")

    assert repository.read("categorie-store") is None
    assert backup.exists()
    assert not (stores_dir / "categorie-store.json").exists()


def test_delete_removes_an_emptied_directory(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    write_store_file(stores_dir, "settings-store", CURRENT_IMAGE_ENVELOPE)

    repository.delete("settings-store")
    repository.delete("settings-store")  # idempotent

    assert not (stores_dir / "settings-store").exists()


def test_names_with_data(repository: PersistedStoreRepository, stores_dir: Path) -> None:
    assert repository.names_with_data() == []  # stores dir does not exist yet

    write_store_file(stores_dir, "workspace-z-index-store", {"state": {"maxZ": 2310}, "version": 0})
    write_store_file(stores_dir, "current-image-store", CURRENT_IMAGE_ENVELOPE)
    write_store_file(stores_dir, "library-store", None)
    write_json_file(stores_dir / "panel-layouts-store.json", {"panel-layouts-store": json.dumps(CURRENT_IMAGE_ENVELOPE)})
    write_store_file(stores_dir, "broken-store", "not an envelope")
    (stores_dir / "outputs-store").mkdir()
    (stores_dir / "Not A Store").mkdir()
    (stores_dir / "notes.txt").write_text("x", encoding="utf-8")

    assert repository.names_with_data() == [
        "broken-store",  # unreadable counts as data: it must not be re-seeded and overwritten
        "current-image-store",
        "panel-layouts-store",
        "workspace-z-index-store",
    ]


@pytest.mark.parametrize("name", ["", "UPPER", "../escape", "a/b", "-leading-dash", "x" * 65])
def test_invalid_names_are_rejected(repository: PersistedStoreRepository, name: str) -> None:
    with pytest.raises(ValueError):
        repository.read(name)
    with pytest.raises(ValueError):
        repository.write(name, PersistedStoreEnvelope(state={}))
    with pytest.raises(ValueError):
        repository.delete(name)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def test_store_round_trip_over_http(client: TestClient, stores_dir: Path) -> None:
    assert client.get("/api/stores/settings-store").json() == {"name": "settings-store", "envelope": None}

    response = client.put("/api/stores/settings-store", json={"state": {"width": 768, "steps": 30}, "version": 1})
    assert response.json() == {"ok": True}

    assert client.get("/api/stores/settings-store").json() == {
        "name": "settings-store",
        "envelope": {"state": {"width": 768, "steps": 30}, "version": 1},
    }
    assert (stores_dir / "settings-store" / "state.json").exists()
    assert client.get("/api/bootstrap").json()["persisted_stores"] == ["settings-store"]

    assert client.delete("/api/stores/settings-store").json() == {"ok": True}
    assert client.get("/api/stores/settings-store").json()["envelope"] is None


def test_put_defaults_the_version(client: TestClient) -> None:
    client.put("/api/stores/workspace-store", json={"state": {}}).raise_for_status()

    assert client.get("/api/stores/workspace-store").json()["envelope"] == {"state": {}, "version": 0}


def test_http_reads_legacy_formats(client: TestClient, stores_dir: Path) -> None:
    write_store_file(stores_dir, "categorie-store", {"categorie-store": json.dumps(CATEGORIES_ENVELOPE)})

    assert client.get("/api/stores/categorie-store").json()["envelope"] == CATEGORIES_ENVELOPE


def test_unreadable_store_is_a_server_error(client: TestClient, stores_dir: Path) -> None:
    path = stores_dir / "settings-store" / "state.json"
    path.parent.mkdir(parents=True)
    path.write_text("{not json", encoding="utf-8")

    response = client.get("/api/stores/settings-store")

    assert response.status_code == 500
    assert "settings-store" in response.json()["detail"]


@pytest.mark.parametrize("name", ["UPPER", "has_underscore", "-dash", "x" * 65])
def test_invalid_store_names_are_422(client: TestClient, name: str) -> None:
    assert client.get(f"/api/stores/{name}").status_code == 422
    assert client.put(f"/api/stores/{name}", json={"state": {}}).status_code == 422
    assert client.delete(f"/api/stores/{name}").status_code == 422


def test_invalid_envelope_is_422(client: TestClient) -> None:
    assert client.put("/api/stores/settings-store", json={"version": 1}).status_code == 422
    assert client.put("/api/stores/settings-store", json={"state": [1, 2]}).status_code == 422
