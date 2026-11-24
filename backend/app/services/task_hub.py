"""Background task progress hub: latest event per task + WebSocket fan-out (thread-safe publish)."""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

from fastapi import WebSocket

from ..schemas import DownloadTaskEvent, GenerationTaskEvent, TaskSnapshot

TaskEventModel = GenerationTaskEvent | DownloadTaskEvent

logger = logging.getLogger(__name__)


def _payload(event: TaskEventModel) -> dict[str, Any]:
    return event.model_dump(mode="json")


class TaskHub:
    """Keeps the latest event of every task (starting with an idle generation task) and streams new events
    to the connected WebSockets.

    publish() may be called from any thread (generation runs in the threadpool); broadcasts are scheduled on
    the event loop of the WebSocket connections. Every send happens under one asyncio lock, so each socket
    receives the snapshot first and then the events in publish order.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest: dict[str, TaskEventModel] = {}
        self._connections: set[WebSocket] = set()
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

    async def connect(self, websocket: WebSocket) -> bool:
        """Accept, register and send every snapshot event. False when shutting down or the send failed."""
        await websocket.accept()
        send_lock = self._bind_loop()
        if self._shutting_down:
            await self._close_quietly(websocket)
            return False
        async with send_lock:
            self._connections.add(websocket)
            try:
                for event in self.snapshot().events:
                    await websocket.send_json(_payload(event))
            except Exception:
                self._connections.discard(websocket)
                await self._close_quietly(websocket)
                return False
        return True

    async def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    def publish(self, event: TaskEventModel) -> None:
        """Record as the latest event of event.task_id and broadcast. Callable from worker threads."""
        with self._lock:
            self._latest[event.task_id] = event
        loop = self._loop
        if self._shutting_down or not self._connections or loop is None or loop.is_closed():
            return
        coroutine = self._broadcast(_payload(event))
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
            for websocket in list(self._connections):
                try:
                    await websocket.send_json(payload)
                except Exception:
                    dead.append(websocket)
            for websocket in dead:
                self._connections.discard(websocket)
                await self._close_quietly(websocket)

    @staticmethod
    async def _close_quietly(websocket: WebSocket) -> None:
        try:
            await websocket.close()
        except Exception:
            logger.debug("Closing a task WebSocket failed", exc_info=True)
