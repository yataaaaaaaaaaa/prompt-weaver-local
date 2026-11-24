"""IP-Adapter files (app/services/ip_adapters.py): the pinned catalog (checked against the real Hugging Face answers
in tests/fixtures/huggingface), the on-disk status, the support rule shared with generation, and installs.

Service tests run on a tiny injected catalog (files of a few bytes written with put_file, see TINY_CATALOG) and a
fake model family detector; downloads go to FakeDownloadManager and the on-disk detection is the real
LocalModelFiles on the temp model folders. test_ip_adapters_api.py reuses the tiny catalog."""

from __future__ import annotations

import subprocess
import sys
import threading
from itertools import product
from pathlib import Path
from typing import Any, get_args

import pytest

from app.schemas import (
    IpAdapterFile,
    IpAdapterFolders,
    IpAdapterInstallResponse,
    IpAdapterStatus,
    IpAdapterVariant,
    ModelArchitecture,
    ReferenceFocus,
    ReferenceSupport,
)
from app.services.container import FILE_HASH_CACHE_NAME
from app.services.downloads import DownloadSpec
from app.services.file_hashes import FileHashCache
from app.services.ip_adapters import (
    DOWNLOAD_VERSION_ID,
    HF_REPO,
    HF_REVISION,
    IMAGE_ENCODER_VIT_H,
    IP_ADAPTER_CATALOG,
    REFERENCE_FOCUSES,
    UNSUPPORTED_MODEL_REASON,
    IpAdapterFileSpec,
    IpAdapterResolution,
    IpAdapterService,
    UnknownIpAdapterVariant,
)
from app.services.local_models import LocalModelFiles
from app.settings import AppPaths
from support import (
    ENCODER_CONTENT,
    FACE_CONTENT,
    FLUX_MODEL,
    GENERAL_CONTENT,
    SD15_MODEL,
    SDXL_MODEL,
    TINY_CATALOG,
    TINY_ENCODER,
    TINY_FACE,
    TINY_GENERAL,
    FakeDownloadManager,
    fake_architecture_of,
    load_fixture,
    put_file,
    put_tiny,
    tiny_service,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# The real catalog against the Hugging Face answers it was probed from
# ---------------------------------------------------------------------------

HF_TREE_FIXTURES = (
    "huggingface/ip_adapter_tree_models.json",
    "huggingface/ip_adapter_tree_sdxl_models.json",
    "huggingface/ip_adapter_tree_image_encoder.json",
)


def published_files() -> dict[str, dict[str, Any]]:
    """Hugging Face tree entries of the files of h94/IP-Adapter at the pinned revision, by repo path."""
    entries = [entry for fixture in HF_TREE_FIXTURES for entry in load_fixture(fixture)]
    return {entry["path"]: entry for entry in entries if entry["type"] == "file"}


def catalog_files() -> list[IpAdapterFileSpec]:
    return list({file.id: file for variant in IP_ADAPTER_CATALOG.variants for file in variant.files}.values())


def test_the_catalog_matches_the_hugging_face_files() -> None:
    published = published_files()
    files = catalog_files()
    assert len(files) == 5  # 4 adapters + the shared encoder
    for file in files:
        entry = published[file.repo_path]
        assert entry["size"] == file.size_bytes, file.id
        assert entry["lfs"]["oid"] == file.sha256, file.id
        assert entry["lfs"]["size"] == file.size_bytes, file.id
        assert file.name.endswith(".safetensors")


def test_the_catalog_is_pinned_to_the_probed_revision() -> None:
    revision = load_fixture("huggingface/ip_adapter_revision.json")
    assert (revision["id"], revision["sha"]) == (HF_REPO, HF_REVISION)
    assert DOWNLOAD_VERSION_ID == HF_REVISION[:12]
    assert IMAGE_ENCODER_VIT_H.url == (
        f"https://huggingface.co/h94/IP-Adapter/resolve/{revision['sha']}/models/image_encoder/model.safetensors"
    )
    for file in catalog_files():
        assert file.url == f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}/{file.repo_path}"


