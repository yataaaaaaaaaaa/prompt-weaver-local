"""/api/characters (app/routers/characters.py) over the real CharacterStore on the temp data dir."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.schemas import REFERENCE_DEFAULTS, CharacterCollection
from app.settings import AppPaths
from support import FakeHttp, OutputFactory

IMAGE_URL = "https://images.example/7/original.png"
UNKNOWN_CHARACTER = "chr-000000000000"
UNKNOWN_IMAGE = "img-000000000000"


def png_bytes(size: tuple[int, int] = (24, 16)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (1, 2, 3)).save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture()
def picture(tmp_path: Path) -> Path:
    path = tmp_path / "picture.png"
    path.write_bytes(png_bytes())
    return path


def file_source(path: Path) -> dict[str, str]:
    return {"kind": "file", "path": str(path)}


def create(client: TestClient, **body: Any) -> dict[str, Any]:
    response = client.post("/api/characters", json={"name": "Aria", **body})
    assert response.status_code == 200, response.text
    return response.json()


def test_list_is_empty_without_characters(client: TestClient) -> None:
    response = client.get("/api/characters")

    assert response.status_code == 200
    assert response.json() == {"items": [], "active_id": None}


def test_create_then_list_get_image_and_update(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000001")

    created = create(
        client,
        identity_tags=["1girl", " red eyes "],
        loras=[{"id": "aria-lora", "weight": 0.7}],
        seed=5,
        seed_locked=True,
        reference_sources=[{"kind": "output", "output_id": "0000000001"}],
    )

    assert created["identity_tags"] == ["1girl", "red eyes"]
    assert created["loras"] == [{"id": "aria-lora", "weight": 0.7}]
    assert (created["reference_strength"], created["reference_focus"]) == (
        REFERENCE_DEFAULTS.strength,
        REFERENCE_DEFAULTS.focus,
    )
    (reference,) = created["reference_images"]
    assert reference["source"] == {"kind": "output", "output_id": "0000000001"}
    assert created["thumbnail"]["source"] == {"kind": "character_image", "image_id": reference["id"]}
    assert client.get("/api/characters").json() == {"items": [created], "active_id": None}

    image = client.get(f"/api/characters/{created['id']}/images/{reference['id']}")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(image.content)) as decoded:
        assert decoded.size == (reference["width"], reference["height"])
    thumbnail = client.get(f"/api/characters/{created['id']}/images/{created['thumbnail']['id']}")
    assert (thumbnail.status_code, thumbnail.headers["content-type"]) == (200, "image/png")

    updated = client.put(f"/api/characters/{created['id']}", json={"name": "Aria v2", "outfit_tags": ["coat"]})
    assert updated.status_code == 200
    body = updated.json()
    assert (body["name"], body["outfit_tags"], body["identity_tags"], body["seed"]) == ("Aria v2", ["coat"], [], None)
    assert body["reference_images"] == created["reference_images"]
    assert body["created_at"] == created["created_at"]


def test_create_errors(client: TestClient, fake_http: FakeHttp, tmp_path: Path, app_paths: AppPaths) -> None:
    text = tmp_path / "notes.png"
    text.write_text("not an image", encoding="utf-8")
    fake_http.add("GET", IMAGE_URL, status=503)
    cases = [
        ({"kind": "output", "output_id": "0000000042"}, 404),
        (file_source(tmp_path / "missing.png"), 404),
        (file_source(text), 422),
        ({"kind": "character_image", "image_id": UNKNOWN_IMAGE}, 422),
        ({"kind": "url", "url": f"{IMAGE_URL}?token=secret"}, 502),
    ]
    for source, status in cases:
        response = client.post("/api/characters", json={"name": "Aria", "reference_sources": [source]})
        assert response.status_code == status, (source, response.text)
        assert "secret" not in response.text

    # Request validation (schema): seed lock without a seed, too many sources, blank name, bad source.
    invalid_bodies = [
        {"name": "Aria", "seed_locked": True},
        {"name": "Aria", "reference_sources": [file_source(text)] * (REFERENCE_DEFAULTS.max_images + 1)},
        {"name": "  "},
        {"name": "Aria", "reference_strength": 1.5},
        {"name": "Aria", "reference_sources": [{"kind": "url", "url": "ftp://example/x.png"}]},
    ]
    for body in invalid_bodies:
        assert client.post("/api/characters", json=body).status_code == 422, body

    assert client.get("/api/characters").json()["items"] == []
    assert not app_paths.character_images_dir.exists()


def test_set_active(client: TestClient) -> None:
    aria = create(client)

    response = client.put("/api/characters/active", json={"id": aria["id"]})
    assert response.status_code == 200
    assert response.json() == {"items": [aria], "active_id": aria["id"]}
    assert client.get("/api/characters").json()["active_id"] == aria["id"]

    assert client.put("/api/characters/active", json={"id": UNKNOWN_CHARACTER}).status_code == 404
    assert client.put("/api/characters/active", json={"id": None}).json()["active_id"] is None
    assert client.put("/api/characters/active", json={}).status_code == 422


def test_update_and_delete_errors(client: TestClient) -> None:
    aria = create(client)
    client.put("/api/characters/active", json={"id": aria["id"]}).raise_for_status()

    assert client.put(f"/api/characters/{UNKNOWN_CHARACTER}", json={"name": "x"}).status_code == 404
    assert client.put("/api/characters/not-an-id", json={"name": "x"}).status_code == 422
    assert client.put(f"/api/characters/{aria['id']}", json={"name": ""}).status_code == 422

    assert client.delete(f"/api/characters/{aria['id']}").json() == {"ok": True}
    assert client.get("/api/characters").json() == {"items": [], "active_id": None}
    assert client.delete(f"/api/characters/{aria['id']}").status_code == 404
    assert client.delete("/api/characters/not-an-id").status_code == 422


def test_reference_image_routes(
    client: TestClient, picture: Path, fake_http: FakeHttp, app_paths: AppPaths
) -> None:
    fake_http.add("GET", IMAGE_URL, content=png_bytes((30, 20)))
    aria = create(client)
    route = f"/api/characters/{aria['id']}/reference-images"

    added = client.post(route, json={"source": {"kind": "url", "url": IMAGE_URL}})
    assert added.status_code == 200
    (reference,) = added.json()["reference_images"]
    assert (reference["width"], reference["height"]) == (30, 20)
    assert added.json()["thumbnail"]["source"] == {"kind": "character_image", "image_id": reference["id"]}
    for _ in range(REFERENCE_DEFAULTS.max_images - 1):
        client.post(route, json={"source": file_source(picture)}).raise_for_status()

    assert client.post(route, json={"source": file_source(picture)}).status_code == 409
    assert client.post(route, json={"source": {"kind": "file", "path": ""}}).status_code == 422
    other = create(client, name="Other")
    other_route = f"/api/characters/{other['id']}/reference-images"
    assert client.post(other_route, json={"source": file_source(picture.with_name("missing.png"))}).status_code == 404
    assert client.post(other_route, json={"source": {"kind": "output", "output_id": "0000000001"}}).status_code == 404
    assert (
        client.post(f"/api/characters/{UNKNOWN_CHARACTER}/reference-images", json={"source": file_source(picture)})
    ).status_code == 404

    removed = client.delete(f"{route}/{reference['id']}")
    assert removed.status_code == 200
    assert reference["id"] not in [image["id"] for image in removed.json()["reference_images"]]
    assert not (app_paths.character_images_dir / f"{reference['id']}.png").exists()
    assert client.delete(f"{route}/{reference['id']}").status_code == 404
    assert client.delete(f"{route}/not-an-image-id").status_code == 422
    assert client.get(f"/api/characters/{aria['id']}/images/{reference['id']}").status_code == 404


def test_thumbnail_routes(client: TestClient, picture: Path) -> None:
    aria = create(client, reference_sources=[file_source(picture)])
    route = f"/api/characters/{aria['id']}/thumbnail"
    reference_id = aria["reference_images"][0]["id"]

    replaced = client.put(route, json={"source": {"kind": "character_image", "image_id": reference_id}})
    assert replaced.status_code == 200
    thumbnail = replaced.json()["thumbnail"]
    assert thumbnail["id"] != aria["thumbnail"]["id"]
    assert client.get(f"/api/characters/{aria['id']}/images/{thumbnail['id']}").status_code == 200
    assert client.get(f"/api/characters/{aria['id']}/images/{aria['thumbnail']['id']}").status_code == 404
    assert client.put(route, json={"source": {"kind": "character_image", "image_id": UNKNOWN_IMAGE}}).status_code == 404
    assert client.put(route, json={"source": {"kind": "nope"}}).status_code == 422

    cleared = client.delete(route)
    assert cleared.status_code == 200
    assert cleared.json()["thumbnail"] is None
    assert client.delete(f"/api/characters/{UNKNOWN_CHARACTER}/thumbnail").status_code == 404
    assert client.put(f"/api/characters/{UNKNOWN_CHARACTER}/thumbnail", json={"source": file_source(picture)}).status_code == 404


def test_image_route_errors(client: TestClient) -> None:
    aria = create(client)

    assert client.get(f"/api/characters/{aria['id']}/images/{UNKNOWN_IMAGE}").status_code == 404
    assert client.get(f"/api/characters/{UNKNOWN_CHARACTER}/images/{UNKNOWN_IMAGE}").status_code == 404
    assert client.get(f"/api/characters/{aria['id']}/images/x").status_code == 422


def test_an_unreadable_characters_file_is_503_and_left_untouched(
    client: TestClient, app_paths: AppPaths, picture: Path
) -> None:
    app_paths.characters_dir.mkdir(parents=True)
    content = b'{"version": 99, "items": []}'
    app_paths.characters_file.write_bytes(content)
    some = f"/api/characters/{UNKNOWN_CHARACTER}"
    requests = [
        ("GET", "/api/characters", None),
        ("POST", "/api/characters", {"name": "Aria", "reference_sources": [file_source(picture)]}),
        ("PUT", "/api/characters/active", {"id": None}),
        ("PUT", some, {"name": "x"}),
        ("DELETE", some, None),
        ("POST", f"{some}/reference-images", {"source": file_source(picture)}),
        ("DELETE", f"{some}/reference-images/{UNKNOWN_IMAGE}", None),
        ("PUT", f"{some}/thumbnail", {"source": file_source(picture)}),
        ("DELETE", f"{some}/thumbnail", None),
        ("GET", f"{some}/images/{UNKNOWN_IMAGE}", None),
    ]

    for method, url, body in requests:
        response = client.request(method, url, json=body)
        assert response.status_code == 503, (method, url, response.text)
        assert "characters.json" in response.json()["detail"]

    assert app_paths.characters_file.read_bytes() == content
    assert sorted(path.name for path in app_paths.characters_dir.iterdir()) == ["characters.json"]


def test_responses_match_the_collection_schema(client: TestClient) -> None:
    create(client, name="Aria")
    create(client, name="Bob")

    collection = CharacterCollection.model_validate(client.get("/api/characters").json())

    assert [character.name for character in collection.items] == ["Aria", "Bob"]
