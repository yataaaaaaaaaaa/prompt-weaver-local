"""Civitai provider (public REST API v1, https://civitai.com/api/v1). Real, trimmed responses are in
tests/fixtures/civitai/*.json.

Endpoints used:
    GET /models?query=&types=&baseModels=&sort=&nsfw=&limit=&cursor=   search (list params repeated:
        types=LORA&types=LoCon); answer {"items": [...], "metadata": {"nextCursor"?: str, ...}}
        (metadata is {} on the last/empty page)
    GET /model-versions/{id}              a version + "modelId" + "model": {name, type, nsfw, poi}
    GET /model-versions/by-hash/{sha256}  same shape as /model-versions/{id}
    404 answers {"error": "Model not found"}; invalid params answer 400 {"error": {"name": "ZodError", ...}}
    Downloads: file["downloadUrl"] (307 redirect to a signed storage URL). With a stored token every request
    sends "Authorization: Bearer <token>"; 401/403 means a token is required (ProviderAuthError /
    DownloadSource.auth_hint).

Mapping rules (owned here, nowhere else):
- CIVITAI_KIND_TYPES: app ModelKind -> Civitai model types. Results of other types are dropped.
- CIVITAI_BASE_MODELS: base-model filter options in display order -> the architecture
  diffusion-lora-runtime loads (sd15 / sdxl; Pony, Illustrious, NoobAI are SDXL) or None (not loadable).
  An unknown base model maps to None.
- CIVITAI_SORTS: app ModelSort -> Civitai sort value.
- ids are strings (Civitai ints converted); hashes lowercase; size_bytes = round(sizeKB * 1024) (exact: it
  matches the byte size of the downloaded file);
- RemoteFile.downloadable only for metadata.format == "SafeTensor" (pickle files are refused) and file type
  "Model" / "Pruned Model" (not VAEs, configs, training data, ...);
- preview images: type "image" only (videos skipped); url resized for thumbnails by replacing the
  "/original=true/" path segment with "/width=450/"; nsfw = nsfwLevel > 2 (1 PG, 2 PG-13, 4 R, 8 X, 16 XXX);
  when query.nsfw is False, nsfw images are dropped;
- page_url: https://civitai.com/models/{modelId}?modelVersionId={versionId} (version) /
  https://civitai.com/models/{modelId} (model);
- trigger words: version "trainedWords" (stripped, empty ones dropped).
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any, TypeVar

import httpx

from ...schemas import (
    BaseModelOption,
    ModelArchitecture,
    ModelKind,
    ModelProviderInfo,
    ModelSearchPage,
    ModelSearchQuery,
    ModelSort,
    PreviewImage,
    RemoteFile,
    RemoteModel,
    RemoteModelVersion,
)
from ..backend_settings import BackendSettingsStore
from ..file_hashes import normalize_sha256
from ..http import HttpClientFactory
from .base import DownloadSource, ProviderAuthError, ProviderError, ProviderNotFoundError, complete_version

CIVITAI_PROVIDER_ID = "civitai"
CIVITAI_API_URL = "https://civitai.com/api/v1"
CIVITAI_SITE_URL = "https://civitai.com"

CIVITAI_KIND_TYPES: dict[ModelKind, tuple[str, ...]] = {
    "checkpoint": ("Checkpoint",),
    "lora": ("LORA", "LoCon", "DoRA"),
    "embedding": ("TextualInversion",),
}

CIVITAI_SORTS: dict[ModelSort, str] = {
    "most_downloaded": "Most Downloaded",
    "highest_rated": "Highest Rated",
    "newest": "Newest",
}

# Display order of the base-model filter. Pony V7 is AuraFlow-based (not SDXL): not loadable.
CIVITAI_BASE_MODELS: dict[str, ModelArchitecture | None] = {
    "SD 1.5": "sd15",
    "SD 1.5 LCM": "sd15",
    "SD 1.5 Hyper": "sd15",
    "SD 1.4": "sd15",
    "SDXL 1.0": "sdxl",
    "SDXL Lightning": "sdxl",
    "SDXL Hyper": "sdxl",
    "SDXL Turbo": "sdxl",
    "Pony": "sdxl",
    "Illustrious": "sdxl",
    "NoobAI": "sdxl",
    "Pony V7": None,
    "SD 2.1": None,
    "SD 3.5": None,
    "Flux.1 D": None,
    "Flux.1 S": None,
}

AUTH_HINT = "This Civitai download requires an API token: add one in the Model library settings."
TOKEN_REQUIRED_MESSAGE = "Civitai requires an API token for this request: add one in the Model library settings."
TOKEN_REJECTED_MESSAGE = "Civitai rejected the stored API token: update it in the Model library settings."

# Civitai model type -> app kind (the inverse of CIVITAI_KIND_TYPES).
_KIND_BY_CIVITAI_TYPE: dict[str, ModelKind] = {
    civitai_type: kind for kind, civitai_types in CIVITAI_KIND_TYPES.items() for civitai_type in civitai_types
}
SAFETENSORS_FORMAT = "SafeTensor"
DOWNLOADABLE_FILE_TYPES = frozenset({"Model", "Pruned Model"})
# Image nsfwLevel values above this one are nsfw (1 PG, 2 PG-13, 4 R, 8 X, 16 XXX).
MAX_SAFE_NSFW_LEVEL = 2
ORIGINAL_IMAGE_SEGMENT = "/original=true/"
THUMBNAIL_IMAGE_SEGMENT = "/width=450/"
# Longest Civitai error text quoted in a ProviderError message.
MAX_ERROR_TEXT_LENGTH = 300

_CIVITAI_ID_RE = re.compile(r"[0-9]{1,18}")

QueryParams = list[tuple[str, str]]
_Mapped = TypeVar("_Mapped")


class _MalformedPayload(ValueError):
    """The Civitai payload does not have the documented shape."""


# ---------------------------------------------------------------------------
# Civitai payload -> app schemas (pure)
# ---------------------------------------------------------------------------


def model_page_url(model_id: str) -> str:
    return f"{CIVITAI_SITE_URL}/models/{model_id}"


def version_page_url(model_id: str, version_id: str) -> str:
    return f"{model_page_url(model_id)}?modelVersionId={version_id}"


def download_url(version_id: str, file_id: str) -> str:
    """Canonical download URL of one file (the form the /model-versions endpoints return)."""
    return f"{CIVITAI_SITE_URL}/api/download/models/{version_id}?fileId={file_id}"


def thumbnail_url(image_url: str) -> str:
    return image_url.replace(ORIGINAL_IMAGE_SEGMENT, THUMBNAIL_IMAGE_SEGMENT)


def _dict(value: Any, what: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _MalformedPayload(f"{what} is not an object")
    return value


def _list(value: Any, what: str) -> list[Any]:
    """`value` as a list; null/absent counts as empty."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise _MalformedPayload(f"{what} is not a list")
    return value