def test_one_variant_per_family_and_focus_all_on_the_vit_h_encoder() -> None:
    variants = IP_ADAPTER_CATALOG.variants
    pairs = [(variant.architecture, variant.focus) for variant in variants]
    assert sorted(pairs) == sorted(product(get_args(ModelArchitecture), get_args(ReferenceFocus)))
    for variant in variants:
        assert variant.image_encoder == IMAGE_ENCODER_VIT_H
        assert variant.adapter.role == "adapter"
        assert variant.files == (variant.adapter, IMAGE_ENCODER_VIT_H)
        assert IP_ADAPTER_CATALOG.variant(variant.id) is variant
        assert IP_ADAPTER_CATALOG.for_model(variant.architecture, variant.focus) is variant
    assert IMAGE_ENCODER_VIT_H.role == "image_encoder"
    # ComfyUI names: the adapters keep their Hugging Face file name, the encoder gets ComfyUI's ViT-H name.
    assert all(variant.adapter.name == variant.adapter.repo_path.rsplit("/", 1)[-1] for variant in variants)
    assert IMAGE_ENCODER_VIT_H.name == "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"
    assert IP_ADAPTER_CATALOG.variant("sdxl-vit-g") is None


def test_ids_and_names_are_unique() -> None:
    variants = IP_ADAPTER_CATALOG.variants
    assert len({variant.id for variant in variants}) == len(variants)
    by_id: dict[str, IpAdapterFileSpec] = {}
    for variant in variants:
        for file in variant.files:
            # One id, one file (the shared encoder is the very same spec everywhere).
            assert by_id.setdefault(file.id, file) == file
    files = list(by_id.values())
    assert len({file.name.casefold() for file in files}) == len(files)
    assert len({file.repo_path for file in files}) == len(files)


def test_reference_focuses_follow_the_schema_literal() -> None:
    assert REFERENCE_FOCUSES == ("face", "general")


# ---------------------------------------------------------------------------
# status: cheap on-disk check
# ---------------------------------------------------------------------------


@pytest.fixture()
def downloads() -> FakeDownloadManager:
    return FakeDownloadManager()


@pytest.fixture()
def hashes(app_paths: AppPaths) -> FileHashCache:
    return FileHashCache(app_paths.cache_dir / FILE_HASH_CACHE_NAME)


@pytest.fixture()
def local_files(app_paths: AppPaths, hashes: FileHashCache) -> LocalModelFiles:
    return LocalModelFiles(paths=app_paths, hashes=hashes)


@pytest.fixture()
def service(app_paths: AppPaths, downloads: FakeDownloadManager, local_files: LocalModelFiles) -> IpAdapterService:
    return tiny_service(app_paths, downloads, local_files=local_files)


def file_status(
    file: IpAdapterFileSpec, local_path: Path | None = None, task_id: str | None = None
) -> IpAdapterFile:
    return IpAdapterFile(
        id=file.id,
        role=file.role,
        name=file.name,
        size_bytes=file.size_bytes,
        local_path=str(local_path) if local_path is not None else None,
        task_id=task_id,
    )


def files_of(status: IpAdapterStatus, variant_id: str) -> list[IpAdapterFile]:
    return next(variant.files for variant in status.variants if variant.id == variant_id)


