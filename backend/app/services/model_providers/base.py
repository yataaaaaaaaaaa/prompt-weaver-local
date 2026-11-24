"""Provider interfaces: ModelProvider, an online catalog of checkpoints / LoRAs / embeddings (Civitai today; e.g.
Hugging Face later), and ImageProvider, an online gallery of generated images with their generation data
(Civitai). A provider maps its own API onto the provider-agnostic schemas of app/schemas.py (RemoteModel,
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
    ImagePeriod,
    ImageSearchPage,
    ImageSort,
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


def version_file(version: RemoteModelVersion, file_id: str | None) -> RemoteFile | None:
    """The file of `version` with this id (None when file_id is None or unknown)."""
    return next((file for file in version.files if file.id == file_id), None) if file_id is not None else None


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
        """The model version whose file has this hash, same shape as get_version(). `sha256` is a lowercase hex
        file hash as normalized by services/file_hashes.py normalize_file_hash: a SHA-256, or a short provider
        hash (Civitai AutoV2 10 / AutoV3 12 hex, published by online images); anything else -> ProviderNotFoundError."""
        ...

    def download_source(self, version: RemoteModel, file: RemoteFile) -> DownloadSource:
        """URL + headers (API token when one is stored) to download `file` of `version`."""
        ...


# ---------------------------------------------------------------------------
# Image galleries (image library)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ImageFeedRequest:
    """One page of a provider's image feed. services/image_library.py builds it from an ImageSearchQuery: the
    unfiltered feed (model_id None, with a period) or one model's gallery (model_id set, period None: Civitai
    answers empty or partial pages for a gallery + period). model_version_id narrows the gallery to that version
    of the model (providers use it when set: Civitai answers version galleries far faster than model galleries)."""

    sort: ImageSort
    nsfw: bool
    limit: int
    period: ImagePeriod | None = None
    model_id: str | None = None
    model_version_id: str | None = None
    # Base model ids of the provider (BaseModelOption.id) the images must be made with; empty = any.
    base_models: tuple[str, ...] = ()
    cursor: str | None = None


class ImageProvider(Protocol):
    """An online image gallery (thread-safe). It shares its id with the ModelProvider that resolves the images'
    resources (ImageResource.version_id / hash -> ModelProvider.get_version / find_by_hash). Same errors as
    ModelProvider (ProviderAuthError, ProviderError, ProviderNotFoundError)."""

    @property
    def id(self) -> str: ...

    def search_images(self, request: ImageFeedRequest) -> ImageSearchPage:
        """One page of images with their generation data and resources parsed from the image metadata. Images
        rated nsfw are dropped unless request.nsfw; next_cursor is the provider's own cursor (None on the last
        page)."""
        ...