def _id(value: Any, what: str) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, str)) or value == "":
        raise _MalformedPayload(f"{what} has no id")
    return str(value)


def _sha256(hashes: Any) -> str | None:
    value = hashes.get("SHA256") if isinstance(hashes, dict) else None
    return normalize_sha256(value) if isinstance(value, str) else None


def _optional_str(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def map_file(raw: Any) -> RemoteFile:
    raw = _dict(raw, "file")
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    file_format = _optional_str(metadata.get("format"))
    size_kb = raw.get("sizeKB")
    if isinstance(size_kb, bool) or not isinstance(size_kb, (int, float)):
        raise _MalformedPayload("file has no sizeKB")
    return RemoteFile(
        id=_id(raw.get("id"), "file"),
        name=raw["name"],
        size_bytes=round(size_kb * 1024),
        sha256=_sha256(raw.get("hashes")),
        format=file_format,
        precision=_optional_str(metadata.get("fp")),
        variant=_optional_str(metadata.get("size")),
        primary=raw.get("primary") is True,
        downloadable=file_format == SAFETENSORS_FORMAT and raw.get("type") in DOWNLOADABLE_FILE_TYPES,
        local_path=None,
    )


def map_images(raw_images: Any, *, include_nsfw: bool) -> list[PreviewImage]:
    images: list[PreviewImage] = []
    for raw in _list(raw_images, "images"):
        raw = _dict(raw, "image")
        url = raw.get("url")
        if raw.get("type", "image") != "image" or not isinstance(url, str) or not url:
            continue
        level = raw.get("nsfwLevel")
        # An image without a level is treated as nsfw (never shown by accident).
        nsfw = isinstance(level, bool) or not isinstance(level, int) or level > MAX_SAFE_NSFW_LEVEL
        if nsfw and not include_nsfw:
            continue
        images.append(PreviewImage(url=thumbnail_url(url), width=raw.get("width"), height=raw.get("height"), nsfw=nsfw))
    return images


def trigger_words(raw_words: Any) -> list[str]:
    return [word.strip() for word in _list(raw_words, "trainedWords") if isinstance(word, str) and word.strip()]


def map_version(raw: Any, *, model_id: str, include_nsfw_images: bool) -> RemoteModelVersion:
    raw = _dict(raw, "model version")
    version_id = _id(raw.get("id"), "model version")
    base_model = raw.get("baseModel") if isinstance(raw.get("baseModel"), str) else ""
    return complete_version(
        RemoteModelVersion(
            id=version_id,
            name=_optional_str(raw.get("name")) or version_id,
            base_model=base_model,
            architecture=CIVITAI_BASE_MODELS.get(base_model),
            trigger_words=trigger_words(raw.get("trainedWords")),
            published_at=raw.get("publishedAt"),
            images=map_images(raw.get("images"), include_nsfw=include_nsfw_images),
            files=[map_file(file) for file in _list(raw.get("files"), "files")],
            page_url=version_page_url(model_id, version_id),
            default_file_id=None,
            unavailable_reason=None,
        )
    )


def map_search_item(raw: Any, *, include_nsfw_images: bool) -> RemoteModel | None:
    """A /models item, or None when its type is not one of the app's kinds."""
    raw = _dict(raw, "model")
    kind = _KIND_BY_CIVITAI_TYPE.get(raw.get("type"))
    if kind is None:
        return None
    model_id = _id(raw.get("id"), "model")
    creator = raw.get("creator") if isinstance(raw.get("creator"), dict) else {}
    stats = raw.get("stats") if isinstance(raw.get("stats"), dict) else {}
    return RemoteModel(
        provider=CIVITAI_PROVIDER_ID,
        id=model_id,
        name=raw["name"],
        kind=kind,
        creator=_optional_str(creator.get("username")),
        nsfw=raw.get("nsfw") is True,
        tags=[tag for tag in _list(raw.get("tags"), "tags") if isinstance(tag, str)],
        download_count=int(stats.get("downloadCount") or 0),
        page_url=model_page_url(model_id),
        versions=[
            map_version(version, model_id=model_id, include_nsfw_images=include_nsfw_images)
            for version in _list(raw.get("modelVersions"), "modelVersions")
        ],
    )


def map_version_payload(raw: Any) -> RemoteModel:
    """A /model-versions/{id} or /model-versions/by-hash/{sha256} payload: the owning model with
    versions == [that version]. Every image is kept, with its nsfw flag."""
    raw = _dict(raw, "model version")
    model = _dict(raw.get("model"), "model version model")
    model_type = model.get("type")
    kind = _KIND_BY_CIVITAI_TYPE.get(model_type)
    if kind is None:
        raise ProviderNotFoundError(
            f"Civitai model version {raw.get('id')} is a {model_type!s} model, not a checkpoint, LoRA or embedding."
        )
    model_id = _id(raw.get("modelId"), "model version model")
    stats = raw.get("stats") if isinstance(raw.get("stats"), dict) else {}
    return RemoteModel(
        provider=CIVITAI_PROVIDER_ID,
        id=model_id,
        name=model["name"],
        kind=kind,
        creator=None,
        nsfw=model.get("nsfw") is True,
        tags=[],
        download_count=int(stats.get("downloadCount") or 0),
        page_url=model_page_url(model_id),
        versions=[map_version(raw, model_id=model_id, include_nsfw_images=True)],
    )


def map_search_page(raw: Any, *, include_nsfw_images: bool) -> ModelSearchPage:
    raw = _dict(raw, "search page")
    if not isinstance(raw.get("items"), list):
        raise _MalformedPayload("search page has no items")
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    next_cursor = metadata.get("nextCursor")
    models = (map_search_item(item, include_nsfw_images=include_nsfw_images) for item in raw["items"])
    return ModelSearchPage(
        items=[model for model in models if model is not None],
        next_cursor=str(next_cursor) if next_cursor not in (None, "") else None,
    )


def search_params(query: ModelSearchQuery) -> QueryParams:
    """GET /models query parameters (list params repeated)."""
    params: QueryParams = [
        ("limit", str(query.limit)),
        ("sort", CIVITAI_SORTS[query.sort]),
        ("nsfw", "true" if query.nsfw else "false"),
    ]
    if query.query.strip():
        params.append(("query", query.query.strip()))
    kinds = dict.fromkeys(query.kinds) if query.kinds else CIVITAI_KIND_TYPES
    params.extend(("types", civitai_type) for kind in kinds for civitai_type in CIVITAI_KIND_TYPES[kind])
    params.extend(("baseModels", base_model) for base_model in dict.fromkeys(query.base_models))
    if query.cursor:
        params.append(("cursor", query.cursor))
    return params


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _redact(text: str, secret: str | None) -> str:
    return text.replace(secret, "***") if secret else text


def _error_text(response: httpx.Response) -> str:
    """The Civitai error text of a failed response ({"error": str} or {"error": {"message": str}})."""
    try:
        payload = response.json()
    except ValueError:
        text = response.text
    else:
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, dict):
            error = error.get("message")
        text = error if isinstance(error, str) else response.text
    text = " ".join(text.split())
    return text if len(text) <= MAX_ERROR_TEXT_LENGTH else f"{text[: MAX_ERROR_TEXT_LENGTH - 3]}..."


