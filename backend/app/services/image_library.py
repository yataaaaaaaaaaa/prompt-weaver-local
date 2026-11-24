"""Image library: online image search, resolution of an image's models, favorites.

search(query) (ImageSearchQuery -> ImageSearchPage):
- the image provider is image_providers.get(query.provider), the model provider model_providers.get(query.provider);
- base models: when query.usable_only, the ids of model_provider.info().base_models whose architecture is not
  None (single owner of that rule: the provider info, i.e. civitai.CIVITAI_BASE_MODELS); else none (= any);
- empty query.query: the provider feed (ImageFeedRequest(model_id=None, period=query.period, ...)), the provider's
  cursor wrapped in our opaque cursor;
- non-empty query.query (Civitai has no free-text image filter): keyword -> model search through the existing
  ModelProvider.search (ModelSearchQuery(query=keyword, kinds=["lora", "checkpoint"], base_models=<above>,
  sort="most_downloaded", nsfw=query.nsfw, limit=MODEL_FANOUT)) -> the galleries of those models, each read
  through its newest version made for an allowed base model (ImageFeedRequest(model_id=..., model_version_id=...,
  period=None): Civitai answers version galleries in well under a second, model galleries in up to ~20 s),
  interleaved round robin, deduplicated by image id; each page asks
  every model that still has images for ceil(limit / active models) images (concurrently); when every model of
  the batch is exhausted, the next batch of models (model search cursor) is used. The opaque next_cursor encodes
  the per-model cursors + the model search cursor; it is None when nothing is left;
- a gallery the provider no longer knows (ProviderNotFoundError) counts as exhausted; other provider errors
  propagate (the router maps them);
- a cursor that cannot be decoded -> InvalidImageCursor (HTTP 422).

Keyword paging details: one request runs at most MAX_ROUNDS_PER_PAGE rounds; a round takes the next batch of
models when every model of the current one is exhausted, then asks the galleries of the active models. The
request stops after the first round that produced images, so a page may hold fewer than `limit` images (or up
to limit + active models - 1, from the ceil split) and may even be empty while next_cursor is set (galleries
whose pages were all filtered out): the client keeps paging while next_cursor is not None. Images are only
deduplicated within a page.

Cursor format (opaque to clients, versioned): base64url (unpadded) of the JSON of _FeedCursor or _KeywordCursor
below. A cursor of the other mode than the query's (feed cursor with a keyword, or the reverse) is invalid too.

resolve_resources(request) -> list[ResolvedImageResource], one per request.resources entry, in order:
- version_id -> catalog.get_version(provider, version_id); else hash -> catalog.find_by_hash(provider, hash)
  (short provider hashes accepted); else unresolved ("no version id or hash published");
- a provider failure for one resource (ProviderNotFoundError, ProviderAuthError, ProviderError) only marks that
  resource unresolved (error = the message); an unknown provider raises UnknownProviderError (HTTP 404);
- sha256: the resource hash when it is a full SHA-256, else the resolved version's default file sha256;
- lookups of the same version id / hash within one call are made once; independent lookups may run concurrently.

favorites(), add_favorite(image), remove_favorite(provider, image_id): delegate to ImageFavoritesStore;
remove_favorite raises FavoriteNotFound (HTTP 404) when absent.
"""

from __future__ import annotations

import base64
import math
from collections.abc import Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Annotated, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from ..schemas import (
    FavoriteImage,
    ImageResource,
    ImageSearchPage,
    ImageSearchQuery,
    ModelKind,
    ModelSearchQuery,
    RemoteImage,
    RemoteModel,
    ResolvedImageResource,
    ResolveImageResourcesRequest,
)
from .file_hashes import normalize_sha256
from .image_favorites import ImageFavoritesStore
from .model_catalog import ModelCatalogService
from .model_providers import (
    ImageFeedRequest,
    ImageProvider,
    ImageProviderRegistry,
    ModelProvider,
    ModelProviderRegistry,
    ProviderError,
    ProviderNotFoundError,
)
from .model_providers.base import version_file

# Models whose galleries one keyword search page interleaves.
MODEL_FANOUT = 4
# Gallery rounds (each may first take the next batch of models) of one keyword search request.
MAX_ROUNDS_PER_PAGE = 2
# Provider lookups resolve_resources runs at once.
MAX_CONCURRENT_LOOKUPS = 4
# The model kinds whose galleries a keyword search pages through.
KEYWORD_MODEL_KINDS: tuple[ModelKind, ...] = ("lora", "checkpoint")

