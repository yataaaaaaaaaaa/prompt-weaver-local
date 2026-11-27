"""services/stories.py StoryStore on the temp data dir: stories, scenes, the scene order, the variant rules, storage
(lazy load, round trip, unreadable files never overwritten, invalid entries skipped) and the HTML export."""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from app.schemas import LoraWeight, SceneCreateRequest, SceneLock, ScenePatch, StoryCreateRequest, StoryPatch
from app.services.outputs import OutputRepository
from app.services.stories import (
    STORIES_FORMAT_VERSION,
    SceneNotFound,
    SceneOrderError,
    StoriesFileError,
    StoryNotFound,
    StoryOutputNotFound,
    StoryStore,
    VariantNotFound,
)
from app.settings import AppPaths
from support import OutputFactory

UNKNOWN_STORY = "sty-000000000000"
UNKNOWN_SCENE = "scn-000000000000"
CHARACTER = "chr-1a2b3c4d5e6f"


@pytest.fixture()
def store(app_paths: AppPaths) -> StoryStore:
    return StoryStore(paths=app_paths, outputs=OutputRepository(app_paths))


def scene_ids(store: StoryStore, story_id: str) -> list[str]:
    return [scene.id for scene in store.get(story_id).scenes]


def story_with_scenes(store: StoryStore, *titles: str) -> str:
    story = store.create(StoryCreateRequest(title="The lighthouse"))
    for title in titles:
        store.add_scene(story.id, SceneCreateRequest(title=title))
    return story.id


def test_construction_reads_nothing_and_a_missing_file_means_no_stories(store: StoryStore, app_paths: AppPaths) -> None:
    assert store.collection().items == []
    assert not app_paths.stories_dir.exists()


def test_create_update_and_delete_a_story(store: StoryStore, app_paths: AppPaths) -> None:
    created = store.create(StoryCreateRequest(title="  The lighthouse  ", character_ids=[CHARACTER]))

    assert created.id.startswith("sty-") and len(created.id) == 16
    assert (created.title, created.character_ids, created.scenes) == ("The lighthouse", [CHARACTER], [])
    assert created.created_at == created.updated_at
    assert store.collection().items == [created]
    assert app_paths.stories_file.is_file()

    renamed = store.update(created.id, StoryPatch(title="The keeper"))
    assert (renamed.title, renamed.character_ids) == ("The keeper", [CHARACTER])
    assert renamed.updated_at >= created.updated_at
    cast_cleared = store.update(created.id, StoryPatch(character_ids=[]))
    assert (cast_cleared.title, cast_cleared.character_ids) == ("The keeper", [])

    store.delete(created.id)
    assert store.collection().items == []
    with pytest.raises(StoryNotFound):
        store.get(created.id)
    with pytest.raises(StoryNotFound):
        store.delete(created.id)


def test_story_and_scene_requests_are_validated() -> None:
    with pytest.raises(ValidationError):
        StoryCreateRequest(title="   ")
    with pytest.raises(ValidationError):
        StoryCreateRequest(title="Tale", character_ids=["alice"])
    with pytest.raises(ValidationError):
        StoryPatch.model_validate({"title": None})
    with pytest.raises(ValidationError):
        ScenePatch.model_validate({"text": None})
    with pytest.raises(ValidationError):
        ScenePatch.model_validate({"title": ""})
    with pytest.raises(ValidationError):
        ScenePatch.model_validate({"seed": -1})
    with pytest.raises(ValidationError):
        SceneCreateRequest.model_validate({"output_id": "42"})
    # character_ids and seed can be cleared: null = the story's characters / a new seed each time.
    assert ScenePatch.model_validate({"character_ids": None, "seed": None}).model_fields_set == {"character_ids", "seed"}
    assert ScenePatch.model_validate({"extra_tags": [" storm ", "", "night"]}).extra_tags == ["storm", "night"]


