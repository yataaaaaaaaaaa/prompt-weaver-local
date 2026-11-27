"""The co-writer's tools as Codex sees them (services/codex/tools.py and schemas.CODEX_TOOL_ARGUMENTS): every tool's
arguments, valid and invalid (each tool's error paths, with the message Codex reads), the JSON schemas it is given
(self-contained, strict, with descriptions, defaults, enums and examples that validate), the pictures a result shows
Codex (services/codex/images.py, through the broker) and the character a tool entry links to."""

from __future__ import annotations

import base64
import io
import threading
from typing import Any

import pytest
from PIL import Image
from pydantic import ValidationError

from app.schemas import (
    CODEX_MAX_IMAGES_PER_CALL,
    CODEX_TOOL_ARGUMENTS,
    CharacterCreateRequest,
    CodexToolImage,
    CodexToolResult,
    OutputImageSource,
)
from app.services.characters import CharacterStore
from app.services.codex.broker import ToolBroker, ToolTurn
from app.services.codex.images import TOOL_IMAGE_MAX_SIDE, ToolImageReader
from app.services.codex.protocol import tool_entry
from app.services.codex.tools import CODEX_TOOLS, TOOLS_BY_NAME
from app.services.outputs import OutputRepository
from app.settings import AppPaths
from support import FakeHttp, OutputFactory

STORY = "sty-000000000001"
SCENE = "scn-000000000001"
SCENE_2 = "scn-000000000002"
CHARACTER = "chr-000000000001"
IMAGE = "img-000000000001"
OUTPUT = "0000000001"

# One valid call per tool: the smallest arguments, then their defaults as the frontend receives them.
MINIMAL: dict[str, dict[str, Any]] = {
    "list_stories": {},
    "get_story": {"story_id": STORY},
    "list_characters": {},
    "list_categories": {},
    "list_loras": {"query": "water"},
    "get_generation_setup": {},
    "preview_scenes": {"story_id": STORY},
    "consistency_report": {"story_id": STORY, "scene_ids": [SCENE]},
    "view_images": {"story_id": STORY},
    "create_story": {"title": "The harbor"},
    "update_story": {"story_id": STORY, "logline": "A boat comes home."},
    "delete_story": {"story_id": STORY, "user_confirmed": True},
    "add_scenes": {"story_id": STORY, "scenes": [{}]},
    "update_scenes": {"story_id": STORY, "changes": [{"scene_id": SCENE, "add_tags": ["rain"]}]},
    "reorder_scenes": {"story_id": STORY, "order": [SCENE_2, SCENE]},
    "duplicate_scene": {"story_id": STORY, "scene_id": SCENE},
    "delete_scenes": {"story_id": STORY, "scene_ids": [SCENE], "user_confirmed": False},
    "generate_scenes": {"story_id": STORY},
    "edit_variants": {"story_id": STORY, "scene_id": SCENE, "choose": OUTPUT},
    "create_character": {},
    "update_character": {"character_id": CHARACTER, "seed": "none"},
    "delete_character": {"character_id": CHARACTER, "user_confirmed": True},
    "install_ip_adapter": {"user_confirmed": True},
}