NO_LOOKUP_ERROR = "No version id or hash published."
CURSOR_VERSION = 1


class InvalidImageCursor(ValueError):
    """ImageSearchQuery.cursor is not a cursor this service produced (HTTP 422)."""


class FavoriteNotFound(LookupError):
    """No favorite with this provider + image id (HTTP 404)."""


# ---------------------------------------------------------------------------
# Opaque search cursor
# ---------------------------------------------------------------------------


class _CursorModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class _GalleryCursor(_CursorModel):
    """Paging state of one model's gallery: `cursor` None + not done = its first page is still to fetch."""

    model: str  # provider model id
    version: str | None = None  # the model version whose gallery is read (None: the whole model's gallery)
    cursor: str | None = None
    done: bool = False


class _FeedCursor(_CursorModel):
    v: Literal[1] = CURSOR_VERSION
    mode: Literal["feed"] = "feed"
    cursor: str  # the image provider's cursor


class _KeywordCursor(_CursorModel):
    v: Literal[1] = CURSOR_VERSION
    mode: Literal["keyword"] = "keyword"
    galleries: list[_GalleryCursor]  # the current batch of models, in model search order
    search_cursor: str | None = None  # model search cursor of the next batch (None: no more models)


_SearchCursor = _FeedCursor | _KeywordCursor
_CURSOR_ADAPTER: TypeAdapter[_SearchCursor] = TypeAdapter(
    Annotated[_FeedCursor | _KeywordCursor, Field(discriminator="mode")]
)


def _encode_cursor(cursor: _SearchCursor) -> str:
    return base64.urlsafe_b64encode(cursor.model_dump_json().encode("utf-8")).rstrip(b"=").decode("ascii")


def _decode_cursor(raw: str) -> _SearchCursor:
    """The cursor encoded by _encode_cursor; InvalidImageCursor for anything else."""
    try:
        payload = base64.urlsafe_b64decode(raw.encode("ascii") + b"=" * (-len(raw) % 4))
        return _CURSOR_ADAPTER.validate_json(payload)
    except ValueError as exc:  # binascii.Error, UnicodeError and pydantic.ValidationError are ValueErrors
        raise InvalidImageCursor("Invalid image search cursor: use the next_cursor of the previous page.") from exc


_ModeCursor = TypeVar("_ModeCursor", _FeedCursor, _KeywordCursor)


def _cursor_of_mode(cursor: _SearchCursor | None, mode: type[_ModeCursor]) -> _ModeCursor | None:
    """`cursor` when it belongs to a search of this mode (feed / keyword); InvalidImageCursor otherwise."""
    if cursor is None or isinstance(cursor, mode):
        return cursor
    raise InvalidImageCursor("This cursor belongs to another search (image feed vs keyword search).")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_T = TypeVar("_T")
_R = TypeVar("_R")


def _map_concurrently(function: Callable[[_T], _R], values: Sequence[_T], max_workers: int) -> list[_R]:
    """[function(value) for value in values] on worker threads (in order); the first exception propagates."""
    if len(values) <= 1:
        return [function(value) for value in values]
    with ThreadPoolExecutor(max_workers=min(max_workers, len(values)), thread_name_prefix="image-library") as pool:
        return list(pool.map(function, values))


def _interleave(pages: Iterable[list[RemoteImage]]) -> list[RemoteImage]:
    """Round robin over `pages` (first image of each, then the second, ...), each image id once."""
    queues = [list(page) for page in pages]
    items: list[RemoteImage] = []
    seen: set[str] = set()
    for index in range(max((len(queue) for queue in queues), default=0)):
        for queue in queues:
            if index < len(queue) and queue[index].id not in seen:
                seen.add(queue[index].id)
                items.append(queue[index])
    return items


@dataclass(frozen=True)
class _Lookup:
    """One provider lookup of resolve_resources (identical lookups are made once per call)."""

    by: Literal["version", "hash"]
    value: str


def _lookup_of(resource: ImageResource) -> _Lookup | None:
    if resource.version_id:
        return _Lookup("version", resource.version_id)
    if resource.hash:
        return _Lookup("hash", resource.hash)
    return None


