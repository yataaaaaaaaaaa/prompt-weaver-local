"""Model installs (app/services/model_installs.py) and POST /api/models/install, GET /api/models/installs.

The provider and the download manager are test doubles (StubProvider, FakeDownloadManager); the local file
detection is the real LocalModelFiles on the temp model folders."""

from __future__ import annotations

import re
import threading
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.schemas import (
    InstalledModel,
    InstallJob,
    InstallRequest,
    InstallResponse,
    ModelSource,
    PreviewImage,
    RemoteFile,
    RemoteModel,
    RemoteModelVersion,
)
from app.services.container import FILE_HASH_CACHE_NAME
from app.services.downloads import DownloadSpec
from app.services.file_hashes import FileHashCache
from app.services.local_models import LocalModelFiles
from app.services.model_installs import InstallRejected, ModelInstallService, install_title
from app.services.model_providers import (
    ModelProviderRegistry,
    ProviderAuthError,
    ProviderError,
    ProviderNotFoundError,
    UnknownProviderError,
)
from app.services.model_providers.base import complete_version
from app.settings import AppPaths
from support import (
    MODEL_CONTENT,
    OTHER_MODEL_CONTENT,
    STUB_AUTH_HINT,
    STUB_DOWNLOAD_HEADERS,
    STUB_PROVIDER_ID,
    FakeDownloadManager,
    StubProvider,
    put_file,
    remote_file,
    sha256_of,
)

SFW_PREVIEW = "https://stub.example/images/sfw.jpeg"


def preview(name: str, *, nsfw: bool) -> PreviewImage:
    return PreviewImage(url=f"https://stub.example/images/{name}.jpeg", width=450, height=600, nsfw=nsfw)


def remote_model(
    *,
    model_id: str,
    name: str,
    version_id: str,
    version_name: str,
    files: list[RemoteFile],
    base_model: str = "Illustrious",
    architecture: str | None = "sdxl",
    images: list[PreviewImage] | None = None,
    version_page_url: str | None = None,
) -> RemoteModel:
    """A provider answer of get_version(): the model with only the requested version, completed by the shared
    install rules (complete_version) like every real provider does."""
    version = RemoteModelVersion(
        id=version_id,
        name=version_name,
        base_model=base_model,
        architecture=architecture,  # type: ignore[arg-type]
        trigger_words=["pixel art", "8bit"],
        published_at=None,
        images=images or [],
        files=files,
        page_url=version_page_url,
        default_file_id=None,
        unavailable_reason=None,
    )
    return RemoteModel(
        provider=STUB_PROVIDER_ID,
        id=model_id,
        name=name,
        kind="lora",
        creator="someone",
        nsfw=False,
        tags=["style"],
        download_count=1234,
        page_url=f"https://stub.example/models/{model_id}",
        versions=[complete_version(version)],
    )


PRIMARY_FILE = remote_file(MODEL_CONTENT, name="pixel_style.safetensors", file_id="11")
FP32_FILE = remote_file(OTHER_MODEL_CONTENT, name="pixel_style_fp32.safetensors", file_id="12", primary=False)
PICKLE_FILE = remote_file(b"pickle", name="pixel_style.ckpt", file_id="13", primary=False, downloadable=False)

PIXEL = remote_model(
    model_id="100",
    name="Pixel Style",
    version_id="200",
    version_name="v2.0",
    files=[FP32_FILE, PRIMARY_FILE, PICKLE_FILE],
    images=[preview("nsfw", nsfw=True), PreviewImage(url=SFW_PREVIEW, width=None, height=None, nsfw=False)],
)
# Another model whose file has the same name as PIXEL's primary file (other content).
TWIN = remote_model(
    model_id="101",
    name="Pixel Twin",
    version_id="201",
    version_name="v1",
    files=[remote_file(OTHER_MODEL_CONTENT, name="pixel_style.safetensors", file_id="21")],
    images=[preview("nsfw", nsfw=True)],
    version_page_url="https://stub.example/models/101?modelVersionId=201",
)
FLUX = remote_model(
    model_id="102",
    name="Flux Thing",
    version_id="202",
    version_name="v1",
    files=[remote_file(b"flux", name="flux.safetensors", file_id="31")],
    base_model="Flux.1 D",
    architecture=None,
)
PIXEL_TITLE = "Pixel Style - v2.0"


