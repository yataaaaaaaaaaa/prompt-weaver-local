from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..dependencies import ServicesDep
from ..schemas import GenerateRequest, OkResponse, OutputRecord
from ..services.generation import GenerationCancelledError, GenerationFailed

router = APIRouter(prefix="/api", tags=["generation"])


@router.post("/generate", response_model=OutputRecord, responses={409: {"description": "Generation failed or was cancelled"}})
def generate(request: GenerateRequest, services: ServicesDep) -> OutputRecord:
    """Generate one image, save it as the next output and return its metadata.
    Progress is published as GenerationTaskEvent on /ws/tasks."""
    # A sync route runs in the threadpool, so the event loop keeps streaming progress while this blocks.
    try:
        return services.generation.generate(request)
    except (GenerationFailed, GenerationCancelledError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/generate/cancel", response_model=OkResponse)
def cancel_generate(services: ServicesDep) -> OkResponse:
    services.generation.cancel()
    return OkResponse()
