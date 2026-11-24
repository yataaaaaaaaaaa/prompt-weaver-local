"""Image library HTTP API (app/routers/images.py): /api/images/search, /resolve and /favorites.

The app's image library service is replaced by one over the stub providers (support.image_library_service:
real catalog, local files and favorites on the temp data dir) before the TestClient starts."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.image_library import NO_LOOKUP_ERROR
from app.services.model_providers import (
    ImageFeedRequest,
    ProviderAuthError,
    ProviderError,
    ProviderNotFoundError,
)
from app.settings import AppPaths
from support import (
    CHECKPOINT,
    CHECKPOINT_AUTOV2,
    PIXEL,
    PIXEL_AUTOV3,
    PIXEL_SHA256,
    STUB_PROVIDER_ID,
    USABLE_BASE_MODELS,
    CatalogStub,
    StubImageProvider,
    image_library_service,
    image_page,
    image_resource,
    models_page,
    remote_image,
)

SEARCH_URL = "/api/images/search"
RESOLVE_URL = "/api/images/resolve"
FAVORITES_URL = "/api/images/favorites"


@pytest.fixture()
def models() -> CatalogStub:
    return CatalogStub(PIXEL, CHECKPOINT, hashes={PIXEL_AUTOV3: "200", CHECKPOINT_AUTOV2: "400"})


@pytest.fixture()
def images() -> StubImageProvider:
    return StubImageProvider()


@pytest.fixture()
def client(app: FastAPI, app_paths: AppPaths, models: CatalogStub, images: StubImageProvider) -> Iterator[TestClient]:
    """The conftest client, with app.state.services.images over the stub providers."""
    app.state.services.images = image_library_service(app_paths, models, images)
    with TestClient(app) as test_client:
        yield test_client


def image_json(image_id: str, **fields: Any) -> dict[str, Any]:
    return remote_image(image_id, **fields).model_dump(mode="json")


def search(client: TestClient, **params: Any) -> Any:
    return client.get(SEARCH_URL, params={"provider": STUB_PROVIDER_ID, **params})


# ---------------------------------------------------------------------------
# GET /api/images/search
# ---------------------------------------------------------------------------


def test_search_pages_through_the_feed(client: TestClient, images: StubImageProvider) -> None:
    images.pages = {(None, None): image_page("1", "2", next_cursor="p2"), (None, "p2"): image_page("3")}

    first = search(client, sort="newest", period="month", limit=2)

    assert first.status_code == 200
    body = first.json()
    assert body["items"] == [image_json("1"), image_json("2")]
    assert isinstance(body["next_cursor"], str)
    assert images.requests == [
        ImageFeedRequest(
            sort="newest", nsfw=False, limit=2, period="month", model_id=None, base_models=USABLE_BASE_MODELS
        )
    ]

    last = search(client, sort="newest", period="month", limit=2, cursor=body["next_cursor"])

    assert last.status_code == 200
    assert last.json() == {"items": [image_json("3")], "next_cursor": None}
    assert images.requests[1].cursor == "p2"


def test_search_by_keyword(client: TestClient, models: CatalogStub, images: StubImageProvider) -> None:
    models.search_pages = {None: models_page("1", "2")}
    images.pages = {("1", None): image_page("a1", "a2"), ("2", None): image_page("b1")}

    response = search(client, query="castle", nsfw="true", usable_only="false", limit=4)

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["items"]] == ["a1", "b1", "a2"]
    assert response.json()["next_cursor"] is None
    (model_query,) = models.queries
    assert (model_query.query, model_query.nsfw, model_query.base_models) == ("castle", True, [])
    assert {(request.model_id, request.limit, request.period, request.nsfw) for request in images.requests} == {
        ("1", 2, None, True),
        ("2", 2, None, True),
    }


@pytest.mark.parametrize("params", [{"cursor": "not a cursor"}, {"query": "castle", "cursor": "e30"}])
def test_search_rejects_an_invalid_cursor(
    client: TestClient, images: StubImageProvider, params: dict[str, str]
) -> None:
    response = search(client, **params)

    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid image search cursor: use the next_cursor of the previous page."}
    assert images.requests == []


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 101}, {"sort": "random"}, {"period": "decade"}])
def test_search_rejects_invalid_parameters(
    client: TestClient, images: StubImageProvider, params: dict[str, Any]
) -> None:
    assert search(client, **params).status_code == 422
    assert images.requests == []


def test_search_with_an_unknown_provider(client: TestClient) -> None:
    response = client.get(SEARCH_URL, params={"provider": "nope"})

    assert response.status_code == 404
    assert response.json() == {"detail": "Unknown image provider 'nope'."}


@pytest.mark.parametrize(
    ("query", "error", "status"),
    [
        ("", ProviderNotFoundError("Feed not found."), 404),
        ("", ProviderAuthError("Stub requires an API token."), 403),
        ("castle", ProviderAuthError("Stub requires an API token."), 403),
        ("", ProviderError("Stub answered HTTP 500."), 502),
        ("castle", ProviderError("Stub answered HTTP 500."), 502),
    ],
)
def test_search_maps_provider_errors(
    client: TestClient, models: CatalogStub, images: StubImageProvider, error: Exception, status: int, query: str
) -> None:
    models.search_pages = {None: models_page("1")}
    images.error = error

    response = search(client, query=query)

    assert response.status_code == status
    assert response.json() == {"detail": str(error)}


def test_a_keyword_search_skips_galleries_that_are_gone(
    client: TestClient, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {None: models_page("1")}
    images.error = ProviderNotFoundError("Stub has no image gallery for model 1.")

    response = search(client, query="castle")

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}


# ---------------------------------------------------------------------------
# POST /api/images/resolve
# ---------------------------------------------------------------------------


def test_resolve_answers_one_entry_per_resource_in_order(client: TestClient, models: CatalogStub) -> None:
    resources = [
        image_resource(name="pixel", hash=PIXEL_AUTOV3, weight=0.6),
        image_resource(name="mystery"),
        image_resource(name="chill", version_id="400", kind="checkpoint"),
        image_resource(name="gone", version_id="999"),
    ]

    response = client.post(
        RESOLVE_URL,
        json={"provider": STUB_PROVIDER_ID, "resources": [item.model_dump(mode="json") for item in resources]},
    )

    assert response.status_code == 200
    body = response.json()
    assert [item["resource"] for item in body] == [item.model_dump(mode="json") for item in resources]
    assert [item["model"]["id"] if item["model"] else None for item in body] == ["100", None, "300", None]
    assert body[0]["model"] == PIXEL.model_dump(mode="json")
    assert body[0]["sha256"] == PIXEL_SHA256
    assert [item["error"] for item in body] == [None, NO_LOOKUP_ERROR, None, "Unknown version 999."]


def test_resolve_with_an_unknown_provider(client: TestClient) -> None:
    response = client.post(RESOLVE_URL, json={"provider": "nope", "resources": []})

    assert response.status_code == 404
    assert response.json() == {"detail": "Unknown model provider 'nope'."}


def test_resolve_rejects_an_invalid_body(client: TestClient) -> None:
    response = client.post(RESOLVE_URL, json={"provider": STUB_PROVIDER_ID, "resources": [{"kind": "vae"}]})

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# /api/images/favorites
# ---------------------------------------------------------------------------


def test_favorites_round_trip(client: TestClient, app_paths: AppPaths) -> None:
    assert client.get(FAVORITES_URL).json() == []

    saved = client.put(FAVORITES_URL, json=image_json("1"))
    assert saved.status_code == 200
    assert saved.json()["image"] == image_json("1")
    assert isinstance(saved.json()["saved_at"], str)

    client.put(FAVORITES_URL, json=image_json("2"))
    client.put(FAVORITES_URL, json=image_json("1", prompt="refreshed"))

    listed = client.get(FAVORITES_URL)
    assert listed.status_code == 200
    assert [item["image"]["id"] for item in listed.json()] == ["1", "2"]
    assert listed.json()[0]["image"] == image_json("1", prompt="refreshed")
    assert app_paths.image_favorites_file.is_file()

    removed = client.delete(f"{FAVORITES_URL}/{STUB_PROVIDER_ID}/1")
    assert removed.status_code == 200
    assert removed.json() == {"ok": True}
    assert [item["image"]["id"] for item in client.get(FAVORITES_URL).json()] == ["2"]


def test_removing_an_unknown_favorite(client: TestClient) -> None:
    response = client.delete(f"{FAVORITES_URL}/{STUB_PROVIDER_ID}/1")

    assert response.status_code == 404
    assert response.json() == {"detail": f"No favorite image '1' from '{STUB_PROVIDER_ID}'."}


def test_saving_an_invalid_image_is_rejected(client: TestClient) -> None:
    response = client.put(FAVORITES_URL, json={"provider": STUB_PROVIDER_ID, "id": "1"})

    assert response.status_code == 422
    assert client.get(FAVORITES_URL).json() == []