def build_service(paths: AppPaths, provider: StubProvider, downloads: FakeDownloadManager) -> ModelInstallService:
    local_files = LocalModelFiles(paths=paths, hashes=FileHashCache(paths.cache_dir / FILE_HASH_CACHE_NAME))
    return ModelInstallService(
        providers=ModelProviderRegistry([provider]),
        local_files=local_files,
        downloads=downloads,  # type: ignore[arg-type]
    )


@pytest.fixture()
def provider() -> StubProvider:
    return StubProvider(PIXEL, TWIN, FLUX)


@pytest.fixture()
def downloads() -> FakeDownloadManager:
    return FakeDownloadManager()


@pytest.fixture()
def service(app_paths: AppPaths, provider: StubProvider, downloads: FakeDownloadManager) -> ModelInstallService:
    return build_service(app_paths, provider, downloads)


@pytest.fixture()
def loras(app_paths: AppPaths) -> Path:
    return app_paths.model_dir("lora")


def request(version_id: str = "200", file_id: str | None = None, provider: str = STUB_PROVIDER_ID) -> InstallRequest:
    return InstallRequest(provider=provider, version_id=version_id, file_id=file_id)


def pixel_source(file: RemoteFile = PRIMARY_FILE) -> ModelSource:
    return ModelSource(
        provider=STUB_PROVIDER_ID,
        model_id="100",
        version_id="200",
        file_id=file.id,
        model_name="Pixel Style",
        version_name="v2.0",
        base_model="Illustrious",
        sha256=file.sha256,
        preview_url=SFW_PREVIEW,  # the first non-nsfw image
        trigger_words=["pixel art", "8bit"],
        page_url="https://stub.example/models/100",  # no version page: the model page
    )


