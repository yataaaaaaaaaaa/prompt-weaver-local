"""Task progress: TaskHub and GET /api/tasks + WebSocket /ws/tasks."""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.schemas import DownloadTaskEvent, GenerationTaskEvent, TaskSnapshot
from app.services.task_hub import TaskHub

IDLE = {"type": "generation", "task_id": "generation", "stage": "idle", "message": "Idle", "current": 0, "total": 0}


class FakeSocket:
    """The subset of starlette's WebSocket used by TaskHub."""

    def __init__(self, *, broken: bool = False) -> None:
        self.broken = broken
        self.accepted = False
        self.closed = False
        self.sent: list[dict[str, Any]] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict[str, Any]) -> None:
        if self.broken:
            raise RuntimeError("connection lost")
        self.sent.append(payload)

    async def close(self) -> None:
        self.closed = True


async def settle() -> None:
    """Let the broadcasts scheduled by publish() run."""
    for _ in range(5):
        await asyncio.sleep(0)


def download(stage: str = "downloading", **values: Any) -> DownloadTaskEvent:
    return DownloadTaskEvent(task_id="download:model-a", stage=stage, **values)


# ---------------------------------------------------------------------------
# TaskHub
# ---------------------------------------------------------------------------


def test_hub_starts_with_an_idle_generation_task() -> None:
    assert TaskHub().snapshot() == TaskSnapshot(events=[GenerationTaskEvent(stage="idle", message="Idle")])


def test_publish_keeps_the_latest_event_per_task_without_any_socket() -> None:
    hub = TaskHub()

    hub.publish(GenerationTaskEvent(stage="sampling", current=1, total=30))
    hub.publish(download(current=10, total=100))
    hub.publish(GenerationTaskEvent(stage="sampling", current=2, total=30))

    assert hub.snapshot().events == [
        GenerationTaskEvent(stage="sampling", current=2, total=30),
        download(current=10, total=100),
    ]


def test_connect_sends_the_snapshot_then_live_events() -> None:
    async def scenario() -> FakeSocket:
        hub = TaskHub()
        hub.publish(download(current=1, total=2))
        socket = FakeSocket()
        assert await hub.connect(socket) is True  # type: ignore[arg-type]
        hub.publish(GenerationTaskEvent(stage="loading_model", message="Loading"))
        await settle()
        return socket

    socket = asyncio.run(scenario())

    assert socket.accepted
    assert [(message["type"], message["stage"]) for message in socket.sent] == [
        ("generation", "idle"),
        ("download", "downloading"),
        ("generation", "loading_model"),
    ]


def test_events_from_worker_threads_are_broadcast_in_order() -> None:
    async def scenario() -> FakeSocket:
        hub = TaskHub()
        socket = FakeSocket()
        await hub.connect(socket)  # type: ignore[arg-type]

        def worker() -> None:
            for step in range(1, 21):
                hub.publish(GenerationTaskEvent(stage="sampling", current=step, total=20))

        thread = threading.Thread(target=worker)
        thread.start()
        await asyncio.to_thread(thread.join)
        await settle()
        return socket

    socket = asyncio.run(scenario())

    assert [message["current"] for message in socket.sent[1:]] == list(range(1, 21))


def test_dead_sockets_are_dropped() -> None:
    async def scenario() -> tuple[FakeSocket, FakeSocket, TaskHub]:
        hub = TaskHub()
        healthy, dying = FakeSocket(), FakeSocket()
        await hub.connect(healthy)  # type: ignore[arg-type]
        await hub.connect(dying)  # type: ignore[arg-type]
        dying.broken = True
        hub.publish(GenerationTaskEvent(stage="saving"))
        await settle()
        dying.broken = False
        hub.publish(GenerationTaskEvent(stage="complete"))
        await settle()
        return healthy, dying, hub

    healthy, dying, _hub = asyncio.run(scenario())

    assert [message["stage"] for message in healthy.sent] == ["idle", "saving", "complete"]
    assert [message["stage"] for message in dying.sent] == ["idle"]
    assert dying.closed


