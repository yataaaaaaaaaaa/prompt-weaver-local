"""Model installs: make a provider file available locally (download unless already on disk).

Route signatures are the API contract mirrored in backend/openapi.json and frontend/src/api/schema.gen.ts:
change them only together with `npm run gen:api`.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..dependencies import ServicesDep
from ..schemas import InstallJob, InstallRequest, InstallResponse
from ..services.model_installs import InstallRejected
from .provider_errors import PROVIDER_ERROR_RESPONSES, provider_http_errors

router = APIRouter(prefix="/api/models", tags=["models"])


@router.post(
    "/install",
    response_model=InstallResponse,
    responses={**PROVIDER_ERROR_RESPONSES, 409: {"description": "The file cannot be installed (see detail)"}},
)
def install_model(request: InstallRequest, services: ServicesDep) -> InstallResponse:
    """'installed' (+ InstalledModel) when the file is already on disk, else 'downloading' (+ task_id, progress
    as DownloadTaskEvent on /ws/tasks). Call again after the download completed to get the InstalledModel.
    Hashing a large local candidate can take seconds (sync route: runs in the threadpool)."""
    try:
        with provider_http_errors():
            return services.installs.install(request)
    except InstallRejected as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/installs", response_model=list[InstallJob])
def list_installs(services: ServicesDep) -> list[InstallJob]:
    """Installs whose download is still running."""
    return services.installs.jobs()
