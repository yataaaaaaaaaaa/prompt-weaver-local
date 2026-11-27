"""THE catalog of the co-writer's tools as Codex sees them (MCP tools/list): name, description, input schema, hints and
how long a call may take. Their arguments are the schemas.CODEX_TOOL_ARGUMENTS models (validated here before the
call goes to the frontend; their JSON schemas carry the descriptions, defaults, enums and examples Codex reads); what
each tool does is the frontend's (src/stores/coWriterTools.ts calls the stores' actions: story, characters, IP-Adapter,
generation), so no rule is implemented twice. The README's capability matrix maps every user-facing capability of the
Story and Characters sections, the prompt board, the LoRA library and the generation settings to these tools.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from ...schemas import CODEX_MAX_IMAGES_PER_CALL, CODEX_TOOL_ARGUMENTS, CodexToolArgs

QUICK_TOOL_TIMEOUT_S = 60.0
# A picture takes up to a minute on the user's GPU, a whole story many.
GENERATION_TOOL_TIMEOUT_S = 1800.0


@dataclass(frozen=True)
class CodexTool:
    name: str
    title: str
    description: str
    read_only: bool = False
    destructive: bool = False
    idempotent: bool = False
    timeout_s: float = QUICK_TOOL_TIMEOUT_S

    @property
    def arguments(self) -> type[CodexToolArgs]:
        return CODEX_TOOL_ARGUMENTS[self.name]

    def input_schema(self) -> dict[str, Any]:
        return inline_refs(self.arguments.model_json_schema())

    def descriptor(self) -> dict[str, Any]:
        """The MCP tool descriptor (tools/list)."""
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.input_schema(),
            "annotations": {
                "title": self.title,
                "readOnlyHint": self.read_only,
                "destructiveHint": self.destructive,
                "idempotentHint": self.idempotent,
                "openWorldHint": False,
            },
        }


def inline_refs(schema: dict[str, Any]) -> dict[str, Any]:
    """The schema with its local $refs replaced by their definitions (some MCP clients do not follow $ref)."""
    definitions = schema.get("$defs", {})

    def resolve(node: Any) -> Any:
        if isinstance(node, dict):
            reference = node.get("$ref")
            if isinstance(reference, str) and reference.startswith("#/$defs/"):
                target = copy.deepcopy(definitions[reference.removeprefix("#/$defs/")])
                rest = {key: value for key, value in node.items() if key != "$ref"}
                return resolve({**target, **rest})
            return {key: resolve(value) for key, value in node.items() if key != "$defs"}
        if isinstance(node, list):
            return [resolve(item) for item in node]
        return node

    resolved: dict[str, Any] = resolve(schema)
    return resolved


_STORY_ID = "story_id and scene_id come from the <app-context> of the user's message, list_stories or get_story."
_ASK_FIRST = "Destructive: ask the user first, and only call it with user_confirmed true after the user said yes in this conversation."
_PICTURES = "Runs the user's model on their GPU (about a minute per picture): only when the user asks for pictures."

CODEX_TOOLS: tuple[CodexTool, ...] = (
    # --- Reading ---
    CodexTool(
        "list_stories",
        "List stories",
        "Every story: story_id, title, logline, how many scenes and pictures, and which one the user is viewing.",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "get_story",
        "Read a story",
        "The whole story in one call: its flow (logline, synopsis, style notes), its characters, and every scene in "
        "reading order with its text, flow notes (beat, shot, setting, mood), per-frame settings (scene tags, negative "
        "tags, locked sub-prompts, LoRAs with weights, characters and the cast they give, seed) and status "
        "(illustrated or not, its picture's output_id, its variants). Read it before changing a story. " + _STORY_ID,
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "list_characters",
        "List characters",
        "Every character with all its fields: character_id, name, identity tags (appearance), outfit tags, negative "
        "tags, LoRAs with weights, seed and whether it is locked, reference images (image_id) with their focus and "
        "strength, and whether it is active in Create. The app adds a character's tags, LoRAs, locked seed and "
        "reference images to every picture it is in: never repeat its appearance in scene tags.",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "list_categories",
        "Read the prompt board",
        "The user's prompt categories in generation order: each one's state (normal, skipped, indirectly disabled: "
        "never picked), activation text, and sub-prompts with their state (normal, locked: always picked, skipped, "
        "indirectly disabled) and prompt-linked LoRAs; plus the forbidden rules (pairs never used together). For every "
        "picture the prompt engine picks one sub-prompt per active category; a scene can lock one (update_scenes "
        "lock). Reuse this vocabulary in tags. Long lists are shortened: `query` reads matching categories in full.",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "list_loras",
        "List LoRAs",
        "The LoRAs of the user's library: lora_id, name, trigger words (put them in the tags of the scenes or the "
        "character that use the LoRA), base model, its weight when selected in Create (applied to every picture), and "
        "the characters and scenes that use it (used_by_characters, used_in_scenes). `query` filters by name.",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "get_generation_setup",
        "Read the generation setup",
        "What every picture is made with: the current model (and whether one is selected), size, steps, CFG, the "
        "negative prompt, the seed behaviors, the LoRAs selected in Create with their weights, the active character, "
        "whether a generation is running, and whether reference images (IP-Adapter) work with this model per focus "
        "(with the reason and the files to install when they do not).",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "preview_scenes",
        "Preview scene prompts",
        "What generating each scene would use, computed by the app's own prompt engine (nothing is generated): the "
        "final positive and negative prompt, the LoRAs with their weights and where each comes from (character, scene, "
        "selection, sub-prompt), the image seed (fixed, locked by a character, or random), the cast, whether reference "
        "images apply, the categories the engine still picks at random, and warnings. Check it before generating. "
        + _STORY_ID,
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "consistency_report",
        "Check consistency",
        "Per scene: its cast (and where it comes from), each character's identity and outfit tags, the LoRAs with "
        "weights, the seed, the reference images that apply, and what its current picture was really made with "
        "(seed, LoRAs, character, references applied or why not); then the problems found (a character missing from "
        "a scene, appearance repeated in scene tags, locks replaced by a character, missing LoRAs or characters, "
        "references that cannot apply, pictures made with another cast) with what to do. Use it after generating, "
        "with view_images.",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "view_images",
        "Look at pictures",
        "Shows you pictures (downscaled), each after its label: the pictures of a story's scenes (story_id, and "
        "scene_ids or every illustrated scene), outputs (output_ids, e.g. a scene's variants) and characters' "
        f"reference images (character_ids); at most {CODEX_MAX_IMAGES_PER_CALL} per call. Use it to compare scenes "
        "and characters, then fix tags, seeds, LoRAs or references.",
        read_only=True,
        idempotent=True,
    ),
    # --- Stories and scenes ---
    CodexTool(
        "create_story",
        "Create a story",
        "Creates a story with its characters, its flow (logline, synopsis, style notes) and its whole outline in one "
        "call: `scenes`, one per beat, each with its text, flow notes and per-frame settings. Shows it to the user; "
        "the story joins this conversation. Answers the story as get_story does.",
    ),
    CodexTool(
        "update_story",
        "Edit a story",
        "Changes the title, the characters (they apply to every scene without its own) or the flow (logline, "
        "synopsis, style notes) of a story. " + _STORY_ID,
        idempotent=True,
    ),
    CodexTool("delete_story", "Delete a story", "Deletes a story and its scenes (their pictures stay in the outputs). " + _ASK_FIRST, destructive=True),
    CodexTool(
        "add_scenes",
        "Add scenes",
        "Adds one or more scenes at a position (1-based, the others follow; null: at the end), each with its text, "
        "flow notes and per-frame settings (tags, negative tags, locks, LoRAs, characters, seed). Checked before "
        "anything is added. Answers the new scenes with their scene_id and position.",
    ),
    CodexTool(
        "update_scenes",
        "Edit scenes",
        "Changes many scenes in one call: each change targets scene_id, or scene_ids ([ids] or \"all\") for the same "
        "change to several scenes. Replace fields (title, text, beat, shot, setting, mood, extra_tags, negative_tags, "
        "locks, loras, characters, seed) or edit the current values (add_tags / remove_tags, add_negative_tags / "
        "remove_negative_tags, lock / unlock categories, set_loras / remove_loras). Every change is checked first "
        "(unknown scenes, categories, sub-prompts, LoRAs or characters: nothing changes, the answer lists the valid "
        "ones). Answers the changed scenes.",
        idempotent=True,
    ),
    CodexTool(
        "reorder_scenes",
        "Reorder scenes",
        "Sets the reading order: `order` (every scene_id once) or one scene_id moved to a 1-based position.",
        idempotent=True,
    ),
    CodexTool("duplicate_scene", "Duplicate a scene", "Inserts a copy of the scene after it (text, settings, pictures); answers the copy."),
    CodexTool("delete_scenes", "Delete scenes", "Deletes scenes (their pictures stay in the outputs). " + _ASK_FIRST, destructive=True),
    # --- Pictures ---
    CodexTool(
        "generate_scenes",
        "Illustrate scenes",
        "Generates a new picture for each scene given (in that order), or for every scene without one (scene_ids "
        "null), through the app's one generation path: the prompt board, the characters, the LoRAs, the current "
        "model. Each picture becomes a variant and the scene's picture. Waits for the pictures. " + _PICTURES,
        timeout_s=GENERATION_TOOL_TIMEOUT_S,
    ),
    CodexTool(
        "edit_variants",
        "Pick a scene's picture",
        "A scene's variants (every picture made for it or added to it): `choose` makes one the scene's picture, `add` "
        "adds existing outputs as variants, `remove` takes variants off the scene (the outputs are kept).",
        idempotent=True,
    ),
    # --- Characters ---
    CodexTool(
        "create_character",
        "Create a character",
        "Creates a character from scratch, or prefilled from a picture (from_output_id, or from_scene: its picture) "
        "like the app's Create character: the picture's tags, LoRAs and seed, and the picture as its first reference "
        "image. Give identity tags (appearance only), outfit tags apart, LoRAs with weights, a seed (seed_locked for "
        "the same look in every picture), reference images and their focus and strength. Answers the character.",
    ),
    CodexTool(
        "update_character",
        "Edit a character",
        "Changes any field of a character (null: unchanged): name, identity / outfit / negative tags, LoRAs with "
        "weights, seed and its lock, reference strength and focus; adds reference images from outputs or scene "
        "pictures (at most 4), removes reference images (image_id), or activates it in Create. Answers the character.",
        idempotent=True,
    ),
    CodexTool(
        "delete_character",
        "Delete a character",
        "Deletes a character and its images (pictures made with it are kept). " + _ASK_FIRST,
        destructive=True,
    ),
    CodexTool(
        "install_ip_adapter",
        "Install reference image support",
        "Starts the download of the IP-Adapter files the current model needs for reference images with this focus "
        "(get_generation_setup says which are missing and how big they are; the user sees the progress in the app). "
        "Only with user_confirmed true after the user agreed to the download.",
    ),
)

TOOLS_BY_NAME: dict[str, CodexTool] = {tool.name: tool for tool in CODEX_TOOLS}
assert set(TOOLS_BY_NAME) == set(CODEX_TOOL_ARGUMENTS), "every tool needs its arguments model and its description"
