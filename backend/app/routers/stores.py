from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Path

from ..dependencies import ServicesDep
from ..schemas import STORE_NAME_PATTERN, OkResponse, PersistedStoreEnvelope, PersistedStoreRead
from ..services.persisted_stores import PersistedStoreUnreadable

router = APIRouter(prefix="/api/stores", tags=["stores"])

StoreName = Annotated[str, Path(pattern=STORE_NAME_PATTERN)]


@router.get("/{name}", response_model=PersistedStoreRead)
def read_store(name: StoreName, services: ServicesDep) -> PersistedStoreRead:
    """Persisted state of one frontend store (envelope is null when nothing was persisted yet)."""
    try:
        envelope = services.stores.read(name)
    except PersistedStoreUnreadable as exc:
        # An error (not "no data") keeps the frontend from overwriting the file; see persisted_stores.py.
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return PersistedStoreRead(name=name, envelope=envelope)


@router.put("/{name}", response_model=OkResponse)
def write_store(name: StoreName, envelope: PersistedStoreEnvelope, services: ServicesDep) -> OkResponse:
    services.stores.write(name, envelope)
    return OkResponse()


@router.delete("/{name}", response_model=OkResponse)
def delete_store(name: StoreName, services: ServicesDep) -> OkResponse:
    services.stores.delete(name)
    return OkResponse()
