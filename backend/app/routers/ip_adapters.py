"""IP-Adapter files of character reference images: status (and support for a model), installs.

Route signatures (paths, parameters, response models, `responses`) are the API contract mirrored in
backend/openapi.json and frontend/src/api/schema.gen.ts: change them only together with `npm run gen:api`.
Downloads are cancelled with POST /api/downloads/{task_id}/cancel and report progress on /ws/tasks.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from ..dependencies import ServicesDep
from ..schemas import IpAdapterInstallResponse, IpAdapterStatus
from ..services.ip_adapters import UnknownIpAdapterVariant

router = APIRouter(prefix="/api/ip-adapters", tags=["ip-adapters"])


@router.get("", response_model=IpAdapterStatus)
def ip_adapter_status(
    services: ServicesDep,
    model_path: Annotated[
        str | None,
        Query(description="Model (ModelSpec.path) to report the reference support of (IpAdapterStatus.support)."),
    ] = None,
) -> IpAdapterStatus:
    """Every IP-Adapter variant with its files (on disk, downloading), and the reference support of model_path."""
    return services.ip_adapters.status(model_path)


@router.post(
    "/{variant_id}/install",
    response_model=IpAdapterInstallResponse,
    responses={404: {"description": "Unknown variant"}},
)
def install_ip_adapter(variant_id: str, services: ServicesDep) -> IpAdapterInstallResponse:
    """Downloads the files of the variant that are not on disk yet (a running download is joined)."""
    try:
        return services.ip_adapters.install(variant_id)
    except UnknownIpAdapterVariant as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
