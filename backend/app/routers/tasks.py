from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..dependencies import ServicesDep
from ..schemas import CLIENT_ID_PATTERN, TaskSnapshot

router = APIRouter(tags=["tasks"])


@router.get("/api/tasks", response_model=TaskSnapshot)
def get_tasks(services: ServicesDep) -> TaskSnapshot:
    """Latest event of every known background task."""
    return services.tasks.snapshot()


@router.websocket("/ws/tasks")
async def tasks_ws(
    websocket: WebSocket,
    services: ServicesDep,
    client_id: Annotated[str | None, Query(pattern=CLIENT_ID_PATTERN)] = None,
) -> None:
    """Streams TaskEvent JSON messages (discriminated by `type`), sending the snapshot events on connect, and the
    co-writer's CodexEvent messages (`type` "codex"). `client_id` names the frontend window (page load) the socket
    belongs to: the co-writer's tool calls go to the window that sent the message."""
    hub = services.tasks
    if not await hub.connect(websocket, client_id):
        return
    try:
        # Incoming messages are ignored; the loop only waits for the client to go away.
        while (await websocket.receive())["type"] != "websocket.disconnect":
            pass
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await hub.disconnect(websocket)
