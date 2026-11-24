"""GET /api/ip-adapters and POST /api/ip-adapters/{variant_id}/install (app/routers/ip_adapters.py).

The real catalog is checked with empty model folders (its files are GBs: never written here) and the real model
family detector on header-only safetensors files; installs that complete use the tiny catalog of
test_ip_adapters.py, with FakeDownloadManager or the app's real DownloadManager over FakeHttp."""

from __future__ import annotations

import json
import struct
import threading
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.services.container import FILE_HASH_CACHE_NAME
from app.services.file_hashes import FileHashCache
from app.services.ip_adapters import (
    HF_REPO,
    HF_REVISION,
    IP_ADAPTER_CATALOG,
    UNSUPPORTED_MODEL_REASON,
    IpAdapterService,
)
from app.services.local_models import LocalModelFiles
from app.settings import AppPaths
from support import (
    FakeDownloadManager,
    FakeHttp,
    put_file,
    wait_until,
    ENCODER_CONTENT,
    FACE_CONTENT,
    GENERAL_CONTENT,
    SDXL_MODEL,
    TINY_CATALOG,
    TINY_ENCODER,
    TINY_FACE,
    TINY_GENERAL,
    fake_architecture_of,
    tiny_service,
)


def checkpoint_header(path: Path, *keys: str) -> Path:
    """A safetensors file holding only a header with `keys` (what pipeline_architecture reads)."""
    header = json.dumps({key: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]} for key in keys}).encode()
    return put_file(path, struct.pack("<Q", len(header)) + header + b"\x00\x00")


def variant(body: dict, variant_id: str) -> dict:
    return next(item for item in body["variants"] if item["id"] == variant_id)


# ---------------------------------------------------------------------------
# Real catalog, empty folders
# ---------------------------------------------------------------------------


def test_status_without_a_model(client: TestClient, app_paths: AppPaths) -> None:
    response = client.get("/api/ip-adapters")

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body["variants"]] == ["sd15-face", "sd15-general", "sdxl-face", "sdxl-general"]
    assert variant(body, "sdxl-face") == {
        "id": "sdxl-face",
        "label": "SDXL face (IP-Adapter Plus Face ViT-H)",
        "architecture": "sdxl",
        "focus": "face",
        "files": [
            {
                "id": "ip-adapter-plus-face-sdxl-vit-h",
                "role": "adapter",
                "name": "ip-adapter-plus-face_sdxl_vit-h.safetensors",
                "size_bytes": 847517512,
                "local_path": None,
                "task_id": None,
            },
            {
                "id": "image-encoder-vit-h",
                "role": "image_encoder",
                "name": "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
                "size_bytes": 2528373448,
                "local_path": None,
                "task_id": None,
            },
        ],
        "ready": False,
    }
    assert body["folders"] == {"adapter": str(app_paths.ip_adapter_dir), "image_encoder": str(app_paths.image_encoder_dir)}
    assert body["architecture"] is None
    assert body["support"] == []


def test_status_of_an_sdxl_model(client: TestClient, app_paths: AppPaths) -> None:
    model = checkpoint_header(
        app_paths.model_dir("checkpoint") / "illustrious.safetensors", "conditioner.embedders.1.model.ln_final.weight"
    )

    response = client.get("/api/ip-adapters", params={"model_path": str(model)})

    assert response.status_code == 200
    body = response.json()
    assert body["architecture"] == "sdxl"
    assert body["support"] == [
        {
            "focus": "face",
            "variant_id": "sdxl-face",
            "ready": False,
            "reason": "Download the IP-Adapter 'SDXL face (IP-Adapter Plus Face ViT-H)' to use reference images.",
        },
        {
            "focus": "general",
            "variant_id": "sdxl-general",
            "ready": False,
            "reason": "Download the IP-Adapter 'SDXL general (IP-Adapter Plus ViT-H)' to use reference images.",
        },
    ]


def test_status_of_an_sd15_model_and_of_an_unknown_model(client: TestClient, app_paths: AppPaths) -> None:
    sd15 = checkpoint_header(
        app_paths.model_dir("checkpoint") / "v1-5.safetensors", "cond_stage_model.transformer.text_model.x"
    )
    body = client.get("/api/ip-adapters", params={"model_path": str(sd15)}).json()
    assert body["architecture"] == "sd15"
    assert [support["variant_id"] for support in body["support"]] == ["sd15-face", "sd15-general"]

    missing = app_paths.model_dir("checkpoint") / "missing.safetensors"
    body = client.get("/api/ip-adapters", params={"model_path": str(missing)}).json()
    assert body["architecture"] is None
    assert body["support"] == [
        {"focus": "face", "variant_id": None, "ready": False, "reason": UNSUPPORTED_MODEL_REASON},
        {"focus": "general", "variant_id": None, "ready": False, "reason": UNSUPPORTED_MODEL_REASON},
    ]
    assert str(missing) not in json.dumps(body["support"])


