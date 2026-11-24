"""CivitaiImageProvider: GET /images query parameters, mapping of the real (trimmed) answers in
tests/fixtures/civitai/images_*.json, nsfw filtering, errors and API token handling. The network is FakeHttp
(tests/support.py). The parsing of the generation metadata itself is covered by test_civitai_image_meta.py."""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any, get_args

import httpx
import pytest

from app.schemas import ImagePeriod, ImageResource, ImageSearchPage, ImageSort
from app.services.backend_settings import BackendSettingsStore
from app.services.model_providers import (
    ImageFeedRequest,
    ImageProviderRegistry,
    ProviderAuthError,
    ProviderError,
    ProviderNotFoundError,
)
from app.services.model_providers.civitai import CIVITAI_API_URL, CivitaiProvider
from app.services.model_providers.civitai_images import (
    CIVITAI_IMAGE_PERIODS,
    CIVITAI_IMAGE_SORTS,
    CivitaiImageProvider,
    image_feed_params,
    map_image,
)
from app.settings import AppPaths
from support import FakeHttp, load_fixture

IMAGES_URL = f"{CIVITAI_API_URL}/images"
TOKEN = "civitai-secret-0123456789abcdef"
IMAGE_HOST = "https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA"


@pytest.fixture()
def settings(app_paths: AppPaths) -> BackendSettingsStore:
    return BackendSettingsStore(app_paths.settings_file)


@pytest.fixture()
def provider(fake_http: FakeHttp, settings: BackendSettingsStore) -> CivitaiImageProvider:
    return CivitaiImageProvider(api=CivitaiProvider(client_factory=fake_http.client_factory, settings=settings))


def feed_request(**overrides: Any) -> ImageFeedRequest:
    return ImageFeedRequest(**{"sort": "most_reactions", "nsfw": False, "limit": 20, **overrides})


def serve(fake_http: FakeHttp, payload: Any) -> None:
    """Answers GET /images with `payload`, or with the fixture civitai/<payload>.json when it is a name."""
    if isinstance(payload, str):
        payload = load_fixture(f"civitai/{payload}.json")
    fake_http.add("GET", IMAGES_URL, json=payload)


def search(provider: CivitaiImageProvider, **overrides: Any) -> ImageSearchPage:
    return provider.search_images(feed_request(**overrides))


def last_params(fake_http: FakeHttp) -> list[tuple[str, str]]:
    return list(fake_http.requests_to(IMAGES_URL)[-1].url.params.multi_items())


def lora(
    name: str | None, weight: float | None, *, version_id: str | None = None, hash: str | None = None
) -> ImageResource:
    return ImageResource(kind="lora", name=name, weight=weight, version_id=version_id, hash=hash)


def checkpoint(name: str | None, *, version_id: str | None = None, hash: str | None = None) -> ImageResource:
    return ImageResource(kind="checkpoint", name=name, weight=None, version_id=version_id, hash=hash)


# ---------------------------------------------------------------------------
# Query parameters
# ---------------------------------------------------------------------------


