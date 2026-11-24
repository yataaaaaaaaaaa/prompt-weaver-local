"""Model library catalog: ModelCatalogService and the /api/models routes (info, search, version and hash
lookups, provider API token). Civitai answers come from FakeHttp with the real trimmed fixtures."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.schemas import ModelKind, ModelProviderInfo, ModelSearchQuery, RemoteFile
from app.services.backend_settings import BackendSettingsStore
from app.services.file_hashes import FileHashCache
from app.services.local_models import LocalModelFiles
from app.services.model_catalog import ModelCatalogService, TokenNotSupportedError
from app.services.model_providers import ModelProviderRegistry, ProviderNotFoundError, UnknownProviderError
from app.services.model_providers.civitai import CIVITAI_API_URL, CivitaiProvider
from app.settings import AppPaths
from support import FakeHttp, load_fixture

SEARCH_URL = f"{CIVITAI_API_URL}/models"
VERSION_URL = f"{CIVITAI_API_URL}/model-versions/62833"
ADD_DETAIL_SHA256 = "47aaaf0d2945ca937151d61304946dd229b3f072140b85484bc93e38f2a6e2f7"
BY_HASH_URL = f"{CIVITAI_API_URL}/model-versions/by-hash/{ADD_DETAIL_SHA256}"
TOKEN = "civitai-secret-0123456789abcdef"
TOKEN_URL = "/api/models/providers/civitai/token"


@pytest.fixture()
def known_files(monkeypatch: pytest.MonkeyPatch, app_paths: AppPaths) -> dict[str, Path]:
    """Stands in for LocalModelFiles.known_path (owned by the installs feature): file id -> local path."""
    known: dict[str, Path] = {}

    def known_path(self: LocalModelFiles, kind: ModelKind, file: RemoteFile) -> Path | None:
        return known.get(file.id)

    monkeypatch.setattr(LocalModelFiles, "known_path", known_path)
    return known


def local_paths(model: dict[str, Any]) -> dict[str, str | None]:
    return {file["id"]: file["local_path"] for version in model["versions"] for file in version["files"]}


# ---------------------------------------------------------------------------
# GET /api/models/info
# ---------------------------------------------------------------------------


def test_info_lists_providers_and_model_dirs(client: TestClient, app_paths: AppPaths) -> None:
    response = client.get("/api/models/info")

    assert response.status_code == 200
    body = response.json()
    assert body["model_dirs"] == {
        "checkpoint": str(app_paths.models_root / "checkpoints"),
        "lora": str(app_paths.models_root / "loras"),
        "embedding": str(app_paths.models_root / "embeddings"),
    }
    (civitai,) = body["providers"]
    assert civitai["id"] == "civitai"
    assert civitai["token_supported"] is True
    assert civitai["token_set"] is False
    assert civitai["kinds"] == ["checkpoint", "lora", "embedding"]
    assert {"id": "Pony", "architecture": "sdxl"} in civitai["base_models"]


# ---------------------------------------------------------------------------
# GET /api/models/search
# ---------------------------------------------------------------------------


def test_search_forwards_the_query_and_annotates_local_copies(
    client: TestClient, fake_http: FakeHttp, known_files: dict[str, Path], app_paths: AppPaths
) -> None:
    local = app_paths.models_root / "loras" / "add_detail.safetensors"
    known_files["44319"] = local
    fake_http.add("GET", SEARCH_URL, json=load_fixture("civitai/search_loras.json"))

    response = client.get(
        "/api/models/search",
        params=[
            ("query", "detail"),
            ("kinds", "lora"),
            ("kinds", "embedding"),
            ("base_models", "SD 1.5"),
            ("base_models", "SDXL 1.0"),
            ("sort", "newest"),
            ("nsfw", "true"),
            ("limit", "2"),
            ("cursor", "2"),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    assert body["next_cursor"] == "2"
    assert [model["id"] for model in body["items"]] == ["58390", "122359"]
    assert local_paths(body["items"][0]) == {"44319": str(local)}
    assert local_paths(body["items"][1]) == {"99264": None, "97113": None}

    params = fake_http.requests_to(SEARCH_URL)[0].url.params
    assert params.get_list("types") == ["LORA", "LoCon", "DoRA", "TextualInversion"]
    assert params.get_list("baseModels") == ["SD 1.5", "SDXL 1.0"]
    assert (params["query"], params["sort"], params["nsfw"], params["limit"], params["cursor"]) == (
        "detail",
        "Newest",
        "true",
        "2",
        "2",
    )


def test_search_with_defaults(client: TestClient, fake_http: FakeHttp, known_files: dict[str, Path]) -> None:
    fake_http.add("GET", SEARCH_URL, json=load_fixture("civitai/search_empty.json"))

    response = client.get("/api/models/search")

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}
    params = fake_http.requests_to(SEARCH_URL)[0].url.params
    assert (params["sort"], params["nsfw"], params["limit"]) == ("Most Downloaded", "false", "20")
    assert "query" not in params


@pytest.mark.parametrize(
    "params",
    [
        {"limit": "0"},
        {"limit": "101"},
        {"sort": "random"},
        {"kinds": "vae"},
        {"nsfw": "maybe"},
    ],
)
def test_search_rejects_invalid_params(client: TestClient, fake_http: FakeHttp, params: dict[str, str]) -> None:
    response = client.get("/api/models/search", params=params)

    assert response.status_code == 422
    assert fake_http.requests == []


def test_search_with_an_unknown_provider_is_404(client: TestClient, fake_http: FakeHttp) -> None:
    response = client.get("/api/models/search", params={"provider": "nope"})

    assert response.status_code == 404
    assert "nope" in response.json()["detail"]
    assert fake_http.requests == []


# ---------------------------------------------------------------------------
# Version and hash lookups
# ---------------------------------------------------------------------------


def test_get_version(client: TestClient, fake_http: FakeHttp, known_files: dict[str, Path], tmp_path: Path) -> None:
    known_files["44319"] = tmp_path / "add_detail.safetensors"
    fake_http.add("GET", VERSION_URL, json=load_fixture("civitai/model_version.json"))

    response = client.get("/api/models/providers/civitai/versions/62833")

    assert response.status_code == 200
    body = response.json()
    assert (body["id"], body["kind"], [version["id"] for version in body["versions"]]) == ("58390", "lora", ["62833"])
    assert local_paths(body) == {"44319": str(tmp_path / "add_detail.safetensors")}


def test_find_by_hash_accepts_any_case(client: TestClient, fake_http: FakeHttp, known_files: dict[str, Path]) -> None:
    fake_http.add("GET", BY_HASH_URL, json=load_fixture("civitai/model_version.json"))

    response = client.get(f"/api/models/providers/civitai/by-hash/{ADD_DETAIL_SHA256.upper()}")

    assert response.status_code == 200
    assert response.json()["versions"][0]["files"][0]["sha256"] == ADD_DETAIL_SHA256
    assert local_paths(response.json()) == {"44319": None}
    assert len(fake_http.requests_to(BY_HASH_URL)) == 1


@pytest.mark.parametrize("bad_hash", ["abc", "g" * 64, "a" * 63, "a" * 65])
def test_find_by_hash_rejects_malformed_hashes(client: TestClient, fake_http: FakeHttp, bad_hash: str) -> None:
    response = client.get(f"/api/models/providers/civitai/by-hash/{bad_hash}")

    assert response.status_code == 422
    assert fake_http.requests == []


@pytest.mark.parametrize(
    "url",
    [
        "/api/models/providers/nope/versions/62833",
        f"/api/models/providers/nope/by-hash/{ADD_DETAIL_SHA256}",
    ],
)
def test_unknown_provider_is_404(client: TestClient, fake_http: FakeHttp, url: str) -> None:
    response = client.get(url)

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown model provider 'nope'."
    assert fake_http.requests == []


def test_unknown_version_is_404(client: TestClient, fake_http: FakeHttp) -> None:
    fake_http.add("GET", VERSION_URL, status=404, json=load_fixture("civitai/error_not_found.json"))

    response = client.get("/api/models/providers/civitai/versions/62833")

    assert response.status_code == 404
    assert "62833" in response.json()["detail"]


@pytest.mark.parametrize("status", [401, 403])
def test_auth_errors_are_403(client: TestClient, fake_http: FakeHttp, status: int) -> None:
    fake_http.add("GET", VERSION_URL, status=status, json={"error": "Unauthorized"})

    response = client.get("/api/models/providers/civitai/versions/62833")

    assert response.status_code == 403
    assert "API token" in response.json()["detail"]


def test_provider_failures_are_502(client: TestClient, fake_http: FakeHttp) -> None:
    fake_http.add("GET", SEARCH_URL, status=400, json=load_fixture("civitai/error_invalid_params.json"))
    response = client.get("/api/models/search")
    assert response.status_code == 502
    assert response.json()["detail"].startswith("Civitai answered HTTP 400")

    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("getaddrinfo failed", request=request)

    fake_http.add("GET", VERSION_URL, handler=unreachable)
    response = client.get("/api/models/providers/civitai/versions/62833")
    assert response.status_code == 502
    assert "could not be reached" in response.json()["detail"]


# ---------------------------------------------------------------------------
# PUT /api/models/providers/{provider}/token
# ---------------------------------------------------------------------------


def test_set_token_stores_it_without_ever_sending_it_back(
    client: TestClient, fake_http: FakeHttp, app_paths: AppPaths, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)

    response = client.put(TOKEN_URL, json={"token": f" {TOKEN} "})

    assert response.status_code == 200
    assert response.json()["token_set"] is True
    assert response.json()["id"] == "civitai"
    assert TOKEN not in response.text
    assert json.loads(app_paths.settings_file.read_text(encoding="utf-8")) == {
        "version": 1,
        "provider_tokens": {"civitai": TOKEN},
    }

    info = client.get("/api/models/info")
    assert info.json()["providers"][0]["token_set"] is True
    assert TOKEN not in info.text

    # Every provider request now carries the token.
    fake_http.add("GET", SEARCH_URL, json=load_fixture("civitai/search_empty.json"))
    search = client.get("/api/models/search")
    assert TOKEN not in search.text
    assert fake_http.requests_to(SEARCH_URL)[0].headers["Authorization"] == f"Bearer {TOKEN}"

    assert TOKEN not in caplog.text


@pytest.mark.parametrize("cleared", [{"token": None}, {"token": ""}, {}])
def test_null_or_empty_token_clears_it(client: TestClient, app_paths: AppPaths, cleared: dict[str, Any]) -> None:
    client.put(TOKEN_URL, json={"token": TOKEN})

    response = client.put(TOKEN_URL, json=cleared)

    assert response.status_code == 200
    assert response.json()["token_set"] is False
    assert client.get("/api/models/info").json()["providers"][0]["token_set"] is False
    assert TOKEN not in app_paths.settings_file.read_text(encoding="utf-8")


def test_set_token_of_an_unknown_provider_is_404(client: TestClient, app_paths: AppPaths) -> None:
    response = client.put("/api/models/providers/nope/token", json={"token": TOKEN})

    assert response.status_code == 404
    assert TOKEN not in response.text
    assert not app_paths.settings_file.exists()


def test_set_token_of_a_provider_without_tokens_is_409(
    client: TestClient, app_paths: AppPaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_info = CivitaiProvider.info

    def info_without_tokens(self: CivitaiProvider) -> ModelProviderInfo:
        return real_info(self).model_copy(update={"token_supported": False})

    monkeypatch.setattr(CivitaiProvider, "info", info_without_tokens)

    response = client.put(TOKEN_URL, json={"token": TOKEN})

    assert response.status_code == 409
    assert TOKEN not in response.text
    assert not app_paths.settings_file.exists()


def test_set_token_validates_the_body(client: TestClient) -> None:
    assert client.put(TOKEN_URL, json={"token": 12}).status_code == 422


# ---------------------------------------------------------------------------
# ModelCatalogService (without HTTP)
# ---------------------------------------------------------------------------


@pytest.fixture()
def catalog(app_paths: AppPaths, fake_http: FakeHttp) -> ModelCatalogService:
    settings = BackendSettingsStore(app_paths.settings_file)
    providers = ModelProviderRegistry([CivitaiProvider(client_factory=fake_http.client_factory, settings=settings)])
    local_files = LocalModelFiles(paths=app_paths, hashes=FileHashCache(app_paths.cache_dir / "file_hashes.json"))
    return ModelCatalogService(paths=app_paths, providers=providers, local_files=local_files, settings=settings)


def test_service_annotates_every_version_and_file(
    catalog: ModelCatalogService, fake_http: FakeHttp, known_files: dict[str, Path], tmp_path: Path
) -> None:
    known_files["94301"] = tmp_path / "Realistic_Vision_V5.1.safetensors"
    fake_http.add("GET", SEARCH_URL, json={"items": [load_fixture("civitai/model_multi_file.json")], "metadata": {}})

    (model,) = catalog.search(ModelSearchQuery()).items

    annotated = {file.id: file.local_path for version in model.versions for file in version.files}
    assert annotated["94301"] == str(tmp_path / "Realistic_Vision_V5.1.safetensors")
    assert [file_id for file_id, path in annotated.items() if path is not None] == ["94301"]
    assert len(annotated) == 12


def test_service_lowercases_hashes(
    catalog: ModelCatalogService, fake_http: FakeHttp, known_files: dict[str, Path]
) -> None:
    fake_http.add("GET", BY_HASH_URL, json=load_fixture("civitai/model_version.json"))

    assert catalog.find_by_hash("civitai", ADD_DETAIL_SHA256.upper()).id == "58390"


@pytest.mark.parametrize(
    ("published", "fixture", "expected"),
    [
        ("7C6BAD76EB54", "model_version.json", ("58390", "62833")),  # AutoV3 of add_detail, uppercase
        (" FC2511737A ", "model_version_checkpoint.json", ("6424", "11745")),  # AutoV2 of ChilloutMix
    ],
)
def test_service_finds_short_hashes_in_any_case(
    catalog: ModelCatalogService,
    fake_http: FakeHttp,
    known_files: dict[str, Path],
    tmp_path: Path,
    published: str,
    fixture: str,
    expected: tuple[str, str],
) -> None:
    url = f"{CIVITAI_API_URL}/model-versions/by-hash/{published.strip().lower()}"
    fake_http.add("GET", url, json=load_fixture(f"civitai/{fixture}"))
    file_id = load_fixture(f"civitai/{fixture}")["files"][0]["id"]
    known_files[str(file_id)] = tmp_path / "local.safetensors"

    model = catalog.find_by_hash("civitai", published)

    assert (model.id, model.versions[0].id) == expected
    assert model.versions[0].files[0].local_path == str(tmp_path / "local.safetensors")
    assert len(fake_http.requests_to(url)) == 1


@pytest.mark.parametrize("bad_hash", ["7c6bad76eb5", "not-a-hash", ""])
def test_service_never_requests_an_invalid_hash(
    catalog: ModelCatalogService, fake_http: FakeHttp, bad_hash: str
) -> None:
    with pytest.raises(ProviderNotFoundError):
        catalog.find_by_hash("civitai", bad_hash)

    assert fake_http.requests == []


def test_the_by_hash_route_still_takes_sha256_only(client: TestClient, fake_http: FakeHttp) -> None:
    response = client.get("/api/models/providers/civitai/by-hash/7c6bad76eb54")

    assert response.status_code == 422
    assert fake_http.requests == []


def test_service_rejects_unknown_providers_and_unsupported_tokens(
    catalog: ModelCatalogService, monkeypatch: pytest.MonkeyPatch, app_paths: AppPaths
) -> None:
    with pytest.raises(UnknownProviderError):
        catalog.set_token("nope", TOKEN)
    with pytest.raises(UnknownProviderError):
        catalog.get_version("nope", "1")

    assert catalog.set_token("civitai", TOKEN).token_set is True
    assert catalog.set_token("civitai", None).token_set is False

    real_info = CivitaiProvider.info
    monkeypatch.setattr(
        CivitaiProvider, "info", lambda self: real_info(self).model_copy(update={"token_supported": False})
    )
    with pytest.raises(TokenNotSupportedError):
        catalog.set_token("civitai", TOKEN)
    assert TOKEN not in app_paths.settings_file.read_text(encoding="utf-8")