# Invalid calls of each tool and a part of the message Codex reads for each.
INVALID: list[tuple[str, dict[str, Any], str]] = [
    ("list_stories", {"story_id": STORY}, "Extra inputs are not permitted"),
    ("list_characters", {"query": "mira"}, "query: Extra inputs are not permitted"),
    ("get_generation_setup", {"model": "x"}, "model: Extra inputs are not permitted"),
    ("get_story", {}, "story_id: Field required"),
    ("get_story", {"story_id": "story-1"}, "String should match pattern"),
    ("list_categories", {"query": "x" * 201}, "at most 200 characters"),
    ("list_loras", {"name": "x"}, "Extra inputs are not permitted"),
    ("preview_scenes", {"story_id": STORY, "scene_ids": ["scene-1"]}, "String should match pattern"),
    ("consistency_report", {}, "story_id: Field required"),
    ("view_images", {}, "Give story_id, output_ids or character_ids."),
    ("view_images", {"scene_ids": [SCENE]}, "scene_ids needs story_id."),
    ("view_images", {"output_ids": ["1"]}, "String should match pattern"),
    ("create_story", {"title": "  "}, "at least 1 character"),
    ("create_story", {"title": "A", "scenes": [{"characters": "everyone"}]}, "scenes.0.characters"),
    ("create_story", {"title": "A", "scenes": [{"tags": ["rain"]}]}, "scenes.0.tags: Extra inputs are not permitted"),
    ("create_story", {"title": "A", "scenes": [{}] * 61}, "at most 60 items"),
    ("update_story", {"story_id": STORY}, "Give at least one change."),
    ("delete_story", {"story_id": STORY}, "user_confirmed: Field required"),
    ("add_scenes", {"story_id": STORY, "scenes": []}, "at least 1 item"),
    ("add_scenes", {"story_id": STORY, "scenes": [{}], "position": 0}, "greater than or equal to 1"),
    ("add_scenes", {"story_id": STORY, "scenes": [{"loras": [{"lora": "x", "weight": 11}]}]}, "less than or equal to 10"),
    ("add_scenes", {"story_id": STORY, "scenes": [{"seed": -1}]}, "greater than or equal to 0"),
    ("update_scenes", {"story_id": STORY, "changes": []}, "at least 1 item"),
    ("update_scenes", {"story_id": STORY, "changes": [{"add_tags": ["rain"]}]}, "Give scene_id or scene_ids (not both)."),
    ("update_scenes", {"story_id": STORY, "changes": [{"scene_id": SCENE, "scene_ids": "all", "text": "x"}]}, "Give scene_id or scene_ids"),
    ("update_scenes", {"story_id": STORY, "changes": [{"scene_ids": "all", "title": "Same"}]}, "title changes one scene: give scene_id."),
    ("update_scenes", {"story_id": STORY, "changes": [{"scene_id": SCENE}]}, "Give at least one change."),
    ("update_scenes", {"story_id": STORY, "changes": [{"scene_id": SCENE, "remove_tags": []}]}, "Give at least one change."),
    ("update_scenes", {"story_id": STORY, "changes": [{"scene_ids": "some", "text": "x"}]}, "changes.0.scene_ids"),
    ("update_scenes", {"story_id": STORY, "changes": [{"scene_id": SCENE, "seed": "lucky"}]}, "changes.0.seed"),
    ("update_scenes", {"story_id": STORY, "changes": [{"scene_id": SCENE, "lock": [{"category": "Mood"}]}]}, "sub_prompt: Field required"),
    ("update_scenes", {"story_id": STORY, "changes": [{"scene_id": SCENE, "text": None, "extra_tags": None}]}, "Give at least one change."),
    ("reorder_scenes", {"story_id": STORY}, "Give order, or scene_id with position."),
    ("reorder_scenes", {"story_id": STORY, "scene_id": SCENE}, "Give order, or scene_id with position."),
    ("reorder_scenes", {"story_id": STORY, "order": [SCENE], "scene_id": SCENE, "position": 1}, "Give order, or scene_id with position."),
    ("duplicate_scene", {"story_id": STORY}, "scene_id: Field required"),
    ("delete_scenes", {"story_id": STORY, "scene_ids": [], "user_confirmed": True}, "at least 1 item"),
    ("generate_scenes", {"story_id": STORY, "missing": True}, "Extra inputs are not permitted"),
    ("edit_variants", {"story_id": STORY, "scene_id": SCENE}, "Give at least one change."),
    ("edit_variants", {"story_id": STORY, "scene_id": SCENE, "remove": ["12"]}, "String should match pattern"),
    ("create_character", {"name": ""}, "at least 1 character"),
    ("create_character", {"from_output_id": OUTPUT, "from_scene": {"story_id": STORY, "scene_id": SCENE}}, "Give from_output_id or from_scene, not both."),
    ("create_character", {"seed_locked": True}, "seed_locked needs a seed."),
    ("create_character", {"reference_strength": 1.5}, "less than or equal to 1"),
    ("create_character", {"reference_focus": "body"}, "Input should be 'face' or 'general'"),
    ("create_character", {"reference_output_ids": [OUTPUT] * 5}, "at most 4 items"),
    ("update_character", {"character_id": CHARACTER}, "Give at least one change."),
    ("update_character", {"character_id": "mira"}, "String should match pattern"),
    ("update_character", {"character_id": CHARACTER, "remove_reference_image_ids": ["image-1"]}, "String should match pattern"),
    ("delete_character", {"character_id": CHARACTER}, "user_confirmed: Field required"),
    ("install_ip_adapter", {"focus": "face"}, "user_confirmed: Field required"),
]