def test_feed_params(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    serve(fake_http, "images_empty")

    search(provider, period="week")

    assert last_params(fake_http) == [
        ("limit", "20"),
        ("sort", "Most Reactions"),
        ("nsfw", "Soft"),
        ("period", "Week"),
        ("withMeta", "true"),
        ("type", "image"),
    ]


def test_gallery_params_never_send_a_period_and_repeat_base_models(
    provider: CivitaiImageProvider, fake_http: FakeHttp
) -> None:
    serve(fake_http, "images_empty")

    search(
        provider,
        sort="newest",
        nsfw=True,
        limit=5,
        period="week",  # Civitai answers empty or partial pages for a gallery + period
        model_id="58390",
        base_models=("SD 1.5", "Illustrious", "SD 1.5"),
        cursor="148224054",
    )

    assert last_params(fake_http) == [
        ("limit", "5"),
        ("sort", "Newest"),
        ("nsfw", "X"),
        ("modelId", "58390"),
        ("baseModels", "SD 1.5"),
        ("baseModels", "Illustrious"),
        ("cursor", "148224054"),
        ("withMeta", "true"),
        ("type", "image"),
    ]


def test_feed_without_a_period_and_empty_cursor() -> None:
    params = image_feed_params(feed_request(period=None, cursor=""))

    assert [name for name, _ in params] == ["limit", "sort", "nsfw", "withMeta", "type"]


def test_sorts_and_periods_are_exhaustive() -> None:
    assert list(CIVITAI_IMAGE_SORTS) == list(get_args(ImageSort))
    assert list(CIVITAI_IMAGE_PERIODS) == list(get_args(ImagePeriod))
    assert CIVITAI_IMAGE_PERIODS["all_time"] == "AllTime"


@pytest.mark.parametrize(("sort", "civitai_sort"), list(CIVITAI_IMAGE_SORTS.items()))
@pytest.mark.parametrize(("period", "civitai_period"), list(CIVITAI_IMAGE_PERIODS.items()))
def test_every_sort_and_period_is_sent(sort: str, civitai_sort: str, period: str, civitai_period: str) -> None:
    params = dict(image_feed_params(feed_request(sort=sort, period=period)))

    assert (params["sort"], params["period"]) == (civitai_sort, civitai_period)


# ---------------------------------------------------------------------------
# Mapping of the real fixtures
# ---------------------------------------------------------------------------


def test_maps_the_feed_with_flat_meta(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    serve(fake_http, "images_feed")
    raw_items = load_fixture("civitai/images_feed.json")["items"]

    page = search(provider, period="week")

    assert page.next_cursor == "feed:1535:149382895"
    on_site, without_meta, comfy = page.items
    uuid = "15917087-88fa-4792-849b-b49dda7905a7"
    assert on_site.model_dump(exclude={"params", "resources"}) == {
        "provider": "civitai",
        "id": "149496085",
        "url": f"{IMAGE_HOST}/{uuid}/original=true/{uuid}.jpeg",
        "thumbnail_url": f"{IMAGE_HOST}/{uuid}/width=450/{uuid}.jpeg",
        "width": 768,
        "height": 1376,
        "nsfw": False,
        "base_model": "Krea 2 Turbo",
        "architecture": None,  # unknown base model: not loadable locally
        "username": "lightyagami_",
        "created_at": datetime(2026, 11, 19, 4, 45, tzinfo=timezone.utc),
        "reaction_count": 1097 + 447 + 87 + 52,  # likes + hearts + laughs + cries (not comments)
        "page_url": "https://civitai.com/images/149496085",
    }
    assert on_site.params is not None
    assert on_site.params.model_dump() == {
        "prompt": raw_items[0]["meta"]["prompt"],
        "clean_prompt": raw_items[0]["meta"]["prompt"],
        "negative_prompt": None,
        "sampler": "euler",
        "steps": 10,
        "cfg_scale": 1.0,
        "seed": 1906051564,
        "width": 768,
        "height": 1376,
        "clip_skip": None,
    }
    # civitaiResources: version ids + weights (diffusionmodel = the checkpoint).
    assert on_site.resources == [
        checkpoint(None, version_id="3072332"),
        lora(None, 1.0, version_id="3116962"),
        lora(None, 1.0, version_id="3470964"),
        lora(None, 1.0, version_id="3113897"),
        lora(None, 1.0, version_id="3375347"),
    ]

    assert (without_meta.id, without_meta.params, without_meta.resources) == ("149285033", None, [])
    assert without_meta.reaction_count == 1086 + 409 + 113 + 39

    # ComfyUI upload: resources + full SHA-256 hashes + inline LoRA tags with spaces in their names.
    assert comfy.params is not None
    assert comfy.params.prompt == raw_items[2]["meta"]["prompt"]
    assert comfy.params.clean_prompt is not None
    assert comfy.params.clean_prompt.startswith("dfd1, Bradhamel art style, A tall slender stone keep")
    assert comfy.params.clean_prompt.endswith("heroic and windswept.")
    assert "<lora:" not in comfy.params.clean_prompt
    assert (comfy.params.seed, comfy.params.steps, comfy.params.width, comfy.params.height) == (
        744905942529739,
        8,
        1456,
        2176,
    )
    assert comfy.resources == [
        checkpoint(
            "kroma-v0.3.1-turbo-opd-W8A8", hash="96043ecf3e920288fbf6f13ca81ba3629fe02e9f8729ed116382ebe4978e7839"
        ),
        lora("KreaComics_V2", 1.0, hash="c3c878a7f6565ffd23663a73416e76a7263b72303721af63bf7b96b0f79af9ed"),
        lora("dfd1 v1", 1.0, hash="63f06786527b716e82a7b3a2b8d425548b72d907739087ff36e5e127d906c94f"),
    ]


def test_a_version_gallery_is_requested_by_version_only(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    serve(fake_http, "images_empty")

    search(provider, model_id="58390", model_version_id="62833", period="week", cursor="feed:2315:10993445")

    assert last_params(fake_http) == [
        ("limit", "20"),
        ("sort", "Most Reactions"),
        ("nsfw", "Soft"),
        ("modelVersionId", "62833"),
        ("cursor", "feed:2315:10993445"),
        ("withMeta", "true"),
        ("type", "image"),
    ]


def test_maps_a_version_gallery_with_flat_meta(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    serve(fake_http, "images_by_version")

    page = search(provider, model_id="58390", model_version_id="62833")

    assert page.next_cursor == "feed:2315:10993445"
    no_meta, unknown_base, a1111 = page.items
    assert (no_meta.params, no_meta.resources) == (None, [])
    assert (unknown_base.base_model, unknown_base.architecture) == (None, None)
    assert a1111.params is not None
    assert a1111.params.model_dump(exclude={"prompt", "clean_prompt", "negative_prompt"}) == {
        "sampler": "DPM++ SDE Karras",
        "steps": 30,
        "cfg_scale": 6.0,
        "seed": 3142190795,
        "width": 512,  # from "Size": "512x768"
        "height": 768,
        "clip_skip": 2,
    }
    assert [(r.kind, r.name, r.weight, r.hash) for r in a1111.resources] == [
        ("checkpoint", "comicmixNSFWByMrMonster_v325", None, "f8cd338212"),
        ("lora", "add_detail", 0.5, "7c6bad76eb54"),
        ("lora", "backlight_slider_v10", -1.0, "bce77b76fba3"),
    ]


def test_maps_a_gallery_with_wrapped_meta(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    serve(fake_http, "images_by_model")

    page = search(provider, model_id="58390")

    assert page.next_cursor == "148224054"  # an integer cursor, sent back as a string
    a1111, forge, forge_single = page.items
    assert [(image.base_model, image.architecture) for image in page.items] == [
        ("SD 1.5", "sd15"),
        ("SDXL 1.0", "sdxl"),
        ("SDXL 1.0", "sdxl"),
    ]
    assert [image.reaction_count for image in page.items] == [1, 2, 1]
    assert a1111.thumbnail_url == (
        f"{IMAGE_HOST}/f9bd78ed-ca03-4f64-9fe3-6047d9739ad6/width=450/f9bd78ed-ca03-4f64-9fe3-6047d9739ad6.jpeg"
    )
    assert a1111.params is not None
    assert a1111.params.model_dump(exclude={"prompt", "clean_prompt", "negative_prompt"}) == {
        "sampler": "DPM++ 2M Karras",
        "steps": 25,
        "cfg_scale": 5.0,
        "seed": 3748019926,
        "width": 512,  # the generation size, not the (upscaled) image size
        "height": 768,
        "clip_skip": 2,
    }
    assert a1111.params.negative_prompt is not None
    assert a1111.params.negative_prompt.startswith("0001SoftRealisticNegativeV2,badhandv4,EasyNegative")
    # AutoV2 checkpoint hash (resources + hashes + Model hash merged), AutoV3 LoRA hashes, published weights.
    assert a1111.resources == [
        checkpoint("chilloutmix_NiPrunedFp32Fix", hash="fc2511737a"),
        lora("kim_v_1", 0.6, hash="1921d0925550"),
        lora("add_detail", 1.0, hash="7c6bad76eb54"),
    ]
    # A resource without weight takes the weight of its inline tag.
    assert forge.resources == [
        checkpoint("Coyote2900", hash="b0f6031b98"),
        lora("add_detail", 1.0, hash="47aaaf0d2945"),
        lora("realistic filter [IL]", 1.0, hash="e762b626fbc9"),
    ]
    assert forge.params is not None and forge.params.clean_prompt is not None
    assert forge.params.clean_prompt.endswith("masterpiece, best quality, high quality   Realistic")
    assert forge_single.resources == [
        checkpoint("Coyote2900", hash="b0f6031b98"),
        lora("add_detail", 1.0, hash="47aaaf0d2945"),
    ]


def test_maps_on_site_images_from_civitai_resources(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    serve(fake_http, "images_by_model_onsite")

    page = search(provider, model_id="61066")

    (image,) = page.items
    assert page.next_cursor == "141517523"
    assert (image.id, image.architecture, image.width, image.height) == ("141517526", "sd15", 512, 512)
    # civitaiResources is authoritative for checkpoints and LoRAs: the name-only LoRA (resources + inline tag) is
    # the same model as version 65537 and is not listed twice.
    assert image.resources == [checkpoint(None, version_id="2305821"), lora(None, 1.0, version_id="65537")]
    assert image.params is not None
    assert (image.params.sampler, image.params.clip_skip, image.params.cfg_scale) == ("Euler a", 2, 7.0)
    assert image.params.clean_prompt is not None
    assert image.params.clean_prompt.endswith("looking away, ((masterpiece))")


def test_the_empty_last_page(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    serve(fake_http, "images_empty")

    assert search(provider, model_id="58390", cursor="148224054") == ImageSearchPage(items=[], next_cursor=None)


def nsfw_payload() -> dict[str, Any]:
    payload = load_fixture("civitai/images_by_model.json")
    first, second, third = payload["items"]
    first["browsingLevel"] = 4  # R
    second["browsingLevel"] = 2  # PG-13: still safe
    del third["browsingLevel"]  # unrated: never shown by accident
    return payload


def test_nsfw_images_are_dropped_unless_requested(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    serve(fake_http, nsfw_payload())

    safe = search(provider)
    everything = search(provider, nsfw=True)

    assert [(image.id, image.nsfw) for image in safe.items] == [("148238586", False)]
    assert safe.next_cursor == "148224054"
    assert [(image.id, image.nsfw) for image in everything.items] == [
        ("148522541", True),
        ("148238586", False),
        ("148238585", True),
    ]


def test_videos_and_items_without_id_or_url_are_skipped() -> None:
    template = load_fixture("civitai/images_by_model.json")["items"][0]
    video = {**template, "type": "video"}
    no_url = {**template, "url": ""}
    no_id = {key: value for key, value in template.items() if key != "id"}
    bad_id = {**template, "id": "12a"}

    assert [map_image(item) for item in (video, no_url, no_id, bad_id)] == [None, None, None, None]
    assert map_image({key: value for key, value in template.items() if key != "type"}) is not None


def test_unreadable_item_fields_read_as_absent() -> None:
    item = copy.deepcopy(load_fixture("civitai/images_feed.json")["items"][1])
    item.update(
        width="wide",
        height=-1,
        createdAt="yesterday",
        stats={"likeCount": "many", "heartCount": 3, "laughCount": None, "cryCount": True},
        baseModel=None,
        username="",
        meta={"id": 149285033, "meta": None},
    )

    image = map_image(item)

    assert image is not None
    assert (image.width, image.height, image.created_at, image.reaction_count) == (None, None, None, 3)
    assert (image.base_model, image.architecture, image.username) == (None, None, None)
    assert (image.params, image.resources) == (None, [])


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        ["not", "a", "page"],
        {"metadata": {}},
        {"items": "nope"},
        {"items": ["not an object"]},
    ],
)
def test_malformed_payloads_are_provider_errors(
    provider: CivitaiImageProvider, fake_http: FakeHttp, payload: Any
) -> None:
    serve(fake_http, payload)

    with pytest.raises(ProviderError, match="unexpected payload"):
        search(provider)


def test_non_json_answer_is_a_provider_error(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    fake_http.add("GET", IMAGES_URL, content=b"<html>maintenance</html>")

    with pytest.raises(ProviderError, match="not JSON"):
        search(provider)


def test_400_quotes_the_zod_error(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    """The real answer to an invalid parameter (here type=bogus)."""
    fake_http.add("GET", IMAGES_URL, status=400, json=load_fixture("civitai/images_error_invalid_type.json"))

    with pytest.raises(ProviderError) as raised:
        search(provider)

    message = str(raised.value)
    assert not isinstance(raised.value, ProviderAuthError)
    assert message.startswith('Civitai answered HTTP 400: [ { "code": "invalid_value"')
    assert 'Invalid option: expected one of \\"image\\"|\\"video\\"|\\"audio\\"' in message


def test_404_is_not_found(provider: CivitaiImageProvider, fake_http: FakeHttp) -> None:
    fake_http.add("GET", IMAGES_URL, status=404, json=load_fixture("civitai/error_not_found.json"))

    with pytest.raises(ProviderNotFoundError, match="model 58390"):
        search(provider, model_id="58390")
    with pytest.raises(ProviderNotFoundError, match="image feed"):
        search(provider)


@pytest.mark.parametrize("model_id", ["abc", "../models", "1/2", ""])
def test_invalid_model_ids_are_not_requested(
    provider: CivitaiImageProvider, fake_http: FakeHttp, model_id: str
) -> None:
    with pytest.raises(ProviderNotFoundError):
        search(provider, model_id=model_id)
    with pytest.raises(ProviderNotFoundError, match="model version"):
        search(provider, model_id="58390", model_version_id=model_id)

    assert fake_http.requests == []


@pytest.mark.parametrize("status", [401, 403])
def test_401_and_403_are_auth_errors(
    provider: CivitaiImageProvider, fake_http: FakeHttp, settings: BackendSettingsStore, status: int
) -> None:
    fake_http.add("GET", IMAGES_URL, status=status, json={"error": "Unauthorized"})

    with pytest.raises(ProviderAuthError, match="add one in the Model library settings"):
        search(provider)

    settings.set_token("civitai", TOKEN)
    with pytest.raises(ProviderAuthError, match="rejected the stored API token") as raised:
        search(provider)
    assert TOKEN not in str(raised.value)


def test_errors_never_contain_the_token(
    provider: CivitaiImageProvider, fake_http: FakeHttp, settings: BackendSettingsStore
) -> None:
    settings.set_token("civitai", TOKEN)
    fake_http.add(
        "GET",
        IMAGES_URL,
        handler=lambda request: httpx.Response(500, json={"error": request.headers["Authorization"]}),
    )
    with pytest.raises(ProviderError) as echoed:
        search(provider)
    assert TOKEN not in str(echoed.value)
    assert "Bearer ***" in str(echoed.value)

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"connection refused (headers: {dict(request.headers)})", request=request)

    fake_http.add("GET", IMAGES_URL, handler=refuse)
    with pytest.raises(ProviderError, match="could not be reached") as unreachable:
        search(provider)
    assert TOKEN not in str(unreachable.value)
    assert unreachable.value.__cause__ is None


# ---------------------------------------------------------------------------
# API token, registry
# ---------------------------------------------------------------------------


def test_bearer_token_only_when_one_is_stored(
    provider: CivitaiImageProvider, fake_http: FakeHttp, settings: BackendSettingsStore
) -> None:
    serve(fake_http, "images_empty")

    search(provider)
    settings.set_token("civitai", TOKEN)
    search(provider, model_id="58390")
    settings.set_token("civitai", None)
    search(provider)

    assert [request.headers.get("authorization") for request in fake_http.requests_to(IMAGES_URL)] == [
        None,
        f"Bearer {TOKEN}",
        None,
    ]


def test_repr_never_contains_the_token(provider: CivitaiImageProvider, settings: BackendSettingsStore) -> None:
    settings.set_token("civitai", TOKEN)

    assert TOKEN not in repr(provider)
    assert "CivitaiImageProvider" in repr(provider)


def test_is_an_image_provider_with_the_model_provider_id(provider: CivitaiImageProvider) -> None:
    assert ImageProviderRegistry([provider]).get("civitai") is provider
