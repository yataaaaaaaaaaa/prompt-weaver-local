"""Generic downloads (services/downloads.py). Progress is read from /ws/tasks and GET /api/tasks
(DownloadTaskEvent); this router only controls running downloads.

Route signatures are the API contract mirrored in backend/openapi.json and frontend/src/api/schema.gen.ts:
change them only together with `npm run gen:api`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..dependencies import ServicesDep
from ..schemas import OkResponse

router = APIRouter(prefix="/api/downloads", tags=["downloads"])


@router.post("/{task_id}/cancel", response_model=OkResponse, responses={404: {"description": "Unknown or finished download"}})
def cancel_download(task_id: str, services: ServicesDep) -> OkResponse:
    """Cancels a queued or running download (its task then ends with stage 'cancelled')."""
    if not services.downloads.cancel(task_id):
        raise HTTPException(status_code=404, detail=f"No running download '{task_id}'.")
    return OkResponse()
