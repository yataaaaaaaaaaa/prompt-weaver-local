"""Civitai image gallery (public REST API v1, GET https://civitai.com/api/v1/images): base.ImageProvider.
Real, trimmed responses are in tests/fixtures/civitai/images_*.json.

Facts about the real API (probed 2026-11, see the fixtures):
- GET /images?limit=&sort=&period=&nsfw=&modelId=|modelVersionId=&baseModels=&cursor=&withMeta=true&type=image
  (list params repeated: baseModels=SD 1.5&baseModels=Illustrious is an OR). There is no free-text filter:
  `query` / `search` are silently ignored, `tags` only takes numeric tag ids (400 ZodError otherwise). `type`
  takes image | video | audio (anything else: 400 ZodError, images_error_invalid_type.json).
- sort: "Most Reactions" | "Most Comments" | "Most Collected" | "Newest" (also Oldest, Random, Recently Added);
  period: "Day" | "Week" | "Month" | "Year" | "AllTime". With modelId, period gives empty or partial pages
  (images_empty.json is a real empty page: {"items": [], "metadata": {}}) -> never sent for a gallery.
- modelVersionId (the gallery of one version, images_by_version.json) answers in a fraction of a second, while an
  uncached modelId gallery took about 20 s (probed 2026-11): a request with model_version_id sends modelVersionId
  only.
- nsfw: "None" (level 1 only), "Soft" (levels 1-2), "Mature", "X" (everything). Items carry nsfwLevel (string)
  and browsingLevel (int 1 PG, 2 PG-13, 4 R, 8 X, 16 XXX): safe = civitai.is_nsfw_level(browsingLevel) is False.
- meta is null unless withMeta=true. In the unfiltered feed and a version gallery meta is the generation dict
  itself (images_feed.json, images_by_version.json); with modelId it is wrapped: {"id": <image id>, "meta": {...}}
  (images_by_model*.json).
- metadata: {"nextCursor": str | int, "nextPage": url} ({} on the last/empty page).
- item: id, url ("/original=true/" -> civitai.thumbnail_url), width, height, nsfwLevel, browsingLevel, type
  ("image" | "video"), createdAt, postId, stats {likeCount, heartCount, laughCount, cryCount, commentCount, ...},
  username, baseModel (may be null), modelVersionIds. Page URL: civitai.image_page_url(id).
- generation meta (any key may be missing): parsed by civitai_image_meta.py (params, and resources merged from
  civitaiResources, resources, hashes, Model / Model hash and the inline <lora:name:weight> tags of the prompt).

Mapping rules (owned here):
- CIVITAI_IMAGE_SORTS / CIVITAI_IMAGE_PERIODS: app ImageSort / ImagePeriod -> Civitai values (exhaustive);
- nsfw: "X" when the request includes nsfw images, else "Soft" (levels 1-2 = the safe levels); nsfw items are
  dropped again after mapping unless requested (the level rule is civitai.is_nsfw_level);
- items of another type than "image" (videos) and items without id or url are skipped;
- reaction_count = likeCount + heartCount + laughCount + cryCount; architecture = CIVITAI_BASE_MODELS[baseModel]
  (None when unknown or not loadable); created_at None when unreadable.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from ...schemas import ImagePeriod, ImageSearchPage, ImageSort, RemoteImage
from .base import ImageFeedRequest, ProviderNotFoundError
from .civitai import (
    CIVITAI_BASE_MODELS,
    CIVITAI_PROVIDER_ID,
    CivitaiProvider,
    QueryParams,
    expect_dict,
    image_page_url,
    is_nsfw_level,
    optional_id,
    optional_positive_int,
    optional_str,
    page_items,
    stat_count,
    thumbnail_url,
)
from .civitai_image_meta import parse_generation_params, parse_resources, unwrap_meta

IMAGES_PATH = "/images"

CIVITAI_IMAGE_SORTS: dict[ImageSort, str] = {
    "most_reactions": "Most Reactions",
    "most_comments": "Most Comments",
    "most_collected": "Most Collected",
    "newest": "Newest",
}

CIVITAI_IMAGE_PERIODS: dict[ImagePeriod, str] = {
    "day": "Day",
    "week": "Week",
    "month": "Month",
    "year": "Year",
    "all_time": "AllTime",
}

NSFW_INCLUDED = "X"
NSFW_SAFE_ONLY = "Soft"
REACTION_STATS = ("likeCount", "heartCount", "laughCount", "cryCount")


def image_feed_params(request: ImageFeedRequest) -> QueryParams:
    """GET /images query parameters (list params repeated). A gallery is the version's (modelVersionId) when
    model_version_id is set, else the model's (modelId). period only for the unfiltered feed (a gallery + period
    answers empty or partial pages)."""
    params: QueryParams = [
        ("limit", str(request.limit)),
        ("sort", CIVITAI_IMAGE_SORTS[request.sort]),
        ("nsfw", NSFW_INCLUDED if request.nsfw else NSFW_SAFE_ONLY),
    ]
    if request.model_version_id is not None:
        params.append(("modelVersionId", request.model_version_id))
    elif request.model_id is not None:
        params.append(("modelId", request.model_id))
    elif request.period is not None:
        params.append(("period", CIVITAI_IMAGE_PERIODS[request.period]))
    params.extend(("baseModels", base_model) for base_model in dict.fromkeys(request.base_models))
    if request.cursor:
        params.append(("cursor", request.cursor))
    params.extend([("withMeta", "true"), ("type", "image")])
    return params


def _created_at(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def map_image(raw: Any) -> RemoteImage | None:
    """A /images item; None for another type than "image" (videos) or an item without id or url."""
    raw = expect_dict(raw, "image")
    image_id, url = optional_id(raw.get("id")), optional_str(raw.get("url"))
    if raw.get("type", "image") != "image" or image_id is None or url is None:
        return None
    base_model = optional_str(raw.get("baseModel"))
    meta = unwrap_meta(raw.get("meta"))
    return RemoteImage(
        provider=CIVITAI_PROVIDER_ID,
        id=image_id,
        url=url,
        thumbnail_url=thumbnail_url(url),
        width=optional_positive_int(raw.get("width")),
        height=optional_positive_int(raw.get("height")),
        nsfw=is_nsfw_level(raw.get("browsingLevel")),
        base_model=base_model,
        architecture=CIVITAI_BASE_MODELS.get(base_model) if base_model is not None else None,
        username=optional_str(raw.get("username")),
        created_at=_created_at(raw.get("createdAt")),
        reaction_count=stat_count(raw.get("stats"), *REACTION_STATS),
        page_url=image_page_url(image_id),
        params=parse_generation_params(meta),
        resources=parse_resources(meta),
    )


def map_image_page(raw: Any, *, include_nsfw: bool) -> ImageSearchPage:
    """A /images answer; nsfw images are dropped unless include_nsfw."""
    items, next_cursor = page_items(raw, "image page")
    images = (map_image(item) for item in items)
    return ImageSearchPage(
        items=[image for image in images if image is not None and (include_nsfw or not image.nsfw)],
        next_cursor=next_cursor,
    )


class CivitaiImageProvider:
    """base.ImageProvider over the Civitai images API. Every request goes through api.get_json (token, errors,
    redaction) and payloads through api.map_payload (malformed payload -> ProviderError)."""

    id = CIVITAI_PROVIDER_ID

    def __init__(self, *, api: CivitaiProvider) -> None:
        self._api = api

    def __repr__(self) -> str:
        return f"{type(self).__name__}(api={self._api!r})"

    def search_images(self, request: ImageFeedRequest) -> ImageSearchPage:
        if request.model_version_id is not None:
            gallery_id = request.model_version_id
            not_found = f"Civitai has no image gallery for model version {gallery_id}."
        elif request.model_id is not None:
            gallery_id, not_found = request.model_id, f"Civitai has no image gallery for model {request.model_id}."
        else:
            gallery_id, not_found = None, "The Civitai image feed was not found."
        if gallery_id is not None and optional_id(gallery_id) != gallery_id:
            raise ProviderNotFoundError(not_found)  # Civitai ids are integers: never request anything else
        payload = self._api.get_json(IMAGES_PATH, params=image_feed_params(request), not_found=not_found)
        return self._api.map_payload(map_image_page, payload, include_nsfw=request.nsfw)
