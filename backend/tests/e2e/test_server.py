"""The e2e backend (server.py) behaves like the real app on synthetic data: seeded fixtures, a paced fake generator
that writes real pictures, the synthetic Civitai (search, versions, downloads with progress, stalls and cancel), the
remote passthrough used by the browser, and resets that start from scratch."""

from __future__ import annotations

import io
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from support import wait_until

from .seed import DATA_TEMPLATE_DIR, minimal_safetensors
from .server import E2EBackend

FIXTURE_STORES = {
    "categorie-store",
    "forbidden-associations-store",
    "library-store",
    "settings-store",
    "current-image-store",
    "workspace-store",
}


@pytest.fixture()
def backend(tmp_path: Path) -> Iterator[TestClient]:
    with TestClient(E2EBackend(tmp_path / "session")) as client:
        yield client


def reset(client: TestClient, **options: Any) -> dict[str, Any]:
    response = client.post("/__e2e__/reset", json=options)
    assert response.status_code == 200, response.text
    return response.json()


def store_state(client: TestClient, name: str) -> Any:
    return client.get(f"/api/stores/{name}").json()["envelope"]["state"]


def library_state(client: TestClient) -> dict[str, Any]:
    return store_state(client, "library-store")


def generate_request(client: TestClient) -> dict[str, Any]:
    library = library_state(client)
    model = next(entry for entry in library["models"] if entry["id"] == library["selectedModelId"])
    return {"model": model, "prompt": "1girl, silver hair, red dress", "width": 832, "height": 1216, "steps": 4, "seed": 99}


def test_startup_seeds_the_synthetic_fixture_data(backend: TestClient) -> None:
    state = backend.get("/__e2e__/state").json()
    data_dir = Path(state["data_dir"])
    assert state["resets"] == 1 and state["unexpected_requests"] == []
    assert data_dir.is_dir() and "storage" not in data_dir.parts

    bootstrap = backend.get("/api/bootstrap").json()
    assert FIXTURE_STORES <= set(bootstrap["persisted_stores"])
    assert backend.get("/api/outputs").json()["ids"] == [f"000000000{index}" for index in range(1, 5)]

    image = Image.open(io.BytesIO(backend.get("/api/outputs/0000000004/image").content))
    assert image.size[0] / image.size[1] == pytest.approx(832 / 1216, rel=0.02)
    assert len(set(image.convert("RGB").get_flattened_data())) > 50  # a real picture, not a flat color

    library = library_state(backend)
    paths = [Path(entry["path"]) for entry in [*library["models"], *library["loras"]]]
    assert all(path.is_file() and Path(state["models_root"]) in path.parents for path in paths)
    assert "{{" not in json.dumps(library)

    characters = backend.get("/api/characters").json()
    assert [item["name"] for item in characters["items"]] == ["Mira", "Bram the knight", "Nova"]
    mira = characters["items"][0]
    thumbnail = backend.get(f"/api/characters/{mira['id']}/images/{mira['thumbnail']['id']}")
    assert thumbnail.status_code == 200 and thumbnail.headers["content-type"] == "image/png"


def test_the_selected_model_is_a_real_sdxl_checkpoint_header(backend: TestClient) -> None:
    library = library_state(backend)
    model = next(entry for entry in library["models"] if entry["id"] == library["selectedModelId"])
    assert Path(model["path"]).read_bytes() == minimal_safetensors("sdxl")
    support = backend.get("/api/ip-adapters", params={"model_path": model["path"]}).json()
    assert support["architecture"] == "sdxl"


def test_generate_paints_a_picture_with_one_progress_event_per_step(backend: TestClient) -> None:
    reset(backend, generator={"step_delay_ms": 0})
    response = backend.post("/api/generate", json=generate_request(backend))
    assert response.status_code == 200, response.text
    record = response.json()
    assert record["output_id"] == "0000000005" and record["seed"] == 99

    image = Image.open(io.BytesIO(backend.get("/api/outputs/0000000005/image").content))
    assert len(set(image.convert("RGB").get_flattened_data())) > 50
    events = backend.get("/api/tasks").json()["events"]
    generation = next(event for event in events if event["type"] == "generation")
    assert (generation["stage"], generation["current"], generation["total"]) == ("complete", 4, 4)
    assert backend.get("/__e2e__/state").json()["generations"] == 1


def test_the_generator_can_fail_on_purpose(backend: TestClient) -> None:
    reset(backend, generator={"step_delay_ms": 0, "fail_message": "Synthetic failure"})
    response = backend.post("/api/generate", json=generate_request(backend))
    assert response.status_code == 409
    assert "Synthetic failure" in response.text


def test_reset_starts_from_scratch_with_files_and_removals(backend: TestClient) -> None:
    reset(backend, generator={"step_delay_ms": 0})
    assert backend.post("/api/generate", json=generate_request(backend)).status_code == 200
    first = Path(backend.get("/__e2e__/state").json()["data_dir"])

    state = reset(
        backend,
        remove=["output"],
        files={"stores/current-image-store/state.json": {"state": {"currentId": None}, "version": 1}},
    )
    assert state["resets"] == 3 and state["generations"] == 0
    assert backend.get("/api/outputs").json()["ids"] == []
    assert store_state(backend, "current-image-store") == {"currentId": None}
    wait_until(lambda: not first.exists())


def test_reset_removes_generated_pictures_too(backend: TestClient) -> None:
    state = reset(backend, remove=["output/0000000004.png"])
    data_dir = Path(state["data_dir"])
    assert (data_dir / "output" / "0000000004.json").is_file()
    assert not (data_dir / "output" / "0000000004.png").exists()
    assert (data_dir / "output" / "0000000003.png").is_file()


def test_reset_rejects_unknown_options_and_paths_outside_the_data_dir(backend: TestClient) -> None:
    assert backend.post("/__e2e__/reset", json={"generator": {"typo": 1}}).status_code == 422
    with pytest.raises(ValueError):
        backend.post("/__e2e__/reset", json={"files": {"../escape.json": {}}})


def test_the_remote_passthrough_serves_synthetic_images_and_reports_unknown_urls(backend: TestClient) -> None:
    image = backend.get("/__e2e__/remote", params={"url": "https://image.civitai.com/e2e/950001/width=450/950001.jpeg"})
    assert image.status_code == 200 and image.headers["content-type"] == "image/jpeg"
    assert Image.open(io.BytesIO(image.content)).size == (350, 512)

    unknown = backend.get("/__e2e__/remote", params={"url": "https://example.com/tracker.js"})
    assert unknown.status_code == 599
    assert backend.get("/__e2e__/state").json()["unexpected_requests"] == ["GET https://example.com/tracker.js"]


def test_the_fixture_data_is_synthetic() -> None:
    """Never a copy of the user's storage: no absolute path of this machine in the committed fixtures."""
    for file in DATA_TEMPLATE_DIR.rglob("*.json"):
        text = file.read_text(encoding="utf-8")
        assert "D:\\\\Anything" not in text and "D:/Anything" not in text, file
        assert "storage" not in text.lower(), file