def test_install_of_the_real_catalog_downloads_from_the_pinned_revision(
    app: FastAPI, client: TestClient, app_paths: AppPaths
) -> None:
    downloads = FakeDownloadManager()
    local_files = LocalModelFiles(paths=app_paths, hashes=FileHashCache(app_paths.cache_dir / FILE_HASH_CACHE_NAME))
    app.state.services.ip_adapters = IpAdapterService(
        paths=app_paths, local_files=local_files, downloads=downloads  # type: ignore[arg-type]
    )

    response = client.post("/api/ip-adapters/sdxl-face/install")

    assert response.status_code == 200
    assert response.json() == {"state": "downloading", "task_ids": ["download-1", "download-2"]}
    base = f"https://huggingface.co/{HF_REPO}/resolve/{HF_REVISION}"
    assert [(spec.url, spec.dest, spec.expected_size) for spec, _ in downloads.started] == [
        (
            f"{base}/sdxl_models/ip-adapter-plus-face_sdxl_vit-h.safetensors",
            app_paths.ip_adapter_dir / "ip-adapter-plus-face_sdxl_vit-h.safetensors",
            847517512,
        ),
        (
            f"{base}/models/image_encoder/model.safetensors",
            app_paths.image_encoder_dir / "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
            2528373448,
        ),
    ]
    sdxl_face = IP_ADAPTER_CATALOG.variant("sdxl-face")
    assert sdxl_face is not None
    assert [spec.expected_sha256 for spec, _ in downloads.started] == [file.sha256 for file in sdxl_face.files]
    files = variant(client.get("/api/ip-adapters").json(), "sdxl-general")["files"]
    assert [file["task_id"] for file in files] == [None, "download-2"]


def test_install_an_unknown_variant(client: TestClient) -> None:
    response = client.post("/api/ip-adapters/sdxl-vit-g/install")

    assert response.status_code == 404
    assert response.json() == {"detail": "Unknown IP-Adapter variant 'sdxl-vit-g'."}


# ---------------------------------------------------------------------------
# Tiny catalog
# ---------------------------------------------------------------------------


@pytest.fixture()
def fake_downloads(app: FastAPI, app_paths: AppPaths) -> FakeDownloadManager:
    """Swaps the app's IP-Adapter service for one over the tiny catalog + FakeDownloadManager (real local files)."""
    downloads = FakeDownloadManager()
    app.state.services.ip_adapters = tiny_service(app_paths, downloads)
    return downloads


def test_install_downloads_then_installs(client: TestClient, fake_downloads: FakeDownloadManager) -> None:
    response = client.post("/api/ip-adapters/sdxl-face/install")
    assert response.status_code == 200
    assert response.json() == {"state": "downloading", "task_ids": ["download-1", "download-2"]}

    body = client.get("/api/ip-adapters", params={"model_path": SDXL_MODEL}).json()
    assert body["support"][0]["reason"] == "The IP-Adapter 'SDXL face' is downloading."

    face = fake_downloads.finish(0, FACE_CONTENT)
    encoder = fake_downloads.finish(1, ENCODER_CONTENT)

    response = client.post("/api/ip-adapters/sdxl-face/install")
    assert response.status_code == 200
    assert response.json() == {"state": "installed", "task_ids": []}
    body = client.get("/api/ip-adapters", params={"model_path": SDXL_MODEL}).json()
    assert [file["local_path"] for file in variant(body, "sdxl-face")["files"]] == [str(face), str(encoder)]
    assert body["support"][0] == {"focus": "face", "variant_id": "sdxl-face", "ready": True, "reason": None}

    # The general variant only needs its adapter: the encoder is shared.
    response = client.post("/api/ip-adapters/sdxl-general/install")
    assert response.json() == {"state": "downloading", "task_ids": ["download-3"]}


def test_install_through_the_download_manager(
    app: FastAPI, client: TestClient, app_paths: AppPaths, fake_http: FakeHttp
) -> None:
    """End to end with the app's DownloadManager: files land in the IP-Adapter folders, verified, without
    credentials, and the shared encoder is downloaded once for both variants."""
    local_files = LocalModelFiles(paths=app_paths, hashes=FileHashCache(app_paths.cache_dir / FILE_HASH_CACHE_NAME))
    app.state.services.ip_adapters = IpAdapterService(
        paths=app_paths,
        local_files=local_files,
        downloads=app.state.services.downloads,
        catalog=TINY_CATALOG,
        architecture_of=fake_architecture_of,
    )
    fake_http.add("GET", TINY_FACE.url, content=FACE_CONTENT)
    fake_http.add("GET", TINY_GENERAL.url, content=GENERAL_CONTENT)
    # The encoder download stays running until both variants asked for it.
    release_encoder = threading.Event()

    def encoder(request: httpx.Request) -> httpx.Response:
        assert release_encoder.wait(5)
        return httpx.Response(200, content=ENCODER_CONTENT)

    fake_http.add("GET", TINY_ENCODER.url, handler=encoder)

    face_tasks = client.post("/api/ip-adapters/sdxl-face/install").json()
    general_tasks = client.post("/api/ip-adapters/sdxl-general/install").json()
    release_encoder.set()
    assert face_tasks["state"] == general_tasks["state"] == "downloading"
    assert len(face_tasks["task_ids"]) == len(general_tasks["task_ids"]) == 2
    assert face_tasks["task_ids"][1] == general_tasks["task_ids"][1]  # the shared encoder

    def all_ready() -> bool:
        body = client.get("/api/ip-adapters", params={"model_path": SDXL_MODEL}).json()
        return all(support["ready"] for support in body["support"])

    wait_until(all_ready)

    assert (app_paths.ip_adapter_dir / TINY_FACE.name).read_bytes() == FACE_CONTENT
    assert (app_paths.ip_adapter_dir / TINY_GENERAL.name).read_bytes() == GENERAL_CONTENT
    assert (app_paths.image_encoder_dir / TINY_ENCODER.name).read_bytes() == ENCODER_CONTENT
    assert len(fake_http.requests_to(TINY_ENCODER.url)) == 1
    assert all("authorization" not in request.headers for request in fake_http.requests)
    body = client.get("/api/ip-adapters").json()
    assert all(file["task_id"] is None for item in body["variants"] for file in item["files"])
    assert client.post("/api/ip-adapters/sdxl-general/install").json() == {"state": "installed", "task_ids": []}
