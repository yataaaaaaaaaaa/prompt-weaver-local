"""The synthetic Civitai of the e2e backend (fake_civitai.py) through the real app: the catalog answers the model
library like Civitai would (real provider parsing), downloads verify, report progress, stall and cancel."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from support import wait_until

from .fake_civitai import CHUNK_SIZE, corrupted, file_content, file_sha256
from .server import E2EBackend


@pytest.fixture()
def backend(tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(E2EBackend(tmp_path / "session")) as client:
        yield client


def reset(client: TestClient, **options: Any) -> dict[str, Any]:
    response = client.post("/__e2e__/reset", json=options)
    assert response.status_code == 200, response.text
    return response.json()


def task_events(client: TestClient, task_id: str) -> list[dict[str, Any]]:
    return [event for event in client.get("/api/tasks").json()["events"] if event["task_id"] == task_id]


def task_stage(client: TestClient, task_id: str) -> str | None:
    events = task_events(client, task_id)
    return events[0]["stage"] if events else None


def start_install(client: TestClient, version_id: str) -> str:
    started = client.post("/api/models/install", json={"provider": "civitai", "version_id": version_id}).json()
    assert started["state"] == "downloading", started
    return started["task_id"]


def test_the_synthetic_civitai_answers_the_model_library(backend: TestClient) -> None:
    page = backend.get("/api/models/search", params={"provider": "civitai", "kinds": "lora", "limit": 20}).json()
    names = [item["name"] for item in page["items"]]
    assert names[0] == "Pixel Forge Style" and "Watercolor Wash" in names and "Aurora XL" not in names

    neon = next(item for item in page["items"] if item["name"] == "Neon Rim Light")
    file = neon["versions"][0]["files"][0]
    assert file["sha256"] == file_sha256(file["id"], 6 * CHUNK_SIZE)
    assert file["local_path"] is not None  # seeded on disk: the app finds it

    flux = next(item for item in page["items"] if item["name"] == "Flux Glow")
    assert flux["versions"][0]["unavailable_reason"]

    query = backend.get("/api/models/search", params={"provider": "civitai", "query": "watercolor"}).json()
    assert [item["name"] for item in query["items"]] == ["Watercolor Wash"]


def test_a_download_reports_progress_and_installs(backend: TestClient) -> None:
    reset(backend, network={"chunk_delay_ms": 0, "download_chunks": 3})
    started = backend.post("/api/models/install", json={"provider": "civitai", "version_id": "920001"}).json()
    assert started["state"] == "downloading"
    task_id = started["task_id"]

    def finished() -> bool:
        events = backend.get("/api/tasks").json()["events"]
        return any(event["task_id"] == task_id and event["stage"] == "complete" for event in events)

    wait_until(finished, timeout=20)
    installed = backend.post("/api/models/install", json={"provider": "civitai", "version_id": "920001"}).json()
    assert installed["state"] == "installed"
    assert Path(installed["installed"]["path"]).stat().st_size == 3 * CHUNK_SIZE


def test_a_stalled_download_stays_downloading_until_cancelled(backend: TestClient) -> None:
    reset(backend, network={"chunk_delay_ms": 0, "download_chunks": 4, "stall_at_percent": 50})
    task_id = backend.post("/api/models/install", json={"provider": "civitai", "version_id": "920007"}).json()["task_id"]

    def stage() -> str | None:
        events = backend.get("/api/tasks").json()["events"]
        return next((event["stage"] for event in events if event["task_id"] == task_id), None)

    wait_until(lambda: stage() == "downloading", timeout=10)
    assert backend.post(f"/api/downloads/{task_id}/cancel").status_code == 200
    wait_until(lambda: stage() == "cancelled", timeout=10)


def test_a_stalled_download_reports_its_progress_up_to_the_stall(backend: TestClient) -> None:
    # Fast chunks are throttled by the download manager (one event per 0.25 s): the last chunk before the stall
    # waits long enough for the stalled download to show its real progress (50% = 2 of 4 MiB).
    reset(backend, network={"chunk_delay_ms": 0, "download_chunks": 4, "stall_at_percent": 50})
    task_id = start_install(backend, "920001")

    def current() -> int:
        events = task_events(backend, task_id)
        return events[0]["current"] if events else -1

    wait_until(lambda: current() == 2 * CHUNK_SIZE, timeout=10)
    assert task_stage(backend, task_id) == "downloading"
    assert backend.post(f"/api/downloads/{task_id}/cancel").status_code == 200
    wait_until(lambda: task_stage(backend, task_id) == "cancelled", timeout=10)


def test_corrupt_downloads_fail_verification_and_the_retry_installs(backend: TestClient) -> None:
    reset(backend, network={"chunk_delay_ms": 0, "download_chunks": 2, "corrupt_downloads": 1})
    failed = start_install(backend, "920001")
    wait_until(lambda: task_stage(backend, failed) == "error", timeout=10)
    assert "SHA-256" in task_events(backend, failed)[0]["message"]

    retried = start_install(backend, "920001")
    wait_until(lambda: task_stage(backend, retried) == "complete", timeout=10)
    installed = backend.post("/api/models/install", json={"provider": "civitai", "version_id": "920001"}).json()
    assert installed["state"] == "installed"


def test_corrupted_content_keeps_its_size_but_not_its_hash() -> None:
    content = file_content("930001", 4096)
    assert len(corrupted(content)) == len(content) and corrupted(content) != content
    assert corrupted(b"") == b""


def test_nsfw_models_are_only_listed_on_request(backend: TestClient) -> None:
    def names(nsfw: bool) -> list[str]:
        params = {"provider": "civitai", "nsfw": str(nsfw).lower(), "limit": 50}
        return [item["name"] for item in backend.get("/api/models/search", params=params).json()["items"]]

    assert "Velvet Noir" not in names(False)
    assert "Velvet Noir" in names(True)
    noir = next(item for item in backend.get(
        "/api/models/search", params={"provider": "civitai", "nsfw": "true", "query": "noir"}
    ).json()["items"])
    assert noir["nsfw"] is True and noir["versions"][0]["images"][0]["nsfw"] is True


def test_the_image_feed_has_a_second_page_of_safe_locally_usable_images(backend: TestClient) -> None:
    first = backend.get("/api/images/search", params={"provider": "civitai"}).json()
    assert len(first["items"]) == 20 and first["next_cursor"]
    second = backend.get("/api/images/search", params={"provider": "civitai", "cursor": first["next_cursor"]}).json()
    ids = [item["id"] for item in first["items"] + second["items"]]
    assert len(ids) == len(set(ids)) == 24 and second["next_cursor"] is None
    # Safe and locally usable only by default: no nsfw image (950006), no Flux image (950004).
    assert "950006" not in ids and "950004" not in ids

    everything = backend.get(
        "/api/images/search", params={"provider": "civitai", "nsfw": "true", "usable_only": "false", "limit": 50}
    ).json()
    assert {"950004", "950006"} <= {item["id"] for item in everything["items"]}


def test_a_keyword_finds_the_gallery_of_the_matching_models(backend: TestClient) -> None:
    page = backend.get("/api/images/search", params={"provider": "civitai", "query": "pixel"}).json()
    assert [item["id"] for item in page["items"]] == ["950001"]
