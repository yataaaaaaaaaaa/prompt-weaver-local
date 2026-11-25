"""Test doubles and helpers shared by the backend tests (fixtures live in conftest.py)."""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

from app.schemas import (
    BaseModelOption,
    GenerateRequest,
    ImageGenerationParams,
    ImageResource,
    ImageSearchPage,
    IpAdapterFileRole,
    ModelArchitecture,
    ModelKind,
    ModelProviderInfo,
    ModelSearchPage,
    ModelSearchQuery,
    PreviewImage,
    RemoteFile,
    RemoteImage,
    RemoteModel,
    RemoteModelVersion,
)
from app.services.backend_settings import BackendSettingsStore
from app.services.container import FILE_HASH_CACHE_NAME
from app.services.downloads import CompletionCallback, DownloadSpec
from app.services.file_hashes import FileHashCache
from app.services.generation import GeneratedImage, GenerationCancelledError, ReferenceInput, StepCallback
from app.services.http import USER_AGENT
from app.services.image_favorites import ImageFavoritesStore
from app.services.image_library import ImageLibraryService
from app.services.ip_adapters import IpAdapterCatalog, IpAdapterFileSpec, IpAdapterService, IpAdapterVariantSpec
from app.services.local_models import LocalModelFiles
from app.services.model_catalog import ModelCatalogService
from app.services.model_providers import (
    DownloadSource,
    ImageFeedRequest,
    ImageProviderRegistry,
    ModelProviderRegistry,
    ProviderNotFoundError,
)
from app.services.model_providers.base import complete_version
from app.services.task_hub import TaskEventModel, TaskHub
from app.settings import AppPaths

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

# make_output fixture: (output_id, *, in_trash=False, png=True, metadata=True) -> metadata dict
OutputFactory = Callable[..., dict[str, Any]]


@dataclass
class GenerateCall:
    request: GenerateRequest
    prompt_lora_dir: Path
    prompt_embedding_dir: Path
    reference: ReferenceInput | None = None


ImageFactory = Callable[[GenerateRequest, int], Image.Image]