def _gallery_version(model: RemoteModel, base_models: tuple[str, ...]) -> str | None:
    """The version whose gallery a keyword search reads for `model`: its first (newest) version made for one of
    `base_models` (any base model when empty); None (the whole model's gallery) when it lists no such version."""
    version = next((v for v in model.versions if not base_models or v.base_model in base_models), None)
    return version.id if version is not None else None


def _resolved_sha256(resource: ImageResource, model: RemoteModel | None) -> str | None:
    """The published hash when it is a full SHA-256, else the sha256 of the resolved version's default file."""
    published = normalize_sha256(resource.hash)
    if published is not None or model is None or not model.versions:
        return published
    version = model.versions[0]
    default = version_file(version, version.default_file_id)
    return default.sha256 if default is not None else None


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ImageLibraryService:
    def __init__(
        self,
        *,
        model_providers: ModelProviderRegistry,
        image_providers: ImageProviderRegistry,
        catalog: ModelCatalogService,
        favorites: ImageFavoritesStore,
    ) -> None:
        self._model_providers = model_providers
        self._image_providers = image_providers
        self._catalog = catalog
        self._favorites = favorites

    # -- search -------------------------------------------------------------

    def search(self, query: ImageSearchQuery) -> ImageSearchPage:
        keyword = query.query.strip()
        cursor = _decode_cursor(query.cursor) if query.cursor is not None else None
        image_provider = self._image_providers.get(query.provider)
        model_provider = self._model_providers.get(query.provider)
        base_models = self._base_models(model_provider, query)
        if not keyword:
            return self._feed_page(image_provider, query, base_models, _cursor_of_mode(cursor, _FeedCursor))
        return self._keyword_page(
            image_provider, model_provider, query, keyword, base_models, _cursor_of_mode(cursor, _KeywordCursor)
        )

    @staticmethod
    def _base_models(model_provider: ModelProvider, query: ImageSearchQuery) -> tuple[str, ...]:
        """Base models the local runtime can load (query.usable_only), else () = any."""
        if not query.usable_only:
            return ()
        return tuple(option.id for option in model_provider.info().base_models if option.architecture is not None)

    @staticmethod
    def _feed_page(
        image_provider: ImageProvider,
        query: ImageSearchQuery,
        base_models: tuple[str, ...],
        cursor: _FeedCursor | None,
    ) -> ImageSearchPage:
        page = image_provider.search_images(
            ImageFeedRequest(
                sort=query.sort,
                nsfw=query.nsfw,
                limit=query.limit,
                period=query.period,
                model_id=None,
                base_models=base_models,
                cursor=cursor.cursor if cursor is not None else None,
            )
        )
        next_cursor = _encode_cursor(_FeedCursor(cursor=page.next_cursor)) if page.next_cursor is not None else None
        return ImageSearchPage(items=page.items, next_cursor=next_cursor)

    @classmethod
    def _keyword_page(
        cls,
        image_provider: ImageProvider,
        model_provider: ModelProvider,
        query: ImageSearchQuery,
        keyword: str,
        base_models: tuple[str, ...],
        cursor: _KeywordCursor | None,
    ) -> ImageSearchPage:
        # A first page starts with an empty batch and the model search still to run.
        galleries = list(cursor.galleries) if cursor is not None else []
        search_cursor = cursor.search_cursor if cursor is not None else None
        models_left = cursor is None or search_cursor is not None
        items: list[RemoteImage] = []
        for _ in range(MAX_ROUNDS_PER_PAGE):
            if all(gallery.done for gallery in galleries):
                if not models_left:
                    break
                galleries, search_cursor = cls._next_models(model_provider, query, keyword, base_models, search_cursor)
                models_left = search_cursor is not None
            active = [gallery for gallery in galleries if not gallery.done]
            if not active:
                continue
            pages = cls._gallery_pages(image_provider, query, base_models, active)
            advanced = {
                gallery.model: gallery.model_copy(update={"cursor": page.next_cursor, "done": page.next_cursor is None})
                for gallery, page in zip(active, pages, strict=True)
            }
            galleries = [advanced.get(gallery.model, gallery) for gallery in galleries]
            items = _interleave(page.items for page in pages)
            if items:
                break
        has_more = models_left or not all(gallery.done for gallery in galleries)
        if not has_more:
            return ImageSearchPage(items=items, next_cursor=None)
        next_cursor = _encode_cursor(_KeywordCursor(galleries=galleries, search_cursor=search_cursor))
        return ImageSearchPage(items=items, next_cursor=next_cursor)

    @staticmethod
    def _gallery_pages(
        image_provider: ImageProvider,
        query: ImageSearchQuery,
        base_models: tuple[str, ...],
        active: list[_GalleryCursor],
    ) -> list[ImageSearchPage]:
        """The next page of every active gallery (in order, concurrently), ceil(limit / len(active)) images each. A
        gallery the provider does not know (ProviderNotFoundError) answers an empty last page; other provider
        errors propagate."""
        per_model = math.ceil(query.limit / len(active))

        def fetch(gallery: _GalleryCursor) -> ImageSearchPage:
            try:
                return image_provider.search_images(
                    ImageFeedRequest(
                        sort=query.sort,
                        nsfw=query.nsfw,
                        limit=per_model,
                        period=None,
                        model_id=gallery.model,
                        model_version_id=gallery.version,
                        base_models=base_models,
                        cursor=gallery.cursor,
                    )
                )
            except ProviderNotFoundError:
                # The model has no (more) gallery, e.g. it was removed since the model search: it is exhausted.
                return ImageSearchPage(items=[], next_cursor=None)

        return _map_concurrently(fetch, active, MODEL_FANOUT)

    @staticmethod
    def _next_models(
        model_provider: ModelProvider,
        query: ImageSearchQuery,
        keyword: str,
        base_models: tuple[str, ...],
        search_cursor: str | None,
    ) -> tuple[list[_GalleryCursor], str | None]:
        """The next batch of models matching `keyword` (galleries not started yet, each on _gallery_version) and
        the following cursor."""
        page = model_provider.search(
            ModelSearchQuery(
                provider=query.provider,
                query=keyword,
                kinds=list(KEYWORD_MODEL_KINDS),
                base_models=list(base_models),
                sort="most_downloaded",
                nsfw=query.nsfw,
                limit=MODEL_FANOUT,
                cursor=search_cursor,
            )
        )
        models = {model.id: model for model in reversed(page.items)}  # the first of each model id wins
        galleries = [
            _GalleryCursor(model=model_id, version=_gallery_version(models[model_id], base_models))
            for model_id in dict.fromkeys(model.id for model in page.items)
        ]
        return galleries, page.next_cursor

    # -- resource resolution --------------------------------------------------

    def resolve_resources(self, request: ResolveImageResourcesRequest) -> list[ResolvedImageResource]:
        provider_id = self._model_providers.get(request.provider).id  # UnknownProviderError (404) up front
        lookups = [_lookup_of(resource) for resource in request.resources]
        unique = list(dict.fromkeys(lookup for lookup in lookups if lookup is not None))

        def run(lookup: _Lookup) -> RemoteModel | str:
            """The resolved model, or the error message of a provider failure."""
            try:
                if lookup.by == "version":
                    return self._catalog.get_version(provider_id, lookup.value)
                return self._catalog.find_by_hash(provider_id, lookup.value)
            except (ProviderNotFoundError, ProviderError) as exc:  # ProviderAuthError is a ProviderError
                return str(exc)

        outcomes = dict(zip(unique, _map_concurrently(run, unique, MAX_CONCURRENT_LOOKUPS), strict=True))
        resolved: list[ResolvedImageResource] = []
        for resource, lookup in zip(request.resources, lookups, strict=True):
            outcome = outcomes[lookup] if lookup is not None else NO_LOOKUP_ERROR
            model = outcome if isinstance(outcome, RemoteModel) else None
            resolved.append(
                ResolvedImageResource(
                    resource=resource,
                    model=model,
                    sha256=_resolved_sha256(resource, model),
                    error=outcome if isinstance(outcome, str) else None,
                )
            )
        return resolved

    # -- favorites ------------------------------------------------------------

    def favorites(self) -> list[FavoriteImage]:
        return self._favorites.list()

    def add_favorite(self, image: RemoteImage) -> FavoriteImage:
        return self._favorites.add(image)

    def remove_favorite(self, provider: str, image_id: str) -> None:
        if not self._favorites.remove(provider, image_id):
            raise FavoriteNotFound(f"No favorite image '{image_id}' from '{provider}'.")
