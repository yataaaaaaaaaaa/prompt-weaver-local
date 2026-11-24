"""Test doubles and helpers shared by the backend tests (fixtures live in conftest.py)."""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

from app.schemas import (
    BaseModelOption,
    GenerateRequest,
    ModelProviderInfo,
    ModelSearchPage,
    ModelSearchQuery,
    RemoteFile,
    RemoteModel,
)
from app.services.downloads import CompletionCallback, DownloadSpec
from app.services.generation import GeneratedImage, StepCallback
from app.services.http import USER_AGENT
from app.services.model_providers import DownloadSource, ProviderNotFoundError
from app.services.task_hub import TaskEventModel, TaskHub

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

# make_output fixture: (output_id, *, in_trash=False, png=True, metadata=True) -> metadata dict
OutputFactory = Callable[..., dict[str, Any]]


@dataclass
class GenerateCall:
    request: GenerateRequest
    prompt_lora_dir: Path
    prompt_embedding_dir: Path


@dataclass
class FakeGenerator:
    """GeneratorPort test double: records calls, reports `reported_steps` sampling steps, returns a small image.

    Set `error` to raise it (after the reported steps) instead of returning an image, or `on_generate` to run
    code in the middle of a generation (e.g. publish from the worker thread or block until released)."""

    reported_steps: int = 2
    seed: int = 4242
    error: Exception | None = None
    on_generate: Callable[[], None] | None = None
    calls: list[GenerateCall] = field(default_factory=list)
    cancel_calls: int = 0
    unload_calls: int = 0

    def generate(
        self,
        request: GenerateRequest,
        *,
        prompt_lora_dir: Path,
        prompt_embedding_dir: Path,
        on_step: StepCallback,
    ) -> GeneratedImage:
        self.calls.append(GenerateCall(request, prompt_lora_dir, prompt_embedding_dir))
        for step in range(1, self.reported_steps + 1):
            on_step(step, request.steps)
        if self.on_generate is not None:
            self.on_generate()
        if self.error is not None:
            raise self.error
        return GeneratedImage(
            image=Image.new("RGB", (request.width // 64 or 1, request.height // 64 or 1), (200, 30, 30)),
            seed=request.seed if request.seed is not None else self.seed,
            prompt=f"resolved({request.prompt})",
            negative_prompt=f"resolved({request.negative_prompt})",
        )

    def cancel(self) -> None:
        self.cancel_calls += 1

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
