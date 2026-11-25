"""Synthetic Civitai and Hugging Face for the e2e backend, served through support.FakeHttp (no real network).

The catalog (fixtures/civitai_catalog.json) is synthetic and compact; this module expands it into Civitai-shaped
API answers (the shapes of the real trimmed answers in tests/fixtures/civitai), so the real provider code
(services/model_providers/civitai*.py) parses them. Every file gets deterministic content (file_content), and its
published size and SHA-256 are computed from that content, so a download verifies like a real one.

Answered (scheme + host + path; FakeHttp ignores the query string for matching, the handlers read it):
- GET https://civitai.com/api/v1/models                 search: types, baseModels, query (name / tags / creator,
                                                        case-insensitive), nsfw, limit, cursor (an offset)
- GET https://civitai.com/api/v1/model-versions/{id}    one version with its model
- GET https://civitai.com/api/v1/model-versions/by-hash/{hash}   full SHA-256 (any case) or AutoV2 (10 hex)
- GET https://civitai.com/api/v1/images                 feed, or the gallery of modelVersionId / modelId; nsfw
                                                        (Soft = levels 1-2), baseModels, limit, cursor
- GET https://civitai.com/api/download/models/{id}      the file (?fileId=), streamed in paced chunks
- GET https://image.civitai.com/e2e/...                 every catalog image (original and thumbnail), as JPEG
- GET https://huggingface.co/h94/IP-Adapter/resolve/... IP-Adapter files: paced bytes whose hash never matches
                                                        the pinned catalog (they end as a failed download)
Anything else answers 599 and is listed in FakeHttp.unexpected (GET /__e2e__/state reports it).

Pacing (options.NetworkOptions): chunk_delay_ms before each chunk, download_chunks chunks per file (a file is
download_chunks MiB: the download manager reads 1 MiB chunks, so each chunk is one visible progress step),
stall_at_percent (the stream stops there; a cancel, or the app being replaced, releases it with a read error, which
the manager turns into "cancelled" for the cancelled download and into a retry for the others; the last chunk before
the stall waits at least STALL_REPORT_DELAY_S, longer than the manager's progress throttle, so the stalled download
shows its real progress), corrupt_downloads (the first N Civitai file downloads deliver other bytes of the same size:
their SHA-256 verification fails, the install ends "Failed" with Retry / Dismiss, and the retry downloads the real
file), and civitai_error_status / civitai_delay_ms for the API answers.
"""

from __future__ import annotations

import functools
import hashlib
import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field

from support import FakeHttp

from .images import jpeg_bytes

CATALOG_FILE = Path(__file__).resolve().parent / "fixtures" / "civitai_catalog.json"

CIVITAI_API = "https://civitai.com/api/v1"
CIVITAI_DOWNLOAD = "https://civitai.com/api/download/models"
CIVITAI_IMAGE_ORIGIN = "https://image.civitai.com"
HUGGING_FACE_ORIGIN = "https://huggingface.co"
# Path prefix of every synthetic image URL (image.civitai.com/e2e/...): frontend/e2e/support/network.ts answers the
# browser's requests for them with generated pictures.
IMAGE_PATH_PREFIX = "/e2e/"
ORIGINAL_SEGMENT = "/original=true/"
THUMBNAIL_SEGMENT = "/width=450/"

# The download manager (services/downloads.py) reads 1 MiB chunks: one synthetic chunk = one progress step.
CHUNK_SIZE = 1024 * 1024
SAFE_NSFW_LEVELS = frozenset({1, 2})
# The download manager publishes at most one progress event per 0.25 s (services/downloads.py progress_interval_s):
# the last chunk before a stall waits longer, so its progress is published before the stream stalls.
STALL_REPORT_DELAY_S = 0.4


class NetworkOptions(BaseModel):
    """Pacing and failures of the synthetic network (E2EResetRequest.network, options.py)."""

    model_config = ConfigDict(extra="forbid")

    chunk_delay_ms: int = Field(default=150, ge=0, le=10_000, description="Wait before each downloaded chunk.")
    download_chunks: int = Field(
        default=6,
        ge=1,
        le=64,
        description="Chunks of 1 MiB per synthetic file (each chunk is one progress step of the download manager).",
    )
    stall_at_percent: int | None = Field(
        default=None,
        ge=0,
        le=99,
        description="Downloads stop progressing at this percentage (they keep the 'downloading' state until "
        "cancelled).",
    )
    civitai_error_status: int | None = Field(
        default=None, ge=400, le=599, description="Every Civitai API call answers this HTTP status (error states)."
    )
    civitai_delay_ms: int = Field(default=0, ge=0, le=30_000, description="Wait before every Civitai API answer.")
    corrupt_downloads: int = Field(
        default=0,
        ge=0,
        le=100,
        description="The first N Civitai file downloads deliver other bytes of the same size: their SHA-256 "
        "verification fails (the install ends 'Failed'); the following downloads are intact.",
    )


