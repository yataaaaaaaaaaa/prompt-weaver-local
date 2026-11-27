"""Background task progress hub: latest event per task + WebSocket fan-out (thread-safe publish), and the event
channel of the other live messages (the co-writer's CodexEvent messages: broadcast, never recorded)."""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable
from typing import Any

from fastapi import WebSocket
from pydantic import BaseModel

from ..schemas import DownloadTaskEvent, GenerationTaskEvent, TaskSnapshot

TaskEventModel = GenerationTaskEvent | DownloadTaskEvent
ClientListener = Callable[[str], None]

logger = logging.getLogger(__name__)


def _payload(event: BaseModel) -> dict[str, Any]:
    return event.model_dump(mode="json")


class TaskHub:
    """Keeps the latest event of every task (starting with an idle generation task) and streams new events
    to the connected WebSockets.

    publish() and broadcast() may be called from any thread (generation runs in the threadpool, the co-writer reads
    Codex on its own threads); sends are scheduled on the event loop of the WebSocket connections. Every send happens
    under one asyncio lock, so each socket receives the snapshot first and then the messages in publish order.

    A socket may name the frontend window it belongs to (`client_id`, a random id per page load): is_client_connected
    tells whether that window is connected, and the client listeners hear when its last socket went away.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest: dict[str, TaskEventModel] = {}
        self._connections: dict[WebSocket, str | None] = {}
        self._client_listeners: list[ClientListener] = []
        self._loop: asyncio.AbstractEventLoop | None = None
        self._send_lock: asyncio.Lock | None = None
        self._shutting_down = False
        self.publish(GenerationTaskEvent(stage="idle", message="Idle"))

    def _bind_loop(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._loop is not loop or self._send_lock is None:
            self._loop = loop
            self._send_lock = asyncio.Lock()
        return self._send_lock

    async def connect(self, websocket: WebSocket, client_id: str | None = None) -> bool:
        """Accept, register and send every snapshot event. False when shutting down or the send failed."""
        await websocket.accept()
        send_lock = self._bind_loop()
        if self._shutting_down:
            await self._close_quietly(websocket)
            return False
        async with send_lock:
            with self._lock:
                self._connections[websocket] = client_id
            try:
                for event in self.snapshot().events:
                    await websocket.send_json(_payload(event))
            except Exception:
                self._forget(websocket)
                await self._close_quietly(websocket)
                return False
        return True

    async def disconnect(self, websocket: WebSocket) -> None:
        self._forget(websocket)

    def add_client_listener(self, listener: ClientListener) -> None:
        """`listener(client_id)` runs when the last socket of a window went away (on the event loop: keep it short)."""
        self._client_listeners.append(listener)

    def is_client_connected(self, client_id: str) -> bool:
        with self._lock:
            return client_id in self._connections.values()

    def _forget(self, websocket: WebSocket) -> None:
        with self._lock:
            client_id = self._connections.pop(websocket, None)
            gone = client_id is not None and client_id not in self._connections.values()
        if gone and client_id is not None:
            for listener in list(self._client_listeners):
                try:
                    listener(client_id)
                except Exception:
                    logger.exception("A task hub client listener failed")

    def publish(self, event: TaskEventModel) -> None:
        """Record as the latest event of event.task_id and broadcast. Callable from worker threads."""
        with self._lock:
            self._latest[event.task_id] = event
        self._send(_payload(event))

    def broadcast(self, message: BaseModel) -> None:
        """Send a live message to every socket without recording it (it is not part of the snapshot). Callable from
        worker threads."""
        self._send(_payload(message))

    def _send(self, payload: dict[str, Any]) -> None:
        loop = self._loop
        with self._lock:
            connected = bool(self._connections)
        if self._shutting_down or not connected or loop is None or loop.is_closed():
            return
        coroutine = self._broadcast(payload)
        try:
            asyncio.run_coroutine_threadsafe(coroutine, loop)
        except RuntimeError:
            # The loop closed between the check and the call (server shutting down).
            coroutine.close()

    def snapshot(self) -> TaskSnapshot:
        with self._lock:
            events = list(self._latest.values())
        return TaskSnapshot(events=events)

    async def shutdown(self) -> None:
        self._shutting_down = True
        with self._lock:
            sockets = list(self._connections)
            self._connections.clear()
        for websocket in sockets:
            await self._close_quietly(websocket)

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        send_lock = self._send_lock
        if send_lock is None:
            return
        async with send_lock:
            dead: list[WebSocket] = []
            with self._lock:
                sockets = list(self._connections)
            for websocket in sockets:
                try:
                    await websocket.send_json(payload)
                except Exception:
                    dead.append(websocket)
            for websocket in dead:
                self._forget(websocket)
                await self._close_quietly(websocket)

    @staticmethod
    async def _close_quietly(websocket: WebSocket) -> None:
        try:
            await websocket.close()
        except Exception:
            logger.debug("Closing a task WebSocket failed", exc_info=True)
