"""/api/stories (app/routers/stories.py) over the real StoryStore on the temp data dir, and generation for a story
scene (GenerateRequest.story -> OutputRecord.story + the scene's chosen variant)."""

from __future__ import annotations

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.schemas import OutputRecord
from app.settings import AppPaths
from support import GENERATE_REQUEST, LEGACY_METADATA_KEYS, FakeGenerator, OutputFactory, load_fixture

UNKNOWN_STORY = "sty-000000000000"
UNKNOWN_SCENE = "scn-000000000000"
CHARACTER = "chr-1a2b3c4d5e6f"


def create_story(client: TestClient, **body: Any) -> dict[str, Any]:
    response = client.post("/api/stories", json={"title": "The lighthouse", **body})
    assert response.status_code == 200, response.text
    return response.json()


def add_scene(client: TestClient, story_id: str, **body: Any) -> dict[str, Any]:
    response = client.post(f"/api/stories/{story_id}/scenes", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_stories_crud(client: TestClient) -> None:
    assert client.get("/api/stories").json() == {"items": []}

    story = create_story(client, character_ids=[CHARACTER])
    assert (story["title"], story["character_ids"], story["scenes"]) == ("The lighthouse", [CHARACTER], [])
    assert client.get("/api/stories").json() == {"items": [story]}
    assert client.get(f"/api/stories/{story['id']}").json() == story

    renamed = client.patch(f"/api/stories/{story['id']}", json={"title": "The keeper"})
    assert renamed.status_code == 200
    assert (renamed.json()["title"], renamed.json()["character_ids"]) == ("The keeper", [CHARACTER])

    assert client.delete(f"/api/stories/{story['id']}").json() == {"ok": True}
    assert client.get("/api/stories").json() == {"items": []}


def test_scene_endpoints(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000001")
    make_output("0000000002")
    story = create_story(client)
    story_id = story["id"]

    with_one = add_scene(client, story_id, text="Once upon a time", extra_tags=["dawn"])
    (first,) = with_one["scenes"]
    assert (first["title"], first["text"], first["extra_tags"], first["character_ids"]) == (
        "Scene 1",
        "Once upon a time",
        ["dawn"],
        None,
    )
    with_two = add_scene(client, story_id, title="Prologue", index=0, output_id="0000000001")
    prologue = with_two["scenes"][0]
    assert (prologue["title"], prologue["chosen_output_id"]) == ("Prologue", "0000000001")
    assert [variant["output_id"] for variant in prologue["variants"]] == ["0000000001"]

    patched = client.patch(
        f"/api/stories/{story_id}/scenes/{first['id']}",
        json={"title": "Arrival", "locks": [{"category_name": "Mood", "prompt_text": "calm"}], "character_ids": [], "seed": 5},
    ).json()
    arrival = patched["scenes"][1]
    assert (arrival["title"], arrival["text"], arrival["locks"], arrival["character_ids"], arrival["seed"]) == (
        "Arrival",
        "Once upon a time",
        [{"category_name": "Mood", "prompt_text": "calm"}],
        [],
        5,
    )

    duplicated = client.post(f"/api/stories/{story_id}/scenes/{arrival['id']}/duplicate").json()
    assert [scene["title"] for scene in duplicated["scenes"]] == ["Prologue", "Arrival", "Arrival (copy)"]
    copy_id = duplicated["scenes"][2]["id"]

    order = [copy_id, prologue["id"], arrival["id"]]
    reordered = client.put(f"/api/stories/{story_id}/scene-order", json={"scene_ids": order}).json()
    assert [scene["id"] for scene in reordered["scenes"]] == order

    variant = client.post(f"/api/stories/{story_id}/scenes/{arrival['id']}/variants", json={"output_id": "0000000002"}).json()
    assert variant["scenes"][2]["chosen_output_id"] == "0000000002"
    client.post(f"/api/stories/{story_id}/scenes/{arrival['id']}/variants", json={"output_id": "0000000001"})
    chosen = client.put(f"/api/stories/{story_id}/scenes/{arrival['id']}/chosen", json={"output_id": "0000000002"}).json()
    assert chosen["scenes"][2]["chosen_output_id"] == "0000000002"
    removed = client.delete(f"/api/stories/{story_id}/scenes/{arrival['id']}/variants/0000000002").json()
    assert (removed["scenes"][2]["chosen_output_id"], len(removed["scenes"][2]["variants"])) == ("0000000001", 1)

    deleted = client.delete(f"/api/stories/{story_id}/scenes/{copy_id}").json()
    assert [scene["id"] for scene in deleted["scenes"]] == [prologue["id"], arrival["id"]]
    assert client.get(f"/api/stories/{story_id}").json() == deleted


def test_errors(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000001")
    story = create_story(client)
    story_id = story["id"]
    scene_id = add_scene(client, story_id)["scenes"][0]["id"]

    not_found = [
        client.get(f"/api/stories/{UNKNOWN_STORY}"),
        client.patch(f"/api/stories/{UNKNOWN_STORY}", json={"title": "x"}),
        client.delete(f"/api/stories/{UNKNOWN_STORY}"),
        client.get(f"/api/stories/{UNKNOWN_STORY}/export"),
        client.post(f"/api/stories/{UNKNOWN_STORY}/scenes", json={}),
        client.patch(f"/api/stories/{story_id}/scenes/{UNKNOWN_SCENE}", json={"text": "x"}),
        client.delete(f"/api/stories/{story_id}/scenes/{UNKNOWN_SCENE}"),
        client.post(f"/api/stories/{story_id}/scenes/{UNKNOWN_SCENE}/duplicate"),
        client.post(f"/api/stories/{story_id}/scenes", json={"output_id": "0000000042"}),
        client.post(f"/api/stories/{story_id}/scenes/{scene_id}/variants", json={"output_id": "0000000042"}),
        client.put(f"/api/stories/{story_id}/scenes/{scene_id}/chosen", json={"output_id": "0000000001"}),
        client.delete(f"/api/stories/{story_id}/scenes/{scene_id}/variants/0000000001"),
    ]
    assert [response.status_code for response in not_found] == [404] * len(not_found)
    assert "Unknown story" in not_found[0].json()["detail"]

    invalid = [
        client.post("/api/stories", json={"title": "  "}),
        client.post("/api/stories", json={"title": "x", "character_ids": ["mira"]}),
        client.patch(f"/api/stories/{story_id}", json={"title": None}),
        client.patch(f"/api/stories/{story_id}/scenes/{scene_id}", json={"text": None}),
        client.patch(f"/api/stories/{story_id}/scenes/{scene_id}", json={"seed": -3}),
        client.put(f"/api/stories/{story_id}/scene-order", json={"scene_ids": []}),
        client.get("/api/stories/not-a-story"),
        client.patch(f"/api/stories/{story_id}/scenes/not-a-scene", json={}),
    ]
    assert [response.status_code for response in invalid] == [422] * len(invalid)
    assert client.get(f"/api/stories/{story_id}").json()["scenes"][0]["text"] == ""


def test_an_unreadable_stories_file_answers_503_and_is_kept(client: TestClient, app_paths: AppPaths) -> None:
    app_paths.stories_dir.mkdir(parents=True)
    app_paths.stories_file.write_text('{"version": 9, "items": []}', encoding="utf-8")

    assert client.get("/api/stories").status_code == 503
    assert client.post("/api/stories", json={"title": "x"}).status_code == 503
    assert app_paths.stories_file.read_text(encoding="utf-8") == '{"version": 9, "items": []}'


def test_export_answers_a_self_contained_html_document(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000001")
    story = create_story(client, title="Night & day")
    add_scene(client, story["id"], title="Arrival", text="The keeper waits.", output_id="0000000001")

    response = client.get(f"/api/stories/{story['id']}/export")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert "<h1>Night &amp; day</h1>" in response.text
    assert "The keeper waits." in response.text
    assert response.text.count("data:image/jpeg;base64,") == 1


# ---------------------------------------------------------------------------
# Generation for a scene
# ---------------------------------------------------------------------------


def metadata_on_disk(paths: AppPaths, output_id: str) -> dict[str, Any]:
    return json.loads((paths.output_dir / f"{output_id}.json").read_text(encoding="utf-8"))


def test_generating_for_a_scene_records_the_link_and_chooses_the_new_variant(
    client: TestClient, app_paths: AppPaths, fake_generator: FakeGenerator
) -> None:
    story = create_story(client, title="The lighthouse")
    scene = add_scene(client, story["id"], title="Storm")["scenes"][0]
    link = {"story_id": story["id"], "scene_id": scene["id"]}

    first = client.post("/api/generate", json={**GENERATE_REQUEST, "story": link})
    second = client.post("/api/generate", json={**GENERATE_REQUEST, "story": link})

    assert first.status_code == 200, first.text
    expected = {**link, "story_title": "The lighthouse", "scene_title": "Storm"}
    assert first.json()["story"] == expected
    assert fake_generator.calls[-1].request.story is not None
    on_disk = metadata_on_disk(app_paths, first.json()["output_id"])
    assert set(on_disk) == LEGACY_METADATA_KEYS | {"story"}
    assert on_disk["story"] == expected
    illustrated = client.get(f"/api/stories/{story['id']}").json()["scenes"][0]
    assert [variant["output_id"] for variant in illustrated["variants"]] == [first.json()["output_id"], second.json()["output_id"]]
    assert illustrated["chosen_output_id"] == second.json()["output_id"]
    # A normal output: listed and readable like any other.
    assert second.json()["output_id"] in client.get("/api/outputs").json()["ids"]
    assert client.get(f"/api/outputs/{second.json()['output_id']}").json()["story"] == expected


def test_generating_for_an_unknown_scene_fails_before_generating(client: TestClient, fake_generator: FakeGenerator) -> None:
    story = create_story(client)

    for link in ({"story_id": UNKNOWN_STORY, "scene_id": UNKNOWN_SCENE}, {"story_id": story["id"], "scene_id": UNKNOWN_SCENE}):
        response = client.post("/api/generate", json={**GENERATE_REQUEST, "story": link})
        assert response.status_code == 409
        assert "Unknown story" in response.json()["detail"] or "has no scene" in response.json()["detail"]
    assert fake_generator.calls == []
    assert client.get("/api/outputs").json()["ids"] == []


def test_a_scene_deleted_during_its_generation_keeps_the_output(client: TestClient, fake_generator: FakeGenerator) -> None:
    story = create_story(client)
    scene = add_scene(client, story["id"])["scenes"][0]
    fake_generator.on_generate = lambda: client.delete(f"/api/stories/{story['id']}/scenes/{scene['id']}")

    response = client.post("/api/generate", json={**GENERATE_REQUEST, "story": {"story_id": story["id"], "scene_id": scene["id"]}})

    assert response.status_code == 200, response.text
    assert response.json()["output_id"] in client.get("/api/outputs").json()["ids"]
    assert client.get(f"/api/stories/{story['id']}").json()["scenes"] == []


def test_a_generation_without_a_story_keeps_the_legacy_metadata_keys(client: TestClient, app_paths: AppPaths) -> None:
    body = client.post("/api/generate", json=GENERATE_REQUEST).json()

    assert body["story"] is None
    assert set(metadata_on_disk(app_paths, body["output_id"])) == LEGACY_METADATA_KEYS


@pytest.mark.parametrize("fixture", ["outputs/metadata.json", "outputs/metadata_legacy_lora_ids.json", "outputs/metadata_lora_weights.json"])
def test_outputs_written_before_stories_load_without_a_story(fixture: str) -> None:
    payload = load_fixture(fixture)
    assert "story" not in payload

    assert OutputRecord.model_validate(payload).story is None
