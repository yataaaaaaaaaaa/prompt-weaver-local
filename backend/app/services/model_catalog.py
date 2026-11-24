"""Read side of the model library: provider capabilities, search and version / hash lookups (annotated with
the local copies LocalModelFiles already knows about), and provider API tokens.

- info(): every registered provider's ModelProviderInfo + the model folders (AppPaths.model_dirs()).
- search / get_version / find_by_hash: delegate to the provider, then set RemoteFile.local_path with
  LocalModelFiles.known_path(model.kind, file) (cheap: never hashes, so searching stays fast). find_by_hash accepts
  short provider hashes too (normalize_file_hash): the image library resolves the AutoV2 / AutoV3 hashes of images.
- set_token: BackendSettingsStore.set_token(provider.id, token) (validates the provider first, and that it
  supports tokens) and returns the provider's refreshed info. The token is never returned nor logged.
Errors: UnknownProviderError / Provider* exceptions from services/model_providers propagate to the router.
"""

from __future__ import annotations

from ..schemas import (
    ModelLibraryInfo,
    ModelProviderInfo,
    ModelSearchPage,
    ModelSearchQuery,
    RemoteFile,
    RemoteModel,
)
from ..settings import AppPaths
from .backend_settings import BackendSettingsStore
from .file_hashes import normalize_file_hash
from .local_models import LocalModelFiles
from .model_providers import ModelProviderRegistry


class TokenNotSupportedError(ValueError):
    """The provider takes no API token (HTTP 409)."""


class ModelCatalogService:
    def __init__(
        self,
        *,
        paths: AppPaths,
        providers: ModelProviderRegistry,
        local_files: LocalModelFiles,
        settings: BackendSettingsStore,
    ) -> None:
        self._paths = paths
        self._providers = providers
        self._local_files = local_files
        self._settings = settings

    def info(self) -> ModelLibraryInfo:
        return ModelLibraryInfo(
            providers=[provider.info() for provider in self._providers.all()],
            model_dirs=self._paths.model_dirs(),
        )

    def search(self, query: ModelSearchQuery) -> ModelSearchPage:
        page = self._providers.get(query.provider).search(query)
        return page.model_copy(update={"items": [self._with_local_paths(model) for model in page.items]})

    def get_version(self, provider_id: str, version_id: str) -> RemoteModel:
        return self._with_local_paths(self._providers.get(provider_id).get_version(version_id))

    def find_by_hash(self, provider_id: str, sha256: str) -> RemoteModel:
        """`sha256`: a file hash in any case, a SHA-256 or a short provider hash (e.g. the Civitai AutoV2 / AutoV3
        hashes online images publish); normalized with normalize_file_hash before the provider call. Anything else
        is passed as is: the provider answers ProviderNotFoundError without a request."""
        provider = self._providers.get(provider_id)
        return self._with_local_paths(provider.find_by_hash(normalize_file_hash(sha256) or sha256))

    def set_token(self, provider_id: str, token: str | None) -> ModelProviderInfo:
        provider = self._providers.get(provider_id)
        if not provider.info().token_supported:
            raise TokenNotSupportedError(f"The model provider '{provider.id}' takes no API token.")
        self._settings.set_token(provider.id, token)
        return provider.info()

    def _with_local_paths(self, model: RemoteModel) -> RemoteModel:
        """`model` with RemoteFile.local_path set from LocalModelFiles.known_path (cheap: never hashes)."""
        return model.model_copy(
            update={
                "versions": [
                    version.model_copy(
                        update={"files": [self._with_local_path(model, file) for file in version.files]}
                    )
                    for version in model.versions
                ]
            }
        )

    def _with_local_path(self, model: RemoteModel, file: RemoteFile) -> RemoteFile:
        path = self._local_files.known_path(model.kind, file)
        return file.model_copy(update={"local_path": str(path) if path is not None else None})