def test_connect_fails_when_the_snapshot_cannot_be_sent() -> None:
    async def scenario() -> tuple[bool, FakeSocket]:
        hub = TaskHub()
        socket = FakeSocket(broken=True)
        connected = await hub.connect(socket)  # type: ignore[arg-type]
        hub.publish(GenerationTaskEvent(stage="saving"))
        await settle()
        return connected, socket

    connected, socket = asyncio.run(scenario())

    assert connected is False
    assert socket.closed


def test_shutdown_closes_sockets_and_refuses_new_ones() -> None:
    async def scenario() -> tuple[FakeSocket, FakeSocket, bool]:
        hub = TaskHub()
        first = FakeSocket()
        await hub.connect(first)  # type: ignore[arg-type]
        await hub.shutdown()
        late = FakeSocket()
        accepted = await hub.connect(late)  # type: ignore[arg-type]
        hub.publish(GenerationTaskEvent(stage="complete"))
        await settle()
        return first, late, accepted

    first, late, accepted = asyncio.run(scenario())

    assert first.closed and [message["stage"] for message in first.sent] == ["idle"]
    assert accepted is False and late.closed and late.sent == []


def test_publish_after_the_loop_closed_only_records() -> None:
    hub = TaskHub()

    async def connect() -> None:
        await hub.connect(FakeSocket())  # type: ignore[arg-type]

    asyncio.run(connect())  # leaves a registered socket bound to a now-closed loop

    hub.publish(GenerationTaskEvent(stage="complete"))

    assert hub.snapshot().events[0].stage == "complete"


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def test_get_tasks_lists_every_task(client: TestClient, app: FastAPI) -> None:
    app.state.services.tasks.publish(download(stage="queued"))

    assert client.get("/api/tasks").json() == {
        "events": [
            IDLE,
            {"type": "download", "task_id": "download:model-a", "stage": "queued", "message": "", "current": 0, "total": 0},
        ]
    }


def test_websocket_sends_the_snapshot_on_connect(client: TestClient, app: FastAPI) -> None:
    app.state.services.tasks.publish(download(current=5, total=10))

    with client.websocket_connect("/ws/tasks") as websocket:
        assert websocket.receive_json() == IDLE
        assert websocket.receive_json()["current"] == 5


def test_websocket_receives_events_published_from_another_thread(client: TestClient, app: FastAPI) -> None:
    hub: TaskHub = app.state.services.tasks
    with client.websocket_connect("/ws/tasks") as first, client.websocket_connect("/ws/tasks") as second:
        assert first.receive_json() == IDLE
        assert second.receive_json() == IDLE

        thread = threading.Thread(
            target=lambda: hub.publish(GenerationTaskEvent(stage="sampling", message="Sampling step 3/30", current=3, total=30))
        )
        thread.start()
        thread.join()

        for websocket in (first, second):
            assert websocket.receive_json() == {
                "type": "generation",
                "task_id": "generation",
                "stage": "sampling",
                "message": "Sampling step 3/30",
                "current": 3,
                "total": 30,
            }


def test_websocket_ignores_client_messages_and_disconnects_cleanly(client: TestClient, app: FastAPI) -> None:
    hub: TaskHub = app.state.services.tasks
    with client.websocket_connect("/ws/tasks") as websocket:
        websocket.receive_json()
        websocket.send_text("ping")
        websocket.send_bytes(b"\x00")
        hub.publish(GenerationTaskEvent(stage="saving"))
        assert websocket.receive_json()["stage"] == "saving"

    # The closed socket was unregistered: publishing afterwards only records.
    hub.publish(GenerationTaskEvent(stage="complete"))
    assert client.get("/api/tasks").json()["events"][0]["stage"] == "complete"
