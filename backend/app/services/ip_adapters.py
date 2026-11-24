"""IP-Adapter files for character reference images (consistency through reference images).

Single owner of:
- the catalog: IP_ADAPTER_CATALOG lists every variant (model family x focus) with its two files, the adapter weights
  and the CLIP vision image encoder, with their Hugging Face location (pinned revision), local file name (ComfyUI
  conventions), size and SHA-256 (tests/fixtures/huggingface holds the real Hugging Face answers they come from);
- "which files are on disk": a file is local when its folder (AppPaths.ip_adapter_dir / image_encoder_dir, the
  ComfyUI models/ipadapter and models/clip_vision folders) holds it, found through services/local_models.py
  (same name and size, or a cached hash match; never re-implemented here);
- installs: missing files are downloaded through services/downloads.py DownloadManager (expected size and SHA-256,
  on_complete records the hash in the file hash cache), a running download of the same file is joined;
- the rule "which variant applies to a model + focus" (resolve), used by GET /api/ip-adapters (ReferenceSupport)
  and by generation (services/generation.py), so the UI explains exactly what generation will do. The model's
  family comes from diffusion_lora_runtime.checkpoint_inspection.pipeline_architecture (torch-free).

Every variant uses the ViT-H/14 image encoder, so one 2.5 GB encoder download serves them all.

Folders: adapter files live in AppPaths.ip_adapter_dir (models/ipadapter), the image encoder in
AppPaths.image_encoder_dir (models/clip_vision). Files a ComfyUI install already has there are reused (by name and
size, or by hash when renamed); downloads land there under the catalog name (or "<stem>-<revision[:12]><suffix>"
when another file holds that name, see local_models.py).

Support rule (resolve), in order:
1. the model's family is unknown (not SD 1.5 / SDXL): not ready, no variant, UNSUPPORTED_MODEL_REASON;
2. the catalog has no variant for family + focus: not ready, no variant;
3. a file of the variant is not on disk: not ready, "is downloading" when every missing file has a running
   download, else "Download the IP-Adapter ...";
4. otherwise ready, with the adapter and image encoder paths.
The on-disk check is the cheap one (LocalModelFiles.known_path_in: name + size or a cached hash, never hashes);
install() runs the full one (locate_in, which may hash same-size candidates) before downloading.

Installs are thread-safe: a file whose download is running is joined (one download per file, also across
variants sharing the image encoder); finished downloads are forgotten lazily (DownloadManager.is_active).
Hugging Face is public: downloads send no header nor token.
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import get_args

from diffusion_lora_runtime.checkpoint_inspection import pipeline_architecture

from ..schemas import (
    IpAdapterFile,
    IpAdapterFileRole,
    IpAdapterFolders,
    IpAdapterInstallResponse,
    IpAdapterStatus,
    IpAdapterVariant,
    ModelArchitecture,
    ReferenceFocus,
    ReferenceSupport,
)
from ..settings import AppPaths
from .downloads import DownloadManager, DownloadSpec
from .local_models import LocalModelFiles

HF_REPO = "h94/IP-Adapter"
# Pinned commit of HF_REPO: the sizes and hashes below are those of this revision.
HF_REVISION = "018e402774aeeddd60609b4ecdb7e298259dc729"


@dataclass(frozen=True)
class IpAdapterFileSpec:
    """One downloadable IP-Adapter file (also usable where services/local_models.py expects a file description:
    id, name, size_bytes, sha256)."""

    id: str
    role: IpAdapterFileRole
    name: str
    repo_path: str
    size_bytes: int
    sha256: str

    @property
    def url(self) -> str:
        return f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}/{self.repo_path}"


@dataclass(frozen=True)
class IpAdapterVariantSpec:
    id: str
    label: str
    architecture: ModelArchitecture
    focus: ReferenceFocus
    adapter: IpAdapterFileSpec
    image_encoder: IpAdapterFileSpec

    @property
    def files(self) -> tuple[IpAdapterFileSpec, IpAdapterFileSpec]:
        return (self.adapter, self.image_encoder)


@dataclass(frozen=True)
class IpAdapterCatalog:
    variants: tuple[IpAdapterVariantSpec, ...]

    def variant(self, variant_id: str) -> IpAdapterVariantSpec | None:
        return next((variant for variant in self.variants if variant.id == variant_id), None)

    def for_model(self, architecture: ModelArchitecture, focus: ReferenceFocus) -> IpAdapterVariantSpec | None:
        return next(
            (variant for variant in self.variants if variant.architecture == architecture and variant.focus == focus),
            None,
        )


# ComfyUI's name of h94/IP-Adapter models/image_encoder/model.safetensors (transformers key layout).
IMAGE_ENCODER_VIT_H = IpAdapterFileSpec(
    id="image-encoder-vit-h",
    role="image_encoder",
    name="CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
    repo_path="models/image_encoder/model.safetensors",
    size_bytes=2528373448,
    sha256="6ca9667da1ca9e0b0f75e46bb030f7e011f44f86cbfb8d5a36590fcd7507b030",
)

IP_ADAPTER_CATALOG = IpAdapterCatalog(
    variants=(
        IpAdapterVariantSpec(
            id="sd15-face",
            label="SD 1.5 face (IP-Adapter Plus Face)",
            architecture="sd15",
            focus="face",
            adapter=IpAdapterFileSpec(
                id="ip-adapter-plus-face-sd15",
                role="adapter",
                name="ip-adapter-plus-face_sd15.safetensors",
                repo_path="models/ip-adapter-plus-face_sd15.safetensors",
                size_bytes=98183288,
                sha256="1c9edc21af6f737dc1d6e0e734190e976cfacf802d6b024b77aa3be922f7569b",
            ),
            image_encoder=IMAGE_ENCODER_VIT_H,
        ),
        IpAdapterVariantSpec(
            id="sd15-general",
            label="SD 1.5 general (IP-Adapter Plus)",
            architecture="sd15",
            focus="general",
            adapter=IpAdapterFileSpec(
                id="ip-adapter-plus-sd15",
                role="adapter",
                name="ip-adapter-plus_sd15.safetensors",
                repo_path="models/ip-adapter-plus_sd15.safetensors",
                size_bytes=98183288,
                sha256="a1c250be40455cc61a43da1201ec3f1edaea71214865fb47f57927e06cbe4996",
            ),
            image_encoder=IMAGE_ENCODER_VIT_H,
        ),
        IpAdapterVariantSpec(
            id="sdxl-face",
            label="SDXL face (IP-Adapter Plus Face ViT-H)",
            architecture="sdxl",
            focus="face",
            adapter=IpAdapterFileSpec(
                id="ip-adapter-plus-face-sdxl-vit-h",
                role="adapter",
                name="ip-adapter-plus-face_sdxl_vit-h.safetensors",
                repo_path="sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors",
                size_bytes=847517512,
                sha256="677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1",
            ),
            image_encoder=IMAGE_ENCODER_VIT_H,
        ),
        IpAdapterVariantSpec(
            id="sdxl-general",
            label="SDXL general (IP-Adapter Plus ViT-H)",
            architecture="sdxl",
            focus="general",
            adapter=IpAdapterFileSpec(
                id="ip-adapter-plus-sdxl-vit-h",
                role="adapter",
                name="ip-adapter-plus_sdxl_vit-h.safetensors",
                repo_path="sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
                size_bytes=847517512,
                sha256="3f5062b8400c94b7159665b21ba5c62acdcd7682262743d7f2aefedef00e6581",
            ),
            image_encoder=IMAGE_ENCODER_VIT_H,
        ),
    )
)


@dataclass(frozen=True)
class IpAdapterResolution:
    """What generation can do with reference images for one model + focus: `support` (shown by the UI as is) and,
    when support.ready, the local files to load."""

    support: ReferenceSupport
    architecture: ModelArchitecture | None
    adapter_path: Path | None
    image_encoder_path: Path | None


class UnknownIpAdapterVariant(LookupError):
    """No variant with this id (HTTP 404)."""


ArchitectureDetector = Callable[[str], ModelArchitecture | None]

# IpAdapterStatus.support lists one entry per focus, in the order of the ReferenceFocus literal.
REFERENCE_FOCUSES: tuple[ReferenceFocus, ...] = get_args(ReferenceFocus)

# Version part of the fallback download names (local_models.py: "<stem>-<version id><suffix>").
DOWNLOAD_VERSION_ID = HF_REVISION[:12]

UNSUPPORTED_MODEL_REASON = "This model cannot use reference images: IP-Adapters need an SD 1.5 or SDXL model."


@dataclass(frozen=True)
class _RunningDownload:
    task_id: str
    dest: Path


@dataclass(frozen=True)
class _FileState:
    local_path: Path | None  # cheap on-disk check (LocalModelFiles.known_path_in)
    task_id: str | None  # running download


class IpAdapterService:
    def __init__(
        self,
        *,
        paths: AppPaths,
        local_files: LocalModelFiles,
        downloads: DownloadManager,
        catalog: IpAdapterCatalog = IP_ADAPTER_CATALOG,
        architecture_of: ArchitectureDetector = pipeline_architecture,
    ) -> None:
        """Performs no IO. `catalog` and `architecture_of` are injectable for tests (a catalog of tiny files, a
        detector that needs no checkpoint file)."""
        self._paths = paths
        self._local_files = local_files
        self._downloads = downloads
        self._catalog = catalog
        self._architecture_of = architecture_of
        self._lock = threading.Lock()
        # Downloads started by install(), by IpAdapterFileSpec.id; ended ones are dropped by _prune_locked().
        self._running: dict[str, _RunningDownload] = {}

    def status(self, model_path: str | None) -> IpAdapterStatus:
        """Every variant with its files (local_path from the cheap on-disk check, task_id of a running download),
        the folders, and for a non-empty `model_path`: its family and one ReferenceSupport per focus in
        REFERENCE_FOCUSES order (resolve().support). Never hashes."""
        states = self._file_states(file for variant in self._catalog.variants for file in variant.files)
        architecture: ModelArchitecture | None = None
        support: list[ReferenceSupport] = []
        if model_path:
            architecture = self._architecture_of(model_path)
            support = [self._resolve(architecture, focus, states).support for focus in REFERENCE_FOCUSES]
        return IpAdapterStatus(
            variants=[_variant_status(variant, states) for variant in self._catalog.variants],
            folders=IpAdapterFolders(
                adapter=str(self._paths.ip_adapter_dir), image_encoder=str(self._paths.image_encoder_dir)
            ),
            architecture=architecture,
            support=support,
        )

    def resolve(self, model_path: str, focus: ReferenceFocus) -> IpAdapterResolution:
        """The variant for the model's family and `focus`, ready when both its files are on disk. Not ready, with a
        user-facing reason, when the family has no IP-Adapter (unknown/unsupported model), when the catalog has no
        variant for it, or when a file is missing (or still downloading). Never hashes (cheap check)."""
        return self._resolve(self._architecture_of(model_path), focus)

    def install(self, variant_id: str) -> IpAdapterInstallResponse:
        """Downloads the variant's missing files (full on-disk check first, hashing same-size candidates; a running
        download of the same file is joined): 'installed' with no task when every file is local, else
        'downloading' with the task ids. Raises UnknownIpAdapterVariant."""
        variant = self._catalog.variant(variant_id)
        if variant is None:
            raise UnknownIpAdapterVariant(f"Unknown IP-Adapter variant '{variant_id}'.")
        # Slow (may hash multi-GB same-size candidates, cached by the file hash cache): outside the lock.
        missing = [
            file
            for file in variant.files
            if self._local_files.locate_in(self._folder(file.role), file, version_id=DOWNLOAD_VERSION_ID) is None
        ]
        if not missing:
            return IpAdapterInstallResponse(state="installed", task_ids=[])
        with self._lock:
            running = self._prune_locked()
            task_ids = [self._start_locked(file, running) for file in missing]
        return IpAdapterInstallResponse(state="downloading", task_ids=task_ids)

    # -- internals --------------------------------------------------------------------------------------

    def _folder(self, role: IpAdapterFileRole) -> Path:
        return self._paths.ip_adapter_dir if role == "adapter" else self._paths.image_encoder_dir

    def _resolve(
        self,
        architecture: ModelArchitecture | None,
        focus: ReferenceFocus,
        states: dict[str, _FileState] | None = None,
    ) -> IpAdapterResolution:
        """The support rule (module docstring). `states` (by file id) is computed for the variant's files when
        not given."""
        if architecture is None:
            return _unavailable(focus, None, None, UNSUPPORTED_MODEL_REASON)
        variant = self._catalog.for_model(architecture, focus)
        if variant is None:
            return _unavailable(focus, architecture, None, f"No IP-Adapter for this model with the {focus} focus.")
        if states is None:
            states = self._file_states(variant.files)
        missing = [states[file.id] for file in variant.files if states[file.id].local_path is None]
        if missing:
            reason = (
                f"The IP-Adapter '{variant.label}' is downloading."
                if all(state.task_id is not None for state in missing)
                else f"Download the IP-Adapter '{variant.label}' to use reference images."
            )
            return _unavailable(focus, architecture, variant.id, reason)
        return IpAdapterResolution(
            support=ReferenceSupport(focus=focus, variant_id=variant.id, ready=True, reason=None),
            architecture=architecture,
            adapter_path=states[variant.adapter.id].local_path,
            image_encoder_path=states[variant.image_encoder.id].local_path,
        )

    def _file_states(self, files: Iterable[IpAdapterFileSpec]) -> dict[str, _FileState]:
        """On-disk path (cheap check, never hashes) and running download of every file, by file id."""
        with self._lock:
            task_ids = {file_id: running.task_id for file_id, running in self._prune_locked().items()}
        states: dict[str, _FileState] = {}
        for file in files:
            if file.id not in states:
                local_path = self._local_files.known_path_in(self._folder(file.role), file)
                states[file.id] = _FileState(local_path=local_path, task_id=task_ids.get(file.id))
        return states

    def _start_locked(self, file: IpAdapterFileSpec, running: dict[str, _RunningDownload]) -> str:
        """Task id of the download of `file`: the running one, else a new one. Call with the lock held."""
        download = running.get(file.id)
        if download is None:
            # Another running download keeps its destination name: this one takes the next free name.
            dest = self._local_files.target_path_in(
                self._folder(file.role),
                file,
                version_id=DOWNLOAD_VERSION_ID,
                reserved=[other.dest for other in running.values()],
            )
            spec = DownloadSpec(
                url=file.url,
                dest=dest,
                title=f"IP-Adapter {file.name}",
                expected_sha256=file.sha256,
                expected_size=file.size_bytes,
            )
            task_id = self._downloads.start(spec, on_complete=self._local_files.remember)
            download = running[file.id] = _RunningDownload(task_id=task_id, dest=dest)
        return download.task_id

    def _prune_locked(self) -> dict[str, _RunningDownload]:
        """The running downloads, after dropping those that ended. Call with the lock held."""
        for file_id, running in list(self._running.items()):
            if not self._downloads.is_active(running.task_id):
                del self._running[file_id]
        return self._running


def _file_status(file: IpAdapterFileSpec, state: _FileState) -> IpAdapterFile:
    return IpAdapterFile(
        id=file.id,
        role=file.role,
        name=file.name,
        size_bytes=file.size_bytes,
        local_path=str(state.local_path) if state.local_path is not None else None,
        task_id=state.task_id,
    )


def _variant_status(variant: IpAdapterVariantSpec, states: dict[str, _FileState]) -> IpAdapterVariant:
    files = [_file_status(file, states[file.id]) for file in variant.files]
    return IpAdapterVariant(
        id=variant.id,
        label=variant.label,
        architecture=variant.architecture,
        focus=variant.focus,
        files=files,
        ready=all(file.local_path is not None for file in files),
    )


def _unavailable(
    focus: ReferenceFocus, architecture: ModelArchitecture | None, variant_id: str | None, reason: str
) -> IpAdapterResolution:
    return IpAdapterResolution(
        support=ReferenceSupport(focus=focus, variant_id=variant_id, ready=False, reason=reason),
        architecture=architecture,
        adapter_path=None,
        image_encoder_path=None,
    )