def test_scenes_are_added_with_default_titles_at_their_index(store: StoryStore) -> None:
    story = store.create(StoryCreateRequest(title="Tale"))

    first = store.add_scene(story.id, SceneCreateRequest(text="Once upon a time"))
    second = store.add_scene(story.id, SceneCreateRequest())
    front = store.add_scene(story.id, SceneCreateRequest(title="Prologue", index=0))
    past_the_end = store.add_scene(story.id, SceneCreateRequest(index=99))

    assert [scene.title for scene in first.scenes] == ["Scene 1"]
    assert first.scenes[0].text == "Once upon a time"
    assert [scene.title for scene in second.scenes] == ["Scene 1", "Scene 2"]
    assert [scene.title for scene in front.scenes] == ["Prologue", "Scene 1", "Scene 2"]
    assert [scene.title for scene in past_the_end.scenes] == ["Prologue", "Scene 1", "Scene 2", "Scene 4"]
    scene = past_the_end.scenes[-1]
    assert scene.id.startswith("scn-")
    assert (scene.variants, scene.chosen_output_id, scene.character_ids, scene.seed) == ([], None, None, None)
    assert past_the_end.updated_at >= story.updated_at
    with pytest.raises(StoryNotFound):
        store.add_scene(UNKNOWN_STORY, SceneCreateRequest())


def test_a_scene_added_from_an_output_is_illustrated_by_it(store: StoryStore, make_output: OutputFactory) -> None:
    make_output("0000000003")
    story = store.create(StoryCreateRequest(title="Tale"))

    updated = store.add_scene(
        story.id,
        SceneCreateRequest(
            output_id="0000000003",
            seed=51111,
            locks=[SceneLock(category_name="Subject", prompt_text="1girl, silver hair")],
        ),
    )

    (scene,) = updated.scenes
    assert [variant.output_id for variant in scene.variants] == ["0000000003"]
    assert scene.chosen_output_id == "0000000003"
    assert scene.seed == 51111
    assert scene.locks == [SceneLock(category_name="Subject", prompt_text="1girl, silver hair")]
    with pytest.raises(StoryOutputNotFound):
        store.add_scene(story.id, SceneCreateRequest(output_id="0000000042"))
    assert len(store.get(story.id).scenes) == 1


def test_update_scene_changes_only_the_fields_sent(store: StoryStore) -> None:
    story_id = story_with_scenes(store, "Arrival")
    (scene_id,) = scene_ids(store, story_id)
    store.update_scene(story_id, scene_id, ScenePatch(text="The storm came.", seed=7, character_ids=[CHARACTER]))

    updated = store.update_scene(story_id, scene_id, ScenePatch(extra_tags=["night", "storm"], seed=None))

    (scene,) = updated.scenes
    assert (scene.title, scene.text, scene.extra_tags, scene.seed, scene.character_ids) == (
        "Arrival",
        "The storm came.",
        ["night", "storm"],
        None,
        [CHARACTER],
    )
    cleared = store.update_scene(story_id, scene_id, ScenePatch.model_validate({"character_ids": None}))
    assert cleared.scenes[0].character_ids is None
    with pytest.raises(SceneNotFound):
        store.update_scene(story_id, UNKNOWN_SCENE, ScenePatch(text="x"))


def test_duplicate_inserts_a_copy_after_the_original(store: StoryStore, make_output: OutputFactory) -> None:
    make_output("0000000001")
    story_id = story_with_scenes(store, "Arrival", "Storm")
    arrival, storm = scene_ids(store, story_id)
    store.update_scene(story_id, arrival, ScenePatch(text="Hello", extra_tags=["dawn"]))
    store.add_variant(story_id, arrival, "0000000001")

    updated = store.duplicate_scene(story_id, arrival)

    assert [scene.title for scene in updated.scenes] == ["Arrival", "Arrival (copy)", "Storm"]
    original, copy, _ = updated.scenes
    assert copy.id not in (arrival, storm)
    assert (copy.text, copy.extra_tags, copy.chosen_output_id) == ("Hello", ["dawn"], "0000000001")
    assert copy.variants == original.variants
    long_title = store.update_scene(story_id, storm, ScenePatch(title="x" * 200))
    assert len(store.duplicate_scene(story_id, long_title.scenes[-1].id).scenes[-1].title) == 200


