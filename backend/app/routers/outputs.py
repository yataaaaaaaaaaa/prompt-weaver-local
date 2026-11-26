from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import FileResponse

from ..dependencies import ServicesDep
from ..schemas import OUTPUT_ID_PATTERN, OkResponse, OutputIndex, OutputRecord
from ..services.outputs import OutputNotFound

router = APIRouter(prefix="/api", tags=["outputs"])

OutputId = Annotated[str, Path(pattern=OUTPUT_ID_PATTERN)]


def _unknown_output(output_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Unknown output '{output_id}'.")


@router.get("/outputs", response_model=OutputIndex)
def list_outputs(services: ServicesDep) -> OutputIndex:
    return OutputIndex(ids=services.outputs.list_ids())


@router.get("/outputs/{output_id}", response_model=OutputRecord, responses={404: {"description": "Unknown output"}})
def get_output(output_id: OutputId, services: ServicesDep) -> OutputRecord:
    try:
        return services.outputs.load(output_id)
    except OutputNotFound as exc:
        raise _unknown_output(output_id) from exc


@router.get(
    "/outputs/{output_id}/image",
    response_class=FileResponse,
    responses={200: {"content": {"image/png": {}}}, 404: {"description": "Unknown output"}},
)
def get_output_image(output_id: OutputId, services: ServicesDep) -> FileResponse:
    try:
        return FileResponse(services.outputs.image_path(output_id), media_type="image/png")
    except OutputNotFound as exc:
        raise _unknown_output(output_id) from exc


@router.get(
    "/outputs/{output_id}/thumbnail",
    response_class=FileResponse,
    responses={200: {"content": {"image/webp": {}}}, 404: {"description": "Unknown output"}},
)
def get_output_thumbnail(output_id: OutputId, services: ServicesDep) -> FileResponse:
    """A small WebP copy of the output picture (filmstrips, lists), cached in the data dir."""
    try:
        return FileResponse(services.outputs.thumbnail_path(output_id), media_type="image/webp")
    except OutputNotFound as exc:
        raise _unknown_output(output_id) from exc


@router.post("/outputs/{output_id}/trash", response_model=OkResponse, responses={404: {"description": "Unknown output"}})
def trash_output(output_id: OutputId, services: ServicesDep) -> OkResponse:
    """Move the output (png + json) into the app-managed trash."""
    try:
        services.outputs.trash(output_id)
    except OutputNotFound as exc:
        raise _unknown_output(output_id) from exc
    return OkResponse()


@router.post("/trash/{output_id}/restore", response_model=OkResponse, responses={404: {"description": "Not in trash"}})
def restore_output(output_id: OutputId, services: ServicesDep) -> OkResponse:
    """Move a trashed output back into the output folder (undo of delete)."""
    try:
        services.outputs.restore(output_id)
    except OutputNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Output '{output_id}' is not in the trash.") from exc
    return OkResponse()