def test_status_lists_every_variant_with_its_missing_files(service: IpAdapterService, app_paths: AppPaths) -> None:
    status = service.status(None)

    assert status == IpAdapterStatus(
        variants=[
            IpAdapterVariant(
                id="sdxl-face",
                label="SDXL face",
                architecture="sdxl",
                focus="face",
                files=[file_status(TINY_FACE), file_status(TINY_ENCODER)],
                ready=False,
            ),
            IpAdapterVariant(
                id="sdxl-general",
                label="SDXL general",
                architecture="sdxl",
                focus="general",
                files=[file_status(TINY_GENERAL), file_status(TINY_ENCODER)],
                ready=False,
            ),
        ],
        folders=IpAdapterFolders(adapter=str(app_paths.ip_adapter_dir), image_encoder=str(app_paths.image_encoder_dir)),
        architecture=None,
        support=[],
    )
    assert app_paths.ip_adapter_dir == app_paths.models_root / "ipadapter"
    assert app_paths.image_encoder_dir == app_paths.models_root / "clip_vision"
    # Nothing is created by a status.
    assert not app_paths.models_root.exists()


def test_status_finds_files_by_name_and_size_without_hashing(
    service: IpAdapterService, app_paths: AppPaths, hash_calls: list[Path]
) -> None:
    face = put_tiny(app_paths, TINY_FACE)
    encoder = put_tiny(app_paths, TINY_ENCODER)
    # Not found by the cheap check: in the folder of the other role, in a sub-folder without a cached hash (only
    # install's full check hashes it), or with the right name but another size.
    put_file(app_paths.image_encoder_dir / TINY_GENERAL.name, GENERAL_CONTENT)
    put_file(app_paths.ip_adapter_dir / "sub" / TINY_GENERAL.name, GENERAL_CONTENT)
    put_file(app_paths.ip_adapter_dir / TINY_GENERAL.name, GENERAL_CONTENT + b"!")

    status = service.status(None)

    assert files_of(status, "sdxl-face") == [file_status(TINY_FACE, face), file_status(TINY_ENCODER, encoder)]
    assert files_of(status, "sdxl-general") == [file_status(TINY_GENERAL), file_status(TINY_ENCODER, encoder)]
    assert [variant.ready for variant in status.variants] == [True, False]
    assert hash_calls == []


def test_status_finds_a_renamed_copy_by_its_cached_hash(
    service: IpAdapterService, local_files: LocalModelFiles, app_paths: AppPaths, hash_calls: list[Path]
) -> None:
    renamed = put_tiny(app_paths, TINY_ENCODER, name="clip-vit-h (renamed).safetensors")
    assert files_of(service.status(None), "sdxl-face")[1] == file_status(TINY_ENCODER)

    local_files.remember(renamed, TINY_ENCODER.sha256)

    assert files_of(service.status(None), "sdxl-face")[1] == file_status(TINY_ENCODER, renamed)
    assert hash_calls == []


def test_status_with_a_model_reports_its_family_and_the_support_of_every_focus(
    app_paths: AppPaths, downloads: FakeDownloadManager
) -> None:
    detected: list[str] = []

    def recording_detector(model_path: str) -> ModelArchitecture | None:
        detected.append(model_path)
        return fake_architecture_of(model_path)

    service = IpAdapterService(
        paths=app_paths,
        local_files=LocalModelFiles(paths=app_paths, hashes=FileHashCache(app_paths.cache_dir / FILE_HASH_CACHE_NAME)),
        downloads=downloads,  # type: ignore[arg-type]
        catalog=TINY_CATALOG,
        architecture_of=recording_detector,
    )
    put_tiny(app_paths, TINY_FACE)
    put_tiny(app_paths, TINY_ENCODER)

    status = service.status(SDXL_MODEL)

    assert status.architecture == "sdxl"
    assert status.support == [service.resolve(SDXL_MODEL, "face").support, service.resolve(SDXL_MODEL, "general").support]
    assert status.support == [
        ReferenceSupport(focus="face", variant_id="sdxl-face", ready=True, reason=None),
        ReferenceSupport(
            focus="general",
            variant_id="sdxl-general",
            ready=False,
            reason="Download the IP-Adapter 'SDXL general' to use reference images.",
        ),
    ]
    assert detected == [SDXL_MODEL] * 3  # once per status, once per resolve

    unsupported = service.status(FLUX_MODEL)
    assert unsupported.architecture is None
    assert [support.focus for support in unsupported.support] == ["face", "general"]
    assert {support.reason for support in unsupported.support} == {UNSUPPORTED_MODEL_REASON}

    # An empty model path is no model.
    assert service.status("").support == []
    assert service.status("").architecture is None