def test_delete_scene_and_reorder(store: StoryStore) -> None:
    story_id = story_with_scenes(store, "A", "B", "C")
    a, b, c = scene_ids(store, story_id)

    assert [scene.id for scene in store.reorder_scenes(story_id, [c, a, b]).scenes] == [c, a, b]
    for bad_order in ([c, a], [c, a, b, b], [c, a, UNKNOWN_SCENE]):
        with pytest.raises(SceneOrderError):
            store.reorder_scenes(story_id, bad_order)
    assert scene_ids(store, story_id) == [c, a, b]

    assert [scene.id for scene in store.delete_scene(story_id, a).scenes] == [c, b]
    with pytest.raises(SceneNotFound):
        store.delete_scene(story_id, a)


def test_variant_rules(store: StoryStore, make_output: OutputFactory) -> None:
    for output_id in ("0000000001", "0000000002", "0000000003"):
        make_output(output_id)
    story_id = story_with_scenes(store, "Storm")
    (scene_id,) = scene_ids(store, story_id)

    def scene_state() -> tuple[list[str], str | None]:
        (scene,) = store.get(story_id).scenes
        return [variant.output_id for variant in scene.variants], scene.chosen_output_id

    # Added variants are appended and chosen.
    store.add_variant(story_id, scene_id, "0000000001")
    store.add_variant(story_id, scene_id, "0000000002")
    assert scene_state() == (["0000000001", "0000000002"], "0000000002")
    # Adding a variant again only chooses it.
    store.add_variant(story_id, scene_id, "0000000001")
    assert scene_state() == (["0000000001", "0000000002"], "0000000001")
    store.add_variant(story_id, scene_id, "0000000003")
    store.choose_variant(story_id, scene_id, "0000000002")
    assert scene_state() == (["0000000001", "0000000002", "0000000003"], "0000000002")
    # Removing the chosen variant chooses the latest remaining one; removing another keeps the choice.
    store.remove_variant(story_id, scene_id, "0000000002")
    assert scene_state() == (["0000000001", "0000000003"], "0000000003")
    store.remove_variant(story_id, scene_id, "0000000001")
    assert scene_state() == (["0000000003"], "0000000003")
    store.remove_variant(story_id, scene_id, "0000000003")
    assert scene_state() == ([], None)

    with pytest.raises(VariantNotFound):
        store.choose_variant(story_id, scene_id, "0000000001")
    with pytest.raises(VariantNotFound):
        store.remove_variant(story_id, scene_id, "0000000001")
    with pytest.raises(StoryOutputNotFound):
        store.add_variant(story_id, scene_id, "0000000099")


def test_scene_link_names_the_story_and_the_scene(store: StoryStore) -> None:
    story_id = story_with_scenes(store, "Storm")
    (scene_id,) = scene_ids(store, story_id)

    link = store.scene_link(story_id, scene_id)

    assert link.model_dump() == {"story_id": story_id, "scene_id": scene_id, "story_title": "The lighthouse", "scene_title": "Storm"}
    with pytest.raises(StoryNotFound):
        store.scene_link(UNKNOWN_STORY, scene_id)
    with pytest.raises(SceneNotFound):
        store.scene_link(story_id, UNKNOWN_SCENE)