def problems(tool: str, arguments: dict[str, Any]) -> str:
    """The message the broker gives Codex for invalid arguments (empty when they are valid)."""
    try:
        CODEX_TOOL_ARGUMENTS[tool].model_validate(arguments)
    except ValidationError as exc:
        return "; ".join(f"{'.'.join(str(part) for part in error['loc']) or 'arguments'}: {error['msg']}" for error in exc.errors())
    return ""


def test_every_tool_has_a_valid_minimal_call_and_an_invalid_one() -> None:
    assert set(MINIMAL) == set(CODEX_TOOL_ARGUMENTS)
    assert {tool for tool, _arguments, _message in INVALID} == set(CODEX_TOOL_ARGUMENTS)


@pytest.mark.parametrize("tool", list(MINIMAL))
def test_the_minimal_call_of_every_tool_is_valid(tool: str) -> None:
    assert problems(tool, MINIMAL[tool]) == ""


@pytest.mark.parametrize(("tool", "arguments", "message"), INVALID, ids=[f"{tool}-{index}" for index, (tool, _a, _m) in enumerate(INVALID)])
def test_invalid_calls_say_what_is_wrong(tool: str, arguments: dict[str, Any], message: str) -> None:
    assert message in problems(tool, arguments)


def test_defaults_reach_the_frontend_filled_in() -> None:
    scenes = CODEX_TOOL_ARGUMENTS["add_scenes"].model_validate({"story_id": STORY, "scenes": [{"title": "Dock"}]}).model_dump(mode="json")
    assert scenes["scenes"][0] == {
        "title": "Dock", "beat": "", "text": "", "shot": "", "setting": "", "mood": "", "extra_tags": [], "negative_tags": [],
        "locks": [], "loras": [], "characters": "story", "seed": None,
    }  # fmt: skip
    change = CODEX_TOOL_ARGUMENTS["update_scenes"].model_validate(MINIMAL["update_scenes"]).model_dump(mode="json")["changes"][0]
    assert change["add_tags"] == ["rain"] and change["scene_ids"] is None and change["loras"] is None and change["set_loras"] == []
    lora = CODEX_TOOL_ARGUMENTS["update_scenes"].model_validate(
        {"story_id": STORY, "changes": [{"scene_ids": "all", "set_loras": [{"lora": "Watercolor Wash"}]}]}
    )
    assert lora.model_dump(mode="json")["changes"][0]["set_loras"] == [{"lora": "Watercolor Wash", "weight": 1.0}]
    assert CODEX_TOOL_ARGUMENTS["install_ip_adapter"].model_validate({"user_confirmed": False}).model_dump() == {"focus": "face", "user_confirmed": False}
    # Tags are trimmed and blank ones dropped, like everywhere in the app.
    cleaned = CODEX_TOOL_ARGUMENTS["add_scenes"].model_validate({"story_id": STORY, "scenes": [{"extra_tags": [" rain ", "", "night"]}]})
    assert cleaned.model_dump()["scenes"][0]["extra_tags"] == ["rain", "night"]


@pytest.mark.parametrize("tool", list(TOOLS_BY_NAME))
def test_every_schema_is_self_contained_strict_and_documented(tool: str) -> None:
    descriptor = TOOLS_BY_NAME[tool].descriptor()
    schema = descriptor["inputSchema"]

    assert descriptor["description"] and descriptor["title"]
    assert "$defs" not in schema and "$ref" not in str(schema)

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node:
                assert node.get("additionalProperties") is False, f"{tool}: an object accepts unknown fields"
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)
    for example in schema.get("examples", []):
        assert problems(tool, example) == "", f"{tool}: its example is invalid"


