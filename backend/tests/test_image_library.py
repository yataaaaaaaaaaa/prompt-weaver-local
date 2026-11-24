"""Image library service (app/services/image_library.py): feed and keyword search with the opaque cursor, and the
resolution of an image's resources.

The providers are test doubles (support.CatalogStub over StubProvider, support.StubImageProvider); the catalog is
the real ModelCatalogService with the real LocalModelFiles on the temp model folders (support.image_library_service)."""

from __future__ import annotations

import base64
import json
import threading
from typing import Any

import pytest

from app.schemas import (
    ImageResource,
    ImageSearchPage,
    ImageSearchQuery,
    ModelSearchQuery,
    RemoteModel,
    ResolvedImageResource,
    ResolveImageResourcesRequest,
)
from app.services.image_library import (
    MODEL_FANOUT,
    NO_LOOKUP_ERROR,
    ImageLibraryService,
    InvalidImageCursor,
)
from app.services.model_providers import (
    ImageFeedRequest,
    ProviderAuthError,
    ProviderError,
    ProviderNotFoundError,
    UnknownProviderError,
)
from app.settings import AppPaths
from support import (
    CHECKPOINT,
    CHECKPOINT_AUTOV2,
    MODEL_CONTENT,
    NO_HASH,
    PICKLE_ONLY,
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
    put_file,
    sha256_of,
)



def image_query(**fields: Any) -> ImageSearchQuery:
    return ImageSearchQuery(provider=STUB_PROVIDER_ID, **fields)


def ids(page: ImageSearchPage) -> list[str]:
    return [image.id for image in page.items]


def raw_cursor(payload: Any) -> str:
    """A cursor in the service's encoding (base64url JSON), for forged-cursor tests."""
    return base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()


@pytest.fixture()
def models() -> CatalogStub:
    return CatalogStub(
        PIXEL,
        CHECKPOINT,
        NO_HASH,
        PICKLE_ONLY,
        hashes={PIXEL_AUTOV3: "200", PIXEL_SHA256: "200", CHECKPOINT_AUTOV2: "400"},
    )


@pytest.fixture()
def images() -> StubImageProvider:
    return StubImageProvider()


@pytest.fixture()
def service(app_paths: AppPaths, models: CatalogStub, images: StubImageProvider) -> ImageLibraryService:
    return image_library_service(app_paths, models, images)


# ---------------------------------------------------------------------------
# Feed (empty keyword)
# ---------------------------------------------------------------------------


