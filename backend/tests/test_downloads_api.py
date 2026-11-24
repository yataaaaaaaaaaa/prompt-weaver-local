"""POST /api/downloads/{task_id}/cancel and the download progress seen through GET /api/tasks, on the app's
own DownloadManager (app.state.services.downloads) over FakeHttp."""

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.downloads import DownloadManager, DownloadSpec, part_path
from app.settings import AppPaths
from support import FakeHttp, wait_until

URL = "https://files.example/models/detail-tweaker.safetensors"
TITLE = "Detail Tweaker - v1.0"


def task_event(client: TestClient, task_id: str) -> dict[str, Any] | None:
    response = client.get("/api/tasks")
    assert response.status_code == 200
    return next((event for event in response.json()["events"] if event["task_id"] == task_id), None)


def downloads_of(app: FastAPI) -> DownloadManager:
    return app.state.services.downloads


def test_cancel_unknown_download_is_404(client: TestClient) -> None:
    response = client.post("/api/downloads/download-unknown/cancel")

    assert response.status_code == 404
    assert "download-unknown" in response.json()["detail"]


def test_cancel_route_stops_a_running_download(
    app: FastAPI, client: TestClient, fake_http: FakeHttp, app_paths: AppPaths
) -> None:
    reached = threading.Event()
    released = threading.Event()

    def blocked_body() -> Iterator[bytes]:
        reached.set()
        released.wait(5)
        yield b"late bytes"

    fake_http.add("GET", URL, handler=lambda request: httpx.Response(200, content=blocked_body()))
    dest = app_paths.model_dir("lora") / "detail-tweaker.safetensors"
    try:
        task_id = downloads_of(app).start(DownloadSpec(url=URL, dest=dest, title=TITLE))
        assert reached.wait(5)
        event = task_event(client, task_id)
        assert event is not None and event["type"] == "download" and event["stage"] == "downloading"

        response = client.post(f"/api/downloads/{task_id}/cancel")
        assert response.status_code == 200
        assert response.json() == {"ok": True}
    finally:
        released.set()

    wait_until(lambda: (task_event(client, task_id) or {}).get("stage") == "cancelled")
    event = task_event(client, task_id)
    assert event is not None
    assert event["title"] == TITLE
    assert event["message"] == "Download cancelled"
    assert not dest.exists()
    assert not part_path(dest).exists()
    # Finished: a second cancel is a 404.
    assert client.post(f"/api/downloads/{task_id}/cancel").status_code == 404


def test_app_shutdown_cancels_running_downloads_without_hanging(
    app: FastAPI, fake_http: FakeHttp, app_paths: AppPaths
) -> None:
    streaming = threading.Event()
    stop = threading.Event()
    # The app's manager reads 1 MiB chunks: feed whole chunks so it reaches its cancellation checks.
    chunk = bytes(1024 * 1024)

    def endless_body() -> Iterator[bytes]:
        streaming.set()
        deadline = time.monotonic() + 10
        while not stop.is_set() and time.monotonic() < deadline:
            time.sleep(0.02)
            yield chunk

    fake_http.add("GET", URL, handler=lambda request: httpx.Response(200, content=endless_body()))
    dest = app_paths.model_dir("checkpoint") / "big-model.safetensors"
    try:
        with TestClient(app) as client:
            task_id = downloads_of(app).start(DownloadSpec(url=URL, dest=dest, title=TITLE))
            assert streaming.wait(5)
            assert client.get("/api/health").status_code == 200
            started = time.monotonic()
        # Leaving the context ran the lifespan shutdown (DownloadManager.shutdown).
        assert time.monotonic() - started < 5
    finally:
        stop.set()

    events = [event for event in app.state.services.tasks.snapshot().events if event.task_id == task_id]
    assert [event.stage for event in events] == ["cancelled"]
    assert not downloads_of(app).is_active(task_id)
    assert not dest.exists()
    assert not part_path(dest).exists()