def test_the_schemas_give_codex_enums_defaults_and_examples() -> None:
    change = TOOLS_BY_NAME["update_scenes"].input_schema()["properties"]["changes"]["items"]["properties"]
    assert {"const": "all", "type": "string"} in change["scene_ids"]["anyOf"]
    assert {"const": "random", "type": "string"} in change["seed"]["anyOf"]
    install = TOOLS_BY_NAME["install_ip_adapter"].input_schema()["properties"]["focus"]
    assert (install["enum"], install["default"]) == (["face", "general"], "face")
    weight = TOOLS_BY_NAME["add_scenes"].input_schema()["properties"]["scenes"]["items"]["properties"]["loras"]["items"]["properties"]["weight"]
    assert (weight["default"], weight["minimum"], weight["maximum"]) == (1.0, -10.0, 10.0)
    with_examples = [tool.name for tool in CODEX_TOOLS if tool.input_schema().get("examples")]
    assert with_examples == ["view_images", "create_story", "add_scenes", "update_scenes", "reorder_scenes", "create_character", "update_character"]


def test_destructive_tools_require_the_users_confirmation() -> None:
    for tool in (tool for tool in CODEX_TOOLS if tool.destructive):
        assert "user_confirmed" in tool.input_schema()["required"], tool.name
        assert "ask the user first" in tool.description
    assert "user_confirmed" in TOOLS_BY_NAME["install_ip_adapter"].input_schema()["required"]


# ---------------------------------------------------------------------------
# Pictures shown to Codex (view_images)
# ---------------------------------------------------------------------------


def test_a_tool_image_names_one_picture() -> None:
    assert CodexToolImage(label="Scene 1", output_id=OUTPUT).output_id == OUTPUT
    assert CodexToolImage(label="Mira", character_id=CHARACTER, image_id=IMAGE).image_id == IMAGE
    for invalid in ({}, {"output_id": OUTPUT, "character_id": CHARACTER, "image_id": IMAGE}, {"character_id": CHARACTER}, {"output_id": OUTPUT, "image_id": IMAGE}):
        with pytest.raises(ValidationError, match="Give output_id, or character_id with image_id."):
            CodexToolImage(label="x", **invalid)
    with pytest.raises(ValidationError, match="at most 8 items"):
        CodexToolResult(ok=True, text="", summary="", images=[CodexToolImage(label="x", output_id=OUTPUT)] * (CODEX_MAX_IMAGES_PER_CALL + 1))


def picture(data: str) -> Image.Image:
    return Image.open(io.BytesIO(base64.b64decode(data)))


def test_the_reader_downscales_outputs_and_character_images(app_paths: AppPaths, make_output: OutputFactory, fake_http: FakeHttp) -> None:
    outputs = OutputRepository(app_paths)
    make_output(OUTPUT)
    Image.new("RGB", (1600, 900), (200, 120, 40)).save(app_paths.output_dir / f"{OUTPUT}.png")
    make_output("0000000002")
    characters = CharacterStore(paths=app_paths, outputs=outputs, http_client_factory=fake_http.client_factory)
    mira = characters.create(CharacterCreateRequest(name="Mira", reference_sources=[OutputImageSource(kind="output", output_id=OUTPUT)]))
    reader = ToolImageReader(outputs=outputs, characters=characters)

    blocks = reader.content(
        [
            CodexToolImage(label="Scene 1 · Arrival, output #0000000001", output_id=OUTPUT),
            CodexToolImage(label="Mira, reference image 1", character_id=mira.id, image_id=mira.reference_images[0].id),
            CodexToolImage(label="Scene 2", output_id="0000000002"),
            CodexToolImage(label="Gone", output_id="0000000099"),
            CodexToolImage(label="Lost", character_id=mira.id, image_id=IMAGE),
        ]
    )

    assert [block["type"] for block in blocks] == ["text", "image", "text", "image", "text", "image", "text", "text", "text", "text"]
    assert blocks[0] == {"type": "text", "text": "Scene 1 · Arrival, output #0000000001"}
    scene = picture(blocks[1]["data"])
    assert (scene.format, scene.size, blocks[1]["mimeType"]) == ("JPEG", (TOOL_IMAGE_MAX_SIDE, 360), "image/jpeg")
    assert max(picture(blocks[3]["data"]).size) <= TOOL_IMAGE_MAX_SIDE
    assert picture(blocks[5]["data"]).size == (4, 6)  # never upscaled
    assert blocks[7:] == [
        {"type": "text", "text": "(Gone: this picture no longer exists.)"},
        {"type": "text", "text": "Lost"},
        {"type": "text", "text": "(Lost: this picture no longer exists.)"},
    ]


