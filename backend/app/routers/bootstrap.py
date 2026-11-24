from __future__ import annotations

from fastapi import APIRouter

from ..dependencies import ServicesDep
from ..schemas import BootstrapResponse

router = APIRouter(prefix="/api", tags=["bootstrap"])


@router.get("/bootstrap", response_model=BootstrapResponse)
def bootstrap(services: ServicesDep) -> BootstrapResponse:
    """Everything the frontend needs at startup (see BootstrapResponse field docs)."""
    legacy_library = services.legacy.load_library()
    legacy_state = services.legacy.load_state_for_bootstrap(legacy_library)
    output_ids = services.outputs.list_ids()
    last_output_id = legacy_state.last_output_id
    return BootstrapResponse(
        data_dir=str(services.paths.root),
        legacy_state=legacy_state,
        legacy_library=legacy_library,
        persisted_stores=services.stores.names_with_data(),
        output_ids=output_ids,
        current_output_id=last_output_id if last_output_id in output_ids else services.outputs.latest_id(),
    )
