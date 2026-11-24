"""Shared fixtures. Every test runs with PROMPT_WEAVER_DATA_DIR pointing at a temp dir so nothing can
touch the real data dir (D:/Anything/storage/prompt-weaver-local-storage) or the ComfyUI model folders.

The model folders (AppPaths.models_root: checkpoints / loras / embeddings) also live in the temp dir, and the
real network is unreachable: the `app` fixture routes every outgoing request to the `fake_http` fixture
(tests/support.py FakeHttp) and `block_real_network` makes any other httpx request to a non-loopback host fail
(loopback stays allowed for in-process test servers).

Rules: never import app.main (it builds the app on the real data dir) and never import
app.services.runtime_adapter / diffusion_lora_runtime (loads torch). Use the `client` fixture, which runs
create_app() on the temp data dir with a FakeGenerator and FakeHttp.
"""

from __future__ import annotations

import shutil
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from app import settings as settings_module
from app.factory import create_app
from app.services import file_hashes
from support import (
    FIXTURES_DIR,
    CountingFactory,
    FakeGenerator,
    FakeHttp,
    OutputFactory,
    load_fixture,
    write_json_file,
)

LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


@pytest.fixture(autouse=True)
def isolated_data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    data_dir = tmp_path / "data"
    monkeypatch.setenv(settings_module.DATA_DIR_ENV, str(data_dir))
    assert settings_module.resolve_data_root() == data_dir
    # Safety net: AppPaths.for_root() without models_root must never reach the real ComfyUI model folders.
    monkeypatch.setattr(settings_module, "DEFAULT_MODELS_ROOT", tmp_path / "default-models")
    return data_dir


@pytest.fixture(autouse=True)
def block_real_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Real httpx transports may only reach loopback hosts (in-process test servers)."""
    real_sync = httpx.HTTPTransport.handle_request
    real_async = httpx.AsyncHTTPTransport.handle_async_request

    def guard(request: httpx.Request) -> None:
        if request.url.host not in LOOPBACK_HOSTS:
            raise AssertionError(f"Tests must not reach the network: {request.method} {request.url}")

    def sync_request(self: httpx.HTTPTransport, request: httpx.Request) -> httpx.Response:
        guard(request)
        return real_sync(self, request)

    async def async_request(self: httpx.AsyncHTTPTransport, request: httpx.Request) -> httpx.Response:
        guard(request)
        return await real_async(self, request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", sync_request)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", async_request)


@pytest.fixture()
def app_paths(isolated_data_dir: Path) -> settings_module.AppPaths:
    """AppPaths on the temp data dir; the model folders (models_root) are inside it too."""
    return settings_module.AppPaths.for_root(isolated_data_dir, models_root=isolated_data_dir / "models")


@pytest.fixture()
def hash_calls(monkeypatch: pytest.MonkeyPatch) -> list[Path]:
    """Every file actually hashed (file_hashes.sha256_file calls), in order: proves that a hash-cache hit or a
    skipped candidate costs no hashing."""
    calls: list[Path] = []
    real = file_hashes.sha256_file

    def spy(path: Path, **kwargs: int) -> str:
        calls.append(Path(path))
        return real(path, **kwargs)

    monkeypatch.setattr(file_hashes, "sha256_file", spy)
    return calls


@pytest.fixture()
def fake_http() -> Iterator[FakeHttp]:
    """The app's network (see support.FakeHttp). Fails the test when a request had no registered route."""
    fake = FakeHttp()
    yield fake
    assert not fake.unexpected, f"Unexpected HTTP requests: {fake.unexpected}"


# ---------------------------------------------------------------------------
# App with a fake generator
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_generator() -> FakeGenerator:
    return FakeGenerator()


@pytest.fixture()
def generator_factory(fake_generator: FakeGenerator) -> CountingFactory:
    return CountingFactory(fake_generator)


@pytest.fixture()
def app(app_paths: settings_module.AppPaths, generator_factory: CountingFactory, fake_http: FakeHttp) -> FastAPI:
    return create_app(
        paths=app_paths,
        generator_factory=generator_factory,
        http_client_factory=fake_http.client_factory,
        install_signal_handlers=False,
    )


@pytest.fixture()
def client(app: FastAPI) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# Data files (trimmed copies of the real formats, see tests/fixtures)
# ---------------------------------------------------------------------------


@pytest.fixture()
def install_legacy_files(app_paths: settings_module.AppPaths) -> Callable[[], None]:
    """Copy tests/fixtures/legacy/app_state.json + library.json into the temp data dir."""

    def install() -> None:
        app_paths.root.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(FIXTURES_DIR / "legacy" / "app_state.json", app_paths.state_file)
        shutil.copyfile(FIXTURES_DIR / "legacy" / "library.json", app_paths.library_file)

    return install


@pytest.fixture()
def make_output(app_paths: settings_module.AppPaths) -> OutputFactory:
    """Create <id>.png and/or <id>.json (real metadata format) in the output dir (or the trash)."""

    def make(output_id: str, *, in_trash: bool = False, png: bool = True, metadata: bool = True) -> dict[str, Any]:
        folder = app_paths.trash_dir if in_trash else app_paths.output_dir
        folder.mkdir(parents=True, exist_ok=True)
        payload = load_fixture("outputs/metadata.json")
        payload.update(
            output_id=output_id,
            image_path=str(app_paths.output_dir / f"{output_id}.png"),
            metadata_path=str(app_paths.output_dir / f"{output_id}.json"),
        )
        if png:
            Image.new("RGB", (4, 6), (10, 20, 30)).save(folder / f"{output_id}.png")
        if metadata:
            write_json_file(folder / f"{output_id}.json", payload)
        return payload

    return make