def pixel_job(task_id: str = "download-1", file_id: str = "11") -> InstallJob:
    return InstallJob(
        task_id=task_id,
        provider=STUB_PROVIDER_ID,
        model_id="100",
        version_id="200",
        file_id=file_id,
        kind="lora",
        title=PIXEL_TITLE,
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


def test_install_title() -> None:
    assert install_title("Pixel Style", "v2.0") == PIXEL_TITLE


def test_a_file_already_present_by_path_is_installed_without_download(
    service: ModelInstallService, provider: StubProvider, downloads: FakeDownloadManager, loras: Path
) -> None:
    path = put_file(loras / "pixel_style.safetensors")

    response = service.install(request())

    assert response == InstallResponse(
        state="installed",
        task_id=None,
        installed=InstalledModel(kind="lora", name=PIXEL_TITLE, path=str(path), source=pixel_source()),
    )
    assert downloads.started == []
    assert provider.calls == [("get_version", "200")]
    assert service.jobs() == []


def test_the_source_prefers_the_version_page_and_skips_nsfw_previews(
    service: ModelInstallService, loras: Path
) -> None:
    path = put_file(loras / "pixel_style.safetensors", OTHER_MODEL_CONTENT)

    installed = service.install(request("201")).installed

    assert installed is not None
    assert installed.path == str(path)
    assert installed.name == "Pixel Twin - v1"
    assert installed.source.page_url == "https://stub.example/models/101?modelVersionId=201"
    assert installed.source.preview_url is None  # only an nsfw image


def test_a_renamed_copy_is_found_by_hash_once(
    service: ModelInstallService, downloads: FakeDownloadManager, loras: Path, hash_calls: list[Path]
) -> None:
    renamed = put_file(loras / "styles" / "Pixel Style (v2).safetensors")

    first = service.install(request())
    second = service.install(request())

    assert first.state == second.state == "installed"
    assert first.installed is not None and first.installed.path == str(renamed)
    assert second == first
    assert hash_calls == [renamed]
    assert downloads.started == []


def test_a_missing_file_is_downloaded_then_installed_from_the_hash_cache(
    service: ModelInstallService,
    provider: StubProvider,
    downloads: FakeDownloadManager,
    app_paths: AppPaths,
    hash_calls: list[Path],
) -> None:
    response = service.install(request())

    assert response == InstallResponse(state="downloading", task_id="download-1", installed=None)
    [(spec, on_complete)] = downloads.started
    assert spec == DownloadSpec(
        url="https://stub.example/download/200?file=11",
        dest=app_paths.prompt_lora_dir / "pixel_style.safetensors",
        title=PIXEL_TITLE,
        headers=STUB_DOWNLOAD_HEADERS,
        expected_sha256=sha256_of(MODEL_CONTENT),
        expected_size=len(MODEL_CONTENT),
        auth_hint=STUB_AUTH_HINT,
    )
    assert spec.dest.parent == app_paths.model_dir("lora")
    assert on_complete is not None
    assert ("download_source", "11") in provider.calls
    assert service.jobs() == [pixel_job()]

    dest = downloads.finish(0)
    response = service.install(request())

    assert response == InstallResponse(
        state="installed",
        task_id=None,
        installed=InstalledModel(kind="lora", name=PIXEL_TITLE, path=str(dest), source=pixel_source()),
    )
    assert hash_calls == []  # the completed download was remembered
    assert len(downloads.started) == 1
    assert service.jobs() == []


def test_an_explicit_file_is_installed(
    service: ModelInstallService, downloads: FakeDownloadManager, loras: Path
) -> None:
    assert service.install(request(file_id="12")).task_id == "download-1"
    [(spec, _)] = downloads.started
    assert spec.dest == loras / "pixel_style_fp32.safetensors"
    assert spec.expected_sha256 == sha256_of(OTHER_MODEL_CONTENT)
    assert service.jobs() == [pixel_job(file_id="12")]

    downloads.finish(0, OTHER_MODEL_CONTENT)
    installed = service.install(request(file_id="12")).installed
    assert installed is not None
    assert installed.source == pixel_source(FP32_FILE)


def test_a_running_install_is_joined_and_a_stopped_one_restarted(
    service: ModelInstallService, downloads: FakeDownloadManager
) -> None:
    assert service.install(request()).task_id == "download-1"
    assert service.install(request()).task_id == "download-1"
    assert len(downloads.started) == 1

    downloads.end("download-1")  # cancelled: no file
    assert service.install(request()).task_id == "download-2"
    assert service.jobs() == [pixel_job("download-2")]


def test_concurrent_identical_installs_start_one_download(app_paths: AppPaths, provider: StubProvider) -> None:
    downloads = FakeDownloadManager(start_delay_s=0.05)
    service = build_service(app_paths, provider, downloads)
    barrier = threading.Barrier(8)
    results: list[InstallResponse] = []
    errors: list[BaseException] = []

    def install() -> None:
        try:
            barrier.wait()
            results.append(service.install(request()))
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=install) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert [result.task_id for result in results] == ["download-1"] * 8
    assert len(downloads.started) == 1
    assert service.jobs() == [pixel_job()]


def test_jobs_lists_running_installs_in_start_order(
    service: ModelInstallService, downloads: FakeDownloadManager, loras: Path
) -> None:
    service.install(request())
    service.install(request("201"))

    twin_job = InstallJob(
        task_id="download-2",
        provider=STUB_PROVIDER_ID,
        model_id="101",
        version_id="201",
        file_id="21",
        kind="lora",
        title="Pixel Twin - v1",
    )
    assert service.jobs() == [pixel_job(), twin_job]
    # Both files are named pixel_style.safetensors: the second download takes the next target name.
    assert [spec.dest for spec, _ in downloads.started] == [
        loras / "pixel_style.safetensors",
        loras / "pixel_style-201.safetensors",
    ]

    downloads.end("download-1")
    assert service.jobs() == [twin_job]
    downloads.end("download-2")
    assert service.jobs() == []


@pytest.mark.parametrize(
    ("version_id", "file_id", "message"),
    [
        ("202", None, "Base model 'Flux.1 D' is not supported"),
        ("202", "31", "Base model 'Flux.1 D' is not supported"),
        ("200", "99", "has no file '99'"),
        ("200", "13", "'pixel_style.ckpt' (PickleTensor) cannot be downloaded"),
    ],
)
def test_files_that_cannot_be_installed_are_rejected(
    service: ModelInstallService,
    downloads: FakeDownloadManager,
    hash_calls: list[Path],
    version_id: str,
    file_id: str | None,
    message: str,
) -> None:
    with pytest.raises(InstallRejected, match=re.escape(message)):
        service.install(request(version_id, file_id))
    assert downloads.started == []
    assert hash_calls == []