# ---------------------------------------------------------------------------
# resolve: the support rule generation uses
# ---------------------------------------------------------------------------


def test_resolve_an_unknown_model_family(service: IpAdapterService) -> None:
    assert service.resolve(FLUX_MODEL, "face") == IpAdapterResolution(
        support=ReferenceSupport(focus="face", variant_id=None, ready=False, reason=UNSUPPORTED_MODEL_REASON),
        architecture=None,
        adapter_path=None,
        image_encoder_path=None,
    )
    # User-facing: no path in the reason.
    assert UNSUPPORTED_MODEL_REASON == (
        "This model cannot use reference images: IP-Adapters need an SD 1.5 or SDXL model."
    )


def test_resolve_a_family_without_a_variant(service: IpAdapterService) -> None:
    assert service.resolve(SD15_MODEL, "general") == IpAdapterResolution(
        support=ReferenceSupport(
            focus="general",
            variant_id=None,
            ready=False,
            reason="No IP-Adapter for this model with the general focus.",
        ),
        architecture="sd15",
        adapter_path=None,
        image_encoder_path=None,
    )


def test_resolve_a_missing_file(service: IpAdapterService, app_paths: AppPaths) -> None:
    put_tiny(app_paths, TINY_ENCODER)

    assert service.resolve(SDXL_MODEL, "face") == IpAdapterResolution(
        support=ReferenceSupport(
            focus="face",
            variant_id="sdxl-face",
            ready=False,
            reason="Download the IP-Adapter 'SDXL face' to use reference images.",
        ),
        architecture="sdxl",
        adapter_path=None,
        image_encoder_path=None,
    )


def test_resolve_a_downloading_file(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager
) -> None:
    service.install("sdxl-face")  # adapter + encoder downloading

    downloading = service.resolve(SDXL_MODEL, "face").support
    assert downloading == ReferenceSupport(
        focus="face", variant_id="sdxl-face", ready=False, reason="The IP-Adapter 'SDXL face' is downloading."
    )
    # The shared encoder is downloading, but the general adapter still has to be downloaded.
    assert service.resolve(SDXL_MODEL, "general").support.reason == (
        "Download the IP-Adapter 'SDXL general' to use reference images."
    )
    # A download that stopped without a file (cancelled, failed): download again.
    downloads.end("download-1")
    assert service.resolve(SDXL_MODEL, "face").support.reason == (
        "Download the IP-Adapter 'SDXL face' to use reference images."
    )


def test_resolve_ready_with_the_local_paths(
    service: IpAdapterService, local_files: LocalModelFiles, app_paths: AppPaths, hash_calls: list[Path]
) -> None:
    face = put_tiny(app_paths, TINY_FACE)
    encoder = put_tiny(app_paths, TINY_ENCODER, name="renamed encoder.safetensors")
    local_files.remember(encoder, TINY_ENCODER.sha256)

    assert service.resolve(SDXL_MODEL, "face") == IpAdapterResolution(
        support=ReferenceSupport(focus="face", variant_id="sdxl-face", ready=True, reason=None),
        architecture="sdxl",
        adapter_path=face,
        image_encoder_path=encoder,
    )
    assert hash_calls == []


def test_the_default_detector_is_the_runtime_pipeline_architecture() -> None:
    from diffusion_lora_runtime.checkpoint_inspection import pipeline_architecture

    defaults = IpAdapterService.__init__.__kwdefaults__
    assert defaults is not None
    assert defaults["architecture_of"] is pipeline_architecture
    assert defaults["catalog"] is IP_ADAPTER_CATALOG