@dataclass
class FakeGenerator:
    """GeneratorPort test double: records calls, reports `reported_steps` sampling steps, returns a small image.

    Set `error` to raise it (after the reported steps) instead of returning an image, or `on_generate` to run
    code in the middle of a generation (e.g. publish from the worker thread or block until released).

    Paced mode (the e2e server, tests/e2e/server.py): `step_delay_s` > 0 waits that long before each step, and a
    cancel() during the steps raises GenerationCancelledError like the runtime does. `reported_steps=None` reports
    every step of the request. `image_factory(request, seed)` replaces the default tiny red image."""

    reported_steps: int | None = 2
    seed: int = 4242
    error: Exception | None = None
    on_generate: Callable[[], None] | None = None
    step_delay_s: float = 0.0
    image_factory: ImageFactory | None = None
    calls: list[GenerateCall] = field(default_factory=list)
    cancel_calls: int = 0
    unload_calls: int = 0
    _cancelled: threading.Event = field(default_factory=threading.Event, repr=False)

    def generate(
        self,
        request: GenerateRequest,
        *,
        prompt_lora_dir: Path,
        prompt_embedding_dir: Path,
        on_step: StepCallback,
        reference: ReferenceInput | None = None,
    ) -> GeneratedImage:
        self.calls.append(GenerateCall(request, prompt_lora_dir, prompt_embedding_dir, reference))
        self._cancelled.clear()
        steps = request.steps if self.reported_steps is None else self.reported_steps
        for step in range(1, steps + 1):
            if self.step_delay_s > 0 and self._cancelled.wait(self.step_delay_s):
                raise GenerationCancelledError("Generation cancelled")
            on_step(step, request.steps)
        if self.on_generate is not None:
            self.on_generate()
        if self.error is not None:
            raise self.error
        seed = request.seed if request.seed is not None else self.seed
        image = (
            self.image_factory(request, seed)
            if self.image_factory is not None
            else Image.new("RGB", (request.width // 64 or 1, request.height // 64 or 1), (200, 30, 30))
        )
        return GeneratedImage(
            image=image,
            seed=seed,
            prompt=f"resolved({request.prompt})",
            negative_prompt=f"resolved({request.negative_prompt})",
        )

    def cancel(self) -> None:
        self.cancel_calls += 1
        self._cancelled.set()

    def unload(self) -> None:
        self.unload_calls += 1


@dataclass
class CountingFactory:
    """GeneratorFactory returning `generator` and counting how often it was called."""

    generator: FakeGenerator
    calls: int = 0

    def __call__(self) -> FakeGenerator:
        self.calls += 1
        return self.generator


class RecordingTaskHub(TaskHub):
    """TaskHub remembering every event published after construction (in order)."""

    def __init__(self) -> None:
        self.published: list[TaskEventModel] = []
        super().__init__()
        self.published.clear()  # drop the initial idle event

    def publish(self, event: TaskEventModel) -> None:
        self.published.append(event)
        super().publish(event)

    def stages(self) -> list[str]:
        return [getattr(event, "stage") for event in self.published]


def load_fixture(relative_path: str) -> Any:
    return json.loads((FIXTURES_DIR / relative_path).read_text(encoding="utf-8"))


def write_json_file(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def sha256_of(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def wait_until(predicate: Callable[[], bool], timeout: float = 5.0) -> None:
    """Polls `predicate` (worker threads, background downloads) until it holds; fails after `timeout` s."""
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("Timed out waiting for the condition")
        time.sleep(0.005)


# ---------------------------------------------------------------------------
# Network double
# ---------------------------------------------------------------------------

HttpHandler = Callable[[httpx.Request], httpx.Response]


@dataclass
class FakeHttp:
    """In-process stand-in for the internet, served through httpx.MockTransport.

    The `app` fixture builds the app with `http_client_factory=fake_http.client_factory`, so every outgoing
    request of the app lands here. Register answers per method + URL (scheme, host and path; the query string
    is ignored for matching, inspect it through `requests`):

        fake_http.add("GET", "https://civitai.com/api/v1/models", json=load_fixture("civitai/search_loras.json"))
        fake_http.add("GET", "https://civitai.com/api/download/models/1", handler=lambda request: httpx.Response(...))

    A later add() for the same route replaces the earlier one. Requests without a route answer 599 and are
    recorded in `unexpected`; the `fake_http` fixture fails the test when any happened.
    """

    routes: dict[tuple[str, str], HttpHandler] = field(default_factory=dict)
    requests: list[httpx.Request] = field(default_factory=list)
    unexpected: list[str] = field(default_factory=list)

    @staticmethod
    def _route_key(method: str, url: str | httpx.URL) -> tuple[str, str]:
        parsed = httpx.URL(str(url))
        return (method.upper(), f"{parsed.scheme}://{parsed.host}{parsed.path}")

    def add(
        self,
        method: str,
        url: str,
        *,
        status: int = 200,
        json: Any = None,
        content: bytes | Iterable[bytes] | None = None,
        headers: dict[str, str] | None = None,
        handler: HttpHandler | None = None,
    ) -> None:
        if handler is None:

            def handler(request: httpx.Request) -> httpx.Response:
                if json is not None:
                    return httpx.Response(status, json=json, headers=headers)
                return httpx.Response(status, content=content if content is not None else b"", headers=headers)

        self.routes[self._route_key(method, url)] = handler

    def requests_to(self, url: str) -> list[httpx.Request]:
        """Recorded requests whose scheme + host + path equal `url`'s."""
        key = self._route_key("GET", url)[1]
        return [request for request in self.requests if self._route_key(request.method, request.url)[1] == key]

    def _handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        handler = self.routes.get(self._route_key(request.method, request.url))
        if handler is None:
            self.unexpected.append(f"{request.method} {request.url}")
            return httpx.Response(599, text=f"FakeHttp: no route for {request.method} {request.url}")
        return handler(request)

    def client_factory(self) -> httpx.Client:
        """HttpClientFactory (app/services/http.py) over this fake: same defaults as default_http_client()."""
        return httpx.Client(
            transport=httpx.MockTransport(self._handle),
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        )


# ---------------------------------------------------------------------------
# Model library doubles (provider files, provider, download manager)
# ---------------------------------------------------------------------------

MODEL_CONTENT = b"safetensors bytes " * 8
OTHER_MODEL_CONTENT = b"different bytes!! " * 8  # same size as MODEL_CONTENT


def put_file(path: Path, content: bytes = MODEL_CONTENT) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def remote_file(
    content: bytes = MODEL_CONTENT,
    *,
    name: str = "pixel_style.safetensors",
    file_id: str = "11",
    with_sha256: bool = True,
    primary: bool = True,
    downloadable: bool = True,
) -> RemoteFile:
    """A provider file describing `content` (exact size and, unless with_sha256=False, its SHA-256)."""
    return RemoteFile(
        id=file_id,
        name=name,
        size_bytes=len(content),
        sha256=sha256_of(content) if with_sha256 else None,
        format="SafeTensor" if downloadable else "PickleTensor",
        precision="fp16",
        variant=None,
        primary=primary,
        downloadable=downloadable,
        local_path=None,
    )


STUB_PROVIDER_ID = "stub"


def remote_model(
    model_id: str,
    version_id: str,
    *,
    name: str | None = None,
    version_name: str = "v1",
    kind: ModelKind = "lora",
    files: list[RemoteFile] | None = None,
    base_model: str = "Illustrious",
    architecture: ModelArchitecture | None = "sdxl",
    trigger_words: Sequence[str] = (),
    images: Sequence[PreviewImage] = (),
    page_url: str | None = None,
    version_page_url: str | None = None,
    creator: str | None = None,
    tags: Sequence[str] = (),
    download_count: int = 0,
) -> RemoteModel:
    """A provider answer of get_version(): the model with only the requested version, completed by the shared
    install rules (base.complete_version) like every real provider does. Default name 'Model <model_id>'; default
    files: one primary SafeTensors file of MODEL_CONTENT with id '<version_id>1'."""
    version = RemoteModelVersion(
        id=version_id,
        name=version_name,
        base_model=base_model,
        architecture=architecture,
        trigger_words=list(trigger_words),
        published_at=None,
        images=list(images),
        files=files if files is not None else [remote_file(file_id=f"{version_id}1")],
        page_url=version_page_url,
        default_file_id=None,
        unavailable_reason=None,
    )
    return RemoteModel(
        provider=STUB_PROVIDER_ID,
        id=model_id,
        name=name if name is not None else f"Model {model_id}",
        kind=kind,
        creator=creator,
        nsfw=False,
        tags=list(tags),
        download_count=download_count,
        page_url=page_url,
        versions=[complete_version(version)],
    )


STUB_DOWNLOAD_HEADERS = {"Authorization": "Bearer stub-secret-token"}
STUB_AUTH_HINT = "Add a Stub API token in the model library settings."


class StubProvider:
    """base.ModelProvider over canned RemoteModels (pass them through base.complete_version like a real
    provider). Records calls; raises `error` from lookups when set."""

    def __init__(self, *models: RemoteModel, provider_id: str = STUB_PROVIDER_ID) -> None:
        self.id = provider_id
        self.models = {version.id: model for model in models for version in model.versions}
        self.error: Exception | None = None
        self.calls: list[tuple[str, str]] = []

    def info(self) -> ModelProviderInfo:
        return ModelProviderInfo(
            id=self.id,
            label="Stub",
            kinds=["lora"],
            base_models=[BaseModelOption(id="Illustrious", architecture="sdxl")],
            sorts=["newest"],
            token_supported=True,
            token_set=False,
        )

    def search(self, query: ModelSearchQuery) -> ModelSearchPage:
        self.calls.append(("search", query.query))
        unique = {model.id: model for model in self.models.values()}
        return ModelSearchPage(items=list(unique.values()), next_cursor=None)

    def _lookup(self, call: str, key: str) -> RemoteModel:
        self.calls.append((call, key))
        if self.error is not None:
            raise self.error
        try:
            return self.models[key]
        except KeyError:
            raise ProviderNotFoundError(f"Unknown version {key}.") from None

    def get_version(self, version_id: str) -> RemoteModel:
        return self._lookup("get_version", version_id)

    def find_by_hash(self, sha256: str) -> RemoteModel:
        return self._lookup("find_by_hash", sha256)

    def download_source(self, version: RemoteModel, file: RemoteFile) -> DownloadSource:
        self.calls.append(("download_source", file.id))
        return DownloadSource(
            url=f"https://stub.example/download/{version.versions[0].id}?file={file.id}",
            headers=STUB_DOWNLOAD_HEADERS,
            auth_hint=STUB_AUTH_HINT,
        )


class FakeDownloadManager:
    """DownloadManager double: start() records (spec, on_complete) and returns 'download-<n>' (n from 1); a task
    stays active until finish() / end()."""

    def __init__(self, *, start_delay_s: float = 0.0) -> None:
        self.started: list[tuple[DownloadSpec, CompletionCallback | None]] = []
        self.active: set[str] = set()
        self.start_delay_s = start_delay_s
        self._lock = threading.Lock()

    def start(self, spec: DownloadSpec, *, on_complete: CompletionCallback | None = None) -> str:
        time.sleep(self.start_delay_s)  # widens race windows in concurrency tests
        with self._lock:
            self.started.append((spec, on_complete))
            task_id = f"download-{len(self.started)}"
            self.active.add(task_id)
        return task_id

    def is_active(self, task_id: str) -> bool:
        return task_id in self.active

    def cancel(self, task_id: str) -> bool:
        return self.end(task_id)

    def shutdown(self, timeout: float | None = 10.0) -> None:
        self.active.clear()

    def end(self, task_id: str) -> bool:
        """The task stops without a file (cancelled / failed)."""
        was_active = task_id in self.active
        self.active.discard(task_id)
        return was_active

    def finish(self, index: int = 0, content: bytes = MODEL_CONTENT) -> Path:
        """Download #index completes like the real manager: verified file at spec.dest, then on_complete, then
        the task ends."""
        spec, on_complete = self.started[index]
        put_file(spec.dest, content)
        if on_complete is not None:
            on_complete(spec.dest, sha256_of(content))
        self.end(f"download-{index + 1}")
        return spec.dest


# ---------------------------------------------------------------------------
# Image library doubles
# ---------------------------------------------------------------------------


def remote_image(
    image_id: str = "1",
    *,
    provider: str = STUB_PROVIDER_ID,
    resources: Iterable[ImageResource] = (),
    prompt: str | None = "castle, sky <lora:pixel_style:0.8>",
    nsfw: bool = False,
) -> RemoteImage:
    """An image with neutral defaults (params from `prompt`; None = no generation data)."""
    params = (
        ImageGenerationParams(
            prompt=prompt,
            clean_prompt=prompt,
            negative_prompt=None,
            sampler=None,
            steps=None,
            cfg_scale=None,
            seed=None,
            width=None,
            height=None,
            clip_skip=None,
        )
        if prompt is not None
        else None
    )
    return RemoteImage(
        provider=provider,
        id=image_id,
        url=f"https://images.example/{image_id}/original.jpeg",
        thumbnail_url=f"https://images.example/{image_id}/thumb.jpeg",
        width=512,
        height=768,
        nsfw=nsfw,
        base_model="Illustrious",
        architecture="sdxl",
        username="alice",
        created_at=None,
        reaction_count=0,
        page_url=f"https://images.example/{image_id}",
        params=params,
        resources=list(resources),
    )


class StubImageProvider:
    """base.ImageProvider over canned pages: pages[(model_id, cursor)] answers the request for that gallery
    (model_id None = the unfiltered feed) and cursor (None = the first page). A request without a canned page
    answers an empty last page. Records every ImageFeedRequest; raises `error` when set."""

    def __init__(
        self,
        pages: dict[tuple[str | None, str | None], ImageSearchPage] | None = None,
        *,
        provider_id: str = STUB_PROVIDER_ID,
    ) -> None:
        self.id = provider_id
        self.pages = dict(pages or {})
        self.requests: list[ImageFeedRequest] = []
        self.error: Exception | None = None
        self._lock = threading.Lock()

    def search_images(self, request: ImageFeedRequest) -> ImageSearchPage:
        with self._lock:  # the service may query galleries concurrently
            self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.pages.get((request.model_id, request.cursor), ImageSearchPage(items=[], next_cursor=None))


# ---------------------------------------------------------------------------
# Image library catalog doubles and data (test_image_library.py, test_images_api.py)
# ---------------------------------------------------------------------------

BASE_MODELS = [
    BaseModelOption(id="Illustrious", architecture="sdxl"),
    BaseModelOption(id="Flux.1 D", architecture=None),
    BaseModelOption(id="SD 1.5", architecture="sd15"),
]
USABLE_BASE_MODELS = ("Illustrious", "SD 1.5")


PIXEL_FILE = remote_file(MODEL_CONTENT, name="pixel_style.safetensors", file_id="11")
PIXEL = remote_model(
    "100",
    "200",
    files=[remote_file(OTHER_MODEL_CONTENT, name="pixel_fp32.safetensors", file_id="12", primary=False), PIXEL_FILE],
)
CHECKPOINT = remote_model(
    "300", "400", kind="checkpoint", files=[remote_file(OTHER_MODEL_CONTENT, name="chill.safetensors", file_id="41")]
)
NO_HASH = remote_model("500", "600", files=[remote_file(name="nohash.safetensors", file_id="61", with_sha256=False)])
PICKLE_ONLY = remote_model("700", "800", files=[remote_file(name="old.ckpt", file_id="81", downloadable=False)])

PIXEL_AUTOV3 = "7c6bad76eb54"
CHECKPOINT_AUTOV2 = "fc2511737a"
PIXEL_SHA256 = sha256_of(MODEL_CONTENT)


class CatalogStub(StubProvider):
    """StubProvider with base models of several architectures, a paged model search (search_pages: model search
    cursor -> page, None = the first page; recorded in `queries`), hash lookups (hashes: hash -> version id) and
    per-key lookup errors (lookup_errors: version id or hash -> exception)."""

    def __init__(
        self,
        *models: RemoteModel,
        search_pages: dict[str | None, ModelSearchPage] | None = None,
        hashes: dict[str, str] | None = None,
    ) -> None:
        super().__init__(*models)
        self.search_pages = dict(search_pages or {})
        self.hashes = dict(hashes or {})
        self.lookup_errors: dict[str, Exception] = {}
        self.search_error: Exception | None = None
        self.queries: list[ModelSearchQuery] = []

    def info(self) -> ModelProviderInfo:
        return super().info().model_copy(update={"base_models": BASE_MODELS})

    def search(self, query: ModelSearchQuery) -> ModelSearchPage:
        self.queries.append(query)
        if self.search_error is not None:
            raise self.search_error
        return self.search_pages.get(query.cursor, ModelSearchPage(items=[], next_cursor=None))

    def get_version(self, version_id: str) -> RemoteModel:
        if version_id in self.lookup_errors:
            self.calls.append(("get_version", version_id))
            raise self.lookup_errors[version_id]
        return super().get_version(version_id)

    def find_by_hash(self, sha256: str) -> RemoteModel:
        self.calls.append(("find_by_hash", sha256))
        if self.error is not None:
            raise self.error
        if sha256 in self.lookup_errors:
            raise self.lookup_errors[sha256]
        if sha256 not in self.hashes:
            raise ProviderNotFoundError(f"No version with hash {sha256}.")
        return self.models[self.hashes[sha256]]


def image_library_service(paths: AppPaths, models: StubProvider, images: StubImageProvider) -> ImageLibraryService:
    """The service over the stub providers, the real catalog (local files on the temp model folders) and real
    favorites on the temp data dir."""
    registry = ModelProviderRegistry([models])
    catalog = ModelCatalogService(
        paths=paths,
        providers=registry,
        local_files=LocalModelFiles(paths=paths, hashes=FileHashCache(paths.cache_dir / FILE_HASH_CACHE_NAME)),
        settings=BackendSettingsStore(paths.settings_file),
    )
    return ImageLibraryService(
        model_providers=registry,
        image_providers=ImageProviderRegistry([images]),
        catalog=catalog,
        favorites=ImageFavoritesStore(paths.image_favorites_file),
    )


def image_page(*image_ids: str, next_cursor: str | None = None) -> ImageSearchPage:
    return ImageSearchPage(items=[remote_image(image_id) for image_id in image_ids], next_cursor=next_cursor)


def models_page(*model_ids: str, next_cursor: str | None = None) -> ModelSearchPage:
    return ModelSearchPage(
        items=[remote_model(model_id, f"{model_id}0") for model_id in model_ids], next_cursor=next_cursor
    )


def image_resource(
    *,
    name: str | None = None,
    version_id: str | None = None,
    hash: str | None = None,
    weight: float | None = None,
    kind: ModelKind = "lora",
) -> ImageResource:
    return ImageResource(kind=kind, name=name, weight=weight, version_id=version_id, hash=hash)


# A valid /api/generate body (test_generation.py, test_generation_characters.py).
GENERATE_REQUEST: dict[str, Any] = {
    "model": {
        "id": "example-model-safetensors",
        "name": "ExampleModel_v50.safetensors",
        "path": "C:/models/checkpoints/ExampleModel_v50.safetensors",
        "default_width": 1024,
        "default_height": 1024,
        "torch_dtype": "float16",
    },
    "loras": [
        {"id": "kept-lora", "name": "kept-lora", "path": "C:/models/loras/kept-lora.safetensors", "weight": 0.6},
        # No weight: LORA_WEIGHT_DEFAULTS.weight (1.0).
        {"id": "other-lora", "name": "other", "path": "C:/models/loras/other.safetensors"},
    ],
    "prompt": "masterpiece, <lora:Dramatic Lighting Slider:2>, 1girl",
    "selections": [
        {"category_name": "Main", "prompt_text": "masterpiece", "locked": True, "induced_lora_ids": ["kept-lora"]},
        {"category_name": "Subject", "prompt_text": "1girl"},
    ],
    "width": 128,
    "height": 192,
    "steps": 12,
    "guidance_scale": 3.5,
    "prompt_seed": 290912999,
    "seed": 718043937,
    "negative_prompt": "worst quality",
}

# The key set of an output metadata file written without a character (the legacy format).
LEGACY_METADATA_KEYS = {
    "output_id",
    "generated_at",
    "prompt",
    "negative_prompt",
    "seed",
    "prompt_seed",
    "image_seed",
    "width",
    "height",
    "steps",
    "guidance_scale",
    "model_id",
    "active_loras",
    "selections",
    "image_path",
    "metadata_path",
}


# ---------------------------------------------------------------------------
# Tiny IP-Adapter catalog (test_ip_adapters.py, test_ip_adapters_api.py): two SDXL variants sharing one encoder, no SD 1.5 variant.
# Every file has its own size, so only the file itself is ever a same-size hashing candidate.
# ---------------------------------------------------------------------------

ENCODER_CONTENT = b"tiny image encoder " * 6
FACE_CONTENT = b"tiny face adapter " * 5
GENERAL_CONTENT = b"tiny general adapter!" * 4


def tiny_file(file_id: str, role: IpAdapterFileRole, content: bytes) -> IpAdapterFileSpec:
    return IpAdapterFileSpec(
        id=file_id,
        role=role,
        name=f"{file_id}.safetensors",
        repo_path=f"tiny/{file_id}.safetensors",
        size_bytes=len(content),
        sha256=sha256_of(content),
    )


TINY_ENCODER = tiny_file("tiny-encoder", "image_encoder", ENCODER_CONTENT)
TINY_FACE = tiny_file("tiny-face", "adapter", FACE_CONTENT)
TINY_GENERAL = tiny_file("tiny-general", "adapter", GENERAL_CONTENT)
# File id -> content (what a download of that file writes).
TINY_CONTENTS = {TINY_ENCODER.id: ENCODER_CONTENT, TINY_FACE.id: FACE_CONTENT, TINY_GENERAL.id: GENERAL_CONTENT}

SDXL_FACE = IpAdapterVariantSpec(
    id="sdxl-face", label="SDXL face", architecture="sdxl", focus="face", adapter=TINY_FACE, image_encoder=TINY_ENCODER
)
SDXL_GENERAL = IpAdapterVariantSpec(
    id="sdxl-general",
    label="SDXL general",
    architecture="sdxl",
    focus="general",
    adapter=TINY_GENERAL,
    image_encoder=TINY_ENCODER,
)
TINY_CATALOG = IpAdapterCatalog(variants=(SDXL_FACE, SDXL_GENERAL))

SDXL_MODEL = "D:/models/sdxl.safetensors"
SD15_MODEL = "D:/models/sd15.safetensors"
FLUX_MODEL = "D:/models/flux.safetensors"
MODEL_FAMILIES: dict[str, ModelArchitecture] = {SDXL_MODEL: "sdxl", SD15_MODEL: "sd15"}


def fake_architecture_of(model_path: str) -> ModelArchitecture | None:
    """Family detector of the tiny tests: no checkpoint file needed."""
    return MODEL_FAMILIES.get(model_path)


def tiny_service(
    paths: AppPaths, downloads: FakeDownloadManager, *, local_files: LocalModelFiles | None = None
) -> IpAdapterService:
    if local_files is None:
        local_files = LocalModelFiles(paths=paths, hashes=FileHashCache(paths.cache_dir / FILE_HASH_CACHE_NAME))
    return IpAdapterService(
        paths=paths,
        local_files=local_files,
        downloads=downloads,  # type: ignore[arg-type]
        catalog=TINY_CATALOG,
        architecture_of=fake_architecture_of,
    )


def put_tiny(paths: AppPaths, file: IpAdapterFileSpec, *, name: str | None = None) -> Path:
    """`file`'s content in its folder (models/ipadapter or models/clip_vision), under its catalog name or `name`."""
    folder = paths.ip_adapter_dir if file.role == "adapter" else paths.image_encoder_dir
    return put_file(folder / (name or file.name), TINY_CONTENTS[file.id])