def test_stories_survive_a_restart(store: StoryStore, app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")
    story_id = story_with_scenes(store, "Arrival", "Storm")
    arrival, _ = scene_ids(store, story_id)
    store.update_scene(story_id, arrival, ScenePatch(locks=[SceneLock(category_name="Mood", prompt_text="calm")], seed=3))
    store.add_variant(story_id, arrival, "0000000001")
    before = store.collection()

    reopened = StoryStore(paths=app_paths, outputs=OutputRepository(app_paths))

    assert reopened.collection() == before
    payload = json.loads(app_paths.stories_file.read_text(encoding="utf-8"))
    assert payload["version"] == STORIES_FORMAT_VERSION
    assert [story["id"] for story in payload["items"]] == [story_id]


def test_invalid_entries_are_skipped(app_paths: AppPaths, store: StoryStore) -> None:
    good = {
        "id": "sty-aaaaaaaaaaa1",
        "title": "Good",
        "character_ids": [],
        "created_at": "2026-11-20T08:00:00Z",
        "updated_at": "2026-11-20T08:00:00Z",
        "scenes": [
            {
                "id": "scn-aaaaaaaaaaa1",
                "title": "Fine",
                "variants": [{"output_id": "0000000001", "added_at": "2026-11-20T08:00:00Z"}],
                "chosen_output_id": "0000000009",
                "created_at": "2026-11-20T08:00:00Z",
                "updated_at": "2026-11-20T08:00:00Z",
            },
            {"id": "scn-aaaaaaaaaaa2", "title": ""},
            {"id": "scn-aaaaaaaaaaa1", "title": "Duplicate", "created_at": "2026-11-20T08:00:00Z", "updated_at": "2026-11-20T08:00:00Z"},
        ],
    }
    app_paths.stories_dir.mkdir(parents=True)
    app_paths.stories_file.write_text(
        json.dumps({"version": 1, "items": [good, {"id": "nope"}, {**good, "title": "Duplicate story"}, "garbage"]}),
        encoding="utf-8",
    )

    (story,) = store.collection().items

    assert story.title == "Good"
    (scene,) = story.scenes
    assert scene.title == "Fine"
    # The chosen illustration was not one of the variants.
    assert scene.chosen_output_id is None


@pytest.mark.parametrize(
    "content",
    ["{not json", json.dumps({"version": 2, "items": []}), json.dumps({"items": []}), json.dumps({"version": 1, "items": {}})],
)
def test_an_unreadable_file_is_refused_and_never_overwritten(app_paths: AppPaths, store: StoryStore, content: str) -> None:
    app_paths.stories_dir.mkdir(parents=True)
    app_paths.stories_file.write_text(content, encoding="utf-8")

    with pytest.raises(StoriesFileError):
        store.collection()
    with pytest.raises(StoriesFileError):
        store.create(StoryCreateRequest(title="Tale"))
    assert app_paths.stories_file.read_text(encoding="utf-8") == content


def test_export_embeds_the_chosen_illustrations_and_escapes_the_text(
    store: StoryStore, app_paths: AppPaths, make_output: OutputFactory
) -> None:
    make_output("0000000001")
    make_output("0000000002")
    story = store.create(StoryCreateRequest(title="Tom & <Jerry>"))
    store.add_scene(story.id, SceneCreateRequest(title="Arrival", text="Line one\nLine <two>", output_id="0000000001"))
    store.add_scene(story.id, SceneCreateRequest(title="Text only", text="No picture yet."))
    store.add_scene(story.id, SceneCreateRequest(title="Gone", output_id="0000000002"))
    (app_paths.output_dir / "0000000002.png").unlink()

    document = store.export_html(story.id)

    assert document.startswith("<!DOCTYPE html>")
    assert "<title>Tom &amp; &lt;Jerry&gt;</title>" in document
    assert "Line one\nLine &lt;two&gt;" in document
    assert "<script" not in document and "http" not in document.split("<body>")[1]
    assert document.count("data:image/jpeg;base64,") == 1
    assert 'alt="Illustration of Arrival"' in document
    assert "1 / 3" in document and "2 / 3" in document and "3 / 3" in document
    encoded = document.split("data:image/jpeg;base64,")[1].split('"')[0]
    with Image.open(io.BytesIO(base64.b64decode(encoded))) as picture:
        assert picture.format == "JPEG"
        assert picture.size == (4, 6)
    with pytest.raises(StoryNotFound):
        store.export_html(UNKNOWN_STORY)


def test_export_downscales_large_pictures(store: StoryStore, app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")
    Image.new("RGB", (3200, 1600), (10, 20, 30)).save(app_paths.output_dir / "0000000001.png")
    story = store.create(StoryCreateRequest(title="Wide"))
    store.add_scene(story.id, SceneCreateRequest(output_id="0000000001"))

    encoded = store.export_html(story.id).split("data:image/jpeg;base64,")[1].split('"')[0]

    with Image.open(io.BytesIO(base64.b64decode(encoded))) as picture:
        assert picture.size == (1600, 800)


def test_reading_a_sidecar_recovers_the_newest_copy(app_paths: AppPaths, store: StoryStore) -> None:
    created = store.create(StoryCreateRequest(title="Tale"))
    payload = app_paths.stories_file.read_text(encoding="utf-8")
    app_paths.stories_file.unlink()
    Path(f"{app_paths.stories_file}.new").write_text(payload, encoding="utf-8")

    reopened = StoryStore(paths=app_paths, outputs=OutputRepository(app_paths))

    assert [story.id for story in reopened.collection().items] == [created.id]
    assert app_paths.stories_file.is_file()


def test_flow_fields_and_scene_loras_are_saved_patched_and_duplicated(store: StoryStore, app_paths: AppPaths) -> None:
    story = store.create(
        StoryCreateRequest(title="The lighthouse", logline="A keeper guides a boat home.", synopsis="Act one...", style_notes="watercolor")
    )
    store.add_scene(
        story.id,
        SceneCreateRequest(
            title="Arrival", beat="Mira arrives", shot="wide shot", setting="island, dusk", mood="lonely",
            loras=[LoraWeight(id="watercolor", weight=0.6)],
        ),
    )  # fmt: skip
    (arrival,) = scene_ids(store, story.id)

    patched = store.update_scene(story.id, arrival, ScenePatch(mood="hopeful", loras=[LoraWeight(id="ink", weight=0)]))
    (scene,) = patched.scenes
    assert (scene.beat, scene.shot, scene.setting, scene.mood) == ("Mira arrives", "wide shot", "island, dusk", "hopeful")
    assert scene.loras == [LoraWeight(id="ink", weight=0)]
    updated = store.update(story.id, StoryPatch(synopsis="Act one, act two."))
    assert (updated.logline, updated.synopsis, updated.style_notes) == ("A keeper guides a boat home.", "Act one, act two.", "watercolor")
    copy = store.duplicate_scene(story.id, arrival).scenes[1]
    assert (copy.beat, copy.mood, copy.loras) == ("Mira arrives", "hopeful", [LoraWeight(id="ink", weight=0)])

    reloaded = StoryStore(paths=app_paths, outputs=OutputRepository(app_paths)).get(story.id)
    assert reloaded == store.get(story.id)
    for field in ("beat", "loras", "mood"):
        with pytest.raises(ValidationError, match="cannot be null"):
            ScenePatch.model_validate({field: None})
    with pytest.raises(ValidationError, match="cannot be null"):
        StoryPatch.model_validate({"logline": None})
    with pytest.raises(ValidationError):
        SceneCreateRequest(loras=[LoraWeight(id="x", weight=12)])


def test_stories_saved_before_the_flow_fields_load_with_their_defaults(app_paths: AppPaths, store: StoryStore) -> None:
    app_paths.stories_file.parent.mkdir(parents=True, exist_ok=True)
    scene = {
        "id": "scn-aaaaaaaaaaa1", "title": "Arrival", "text": "Hello", "extra_tags": ["dawn"], "negative_tags": [], "locks": [],
        "character_ids": None, "seed": 3, "variants": [], "chosen_output_id": None,
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
    }  # fmt: skip
    story = {
        "id": "sty-aaaaaaaaaaa1", "title": "Old", "character_ids": [], "scenes": [scene],
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
    }  # fmt: skip
    app_paths.stories_file.write_text(json.dumps({"version": STORIES_FORMAT_VERSION, "items": [story]}), encoding="utf-8")

    (loaded,) = store.collection().items
    assert (loaded.logline, loaded.synopsis, loaded.style_notes) == ("", "", "")
    (old,) = loaded.scenes
    assert (old.text, old.seed, old.beat, old.shot, old.setting, old.mood, old.loras) == ("Hello", 3, "", "", "", "", [])
    # A change keeps everything else and writes the new fields with their defaults.
    store.update_scene(loaded.id, old.id, ScenePatch(beat="She arrives"))
    saved = json.loads(app_paths.stories_file.read_text(encoding="utf-8"))["items"][0]
    assert (saved["logline"], saved["scenes"][0]["beat"], saved["scenes"][0]["loras"], saved["scenes"][0]["extra_tags"]) == ("", "She arrives", [], ["dawn"])