# ---------------------------------------------------------------------------
# install
# ---------------------------------------------------------------------------


def download_spec(paths: AppPaths, file: IpAdapterFileSpec, dest: Path | None = None) -> DownloadSpec:
    folder = paths.ip_adapter_dir if file.role == "adapter" else paths.image_encoder_dir
    return DownloadSpec(
        url=f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}/{file.repo_path}",
        dest=dest or folder / file.name,
        title=f"IP-Adapter {file.name}",
        expected_sha256=file.sha256,
        expected_size=file.size_bytes,
    )


def started_specs(downloads: FakeDownloadManager) -> list[DownloadSpec]:
    return [spec for spec, _on_complete in downloads.started]


def test_install_an_unknown_variant(service: IpAdapterService, downloads: FakeDownloadManager) -> None:
    with pytest.raises(UnknownIpAdapterVariant, match="sd15-face"):
        service.install("sd15-face")
    assert downloads.started == []


def test_install_when_every_file_is_local(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager
) -> None:
    put_tiny(app_paths, TINY_FACE)
    put_tiny(app_paths, TINY_ENCODER)

    assert service.install("sdxl-face") == IpAdapterInstallResponse(state="installed", task_ids=[])
    assert downloads.started == []


def test_install_downloads_each_missing_file_in_file_order(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager
) -> None:
    assert service.install("sdxl-face") == IpAdapterInstallResponse(
        state="downloading", task_ids=["download-1", "download-2"]
    )
    assert started_specs(downloads) == [download_spec(app_paths, TINY_FACE), download_spec(app_paths, TINY_ENCODER)]
    # Hugging Face is public: no header, no token, no auth hint.
    assert all(spec.headers == {} and spec.auth_hint is None for spec in started_specs(downloads))

    # Asking again joins the running downloads.
    assert service.install("sdxl-face").task_ids == ["download-1", "download-2"]
    assert len(downloads.started) == 2


def test_install_downloads_only_the_missing_file(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager
) -> None:
    put_tiny(app_paths, TINY_ENCODER)

    assert service.install("sdxl-face") == IpAdapterInstallResponse(state="downloading", task_ids=["download-1"])
    assert started_specs(downloads) == [download_spec(app_paths, TINY_FACE)]


def test_install_joins_the_shared_encoder_across_variants(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager
) -> None:
    assert service.install("sdxl-face").task_ids == ["download-1", "download-2"]
    assert service.install("sdxl-general").task_ids == ["download-3", "download-2"]

    assert started_specs(downloads) == [
        download_spec(app_paths, TINY_FACE),
        download_spec(app_paths, TINY_ENCODER),
        download_spec(app_paths, TINY_GENERAL),
    ]


