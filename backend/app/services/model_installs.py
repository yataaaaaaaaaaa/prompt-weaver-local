"""Model installs: "make this provider file available locally", downloading it only when it is not already
on disk. The library itself is owned by the frontend library store ('library-store'): the backend returns an
InstalledModel (path + provenance) and the frontend registers it (libraryStore.registerInstalled).

install(request):
 1. model = provider.get_version(version_id) (versions == [version]); file = request.file_id or
    version.default_file_id (rules in model_providers/base.py: default_file / unavailable_reason).
    InstallRejected(version.unavailable_reason) when it is set, and when file_id is unknown or not downloadable.
 2. path = local_files.locate(kind, file, version_id): present -> {state: "installed", installed: InstalledModel}.
 3. else: an install of the same (provider, version, file) already downloading -> its task id; otherwise
    downloads.start(DownloadSpec(provider.download_source(...), dest=local_files.target_path(...),
    expected_sha256/size, title)) with on_complete=local_files.remember -> {state: "downloading", task_id}.
    The target name skips the destinations of the other running installs (two files with the same name).
    When the download completes, the frontend calls install() again: step 2 then answers "installed" from
    the hash cache, without hashing.
Thread-safe: concurrent identical requests start one download (locate() runs outside the lock, the running
installs are re-checked under it). Finished downloads leave the running list lazily (DownloadManager.is_active).

Display name (single owner: install_title below): "<model name> - <version name>"; used for
InstalledModel.name (the library entry name), InstallJob.title and the download task title.
Provenance (ModelSource, single owner: model_source below) is built from the provider's RemoteModel:
preview_url = first non-nsfw preview image, page_url = the version page (else the model page), sha256 = the
provider's file hash.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

from ..schemas import (
    InstalledModel,
    InstallJob,
    InstallRequest,
    InstallResponse,
    ModelSource,
    RemoteFile,
    RemoteModel,
    RemoteModelVersion,
)
from .downloads import DownloadManager, DownloadSpec
from .local_models import LocalModelFiles
from .model_providers import ModelProvider, ModelProviderRegistry, ProviderError
from .model_providers.base import version_file


def install_title(model_name: str, version_name: str) -> str:
    return f"{model_name} - {version_name}"


class InstallRejected(ValueError):
    """The requested file cannot be installed (HTTP 409); the message says why."""


def model_source(provider_id: str, model: RemoteModel, version: RemoteModelVersion, file: RemoteFile) -> ModelSource:
    """Provenance of `file` of `version` of `model` (stored with the library entry by the frontend)."""
    preview = next((image for image in version.images if not image.nsfw), None)
    return ModelSource(
        provider=provider_id,
        model_id=model.id,
        version_id=version.id,
        file_id=file.id,
        model_name=model.name,
        version_name=version.name,
        base_model=version.base_model,
        sha256=file.sha256,
        preview_url=preview.url if preview is not None else None,
        trigger_words=list(version.trigger_words),
        page_url=version.page_url or model.page_url,
    )


def _requested_version(provider: ModelProvider, model: RemoteModel, version_id: str) -> RemoteModelVersion:
    version = next((candidate for candidate in model.versions if candidate.id == version_id), None)
    if version is None:
        raise ProviderError(f"Model provider '{provider.id}' did not return version {version_id}.")
    return version


def _requested_file(version: RemoteModelVersion, file_id: str | None) -> RemoteFile:
    """The file to install; InstallRejected when it cannot be installed. The rules live in
    model_providers/base.py and are read here through version.unavailable_reason / version.default_file_id."""
    if version.unavailable_reason is not None:
        raise InstallRejected(version.unavailable_reason)
    wanted = file_id or version.default_file_id
    if wanted is None:
        raise InstallRejected(f"Version '{version.name}' has no file to install.")
    file = version_file(version, wanted)
    if file is None:
        raise InstallRejected(f"Version '{version.name}' has no file '{wanted}'.")
    if not file.downloadable:
        raise InstallRejected(f"File '{file.name}' ({file.format or 'unknown format'}) cannot be downloaded.")
    return file


def _downloading(task_id: str) -> InstallResponse:
    return InstallResponse(state="downloading", task_id=task_id, installed=None)


# (provider id, version id, file id) of an install.
_InstallKey = tuple[str, str, str]


@dataclass(frozen=True)
class _ActiveInstall:
    job: InstallJob
    dest: Path


class ModelInstallService:
    def __init__(
        self,
        *,
        providers: ModelProviderRegistry,
        local_files: LocalModelFiles,
        downloads: DownloadManager,
    ) -> None:
        self._providers = providers
        self._local_files = local_files
        self._downloads = downloads
        self._lock = threading.Lock()
        # Installs that started a download, in start order; finished ones are dropped by _prune_locked().
        self._active: dict[_InstallKey, _ActiveInstall] = {}

    def install(self, request: InstallRequest) -> InstallResponse:
        """See the module docstring. Raises UnknownProviderError, ProviderNotFoundError, ProviderAuthError,
        ProviderError (provider lookups) and InstallRejected."""
        provider = self._providers.get(request.provider)
        model = provider.get_version(request.version_id)
        version = _requested_version(provider, model, request.version_id)
        file = _requested_file(version, request.file_id)
        title = install_title(model.name, version.name)

        # Slow (may hash multi-GB candidates): outside the lock.
        path = self._local_files.locate(model.kind, file, version_id=version.id)
        if path is not None:
            installed = InstalledModel(
                kind=model.kind,
                name=title,
                path=str(path),
                source=model_source(provider.id, model, version, file),
            )
            return InstallResponse(state="installed", task_id=None, installed=installed)

        key: _InstallKey = (provider.id, version.id, file.id)
        with self._lock:
            running = self._prune_locked().get(key)
        if running is not None:
            return _downloading(running.job.task_id)

        source = provider.download_source(model, file)
        local_files = self._local_files
        with self._lock:
            # Re-check: an identical request may have started the download meanwhile.
            active = self._prune_locked()
            running = active.get(key)
            if running is not None:
                return _downloading(running.job.task_id)
            # A running install of another file with the same name keeps that name: this one takes the next.
            dest = local_files.target_path(
                model.kind, file, version_id=version.id, reserved=[other.dest for other in active.values()]
            )
            spec = DownloadSpec(
                url=source.url,
                dest=dest,
                title=title,
                headers=source.headers,
                expected_sha256=file.sha256,
                expected_size=file.size_bytes,
                auth_hint=source.auth_hint,
            )
            task_id = self._downloads.start(spec, on_complete=lambda done, sha256: local_files.remember(done, sha256))
            job = InstallJob(
                task_id=task_id,
                provider=provider.id,
                model_id=model.id,
                version_id=version.id,
                file_id=file.id,
                kind=model.kind,
                title=title,
            )
            active[key] = _ActiveInstall(job=job, dest=dest)
        return _downloading(task_id)

    def jobs(self) -> list[InstallJob]:
        """Installs whose download is still active (DownloadManager.is_active), in start order."""
        with self._lock:
            return [active.job for active in self._prune_locked().values()]

    def _prune_locked(self) -> dict[_InstallKey, _ActiveInstall]:
        """The running installs, after dropping those whose download ended. Call with the lock held."""
        for key, active in list(self._active.items()):
            if not self._downloads.is_active(active.job.task_id):
                del self._active[key]
        return self._active