def test_feed_pages_through_the_provider_feed_with_an_opaque_cursor(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    images.pages = {(None, None): image_page("1", "2", next_cursor="p2"), (None, "p2"): image_page("3")}
    query = image_query(sort="newest", period="month", limit=2)

    first = service.search(query)

    assert ids(first) == ["1", "2"]
    assert first.next_cursor is not None and first.next_cursor != "p2"
    assert images.requests == [
        ImageFeedRequest(
            sort="newest", nsfw=False, limit=2, period="month", model_id=None, base_models=USABLE_BASE_MODELS
        )
    ]

    last = service.search(query.model_copy(update={"cursor": first.next_cursor}))

    assert ids(last) == ["3"]
    assert last.next_cursor is None
    assert images.requests[1].cursor == "p2"
    assert models.queries == []  # the feed needs no model search


def test_a_blank_keyword_is_the_feed(service: ImageLibraryService, images: StubImageProvider) -> None:
    images.pages = {(None, None): image_page("1")}

    page = service.search(image_query(query="   "))

    assert ids(page) == ["1"]
    assert page.next_cursor is None
    assert images.requests[0].model_id is None


@pytest.mark.parametrize(
    ("nsfw", "usable_only", "base_models"), [(False, True, USABLE_BASE_MODELS), (True, False, ())]
)
def test_feed_passes_nsfw_and_the_usable_base_models(
    service: ImageLibraryService,
    images: StubImageProvider,
    nsfw: bool,
    usable_only: bool,
    base_models: tuple[str, ...],
) -> None:
    service.search(image_query(nsfw=nsfw, usable_only=usable_only))

    (request,) = images.requests
    assert request.nsfw is nsfw
    assert request.base_models == base_models


def test_feed_provider_errors_propagate(service: ImageLibraryService, images: StubImageProvider) -> None:
    images.error = ProviderAuthError("Stub requires an API token.")
    with pytest.raises(ProviderAuthError):
        service.search(image_query())


def test_an_unknown_provider_is_rejected(service: ImageLibraryService) -> None:
    with pytest.raises(UnknownProviderError):
        service.search(ImageSearchQuery(provider="nope"))
    with pytest.raises(UnknownProviderError):
        service.search(ImageSearchQuery(provider="nope", query="castle"))


# ---------------------------------------------------------------------------
# Keyword search (model search -> galleries)
# ---------------------------------------------------------------------------


def test_keyword_search_looks_up_matching_loras_and_checkpoints(
    service: ImageLibraryService, models: CatalogStub
) -> None:
    service.search(image_query(query="  add detail ", nsfw=True))

    assert models.queries == [
        ModelSearchQuery(
            provider=STUB_PROVIDER_ID,
            query="add detail",
            kinds=["lora", "checkpoint"],
            base_models=list(USABLE_BASE_MODELS),
            sort="most_downloaded",
            nsfw=True,
            limit=MODEL_FANOUT,
            cursor=None,
        )
    ]


def test_keyword_search_asks_every_gallery_for_its_share_without_period(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {None: models_page("1", "2", "3")}

    service.search(image_query(query="castle", sort="most_collected", period="day", limit=10, usable_only=False))

    assert sorted(images.requests, key=lambda request: request.model_id or "") == [
        ImageFeedRequest(
            sort="most_collected",
            nsfw=False,
            limit=4,
            period=None,
            model_id=model_id,
            model_version_id=f"{model_id}0",  # the models' newest version (support.models_page)
            cursor=None,
        )
        for model_id in ("1", "2", "3")
    ]
    assert models.queries[0].base_models == []


def test_keyword_search_interleaves_galleries_round_robin_without_duplicates(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {None: models_page("1", "2", "3")}
    images.pages = {
        ("1", None): image_page("a1", "shared", "a3"),
        ("2", None): image_page("b1", "b2"),
        ("3", None): image_page("shared", "c2"),
    }

    page = service.search(image_query(query="castle", limit=9))

    assert ids(page) == ["a1", "b1", "shared", "b2", "c2", "a3"]
    assert page.next_cursor is None  # every gallery answered its last page and no model is left


def test_keyword_search_drops_exhausted_galleries_and_resumes_the_others(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {None: models_page("1", "2", "3")}
    images.pages = {
        ("1", None): image_page("a1", next_cursor="a-2"),
        ("2", None): image_page("b1"),
        ("3", None): image_page("c1", next_cursor="c-2"),
        ("1", "a-2"): image_page("a2"),
        ("3", "c-2"): image_page("c2", next_cursor="c-3"),
    }
    query = image_query(query="castle", limit=10)

    first = service.search(query)
    assert ids(first) == ["a1", "b1", "c1"]
    assert first.next_cursor is not None

    images.requests.clear()
    second = service.search(query.model_copy(update={"cursor": first.next_cursor}))

    assert ids(second) == ["a2", "c2"]
    assert sorted((request.model_id, request.cursor, request.limit) for request in images.requests) == [
        ("1", "a-2", 5),
        ("3", "c-2", 5),
    ]
    assert len(models.queries) == 1  # the batch is not exhausted yet: no new model search

    images.requests.clear()
    third = service.search(query.model_copy(update={"cursor": second.next_cursor}))

    assert [(request.model_id, request.cursor, request.limit) for request in images.requests] == [("3", "c-3", 10)]
    assert ids(third) == []  # no canned page: the gallery's empty last page
    assert third.next_cursor is None


def test_keyword_search_continues_with_the_next_batch_of_models(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {None: models_page("1", "2", next_cursor="m2"), "m2": models_page("3")}
    images.pages = {("1", None): image_page("a1"), ("2", None): image_page("b1"), ("3", None): image_page("c1")}
    query = image_query(query="castle")

    first = service.search(query)
    assert ids(first) == ["a1", "b1"]
    assert first.next_cursor is not None  # the model search has more

    second = service.search(query.model_copy(update={"cursor": first.next_cursor}))

    assert ids(second) == ["c1"]
    assert second.next_cursor is None
    assert [query.cursor for query in models.queries] == [None, "m2"]
    assert [request.model_id for request in images.requests[2:]] == ["3"]


def test_a_batch_without_images_moves_on_to_the_next_batch_in_the_same_request(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {None: models_page("1", next_cursor="m2"), "m2": models_page("2")}
    images.pages = {("2", None): image_page("b1")}  # model 1 has no images

    page = service.search(image_query(query="castle"))

    assert ids(page) == ["b1"]
    assert page.next_cursor is None
    assert [request.model_id for request in images.requests] == ["1", "2"]


def test_one_request_reads_at_most_two_batches_of_models(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {
        None: models_page("1", next_cursor="m2"),
        "m2": models_page("2", next_cursor="m3"),
        "m3": models_page("3"),
    }
    images.pages = {("3", None): image_page("c1")}
    query = image_query(query="castle")

    first = service.search(query)

    assert ids(first) == []
    assert first.next_cursor is not None  # more models: the client keeps paging
    assert [query.cursor for query in models.queries] == [None, "m2"]

    second = service.search(query.model_copy(update={"cursor": first.next_cursor}))

    assert ids(second) == ["c1"]
    assert second.next_cursor is None
    assert [query.cursor for query in models.queries] == [None, "m2", "m3"]


def test_a_gallery_page_filtered_empty_is_retried_within_the_request(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {None: models_page("1")}
    images.pages = {("1", None): image_page(next_cursor="a-2"), ("1", "a-2"): image_page("a2")}

    page = service.search(image_query(query="castle"))

    assert ids(page) == ["a2"]
    assert [request.cursor for request in images.requests] == [None, "a-2"]


def test_a_keyword_without_models_answers_an_empty_last_page(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    page = service.search(image_query(query="nothing matches"))

    assert page == ImageSearchPage(items=[], next_cursor=None)
    assert len(models.queries) == 1
    assert images.requests == []


def test_keyword_search_passes_nsfw_and_base_models_to_the_galleries(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_pages = {None: models_page("1")}

    service.search(image_query(query="castle", nsfw=True, usable_only=True))
    service.search(image_query(query="castle", nsfw=False, usable_only=False))

    assert [(request.nsfw, request.base_models) for request in images.requests] == [
        (True, USABLE_BASE_MODELS),
        (False, ()),
    ]
    assert [(query.nsfw, query.base_models) for query in models.queries] == [
        (True, list(USABLE_BASE_MODELS)),
        (False, []),
    ]


def test_keyword_galleries_are_fetched_concurrently(
    app_paths: AppPaths, models: CatalogStub
) -> None:
    class BarrierImageProvider(StubImageProvider):
        """Every gallery request waits until all of them run at once (fails when they run one by one)."""

        barrier = threading.Barrier(3, timeout=5)

        def search_images(self, request: ImageFeedRequest) -> ImageSearchPage:
            self.barrier.wait()
            return super().search_images(request)

    images = BarrierImageProvider({("1", None): image_page("a1"), ("2", None): image_page("b1")})
    models.search_pages = {None: models_page("1", "2", "3")}

    page = image_library_service(app_paths, models, images).search(image_query(query="castle"))

    assert ids(page) == ["a1", "b1"]


def test_keyword_provider_errors_propagate(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    models.search_error = ProviderError("Stub answered HTTP 500.")
    with pytest.raises(ProviderError):
        service.search(image_query(query="castle"))

    models.search_error = None
    models.search_pages = {None: models_page("1", "2")}
    images.error = ProviderAuthError("Stub requires an API token.")
    with pytest.raises(ProviderAuthError):
        service.search(image_query(query="castle"))


def test_a_gallery_the_provider_no_longer_knows_is_exhausted(
    app_paths: AppPaths, models: CatalogStub
) -> None:
    class GoneGallery(StubImageProvider):
        """Model 2 was removed since the model search: its gallery answers 404."""

        def search_images(self, request: ImageFeedRequest) -> ImageSearchPage:
            if request.model_id == "2":
                super().search_images(request)  # recorded
                raise ProviderNotFoundError("Stub has no image gallery for model 2.")
            return super().search_images(request)

    images = GoneGallery({("1", None): image_page("a1", next_cursor="a-2"), ("1", "a-2"): image_page("a2")})
    models.search_pages = {None: models_page("1", "2")}
    service = image_library_service(app_paths, models, images)
    query = image_query(query="castle", limit=10)

    first = service.search(query)
    assert ids(first) == ["a1"]
    images.requests.clear()
    second = service.search(query.model_copy(update={"cursor": first.next_cursor}))

    assert [request.model_id for request in images.requests] == ["1"]  # gallery 2 is not asked again
    assert ids(second) == ["a2"]
    assert second.next_cursor is None


# ---------------------------------------------------------------------------
# Cursors
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "cursor",
    [
        "",
        "not a cursor!",
        "é",
        raw_cursor([1, 2]),
        raw_cursor({"v": 2, "mode": "feed", "cursor": "p2"}),
        raw_cursor({"v": 1, "mode": "other", "cursor": "p2"}),
        raw_cursor({"v": 1, "mode": "feed"}),
        raw_cursor({"v": 1, "mode": "feed", "cursor": "p2", "extra": True}),
        raw_cursor({"v": 1, "mode": "keyword", "galleries": [{"cursor": "x"}]}),
    ],
)
def test_undecodable_cursors_are_rejected(
    service: ImageLibraryService, images: StubImageProvider, cursor: str
) -> None:
    with pytest.raises(InvalidImageCursor):
        service.search(image_query(cursor=cursor))
    with pytest.raises(InvalidImageCursor):
        service.search(image_query(query="castle", cursor=cursor))
    assert images.requests == []


def test_a_cursor_only_continues_the_kind_of_search_it_comes_from(
    service: ImageLibraryService, models: CatalogStub, images: StubImageProvider
) -> None:
    images.pages = {(None, None): image_page("1", next_cursor="p2"), ("1", None): image_page("a1", next_cursor="a-2")}
    models.search_pages = {None: models_page("1")}
    feed_cursor = service.search(image_query()).next_cursor
    keyword_cursor = service.search(image_query(query="castle")).next_cursor
    assert feed_cursor is not None and keyword_cursor is not None
    images.requests.clear()

    with pytest.raises(InvalidImageCursor):
        service.search(image_query(query="castle", cursor=feed_cursor))
    with pytest.raises(InvalidImageCursor):
        service.search(image_query(cursor=keyword_cursor))
    assert images.requests == []


def test_cursors_are_url_safe(service: ImageLibraryService, images: StubImageProvider) -> None:
    images.pages = {(None, None): image_page("1", next_cursor="12345|6789?&=/+ é")}

    cursor = service.search(image_query()).next_cursor

    assert cursor is not None
    assert set(cursor) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    service.search(image_query(cursor=cursor))
    assert images.requests[-1].cursor == "12345|6789?&=/+ é"


# ---------------------------------------------------------------------------
# Resource resolution
# ---------------------------------------------------------------------------


def resolve(
    service: ImageLibraryService, *resources: ImageResource, provider: str = STUB_PROVIDER_ID
) -> list[ResolvedImageResource]:
    return service.resolve_resources(ResolveImageResourcesRequest(provider=provider, resources=list(resources)))


def test_resources_resolve_by_version_id_then_by_hash_in_order(
    service: ImageLibraryService, models: CatalogStub
) -> None:
    by_version = image_resource(name="pixel", version_id="200", weight=0.6)
    by_hash = image_resource(name="chill", hash=CHECKPOINT_AUTOV2, kind="checkpoint")
    name_only = image_resource(name="mystery")

    resolved = resolve(service, by_version, by_hash, name_only)

    assert [item.resource for item in resolved] == [by_version, by_hash, name_only]
    assert resolved[0].model == PIXEL
    assert resolved[0].error is None
    assert resolved[1].model == CHECKPOINT
    assert resolved[1].error is None
    assert resolved[2].model is None
    assert resolved[2].sha256 is None
    assert resolved[2].error == NO_LOOKUP_ERROR
    assert models.calls == [("get_version", "200"), ("find_by_hash", CHECKPOINT_AUTOV2)]


def test_a_version_id_wins_over_a_hash(service: ImageLibraryService, models: CatalogStub) -> None:
    (resolved,) = resolve(service, image_resource(version_id="200", hash=CHECKPOINT_AUTOV2))

    assert resolved.model == PIXEL
    assert models.calls == [("get_version", "200")]


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (ProviderNotFoundError("Unknown version 999."), "Unknown version 999."),
        (ProviderAuthError("Stub requires an API token."), "Stub requires an API token."),
        (ProviderError("Stub answered HTTP 500."), "Stub answered HTTP 500."),
    ],
)
def test_a_provider_failure_only_marks_its_resource_unresolved(
    service: ImageLibraryService, models: CatalogStub, error: Exception, message: str
) -> None:
    models.lookup_errors["999"] = error

    failed, resolved = resolve(service, image_resource(version_id="999"), image_resource(hash=PIXEL_AUTOV3))

    assert failed.model is None
    assert failed.sha256 is None
    assert failed.error == message
    assert resolved.model == PIXEL
    assert resolved.error is None


def test_an_unknown_hash_is_unresolved(service: ImageLibraryService) -> None:
    (resolved,) = resolve(service, image_resource(hash="0123456789"))

    assert resolved.model is None
    assert resolved.error == "No version with hash 0123456789."


def test_resolving_with_an_unknown_provider_fails(service: ImageLibraryService, models: CatalogStub) -> None:
    with pytest.raises(UnknownProviderError):
        resolve(service, image_resource(version_id="200"), provider="nope")
    with pytest.raises(UnknownProviderError):
        resolve(service, provider="nope")
    assert models.calls == []


def test_identical_lookups_are_made_once_per_call(service: ImageLibraryService, models: CatalogStub) -> None:
    resolved = resolve(
        service,
        image_resource(name="a", version_id="200", weight=0.5),
        image_resource(name="b", hash=CHECKPOINT_AUTOV2),
        image_resource(name="c", version_id="200", weight=1.0),
        image_resource(name="d", hash=CHECKPOINT_AUTOV2),
        image_resource(name="e", version_id="999"),
        image_resource(name="f", version_id="999"),
    )

    assert [item.resource.name for item in resolved] == ["a", "b", "c", "d", "e", "f"]
    assert [item.model.id if item.model else None for item in resolved] == ["100", "300", "100", "300", None, None]
    assert sorted(models.calls) == [
        ("find_by_hash", CHECKPOINT_AUTOV2),
        ("get_version", "200"),
        ("get_version", "999"),
    ]

    resolve(service, image_resource(version_id="200"))
    assert models.calls.count(("get_version", "200")) == 2  # deduplicated within one call only


def test_lookups_run_concurrently(app_paths: AppPaths, images: StubImageProvider) -> None:
    class BarrierProvider(CatalogStub):
        """Every lookup waits until both run at once (fails when they run one by one)."""

        barrier = threading.Barrier(2, timeout=5)

        def get_version(self, version_id: str) -> RemoteModel:
            self.barrier.wait()
            return super().get_version(version_id)

    service = image_library_service(app_paths, BarrierProvider(PIXEL, CHECKPOINT), images)

    resolved = resolve(service, image_resource(version_id="200"), image_resource(version_id="400"))

    assert [item.model for item in resolved] == [PIXEL, CHECKPOINT]


def test_sha256_is_the_published_sha256_else_the_default_file_hash(service: ImageLibraryService) -> None:
    published = sha256_of(b"the file the image was made with")
    resolved = resolve(
        service,
        image_resource(hash=PIXEL_SHA256.upper()),  # a full SHA-256 that also resolves (any case)
        image_resource(version_id="400", hash=published),  # the published SHA-256 wins over the version's default file
        image_resource(hash=published),  # unknown at the provider: still the published SHA-256
        image_resource(hash=PIXEL_AUTOV3),  # short hash: the resolved version's default (primary) file
        image_resource(version_id="600"),  # the provider publishes no hash for the file
        image_resource(version_id="800"),  # no downloadable (default) file
        image_resource(version_id="999"),  # unresolved, nothing published
    )

    assert [item.sha256 for item in resolved] == [
        PIXEL_SHA256,
        published,
        published,
        PIXEL_SHA256,
        None,
        None,
        None,
    ]
    assert resolved[2].model is None
    assert resolved[2].error is not None


def test_resolved_files_carry_their_local_path(service: ImageLibraryService, app_paths: AppPaths) -> None:
    local = put_file(app_paths.model_dir("lora") / "pixel_style.safetensors", MODEL_CONTENT)

    (resolved,) = resolve(service, image_resource(version_id="200"))

    assert resolved.model is not None
    paths = {file.id: file.local_path for file in resolved.model.versions[0].files}
    assert paths == {"12": None, "11": str(local)}
