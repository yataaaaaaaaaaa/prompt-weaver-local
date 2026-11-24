"""End to end: Civitai version lookup -> streamed download -> verified file in the models folder -> "installed",
through the real app container (the `client` fixture). Only the network is faked (FakeHttp): the Civitai
answers are the real trimmed fixtures with the file's size and SHA-256 changed to match a small payload, and the
download URL answers 307 to a signed storage URL on another host, like Civitai does."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.services.downloads import part_path
from app.settings import AppPaths
from support import FakeHttp, load_fixture, sha256_of, wait_until

API_URL = "https://civitai.com/api/v1"
MODEL_ID = "58390"
VERSION_ID = "62833"
FILE_ID = "44319"
DOWNLOAD_URL = f"https://civitai.com/api/download/models/{VERSION_ID}"
STORAGE_URL = "https://storage.example/signed/add_detail.safetensors"
PAYLOAD = b"not really safetensors, but the right size and hash " * 40
TOKEN = "civitai-secret-token-1234567890"


def shrink_file(raw_file: dict[str, Any]) -> None:
    """Make the Civitai file entry describe PAYLOAD (Civitai reports sizeKB and an uppercase SHA256)."""
    raw_file["sizeKB"] = len(PAYLOAD) / 1024
    raw_file["hashes"]["SHA256"] = sha256_of(PAYLOAD).upper()


def version_payload() -> dict[str, Any]:
    payload = load_fixture("civitai/model_version.json")
    for raw_file in payload["files"]:
        if str(raw_file["id"]) == FILE_ID:
            shrink_file(raw_file)
    return payload


def search_payload() -> dict[str, Any]:
    payload = load_fixture("civitai/search_loras.json")
    for item in payload["items"]:
        for version in item["modelVersions"]:
            for raw_file in version["files"]:
                if str(raw_file["id"]) == FILE_ID:
                    shrink_file(raw_file)
    return payload


class StorageGate:
    """Holds the storage download open until released (lets a test look at a running install)."""

    def __init__(self) -> None:
        self.reached = threading.Event()
        self.released = threading.Event()

    def body(self) -> Iterator[bytes]:
        self.reached.set()
        self.released.wait(timeout=5)
        yield PAYLOAD


@pytest.fixture()
def civitai(fake_http: FakeHttp) -> FakeHttp:
    fake_http.add("GET", f"{API_URL}/model-versions/{VERSION_ID}", json=version_payload())
    fake_http.add("GET", f"{API_URL}/models", json=search_payload())
    fake_http.add("GET", DOWNLOAD_URL, handler=lambda request: httpx.Response(307, headers={"Location": STORAGE_URL}))
    fake_http.add("GET", STORAGE_URL, content=PAYLOAD)
    return fake_http


def install(client: TestClient) -> dict[str, Any]:
    response = client.post("/api/models/install", json={"provider": "civitai", "version_id": VERSION_ID, "file_id": None})
    assert response.status_code == 200, response.text
    return response.json()


def task_event(client: TestClient, task_id: str) -> dict[str, Any] | None:
    events = client.get("/api/tasks").json()["events"]
    return next((event for event in events if event["task_id"] == task_id), None)


def wait_for_stage(client: TestClient, task_id: str, stage: str) -> dict[str, Any]:
    wait_until(lambda: (task_event(client, task_id) or {}).get("stage") in (stage, "error", "cancelled"))
    event = task_event(client, task_id)
    assert event is not None and event["stage"] == stage, event
    return event


def test_install_downloads_verifies_and_then_answers_installed(client: TestClient, civitai: FakeHttp, app_paths: AppPaths) -> None:
    started = install(client)
    assert started["state"] == "downloading"
    assert started["installed"] is None
    task_id = started["task_id"]

    complete = wait_for_stage(client, task_id, "complete")
    title = f"{version_payload()['model']['name']} - {version_payload()['name']}"
    assert complete["type"] == "download"
    assert complete["title"] == title
    assert complete["current"] == complete["total"] == len(PAYLOAD)

    dest = app_paths.model_dir("lora") / "add_detail.safetensors"
    assert dest.read_bytes() == PAYLOAD
    assert not part_path(dest).exists()
    assert sorted(path.name for path in dest.parent.iterdir()) == ["add_detail.safetensors"]

    # The download followed Civitai's 307 to the storage host; the file was requested once.
    (download_request,) = civitai.requests_to(DOWNLOAD_URL)
    assert download_request.url.params["fileId"] == FILE_ID
    assert len(civitai.requests_to(STORAGE_URL)) == 1

    again = install(client)
    assert again["state"] == "installed"
    assert again["task_id"] is None
    installed = again["installed"]
    assert installed["kind"] == "lora"
    assert installed["name"] == title
    assert installed["path"] == str(dest)
    source = installed["source"]
    assert {key: source[key] for key in ("provider", "model_id", "version_id", "file_id", "base_model")} == {
        "provider": "civitai",
        "model_id": MODEL_ID,
        "version_id": VERSION_ID,
        "file_id": FILE_ID,
        "base_model": "SD 1.5",
    }
    assert source["sha256"] == sha256_of(PAYLOAD)  # lowercase
    assert source["page_url"] == f"https://civitai.com/models/{MODEL_ID}?modelVersionId={VERSION_ID}"
    assert source["preview_url"] is not None and "/width=450/" in source["preview_url"]
    # Answered from disk + hash cache: no new download, no running install left.
    assert len(civitai.requests_to(DOWNLOAD_URL)) == 1
    assert len(civitai.requests_to(STORAGE_URL)) == 1
    assert client.get("/api/models/installs").json() == []

    # Search results now point at the local copy.
    page = client.get("/api/models/search", params={"query": "detail", "kinds": "lora"}).json()
    detail = next(item for item in page["items"] if item["id"] == MODEL_ID)
    files = {file["id"]: file for version in detail["versions"] for file in version["files"]}
    assert files[FILE_ID]["local_path"] == str(dest)


def test_running_install_is_listed_and_joined_until_it_completes(client: TestClient, civitai: FakeHttp) -> None:
    gate = StorageGate()
    civitai.add("GET", STORAGE_URL, handler=lambda request: httpx.Response(200, content=gate.body()))

    task_id = install(client)["task_id"]
    assert gate.reached.wait(timeout=5)
    try:
        (job,) = client.get("/api/models/installs").json()
        assert job["task_id"] == task_id
        assert (job["provider"], job["model_id"], job["version_id"], job["file_id"], job["kind"]) == (
            "civitai",
            MODEL_ID,
            VERSION_ID,
            FILE_ID,
            "lora",
        )
        # A second request (e.g. a double click or another window) joins the running download.
        assert install(client) == {"state": "downloading", "task_id": task_id, "installed": None}
    finally:
        gate.released.set()

    wait_for_stage(client, task_id, "complete")
    assert install(client)["state"] == "installed"
    assert len(civitai.requests_to(STORAGE_URL)) == 1


def test_stored_token_is_sent_to_civitai_only_and_never_echoed(client: TestClient, civitai: FakeHttp, app_paths: AppPaths) -> None:
    saved = client.put("/api/models/providers/civitai/token", json={"token": f"  {TOKEN}  "})
    assert saved.status_code == 200
    assert saved.json()["token_set"] is True
    assert TOKEN not in saved.text

    task_id = install(client)["task_id"]
    wait_for_stage(client, task_id, "complete")

    bearer = f"Bearer {TOKEN}"  # stored trimmed
    (version_request,) = civitai.requests_to(f"{API_URL}/model-versions/{VERSION_ID}")
    (download_request,) = civitai.requests_to(DOWNLOAD_URL)
    (storage_request,) = civitai.requests_to(STORAGE_URL)
    assert version_request.headers["Authorization"] == bearer
    assert download_request.headers["Authorization"] == bearer
    # httpx drops the Authorization header when the redirect leaves civitai.com.
    assert "Authorization" not in storage_request.headers

    for response in (
        client.get("/api/models/info"),
        client.get("/api/tasks"),
        client.get("/api/models/installs"),
        client.post("/api/models/install", json={"provider": "civitai", "version_id": VERSION_ID}),
    ):
        assert response.status_code == 200
        assert TOKEN not in response.text
    assert TOKEN in app_paths.settings_file.read_text(encoding="utf-8")