class CivitaiProvider:
    """base.ModelProvider over the Civitai REST API."""

    id = CIVITAI_PROVIDER_ID
    label = "Civitai"

    def __init__(
        self,
        *,
        client_factory: HttpClientFactory,
        settings: BackendSettingsStore,
        api_url: str = CIVITAI_API_URL,
    ) -> None:
        self._client_factory = client_factory
        self._settings = settings
        self._api_url = api_url

    def __repr__(self) -> str:
        return f"{type(self).__name__}(api_url={self._api_url!r})"

    def info(self) -> ModelProviderInfo:
        return ModelProviderInfo(
            id=self.id,
            label=self.label,
            kinds=list(CIVITAI_KIND_TYPES),
            base_models=[
                BaseModelOption(id=base_model, architecture=architecture)
                for base_model, architecture in CIVITAI_BASE_MODELS.items()
            ],
            sorts=list(CIVITAI_SORTS),
            token_supported=True,
            token_set=self._settings.has_token(self.id),
        )

    def search(self, query: ModelSearchQuery) -> ModelSearchPage:
        payload = self._get_json("/models", params=search_params(query), not_found="Civitai search not found.")
        return self._mapped(map_search_page, payload, include_nsfw_images=query.nsfw)

    def get_version(self, version_id: str) -> RemoteModel:
        not_found = f"Civitai model version {version_id} was not found."
        if not _CIVITAI_ID_RE.fullmatch(version_id):
            raise ProviderNotFoundError(not_found)  # Civitai ids are integers: never request anything else
        payload = self._get_json(f"/model-versions/{version_id}", not_found=not_found)
        return self._mapped(map_version_payload, payload)

    def find_by_hash(self, sha256: str) -> RemoteModel:
        not_found = f"No Civitai model version has a file with SHA-256 {sha256}."
        if normalize_sha256(sha256) != sha256:  # lowercase hex only: never request anything else
            raise ProviderNotFoundError(not_found)
        payload = self._get_json(f"/model-versions/by-hash/{sha256}", not_found=not_found)
        return self._mapped(map_version_payload, payload)

    def download_source(self, version: RemoteModel, file: RemoteFile) -> DownloadSource:
        owner = next(
            (candidate for candidate in version.versions if any(item.id == file.id for item in candidate.files)),
            None,
        )
        if owner is None:
            raise ValueError(f"File {file.id} does not belong to any version of Civitai model {version.id}.")
        return DownloadSource(
            url=download_url(owner.id, file.id),
            headers=self._auth_headers(self._settings.get_token(self.id)),
            auth_hint=AUTH_HINT,
        )

    # -- internals ----------------------------------------------------------

    @staticmethod
    def _auth_headers(token: str | None) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}"} if token else {}

    @staticmethod
    def _mapped(mapper: Callable[..., _Mapped], payload: Any, **kwargs: Any) -> _Mapped:
        try:
            return mapper(payload, **kwargs)
        except (KeyError, TypeError, ValueError) as exc:  # pydantic ValidationError is a ValueError
            raise ProviderError(f"Civitai answered an unexpected payload ({type(exc).__name__}).") from None

    def _get_json(self, path: str, *, not_found: str, params: QueryParams | None = None) -> Any:
        """GET {api_url}{path} -> parsed JSON; errors mapped to the provider exceptions of base.py. No message
        ever contains the token (httpx errors are not chained: their text could quote request headers)."""
        token = self._settings.get_token(self.id)
        try:
            with self._client_factory() as client:
                response = client.get(f"{self._api_url}{path}", params=params, headers=self._auth_headers(token))
        except httpx.HTTPError as exc:
            message = f"Civitai could not be reached ({type(exc).__name__}: {exc})."
            raise ProviderError(_redact(message, token)) from None

        status = response.status_code
        if status in (401, 403):
            raise ProviderAuthError(TOKEN_REJECTED_MESSAGE if token else TOKEN_REQUIRED_MESSAGE)
        if status == 404:
            raise ProviderNotFoundError(not_found)
        if not response.is_success:
            raise ProviderError(_redact(f"Civitai answered HTTP {status}: {_error_text(response)}", token))
        try:
            return response.json()
        except ValueError:
            raise ProviderError("Civitai answered a response that is not JSON.") from None
