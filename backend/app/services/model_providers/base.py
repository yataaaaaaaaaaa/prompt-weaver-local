"""Model provider interface: an online catalog of checkpoints / LoRAs / embeddings (Civitai today; e.g. Hugging
Face later). A provider maps its own API onto the provider-agnostic schemas of app/schemas.py (RemoteModel,
RemoteModelVersion, RemoteFile, ...) and tells the download manager how to fetch a file. It never touches the
local disk: local copies are the business of services/local_models.py, downloads of services/downloads.py.

Errors raised by providers (routers map them to HTTP statuses):
    UnknownProviderError   no provider with that id                         -> 404
    ProviderNotFoundError  unknown model / version / hash at the provider   -> 404
    ProviderAuthError      the provider requires or rejected an API token   -> 403
    ProviderError          network failure, 5xx, malformed payload           -> 502
Messages must never contain the API token.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Protocol

from ...schemas import (
    ModelProviderInfo,
    ModelSearchPage,
    ModelSearchQuery,
    RemoteFile,
    RemoteModel,
    RemoteModelVersion,
)


class ProviderError(RuntimeError):
    """The provider could not be reached or answered something unusable (HTTP 502)."""


class ProviderAuthError(ProviderError):
    """The provider requires an API token for this request, or rejected the stored one (HTTP 403)."""


class ProviderNotFoundError(LookupError):
    """Unknown model, version or hash at the provider (HTTP 404)."""


class UnknownProviderError(LookupError):
    """No registered provider has this id (HTTP 404)."""


@dataclass(frozen=True)
class DownloadSource:
    """How to download one RemoteFile (input of services/downloads.py DownloadSpec)."""

    url: str
    # May hold credentials (e.g. "Authorization: Bearer <token>"): never log them.
    headers: Mapping[str, str] = field(default_factory=dict, repr=False)
    # User-facing message used when the download answers 401/403 (e.g. "add a Civitai API token").
    auth_hint: str | None = None


# ---------------------------------------------------------------------------
# Install rules shared by every provider (they fill RemoteModelVersion.default_file_id / unavailable_reason
# with complete_version) and by services/model_installs.py. The frontend only reads those two fields.
# ---------------------------------------------------------------------------


def default_file(files: list[RemoteFile]) -> RemoteFile | None:
    """The file an install uses when none is requested: the primary file when downloadable, else the first
    downloadable file; None when no file can be downloaded."""
    downloadable = [file for file in files if file.downloadable]
    return next((file for file in downloadable if file.primary), downloadable[0] if downloadable else None)


def unavailable_reason(version: RemoteModelVersion) -> str | None:
    """Why `version` cannot be installed (None when it can): its base model is not loadable by the local
    runtime (architecture None), or none of its files is downloadable."""
    if version.architecture is None:
        return f"Base model '{version.base_model}' is not supported by the local runtime."
    if default_file(version.files) is None:
        return "No downloadable file (only SafeTensors files are downloaded)."
    return None


def complete_version(version: RemoteModelVersion) -> RemoteModelVersion:
    """`version` with default_file_id and unavailable_reason computed from its files and architecture.
    Providers call it on every version they return."""
    chosen = default_file(version.files)
    return version.model_copy(
        update={
            "default_file_id": chosen.id if chosen is not None else None,
            "unavailable_reason": unavailable_reason(version),
        }
    )


class ModelProvider(Protocol):
    """One online model catalog. Implementations are thread-safe (routes run in the threadpool) and read their
    API token themselves from services/backend_settings.py (BackendSettingsStore.get_token(self.id))."""

    @property
    def id(self) -> str:
        """Stable id used in API paths and ModelSource.provider (e.g. "civitai"). Never rename."""
        ...

    def info(self) -> ModelProviderInfo:
        """Static capabilities (kinds, base-model filter options with their architecture, sorts) + token_set."""
        ...

    def search(self, query: ModelSearchQuery) -> ModelSearchPage:
        """One page of results. Only models of the kinds the app supports are returned; RemoteFile.local_path
        is always None here (services/model_catalog.py annotates it)."""
        ...

    def get_version(self, version_id: str) -> RemoteModel:
        """The model owning `version_id`, with `versions` == [that version] (full file list)."""
        ...

    def find_by_hash(self, sha256: str) -> RemoteModel:
        """The model version whose file has this SHA-256 (lowercase hex), same shape as get_version()."""
        ...

    def download_source(self, version: RemoteModel, file: RemoteFile) -> DownloadSource:
        """URL + headers (API token when one is stored) to download `file` of `version`."""
        ...
