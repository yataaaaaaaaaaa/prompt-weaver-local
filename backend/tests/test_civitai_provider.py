"""CivitaiProvider: query building, mapping of the real (trimmed) Civitai responses in tests/fixtures/civitai,
error mapping and API token handling. The network is FakeHttp (tests/support.py)."""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any

import httpx
import pytest

from app.schemas import ModelSearchQuery, RemoteModel
from app.services.backend_settings import BackendSettingsStore
from app.services.model_providers import ProviderAuthError, ProviderError, ProviderNotFoundError
from app.services.model_providers.civitai import (
    AUTH_HINT,
    CIVITAI_API_URL,
    CIVITAI_BASE_MODELS,
    CIVITAI_KIND_TYPES,
    CIVITAI_SORTS,
    CivitaiProvider,
)
from app.settings import AppPaths
from support import FakeHttp, load_fixture

SEARCH_URL = f"{CIVITAI_API_URL}/models"
TOKEN = "civitai-secret-0123456789abcdef"
ADD_DETAIL_SHA256 = "47aaaf0d2945ca937151d61304946dd229b3f072140b85484bc93e38f2a6e2f7"
IMAGE_HOST = "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA"


@pytest.fixture()
def settings(app_paths: AppPaths) -> BackendSettingsStore:
    return BackendSettingsStore(app_paths.settings_file)


@pytest.fixture()
def provider(fake_http: FakeHttp, settings: BackendSettingsStore) -> CivitaiProvider:
    return CivitaiProvider(client_factory=fake_http.client_factory, settings=settings)


def serve_search(fake_http: FakeHttp, payload: Any) -> None:
    fake_http.add("GET", SEARCH_URL, json=payload)


def search(provider: CivitaiProvider, **query: Any) -> list[RemoteModel]:
    return provider.search(ModelSearchQuery(**query)).items


def last_params(fake_http: FakeHttp) -> list[tuple[str, str]]:
    return list(fake_http.requests[-1].url.params.multi_items())


# ---------------------------------------------------------------------------
# info
# ---------------------------------------------------------------------------


def test_info_lists_the_capabilities_and_token_state(provider: CivitaiProvider, settings: BackendSettingsStore) -> None:
    info = provider.info()

    assert (info.id, info.label, info.token_supported, info.token_set) == ("civitai", "Civitai", True, False)
    assert info.kinds == ["checkpoint", "lora", "embedding"]
    assert info.sorts == list(CIVITAI_SORTS)
    assert [(option.id, option.architecture) for option in info.base_models] == list(CIVITAI_BASE_MODELS.items())
    assert {option.id: option.architecture for option in info.base_models}["Illustrious"] == "sdxl"
    assert {option.id: option.architecture for option in info.base_models}["Flux.1 D"] is None

    settings.set_token("civitai", TOKEN)
    assert provider.info().token_set is True
    assert TOKEN not in provider.info().model_dump_json()


# ---------------------------------------------------------------------------
# search: query parameters
# ---------------------------------------------------------------------------