def test_concurrent_installs_download_the_shared_encoder_once(app_paths: AppPaths) -> None:
    downloads = FakeDownloadManager(start_delay_s=0.02)
    service = tiny_service(app_paths, downloads)
    barrier = threading.Barrier(4)
    answers: list[IpAdapterInstallResponse] = []
    answers_lock = threading.Lock()

    def install(variant_id: str) -> None:
        barrier.wait()
        answer = service.install(variant_id)
        with answers_lock:
            answers.append(answer)

    threads = [
        threading.Thread(target=install, args=(variant_id,))
        for variant_id in ("sdxl-face", "sdxl-general", "sdxl-face", "sdxl-general")
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    dests = sorted(spec.dest.name for spec in started_specs(downloads))
    assert dests == sorted([TINY_FACE.name, TINY_GENERAL.name, TINY_ENCODER.name])
    encoder_tasks = {answer.task_ids[1] for answer in answers}
    assert len(answers) == 4 and len(encoder_tasks) == 1


def test_status_shows_the_running_downloads_until_they_end(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager, hash_calls: list[Path]
) -> None:
    service.install("sdxl-face")
    assert files_of(service.status(None), "sdxl-face") == [
        file_status(TINY_FACE, task_id="download-1"),
        file_status(TINY_ENCODER, task_id="download-2"),
    ]
    assert files_of(service.status(None), "sdxl-general")[1] == file_status(TINY_ENCODER, task_id="download-2")

    face = downloads.finish(0, FACE_CONTENT)
    downloads.end("download-2")  # cancelled

    status = service.status(None)
    assert files_of(status, "sdxl-face") == [file_status(TINY_FACE, face), file_status(TINY_ENCODER)]
    assert not status.variants[0].ready

    # A new install downloads the encoder again (the ended task is forgotten).
    assert service.install("sdxl-face") == IpAdapterInstallResponse(state="downloading", task_ids=["download-3"])
    encoder = downloads.finish(2, ENCODER_CONTENT)

    status = service.status(SDXL_MODEL)
    assert files_of(status, "sdxl-face") == [file_status(TINY_FACE, face), file_status(TINY_ENCODER, encoder)]
    assert status.variants[0].ready
    assert status.support[0] == ReferenceSupport(focus="face", variant_id="sdxl-face", ready=True, reason=None)
    # on_complete recorded the verified hashes: the full check of the next install hashes nothing.
    assert service.install("sdxl-face") == IpAdapterInstallResponse(state="installed", task_ids=[])
    assert hash_calls == []


def test_on_complete_remembers_the_hash(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager, hashes: FileHashCache
) -> None:
    service.install("sdxl-face")
    _spec, on_complete = downloads.started[0]
    assert on_complete is not None

    face = downloads.finish(0, FACE_CONTENT)

    assert hashes.cached_sha256(face) == TINY_FACE.sha256


def test_install_finds_a_renamed_copy_by_hashing_it_once(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager, hash_calls: list[Path]
) -> None:
    renamed = put_tiny(app_paths, TINY_FACE, name="faces/My face adapter.safetensors")
    encoder = put_tiny(app_paths, TINY_ENCODER)
    assert files_of(service.status(None), "sdxl-face")[0] == file_status(TINY_FACE)

    assert service.install("sdxl-face") == IpAdapterInstallResponse(state="installed", task_ids=[])
    assert downloads.started == []
    assert sorted(hash_calls) == sorted([renamed, encoder])

    # The hashes found are cached: the cheap check now finds the renamed copy, without hashing.
    hash_calls.clear()
    assert files_of(service.status(None), "sdxl-face") == [
        file_status(TINY_FACE, renamed),
        file_status(TINY_ENCODER, encoder),
    ]
    assert service.resolve(SDXL_MODEL, "face").adapter_path == renamed
    assert hash_calls == []


def test_install_keeps_a_different_file_holding_the_name(
    service: IpAdapterService, app_paths: AppPaths, downloads: FakeDownloadManager
) -> None:
    put_file(app_paths.ip_adapter_dir / TINY_FACE.name, b"another adapter with this name")
    put_tiny(app_paths, TINY_ENCODER)

    assert service.install("sdxl-face").task_ids == ["download-1"]

    dest = app_paths.ip_adapter_dir / f"tiny-face-{HF_REVISION[:12]}.safetensors"
    assert started_specs(downloads) == [download_spec(app_paths, TINY_FACE, dest)]
    assert (app_paths.ip_adapter_dir / TINY_FACE.name).read_bytes() == b"another adapter with this name"


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def test_importing_the_ip_adapter_module_does_not_load_torch() -> None:
    """The model family comes from diffusion_lora_runtime.checkpoint_inspection, which must stay torch-free."""
    code = (
        "import sys\n"
        "import app.services.ip_adapters\n"
        "heavy = sorted(name for name in ('torch', 'diffusers', 'transformers') if name in sys.modules)\n"
        "assert not heavy, heavy\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND_DIR, capture_output=True, text=True, timeout=120
    )

    assert result.returncode == 0, result.stderr
