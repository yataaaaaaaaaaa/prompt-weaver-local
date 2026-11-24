"""Service container stored on app.state.services."""

from __future__ import annotations

from dataclasses import dataclass

from ..settings import AppPaths
from .backend_settings import BackendSettingsStore
from .downloads import DownloadManager
from .file_hashes import FileHashCache
from .generation import GenerationService, GeneratorFactory
from .http import HttpClientFactory
from .legacy_state import LegacyStateService
from .local_models import LocalModelFiles
from .model_catalog import ModelCatalogService
from .model_installs import ModelInstallService
from .model_providers import ModelProviderRegistry
from .model_providers.civitai import CivitaiProvider
from .outputs import OutputRepository
from .persisted_stores import PersistedStoreRepository
from .task_hub import TaskHub

FILE_HASH_CACHE_NAME = "file_hashes.json"


@dataclass
class AppServices:
    paths: AppPaths
    legacy: LegacyStateService
    outputs: OutputRepository
    stores: PersistedStoreRepository
    tasks: TaskHub
    generation: GenerationService
    settings: BackendSettingsStore
    downloads: DownloadManager
    catalog: ModelCatalogService
    installs: ModelInstallService


def build_services(
    paths: AppPaths,
    generator_factory: GeneratorFactory,
    http_client_factory: HttpClientFactory,
) -> AppServices:
    """Construct every service. Performs no filesystem or network IO (the lifespan calls paths.ensure_dirs())."""
    outputs = OutputRepository(paths)
    tasks = TaskHub()
    settings = BackendSettingsStore(paths.settings_file)
    providers = ModelProviderRegistry([CivitaiProvider(client_factory=http_client_factory, settings=settings)])
    local_files = LocalModelFiles(paths=paths, hashes=FileHashCache(paths.cache_dir / FILE_HASH_CACHE_NAME))
    downloads = DownloadManager(tasks=tasks, client_factory=http_client_factory)
    return AppServices(
        paths=paths,
        legacy=LegacyStateService(paths),
        outputs=outputs,
        stores=PersistedStoreRepository(paths.stores_dir),
        tasks=tasks,
        generation=GenerationService(
            paths=paths,
            outputs=outputs,
            tasks=tasks,
            generator_factory=generator_factory,
        ),
        settings=settings,
        downloads=downloads,
        catalog=ModelCatalogService(paths=paths, providers=providers, local_files=local_files, settings=settings),
        installs=ModelInstallService(providers=providers, local_files=local_files, downloads=downloads),
    )
