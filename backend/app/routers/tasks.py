from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..dependencies import ServicesDep
from ..schemas import TaskSnapshot

router = APIRouter(tags=["tasks"])


@router.get("/api/tasks", response_model=TaskSnapshot)
def get_tasks(services: ServicesDep) -> TaskSnapshot:
    """Latest event of every known background task."""
    return services.tasks.snapshot()


@router.websocket("/ws/tasks")
async def tasks_ws(websocket: WebSocket, services: ServicesDep) -> None:
    """Streams TaskEvent JSON messages (discriminated by `type`); sends the snapshot events on connect."""
    hub = services.tasks
    if not await hub.connect(websocket):
        return
    try:
        # Incoming messages are ignored; the loop only waits for the client to go away.
        while (await websocket.receive())["type"] != "websocket.disconnect":
            pass
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await hub.disconnect(websocket)