def file_content(file_id: int | str, size: int) -> bytes:
    """The deterministic bytes of the synthetic file `file_id` (generated on demand, never kept)."""
    seed = f"prompt-weaver-e2e-file:{file_id}:".encode()
    return (seed * (size // len(seed) + 1))[:size]


def corrupted(content: bytes) -> bytes:
    """Other bytes of the same size (the first byte flipped): a download of them fails the SHA-256 verification."""
    return bytes([content[0] ^ 0xFF]) + content[1:] if content else content


@functools.lru_cache(maxsize=None)
def file_sha256(file_id: str, size: int) -> str:
    return hashlib.sha256(file_content(file_id, size)).hexdigest()


def image_url(image_id: int | str) -> str:
    """The original URL of the synthetic image `image_id` (Civitai form: thumbnails replace /original=true/)."""
    return f"{CIVITAI_IMAGE_ORIGIN}{IMAGE_PATH_PREFIX}{image_id}{ORIGINAL_SEGMENT}{image_id}.jpeg"


def load_catalog(path: Path = CATALOG_FILE) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class _File:
    raw: dict[str, Any]
    size: int

    @property
    def id(self) -> str:
        return str(self.raw["id"])

    @property
    def sha256(self) -> str:
        return file_sha256(self.id, self.size)

    def content(self) -> bytes:
        return file_content(self.id, self.size)


class SyntheticCivitai:
    """Expands the catalog and registers its routes on a FakeHttp (install())."""

    def __init__(self, catalog: dict[str, Any], options: NetworkOptions) -> None:
        self.options = options
        self._models: list[dict[str, Any]] = catalog.get("models", [])
        self._images: list[dict[str, Any]] = catalog.get("images", [])
        self._files: dict[str, _File] = {}
        self._versions: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
        self._closed = threading.Event()
        # Incremented by release_stalls(): a stalled stream ends when a release happened after its request started.
        self._releases = 0
        self._release_changed = threading.Condition()
        # Civitai file downloads still to corrupt (NetworkOptions.corrupt_downloads), counted down per request.
        self._corrupt_left = options.corrupt_downloads
        self._corrupt_lock = threading.Lock()
        file_size = options.download_chunks * CHUNK_SIZE
        for model in self._models:
            for version in model.get("versions", []):
                self._versions[str(version["id"])] = (model, version)
                for file in version.get("files", []):
                    self._files[str(file["id"])] = _File(file, file_size)

    # -- lifecycle -----------------------------------------------------------------------------------------------

    def close(self) -> None:
        """Ends every paced or stalled stream (the app is being replaced)."""
        self._closed.set()
        self.release_stalls()

    def release_stalls(self) -> None:
        """Ends, with a read error, the stalled streams whose request started before this call (server.py calls it
        after every download cancel: the manager only notices a cancel between chunks). Their retries stall again."""
        with self._release_changed:
            self._releases += 1
            self._release_changed.notify_all()

    def install(self, http: FakeHttp) -> None:
        http.add("GET", f"{CIVITAI_API}/models", handler=self._api(self._search))
        http.add("GET", f"{CIVITAI_API}/images", handler=self._api(self._image_page))
        for version_id in self._versions:
            http.add("GET", f"{CIVITAI_API}/model-versions/{version_id}", handler=self._api(self._version))
            http.add("GET", f"{CIVITAI_DOWNLOAD}/{version_id}", handler=self._download)
        for file in self._files.values():
            for key in {file.sha256, file.sha256.upper(), file.sha256[:10], file.sha256[:10].upper()}:
                http.add("GET", f"{CIVITAI_API}/model-versions/by-hash/{key}", handler=self._api(self._by_hash))
        for image_id in self._all_image_ids():
            original = image_url(image_id)
            for url in (original, original.replace(ORIGINAL_SEGMENT, THUMBNAIL_SEGMENT)):
                http.add("GET", url, content=jpeg_bytes(f"civitai-image:{image_id}", 832, 1216),
                         headers={"Content-Type": "image/jpeg"})

    def install_hugging_face(self, http: FakeHttp, urls: list[str]) -> None:
        """Paced bytes for the IP-Adapter files (their pinned SHA-256 never matches: the download ends failed)."""
        for url in urls:
            http.add("GET", url, handler=self._hugging_face_download)

    # -- Civitai API ---------------------------------------------------------------------------------------------

    def _api(self, answer: Any) -> Any:
        def handler(request: httpx.Request) -> httpx.Response:
            if self.options.civitai_delay_ms:
                self._closed.wait(self.options.civitai_delay_ms / 1000)
            if self.options.civitai_error_status is not None:
                return httpx.Response(
                    self.options.civitai_error_status, json={"error": "Synthetic Civitai error (e2e option)"}
                )
            return answer(request)

        return handler

    def _search(self, request: httpx.Request) -> httpx.Response:
        params = request.url.params
        types = set(params.get_list("types"))
        base_models = set(params.get_list("baseModels"))
        query = (params.get("query") or "").strip().casefold()
        include_nsfw = params.get("nsfw") == "true"
        matches = []
        for model in self._models:
            if types and model["type"] not in types:
                continue
            if not include_nsfw and model.get("nsfw", False):
                continue
            versions = [v for v in model.get("versions", []) if not base_models or v["baseModel"] in base_models]
            if not versions:
                continue
            haystack = " ".join([model["name"], model.get("creator", ""), *model.get("tags", [])]).casefold()
            if query and query not in haystack:
                continue
            matches.append(self._model_payload(model, versions))
        matches.sort(key=lambda item: -item["stats"]["downloadCount"])
        return httpx.Response(200, json=self._page(matches, params))

    def _version(self, request: httpx.Request) -> httpx.Response:
        version_id = request.url.path.rsplit("/", 1)[-1]
        model, version = self._versions[version_id]
        return httpx.Response(200, json=self._version_payload(model, version))

    def _by_hash(self, request: httpx.Request) -> httpx.Response:
        key = request.url.path.rsplit("/", 1)[-1].lower()
        for file_id, file in self._files.items():
            if file.sha256 == key or file.sha256[:10] == key:
                for model, version in self._versions.values():
                    if any(str(raw["id"]) == file_id for raw in version.get("files", [])):
                        return httpx.Response(200, json=self._version_payload(model, version))
        return httpx.Response(404, json={"error": "Not found"})

    def _image_page(self, request: httpx.Request) -> httpx.Response:
        params = request.url.params
        version_id, model_id = params.get("modelVersionId"), params.get("modelId")
        safe_only = params.get("nsfw") != "X"
        base_models = set(params.get_list("baseModels"))
        if model_id is not None:
            model_versions = {
                int(version_id_)
                for version_id_, (model, _) in self._versions.items()
                if str(model["id"]) == model_id
            }
        items = []
        for image in self._images:
            versions = set(image.get("modelVersionIds", []))
            if version_id is not None and int(version_id) not in versions:
                continue
            if model_id is not None and not versions & model_versions:
                continue
            if safe_only and image.get("nsfwLevel", 1) not in SAFE_NSFW_LEVELS:
                continue
            if base_models and image.get("baseModel") not in base_models:
                continue
            items.append(self._image_payload(image, wrapped=version_id is not None or model_id is not None))
        return httpx.Response(200, json=self._page(items, params))

    @staticmethod
    def _page(items: list[dict[str, Any]], params: httpx.QueryParams) -> dict[str, Any]:
        offset = int(params.get("cursor") or 0)
        limit = int(params.get("limit") or 20)
        page = items[offset : offset + limit]
        metadata = {"nextCursor": str(offset + limit)} if offset + limit < len(items) else {}
        return {"items": page, "metadata": metadata}

    # -- payloads ------------------------------------------------------------------------------------------------

    def _file_payload(self, version_id: str, raw: dict[str, Any]) -> dict[str, Any]:
        file = self._files[str(raw["id"])]
        sha256 = file.sha256.upper()
        return {
            "id": raw["id"],
            "sizeKB": file.size / 1024,
            "name": raw["name"],
            "type": raw.get("type", "Model"),
            "metadata": {"format": raw.get("format", "SafeTensor"), "size": raw.get("variant"), "fp": raw.get("fp")},
            "hashes": {"AutoV2": sha256[:10], "SHA256": sha256},
            "downloadUrl": f"{CIVITAI_DOWNLOAD}/{version_id}?fileId={raw['id']}",
            "primary": raw.get("primary", False),
        }

    @staticmethod
    def _preview_payload(raw: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": raw["id"],
            "url": image_url(raw["id"]),
            "nsfwLevel": raw.get("nsfwLevel", 1),
            "width": raw.get("width", 832),
            "height": raw.get("height", 1216),
            "type": "image",
        }

    def _version_fields(self, version: dict[str, Any]) -> dict[str, Any]:
        version_id = str(version["id"])
        return {
            "id": version["id"],
            "name": version.get("name", "v1.0"),
            "baseModel": version["baseModel"],
            "publishedAt": version.get("publishedAt", "2026-10-01T10:00:00.000Z"),
            "trainedWords": version.get("trainedWords", []),
            "files": [self._file_payload(version_id, raw) for raw in version.get("files", [])],
            "images": [self._preview_payload(raw) for raw in version.get("images", [])],
            "downloadUrl": f"{CIVITAI_DOWNLOAD}/{version_id}",
        }

    def _model_payload(self, model: dict[str, Any], versions: list[dict[str, Any]]) -> dict[str, Any]:
        return {
            "id": model["id"],
            "name": model["name"],
            "type": model["type"],
            "nsfw": model.get("nsfw", False),
            "creator": {"username": model.get("creator")},
            "tags": model.get("tags", []),
            "stats": {"downloadCount": model.get("downloads", 0)},
            "modelVersions": [self._version_fields(version) for version in versions],
        }

    def _version_payload(self, model: dict[str, Any], version: dict[str, Any]) -> dict[str, Any]:
        return {
            **self._version_fields(version),
            "modelId": model["id"],
            "model": {"name": model["name"], "type": model["type"], "nsfw": model.get("nsfw", False)},
            "stats": {"downloadCount": model.get("downloads", 0)},
        }

    @staticmethod
    def _image_payload(image: dict[str, Any], *, wrapped: bool) -> dict[str, Any]:
        level = image.get("nsfwLevel", 1)
        meta = image.get("meta")
        return {
            "id": image["id"],
            "url": image_url(image["id"]),
            "width": image.get("width", 832),
            "height": image.get("height", 1216),
            "type": "image",
            "nsfw": level not in SAFE_NSFW_LEVELS,
            "browsingLevel": level,
            "createdAt": image.get("createdAt", "2026-11-01T12:00:00.000Z"),
            "stats": {"likeCount": image.get("reactions", 0), "heartCount": 0, "laughCount": 0, "cryCount": 0},
            # Galleries wrap the generation data ({"id", "meta"}), the feed sends it flat (civitai_image_meta.py).
            "meta": ({"id": image["id"], "meta": meta} if wrapped else meta) if meta is not None else None,
            "username": image.get("username"),
            "baseModel": image.get("baseModel"),
            "modelVersionIds": image.get("modelVersionIds", []),
        }

    def _all_image_ids(self) -> list[int]:
        ids = [image["id"] for image in self._images]
        for model in self._models:
            for version in model.get("versions", []):
                ids.extend(raw["id"] for raw in version.get("images", []))
        return ids

    # -- downloads -----------------------------------------------------------------------------------------------

    def _paced(self, content: bytes, releases_at_request: int) -> Iterator[bytes]:
        stall_at = (
            len(content) * self.options.stall_at_percent // 100 if self.options.stall_at_percent is not None else None
        )
        sent = 0
        while sent < len(content):
            if stall_at is not None and sent + CHUNK_SIZE > stall_at:
                with self._release_changed:
                    while self._releases == releases_at_request and not self._closed.is_set():
                        self._release_changed.wait(0.05)
                raise httpx.ReadError("Synthetic stalled download released")
            delay_s = self.options.chunk_delay_ms / 1000
            if stall_at is not None and sent + 2 * CHUNK_SIZE > stall_at:
                # The last chunk before the stall: late enough for its progress event to pass the throttle.
                delay_s = max(delay_s, STALL_REPORT_DELAY_S)
            if delay_s and self._closed.wait(delay_s):
                raise httpx.ReadError("Synthetic network closed")
            chunk = content[sent : sent + CHUNK_SIZE]
            sent += len(chunk)
            yield chunk

    def _stream(self, content: bytes) -> httpx.Response:
        with self._release_changed:
            releases = self._releases
        return httpx.Response(
            200,
            content=self._paced(content, releases),
            headers={"Content-Length": str(len(content)), "Content-Type": "application/octet-stream"},
        )

    def _download(self, request: httpx.Request) -> httpx.Response:
        version_id = request.url.path.rsplit("/", 1)[-1]
        _, version = self._versions[version_id]
        file_id = request.url.params.get("fileId")
        raw = next(
            (item for item in version.get("files", []) if file_id is None or str(item["id"]) == file_id),
            None,
        )
        if raw is None:
            return httpx.Response(404, json={"error": "File not found"})
        content = self._files[str(raw["id"])].content()
        return self._stream(corrupted(content) if self._take_corrupt_download() else content)

    def _take_corrupt_download(self) -> bool:
        """Whether this download is one of the first NetworkOptions.corrupt_downloads (counted down)."""
        with self._corrupt_lock:
            if self._corrupt_left <= 0:
                return False
            self._corrupt_left -= 1
            return True

    def _hugging_face_download(self, request: httpx.Request) -> httpx.Response:
        return self._stream(file_content(request.url.path, self.options.download_chunks * CHUNK_SIZE))