def test_search_sends_the_default_query(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    serve_search(fake_http, load_fixture("civitai/search_empty.json"))

    search(provider)

    request = fake_http.requests_to(SEARCH_URL)[0]
    assert request.method == "GET"
    every_type = [civitai_type for types in CIVITAI_KIND_TYPES.values() for civitai_type in types]
    assert last_params(fake_http) == [
        ("limit", "20"),
        ("sort", "Most Downloaded"),
        ("nsfw", "false"),
        *[("types", civitai_type) for civitai_type in every_type],
    ]
    assert "query" not in request.url.params
    assert "cursor" not in request.url.params


def test_search_repeats_list_params(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    serve_search(fake_http, load_fixture("civitai/search_empty.json"))

    search(
        provider,
        query="  detail tweaker ",
        kinds=["lora", "embedding"],
        base_models=["SD 1.5", "Illustrious"],
        sort="highest_rated",
        nsfw=True,
        limit=5,
        cursor="17616|457433|376130",
    )

    assert last_params(fake_http) == [
        ("limit", "5"),
        ("sort", "Highest Rated"),
        ("nsfw", "true"),
        ("query", "detail tweaker"),
        ("types", "LORA"),
        ("types", "LoCon"),
        ("types", "DoRA"),
        ("types", "TextualInversion"),
        ("baseModels", "SD 1.5"),
        ("baseModels", "Illustrious"),
        ("cursor", "17616|457433|376130"),
    ]


@pytest.mark.parametrize(("sort", "civitai_sort"), list(CIVITAI_SORTS.items()))
def test_search_maps_every_sort(provider: CivitaiProvider, fake_http: FakeHttp, sort: str, civitai_sort: str) -> None:
    serve_search(fake_http, load_fixture("civitai/search_empty.json"))

    search(provider, sort=sort, kinds=["checkpoint"], query=" ")

    assert last_params(fake_http) == [
        ("limit", "20"),
        ("sort", civitai_sort),
        ("nsfw", "false"),
        ("types", "Checkpoint"),
    ]


def test_search_next_cursor_and_empty_last_page(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    serve_search(fake_http, load_fixture("civitai/search_checkpoints.json"))
    assert provider.search(ModelSearchQuery()).next_cursor == "17616|457433|376130"

    serve_search(fake_http, load_fixture("civitai/search_empty.json"))
    page = provider.search(ModelSearchQuery(cursor="17616|457433|376130"))
    assert (page.items, page.next_cursor) == ([], None)

    serve_search(fake_http, {"items": [], "metadata": {"nextCursor": 40}})
    assert provider.search(ModelSearchQuery()).next_cursor == "40"


# ---------------------------------------------------------------------------
# search: mapping of the real fixtures
# ---------------------------------------------------------------------------


def test_maps_loras(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    serve_search(fake_http, load_fixture("civitai/search_loras.json"))

    detail, detail_xl = search(provider, kinds=["lora"], query="detail")

    assert detail.model_dump(exclude={"versions"}) == {
        "provider": "civitai",
        "id": "58390",
        "name": "Detail Tweaker LoRA (细节调整LoRA)",
        "kind": "lora",
        "creator": "CyberAIchemist",
        "nsfw": False,
        "tags": ["anime", "photorealistic", "concept", "detailed", "lora", "undetailed"],
        "download_count": 586477,
        "page_url": "https://civitai.com/models/58390",
    }
    (version,) = detail.versions
    assert version.id == "62833"
    assert version.name == "v1.0"
    assert (version.base_model, version.architecture) == ("SD 1.5", "sd15")
    assert version.trigger_words == []
    assert version.published_at == datetime(2023, 5, 5, 7, 28, 19, 122000, tzinfo=timezone.utc)
    assert version.page_url == "https://civitai.com/models/58390?modelVersionId=62833"
    assert (version.default_file_id, version.unavailable_reason) == ("44319", None)
    (file,) = version.files
    assert file.model_dump() == {
        "id": "44319",
        "name": "add_detail.safetensors",
        "size_bytes": 37861176,
        "sha256": ADD_DETAIL_SHA256,
        "format": "SafeTensor",
        "precision": None,
        "variant": None,
        "primary": True,
        "downloadable": True,
        "local_path": None,
    }
    assert [image.model_dump() for image in version.images] == [
        {
            "url": f"{IMAGE_HOST}/8db45d23-7bcf-4979-8b35-0e7779c5a8f8/width=450/692411.jpeg",
            "width": 1920,
            "height": 3840,
            "nsfw": False,
        },
        {
            "url": f"{IMAGE_HOST}/5db97082-a909-4c3e-b6d1-2a46318f29a0/width=450/692487.jpeg",
            "width": 3840,
            "height": 2154,
            "nsfw": False,
        },
    ]

    assert [(item.id, item.architecture, item.files[0].size_bytes) for item in detail_xl.versions] == [
        ("135867", "sdxl", 228452344),
        ("133241", "sdxl", 170541512),
    ]


def test_maps_checkpoints(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    serve_search(fake_http, load_fixture("civitai/search_checkpoints.json"))

    janku, illustrious = search(provider, kinds=["checkpoint"], base_models=["Illustrious"])

    assert (janku.kind, janku.creator, janku.download_count) == ("checkpoint", "janxd", 247219)
    latest = janku.versions[0]
    assert (latest.id, latest.base_model, latest.architecture) == ("2786084", "Illustrious", "sdxl")
    (file,) = latest.files
    assert (file.name, file.size_bytes, file.precision, file.variant) == (
        "JANKU v7.777.safetensors",
        6938040674,
        "fp16",
        "pruned",
    )
    assert file.sha256 == "88177d224ce97f60cf3e908f87902f913ed4562bd79d237f84238a4354601efb"
    # The first preview of this version is a video: skipped.
    assert [image.url.rsplit("/", 1)[-1] for image in latest.images] == ["124686956.jpeg"]
    assert all("/width=450/" in image.url for image in latest.images)
    assert illustrious.versions[0].default_file_id == "798303"


def test_maps_embeddings_and_refuses_pickle_files(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    serve_search(fake_http, load_fixture("civitai/search_embeddings.json"))

    easy_negative, deep_negative = search(provider, kinds=["embedding"])

    assert easy_negative.kind == "embedding"
    safetensors, pickle = easy_negative.versions
    assert safetensors.trigger_words == ["easynegative"]
    assert (safetensors.default_file_id, safetensors.unavailable_reason) == ("8955", None)
    assert (safetensors.files[0].size_bytes, safetensors.files[0].variant) == (24655, "full")
    assert (pickle.files[0].format, pickle.files[0].downloadable) == ("PickleTensor", False)
    assert pickle.default_file_id is None
    assert pickle.unavailable_reason is not None and "No downloadable file" in pickle.unavailable_reason

    # A version with a pickle file (not primary) and its SafeTensors twin (primary): the SafeTensors file wins.
    multi_format = deep_negative.versions[0]
    assert [(file.id, file.primary, file.downloadable) for file in multi_format.files] == [
        ("5845", False, False),
        ("1186961", True, True),
    ]
    assert multi_format.default_file_id == "1186961"
    assert multi_format.trigger_words == ["ng_deepnegative_v1_75t"]


def test_maps_multi_file_versions(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    """Realistic Vision: pruned / full SafeTensors and .ckpt files per version (GET /models/{id} item shape)."""
    serve_search(fake_http, {"items": [load_fixture("civitai/model_multi_file.json")], "metadata": {}})

    (model,) = search(provider, kinds=["checkpoint"])

    hyper, _, v51, _ = model.versions
    assert (hyper.base_model, hyper.architecture) == ("SD 1.5 Hyper", "sd15")
    assert hyper.trigger_words == []  # no trainedWords key in this payload
    assert hyper.default_file_id == "418901"
    assert [(file.id, file.format, file.precision, file.primary, file.downloadable) for file in v51.files] == [
        ("94300", "PickleTensor", "fp16", False, False),
        ("94298", "SafeTensor", "fp16", True, True),
        ("94297", "PickleTensor", "fp16", False, False),
        ("94301", "SafeTensor", "fp32", False, True),
    ]
    assert v51.default_file_id == "94298"
    assert all(not file.downloadable for file in v51.files if file.name.endswith(".ckpt"))


def test_maps_locon_and_dora_to_lora_and_drops_other_types(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    template = load_fixture("civitai/search_loras.json")["items"][0]
    items = []
    for index, civitai_type in enumerate(["LoCon", "DoRA", "VAE", "Controlnet", "Checkpoint", "TextualInversion"]):
        item = copy.deepcopy(template)
        item.update(id=index + 1, type=civitai_type)
        items.append(item)
    serve_search(fake_http, {"items": items, "metadata": {}})

    models = search(provider)

    assert [(model.id, model.kind) for model in models] == [
        ("1", "lora"),
        ("2", "lora"),
        ("5", "checkpoint"),
        ("6", "embedding"),
    ]


def test_unknown_base_models_are_not_installable(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    payload = load_fixture("civitai/search_loras.json")
    versions = payload["items"][0]["modelVersions"]
    versions[0]["baseModel"] = "Wan Video 14B t2v"
    flux = copy.deepcopy(versions[0])
    flux.update(id=1, baseModel="Flux.1 D")
    versions.append(flux)
    serve_search(fake_http, payload)

    unknown, known_unsupported = search(provider)[0].versions

    for version in (unknown, known_unsupported):
        assert version.architecture is None
        assert version.default_file_id == "44319"
        assert version.unavailable_reason is not None and "not supported" in version.unavailable_reason


def test_trigger_words_are_stripped(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    payload = load_fixture("civitai/search_loras.json")
    payload["items"][0]["modelVersions"][0]["trainedWords"] = [" detailed ", "", "  ", "add_detail"]
    serve_search(fake_http, payload)

    assert search(provider)[0].versions[0].trigger_words == ["detailed", "add_detail"]


def test_non_model_files_are_not_downloadable(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    payload = load_fixture("civitai/search_loras.json")
    files = payload["items"][0]["modelVersions"][0]["files"]
    pruned = copy.deepcopy(files[0])
    pruned.update(id=2, type="Pruned Model", primary=False)
    vae = copy.deepcopy(files[0])
    vae.update(id=3, type="VAE", primary=False)
    files.extend([pruned, vae])
    serve_search(fake_http, payload)

    version = search(provider)[0].versions[0]

    assert [(file.id, file.downloadable) for file in version.files] == [("44319", True), ("2", True), ("3", False)]


def nsfw_image_payload() -> dict[str, Any]:
    payload = load_fixture("civitai/search_loras.json")
    images = payload["items"][0]["modelVersions"][0]["images"]
    images[0]["nsfwLevel"] = 4  # R
    images[1]["nsfwLevel"] = 2  # PG-13: still safe
    return payload


def test_search_drops_nsfw_images_unless_nsfw_is_requested(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    serve_search(fake_http, nsfw_image_payload())

    safe = search(provider)[0].versions[0].images
    everything = search(provider, nsfw=True)[0].versions[0].images

    assert [(image.url.rsplit("/", 1)[-1], image.nsfw) for image in safe] == [("692487.jpeg", False)]
    assert [(image.url.rsplit("/", 1)[-1], image.nsfw) for image in everything] == [
        ("692411.jpeg", True),
        ("692487.jpeg", False),
    ]


@pytest.mark.parametrize(
    "payload",
    [
        ["not", "a", "page"],
        {"metadata": {}},
        {"items": [{"id": 1, "type": "LORA", "name": "x", "modelVersions": [{"id": 2, "files": [{"id": 3}]}]}]},
        {"items": [{"id": 1, "type": "LORA", "name": "x", "modelVersions": "nope"}]},
        {"items": [{"type": "LORA", "name": "x"}]},
    ],
)
def test_malformed_payloads_are_provider_errors(provider: CivitaiProvider, fake_http: FakeHttp, payload: Any) -> None:
    serve_search(fake_http, payload)

    with pytest.raises(ProviderError, match="unexpected payload"):
        search(provider)


def test_non_json_answer_is_a_provider_error(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    fake_http.add("GET", SEARCH_URL, content=b"<html>maintenance</html>")

    with pytest.raises(ProviderError, match="not JSON"):
        search(provider)


# ---------------------------------------------------------------------------
# get_version / find_by_hash
# ---------------------------------------------------------------------------


def test_get_version(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    url = f"{CIVITAI_API_URL}/model-versions/62833"
    fake_http.add("GET", url, json=load_fixture("civitai/model_version.json"))

    model = provider.get_version("62833")

    assert len(fake_http.requests_to(url)) == 1
    assert model.model_dump(exclude={"versions"}) == {
        "provider": "civitai",
        "id": "58390",
        "name": "Detail Tweaker LoRA (细节调整LoRA)",
        "kind": "lora",
        "creator": None,
        "nsfw": False,
        "tags": [],
        "download_count": 586477,
        "page_url": "https://civitai.com/models/58390",
    }
    (version,) = model.versions
    assert (version.id, version.name, version.architecture) == ("62833", "v1.0", "sd15")
    assert version.page_url == "https://civitai.com/models/58390?modelVersionId=62833"
    assert (version.default_file_id, version.unavailable_reason) == ("44319", None)
    assert version.files[0].sha256 == ADD_DETAIL_SHA256
    assert version.files[0].size_bytes == 37861176
    assert [image.url.rsplit("/", 2)[-2] for image in version.images] == ["width=450", "width=450"]


def test_get_version_keeps_nsfw_images_flagged(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    payload = load_fixture("civitai/model_version.json")
    payload["images"][0]["nsfwLevel"] = 8
    payload["images"].append({**payload["images"][1], "type": "video", "url": "https://x/original=true/v.mp4"})
    fake_http.add("GET", f"{CIVITAI_API_URL}/model-versions/62833", json=payload)

    images = provider.get_version("62833").versions[0].images

    assert [image.nsfw for image in images] == [True, False]


def test_find_by_hash(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    url = f"{CIVITAI_API_URL}/model-versions/by-hash/{ADD_DETAIL_SHA256}"
    fake_http.add("GET", url, json=load_fixture("civitai/model_version.json"))

    model = provider.find_by_hash(ADD_DETAIL_SHA256)

    assert len(fake_http.requests_to(url)) == 1
    assert (model.id, model.kind, model.versions[0].id) == ("58390", "lora", "62833")


def test_version_of_an_unsupported_type_is_not_found(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    payload = load_fixture("civitai/model_version.json")
    payload["model"]["type"] = "VAE"
    fake_http.add("GET", f"{CIVITAI_API_URL}/model-versions/62833", json=payload)

    with pytest.raises(ProviderNotFoundError, match="VAE"):
        provider.get_version("62833")


@pytest.mark.parametrize("version_id", ["abc", "../models", "1/2", ""])
def test_invalid_version_ids_are_not_requested(provider: CivitaiProvider, fake_http: FakeHttp, version_id: str) -> None:
    with pytest.raises(ProviderNotFoundError):
        provider.get_version(version_id)
    with pytest.raises(ProviderNotFoundError):
        provider.find_by_hash(version_id)

    assert fake_http.requests == []


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

VERSION_URL = f"{CIVITAI_API_URL}/model-versions/62833"


def test_404_is_not_found(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    fake_http.add("GET", VERSION_URL, status=404, json=load_fixture("civitai/error_not_found.json"))

    with pytest.raises(ProviderNotFoundError, match="62833"):
        provider.get_version("62833")


def test_400_quotes_the_civitai_error_message_truncated(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    fake_http.add("GET", SEARCH_URL, status=400, json=load_fixture("civitai/error_invalid_params.json"))

    with pytest.raises(ProviderError) as raised:
        search(provider)

    message = str(raised.value)
    assert not isinstance(raised.value, ProviderAuthError)
    assert message.startswith("Civitai answered HTTP 400: [ { \"code\": \"invalid_union\"")
    assert message.endswith("...")
    assert len(message) <= len("Civitai answered HTTP 400: ") + 300


def test_500_quotes_a_plain_error_string(provider: CivitaiProvider, fake_http: FakeHttp) -> None:
    fake_http.add("GET", SEARCH_URL, status=500, json={"error": "Internal error"})

    with pytest.raises(ProviderError, match=r"^Civitai answered HTTP 500: Internal error$"):
        search(provider)


@pytest.mark.parametrize("status", [401, 403])
def test_401_and_403_are_auth_errors(
    provider: CivitaiProvider, fake_http: FakeHttp, settings: BackendSettingsStore, status: int
) -> None:
    fake_http.add("GET", VERSION_URL, status=status, json={"error": "Unauthorized"})

    with pytest.raises(ProviderAuthError, match="add one in the Model library settings"):
        provider.get_version("62833")

    settings.set_token("civitai", TOKEN)
    with pytest.raises(ProviderAuthError, match="rejected the stored API token") as raised:
        provider.get_version("62833")
    assert TOKEN not in str(raised.value)


def test_network_errors_are_provider_errors_without_the_token(
    provider: CivitaiProvider, fake_http: FakeHttp, settings: BackendSettingsStore
) -> None:
    settings.set_token("civitai", TOKEN)

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"connection refused (headers: {dict(request.headers)})", request=request)

    fake_http.add("GET", SEARCH_URL, handler=refuse)

    with pytest.raises(ProviderError) as raised:
        search(provider)

    assert "ConnectError" in str(raised.value)
    assert TOKEN not in str(raised.value)
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__ is True


def test_error_answers_never_echo_the_token(
    provider: CivitaiProvider, fake_http: FakeHttp, settings: BackendSettingsStore
) -> None:
    settings.set_token("civitai", TOKEN)
    fake_http.add(
        "GET",
        SEARCH_URL,
        handler=lambda request: httpx.Response(500, json={"error": request.headers["Authorization"]}),
    )

    with pytest.raises(ProviderError) as raised:
        search(provider)

    assert TOKEN not in str(raised.value)
    assert "Bearer ***" in str(raised.value)


# ---------------------------------------------------------------------------
# API token
# ---------------------------------------------------------------------------


def test_authorization_header_only_when_a_token_is_stored(
    provider: CivitaiProvider, fake_http: FakeHttp, settings: BackendSettingsStore
) -> None:
    serve_search(fake_http, load_fixture("civitai/search_empty.json"))
    fake_http.add("GET", VERSION_URL, json=load_fixture("civitai/model_version.json"))

    search(provider)
    provider.get_version("62833")
    assert all("authorization" not in request.headers for request in fake_http.requests)

    settings.set_token("civitai", TOKEN)
    search(provider)
    provider.get_version("62833")
    assert [request.headers.get("authorization") for request in fake_http.requests[2:]] == [f"Bearer {TOKEN}"] * 2

    settings.set_token("civitai", None)
    search(provider)
    assert "authorization" not in fake_http.requests[-1].headers


def test_download_source(provider: CivitaiProvider, fake_http: FakeHttp, settings: BackendSettingsStore) -> None:
    serve_search(fake_http, {"items": [load_fixture("civitai/model_multi_file.json")], "metadata": {}})
    (model,) = search(provider)
    v51 = model.versions[2]
    full_fp32 = v51.files[3]

    source = provider.download_source(model, full_fp32)

    assert source.url == "https://civitai.com/api/download/models/130072?fileId=94301"
    assert dict(source.headers) == {}
    assert source.auth_hint == AUTH_HINT

    settings.set_token("civitai", TOKEN)
    with_token = provider.download_source(model, full_fp32)
    assert dict(with_token.headers) == {"Authorization": f"Bearer {TOKEN}"}
    assert TOKEN not in repr(with_token)

    # Same URL as the one the version endpoint publishes for that file.
    version_payload = load_fixture("civitai/model_version.json")
    fake_http.add("GET", VERSION_URL, json=version_payload)
    single = provider.get_version("62833")
    published_url = version_payload["files"][0]["downloadUrl"]
    assert provider.download_source(single, single.versions[0].files[0]).url == published_url

    foreign = model.versions[0].files[0].model_copy(update={"id": "999"})
    with pytest.raises(ValueError):
        provider.download_source(model, foreign)


def test_repr_never_contains_the_token(provider: CivitaiProvider, settings: BackendSettingsStore) -> None:
    settings.set_token("civitai", TOKEN)

    assert TOKEN not in repr(provider)