def test_provider_errors_propagate(
    service: ModelInstallService, provider: StubProvider, downloads: FakeDownloadManager
) -> None:
    with pytest.raises(UnknownProviderError):
        service.install(request(provider="nope"))
    with pytest.raises(ProviderNotFoundError):
        service.install(request("999"))

    provider.models["300"] = PIXEL  # answers another version than the requested one
    with pytest.raises(ProviderError, match="did not return version 300"):
        service.install(request("300"))

    provider.error = ProviderAuthError("Stub requires an API token.")
    with pytest.raises(ProviderAuthError):
        service.install(request())
    assert downloads.started == []


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.fixture()
def api_downloads(
    app: FastAPI, app_paths: AppPaths, provider: StubProvider, downloads: FakeDownloadManager
) -> FakeDownloadManager:
    """Swaps the app's install service for one over StubProvider + FakeDownloadManager (real local files)."""
    app.state.services.installs = build_service(app_paths, provider, downloads)
    return downloads


def test_api_install_downloads_then_installs(client: TestClient, api_downloads: FakeDownloadManager) -> None:
    body = {"provider": STUB_PROVIDER_ID, "version_id": "200"}

    response = client.post("/api/models/install", json=body)
    assert response.status_code == 200
    assert response.json() == {"state": "downloading", "task_id": "download-1", "installed": None}
    assert "stub-secret-token" not in response.text

    jobs = client.get("/api/models/installs")
    assert jobs.status_code == 200
    assert jobs.json() == [pixel_job().model_dump(mode="json")]

    dest = api_downloads.finish(0)
    response = client.post("/api/models/install", json=body)
    assert response.status_code == 200
    assert response.json() == {
        "state": "installed",
        "task_id": None,
        "installed": {
            "kind": "lora",
            "name": PIXEL_TITLE,
            "path": str(dest),
            "source": pixel_source().model_dump(mode="json"),
        },
    }
    assert client.get("/api/models/installs").json() == []


def test_api_install_of_a_present_file(
    client: TestClient, api_downloads: FakeDownloadManager, loras: Path
) -> None:
    path = put_file(loras / "pixel_style.safetensors")

    response = client.post("/api/models/install", json={"provider": STUB_PROVIDER_ID, "version_id": "200", "file_id": "11"})

    assert response.status_code == 200
    assert response.json()["state"] == "installed"
    assert response.json()["installed"]["path"] == str(path)
    assert api_downloads.started == []


def test_api_install_rejections(client: TestClient, api_downloads: FakeDownloadManager) -> None:
    response = client.post("/api/models/install", json={"provider": STUB_PROVIDER_ID, "version_id": "200", "file_id": "13"})
    assert response.status_code == 409
    assert "cannot be downloaded" in response.json()["detail"]

    response = client.post("/api/models/install", json={"provider": STUB_PROVIDER_ID, "version_id": "202"})
    assert response.status_code == 409
    assert "not supported" in response.json()["detail"]
    assert api_downloads.started == []


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (ProviderNotFoundError("Model not found."), 404),
        (ProviderAuthError("Stub requires an API token."), 403),
        (ProviderError("Stub answered HTTP 500."), 502),
    ],
)
def test_api_install_maps_provider_errors(
    client: TestClient, api_downloads: FakeDownloadManager, provider: StubProvider, error: Exception, status: int
) -> None:
    provider.error = error
    response = client.post("/api/models/install", json={"provider": STUB_PROVIDER_ID, "version_id": "200"})
    assert response.status_code == status
    assert response.json() == {"detail": str(error)}


def test_api_install_of_an_unknown_provider(client: TestClient, api_downloads: FakeDownloadManager) -> None:
    response = client.post("/api/models/install", json={"provider": "nope", "version_id": "200"})
    assert response.status_code == 404
    assert response.json() == {"detail": "Unknown model provider 'nope'."}


def test_api_installs_is_empty_without_downloads(client: TestClient, api_downloads: FakeDownloadManager) -> None:
    assert client.get("/api/models/installs").json() == []