def test_the_broker_sends_the_pictures_after_the_text() -> None:
    seen: list[list[CodexToolImage]] = []

    def content(images: list[CodexToolImage]) -> list[dict[str, Any]]:
        seen.append(images)
        return [{"type": "text", "text": image.label} for image in images] + [{"type": "image", "data": "AAAA", "mimeType": "image/jpeg"}]

    events: list[Any] = []
    broker = ToolBroker(
        publish=events.append,
        is_connected=lambda _client: True,
        current_turn=lambda: ToolTurn(conversation_id="cnv-000000000001", client_id="window-1"),
        on_outcome=lambda _turn, _outcome: None,
        image_content=content,
    )
    box: list[Any] = []
    thread = threading.Thread(target=lambda: box.append(broker.call("view_images", {"story_id": STORY})))
    thread.start()
    while not events:
        thread.join(0.01)
    image = CodexToolImage(label="Scene 1 · Arrival", output_id=OUTPUT)
    broker.resolve(events[0].call.call_id, CodexToolResult(ok=True, text='{"shown": 1}', summary="Looked at 1 picture", story_id=STORY, images=[image]))
    thread.join(5)

    assert seen == [[image]]
    assert box[0].call_tool_result()["content"] == [
        {"type": "text", "text": '{"shown": 1}'},
        {"type": "text", "text": "Scene 1 · Arrival"},
        {"type": "image", "data": "AAAA", "mimeType": "image/jpeg"},
    ]


# ---------------------------------------------------------------------------
# The character a tool entry links to
# ---------------------------------------------------------------------------


def test_a_tool_entry_links_to_the_character_it_acted_on() -> None:
    meta = {"prompt_weaver/activity": {"ok": True, "summary": "Edited Mira (outfit)", "story_id": None, "scene_id": None, "character_id": CHARACTER}}
    item = {"type": "mcpToolCall", "id": "t1", "server": "prompt_weaver", "tool": "update_character", "status": "completed", "arguments": {}, "result": {"content": [], "_meta": meta}}
    entry = tool_entry(item)
    assert entry is not None and (entry.text, entry.character_id, entry.story_id) == ("Edited Mira (outfit)", CHARACTER, None)

    running = {**item, "status": "inProgress", "result": None, "arguments": {"character_id": CHARACTER}}
    entry = tool_entry(running)
    assert entry is not None and (entry.status, entry.character_id) == ("running", CHARACTER)


def test_the_fake_codex_chains_tool_results_by_name_and_json_path() -> None:
    from fake_codex import _fill

    values = {"last.text": '{"scenes": [{"scene_id": "scn-1"}], "count": 3}', "cast.text": '{"character_id": "chr-1"}', "context.story_id": "sty-1"}
    filled = _fill(
        {"a": "{last.json.scenes.0.scene_id}", "b": ["{cast.json.character_id}"], "c": "{last.json.count}", "d": "in {context.story_id} {unknown}", "e": "{last.json.scenes}"},
        values,
    )
    assert filled == {"a": "scn-1", "b": ["chr-1"], "c": 3, "d": "in sty-1 {unknown}", "e": [{"scene_id": "scn-1"}]}
    assert _fill("{last.json.missing.0}", values) == "{last.json.missing.0}"


def test_a_running_call_of_one_scene_names_it() -> None:
    item = {"type": "mcpToolCall", "id": "t1", "server": "prompt_weaver", "tool": "generate_scenes", "status": "inProgress", "arguments": {"story_id": STORY, "scene_ids": [SCENE]}}
    entry = tool_entry(item)
    assert entry is not None and (entry.story_id, entry.scene_id) == (STORY, SCENE)
    several = tool_entry({**item, "arguments": {"story_id": STORY, "scene_ids": [SCENE, SCENE_2]}})
    assert several is not None and several.scene_id is None
