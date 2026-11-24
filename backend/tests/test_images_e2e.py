"""Image library end to end: /api/images/* through the real container (Civitai providers, model catalog, image
library service, favorites store) with the network answered by FakeHttp from the real trimmed Civitai fixtures.

FakeHttp matches scheme + host + path only, so the /images and /models handlers switch on the query string."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.services.model_providers.civitai import CIVITAI_API_URL
from app.settings import AppPaths
from support import FakeHttp, image_resource, load_fixture

MODELS_URL = f"{CIVITAI_API_URL}/models"
IMAGES_URL = f"{CIVITAI_API_URL}/images"
BY_HASH_URL = f"{CIVITAI_API_URL}/model-versions/by-hash"

DETAIL_VERSION_ID = "62833"  # search_loras.json: Detail Tweaker LoRA 58390, v1.0 (gallery: images_by_version.json)
OTHER_VERSION_ID = "135867"  # search_loras.json: the newest version of LoRA 122359 (its gallery is empty here)
VERSION_GALLERY_IDS = ["47793744", "22452542", "10993445"]  # images_by_version.json
DETAIL_IMAGE_ID = "10993445"  # images_by_version.json: comicmix checkpoint + add_detail (0.5) + backlight (-1)
ADD_DETAIL_AUTOV3 = "7c6bad76eb54"  # model_version.json (add_detail v1.0, version 62833)
ADD_DETAIL_SHA256 = "47aaaf0d2945ca937151d61304946dd229b3f072140b85484bc93e38f2a6e2f7"
CHILLOUT_AUTOV2 = "fc2511737a"  # model_version_checkpoint.json (ChilloutMix, version 11745)
KIM_AUTOV3 = "1921d0925550"  # unknown to the fixtures: 404


def serve_keyword_search(fake_http: FakeHttp) -> None:
    """Model search 'detail' -> search_loras.json (models 58390, 122359; its next cursor '2' -> search_empty.json);
    the first page of version 62833's gallery -> images_by_version.json, every other gallery page ->
    images_empty.json."""

    def models(request: httpx.Request) -> httpx.Response:
        page = "search_empty.json" if request.url.params.get("cursor") == "2" else "search_loras.json"
        return httpx.Response(200, json=load_fixture(f"civitai/{page}"))

    def images(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        first_detail_page = params.get("modelVersionId") == DETAIL_VERSION_ID and "cursor" not in params
        page = "images_by_version.json" if first_detail_page else "images_empty.json"
        return httpx.Response(200, json=load_fixture(f"civitai/{page}"))

    fake_http.add("GET", MODELS_URL, handler=models)
    fake_http.add("GET", IMAGES_URL, handler=images)


def test_a_keyword_search_pages_through_the_galleries_of_the_matching_models(
    client: TestClient, fake_http: FakeHttp
) -> None:
    serve_keyword_search(fake_http)

    first = client.get("/api/images/search", params={"query": "detail"})

    assert first.status_code == 200, first.text
    page = first.json()
    assert [image["id"] for image in page["items"]] == VERSION_GALLERY_IDS
    detail = page["items"][2]
    assert detail["page_url"] == f"https://civitai.com/images/{DETAIL_IMAGE_ID}"
    assert detail["architecture"] == "sd15"
    assert [(r["kind"], r["name"], r["weight"], r["hash"]) for r in detail["resources"]] == [
        ("checkpoint", "comicmixNSFWByMrMonster_v325", None, "f8cd338212"),
        ("lora", "add_detail", 0.5, ADD_DETAIL_AUTOV3),
        ("lora", "backlight_slider_v10", -1.0, "bce77b76fba3"),
    ]
    assert page["next_cursor"] is not None

    # The keyword went to the model catalog (LoRAs + checkpoints); each model's gallery was read through its newest
    # version (modelVersionId: fast on Civitai), without a period.
    (model_search,) = fake_http.requests_to(MODELS_URL)
    assert model_search.url.params["query"] == "detail"
    assert set(model_search.url.params.get_list("types")) >= {"LORA", "Checkpoint"}
    gallery_requests = fake_http.requests_to(IMAGES_URL)
    gallery_versions = {request.url.params["modelVersionId"] for request in gallery_requests}
    assert gallery_versions == {DETAIL_VERSION_ID, OTHER_VERSION_ID}
    for request in gallery_requests:
        assert "modelId" not in request.url.params
        assert "period" not in request.url.params
        assert request.url.params["withMeta"] == "true"
        assert request.url.params["nsfw"] == "Soft"
        assert "SD 1.5" in request.url.params.get_list("baseModels")  # usable_only (default)

    # The next page continues gallery 62833 (empty now), then the next model batch (none): the end.
    second = client.get("/api/images/search", params={"query": "detail", "cursor": page["next_cursor"]})

    assert second.status_code == 200, second.text
    assert second.json() == {"items": [], "next_cursor": None}
    continued = [request for request in fake_http.requests_to(IMAGES_URL) if "cursor" in request.url.params]
    assert [(request.url.params["modelVersionId"], request.url.params["cursor"]) for request in continued] == [
        (DETAIL_VERSION_ID, "feed:2315:10993445")
    ]


def test_the_feed_passes_the_period_and_wraps_the_civitai_cursor(client: TestClient, fake_http: FakeHttp) -> None:
    fake_http.add("GET", IMAGES_URL, json=load_fixture("civitai/images_feed.json"))

    first = client.get("/api/images/search", params={"period": "month", "sort": "newest"})

    assert first.status_code == 200, first.text
    assert len(first.json()["items"]) == 3
    request = fake_http.requests_to(IMAGES_URL)[0]
    assert (request.url.params["period"], request.url.params["sort"]) == ("Month", "Newest")
    assert "modelId" not in request.url.params

    second = client.get("/api/images/search", params={"period": "month", "cursor": first.json()["next_cursor"]})

    assert second.status_code == 200
    assert fake_http.requests_to(IMAGES_URL)[1].url.params["cursor"] == "feed:1535:149382895"


def test_an_invalid_cursor_is_rejected(client: TestClient) -> None:
    response = client.get("/api/images/search", params={"query": "detail", "cursor": "forged"})

    assert response.status_code == 422


def test_resources_resolve_by_short_civitai_hashes(client: TestClient, fake_http: FakeHttp) -> None:
    fake_http.add("GET", f"{BY_HASH_URL}/{ADD_DETAIL_AUTOV3}", json=load_fixture("civitai/model_version.json"))
    fake_http.add("GET", f"{BY_HASH_URL}/{CHILLOUT_AUTOV2}", json=load_fixture("civitai/model_version_checkpoint.json"))
    fake_http.add("GET", f"{BY_HASH_URL}/{KIM_AUTOV3}", status=404, json=load_fixture("civitai/error_not_found.json"))
    resources = [
        image_resource(kind="checkpoint", name="chilloutmix_NiPrunedFp32Fix", hash=CHILLOUT_AUTOV2).model_dump(),
        image_resource(name="kim_v_1", weight=0.6, hash=KIM_AUTOV3).model_dump(),
        image_resource(name="add_detail", weight=1.0, hash=ADD_DETAIL_AUTOV3).model_dump(),
        image_resource(name="add_detail", weight=0.5, hash=ADD_DETAIL_AUTOV3).model_dump(),
    ]

    response = client.post("/api/images/resolve", json={"provider": "civitai", "resources": resources})

    assert response.status_code == 200, response.text
    checkpoint, kim, detail, detail_again = response.json()
    assert (checkpoint["model"]["kind"], checkpoint["model"]["versions"][0]["id"]) == ("checkpoint", "11745")
    assert checkpoint["sha256"] == "fc2511737a54c5e80b89ab03e0ab4b98d051ab187f92860f3cd664dc9d08b271"
    assert kim["model"] is None
    assert kim["error"]
    assert (detail["model"]["id"], detail["model"]["versions"][0]["id"]) == ("58390", "62833")
    assert detail["sha256"] == ADD_DETAIL_SHA256
    assert detail["resource"]["weight"] == 1.0
    assert detail_again["model"] == detail["model"]
    # One lookup per distinct hash.
    assert len(fake_http.requests_to(f"{BY_HASH_URL}/{ADD_DETAIL_AUTOV3}")) == 1


def test_favorites_are_kept_by_the_backend(client: TestClient, fake_http: FakeHttp, app_paths: AppPaths) -> None:
    serve_keyword_search(fake_http)
    image = client.get("/api/images/search", params={"query": "detail"}).json()["items"][2]

    saved = client.put("/api/images/favorites", json=image)

    assert saved.status_code == 200, saved.text
    assert saved.json()["image"] == image
    assert [favorite["image"]["id"] for favorite in client.get("/api/images/favorites").json()] == [DETAIL_IMAGE_ID]
    stored = json.loads(Path(app_paths.image_favorites_file).read_text(encoding="utf-8"))
    assert stored["version"] == 1
    assert [item["image"]["id"] for item in stored["items"]] == [DETAIL_IMAGE_ID]

    assert client.delete(f"/api/images/favorites/civitai/{DETAIL_IMAGE_ID}").status_code == 200
    assert client.get("/api/images/favorites").json() == []
    assert client.delete(f"/api/images/favorites/civitai/{DETAIL_IMAGE_ID}").status_code == 404
