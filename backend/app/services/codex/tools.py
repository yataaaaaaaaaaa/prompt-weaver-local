"""THE catalog of the co-writer's tools as Codex sees them (MCP tools/list): name, description, input schema, hints and
how long a call may take. Their arguments are the schemas.CODEX_TOOL_ARGUMENTS models (validated here before the
call goes to the frontend); what each tool does is the frontend's (src/stores/coWriterTools.ts calls the story store's
actions), so no story rule is implemented twice.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

from ...schemas import CODEX_TOOL_ARGUMENTS, CodexToolArgs

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


_STORY_ID = "story_id comes from the <app-context> of the user's message or from list_stories."

CODEX_TOOLS: tuple[CodexTool, ...] = (
    CodexTool(
        "list_stories",
        "List stories",
        "Every story of the app: story_id, title, how many scenes and how many have a picture, and which one the user "
        "is viewing.",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "get_story",
        "Read a story",
        "One story with its characters and every scene in reading order: scene_id, position, title, text, scene tags, "
        "negative tags, locked sub-prompts, characters, seed and whether it has a picture. " + _STORY_ID,
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "list_characters",
        "List characters",
        "The user's characters (character_id, name, identity tags, outfit tags, negative tags). A character keeps the "
        "same person in every picture: its tags are added to the prompt by the app, never repeat them in scene tags.",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "list_categories",
        "List prompt categories",
        "The user's prompt categories (Create section) and their sub-prompts. The app's prompt engine picks one "
        "sub-prompt per category for every picture; reuse their vocabulary in scene tags, or lock one with "
        "lock_sub_prompt. Long lists are shortened: use `query` to read one category.",
        read_only=True,
        idempotent=True,
    ),
    CodexTool(
        "create_story",
        "Create a story",
        "Creates a story (no scenes yet) and shows it to the user. The story joins this conversation.",
    ),
    CodexTool("update_story", "Edit a story", "Renames a story or sets its characters (they apply to every scene). " + _STORY_ID),
    CodexTool(
        "add_scene",
        "Add a scene",
        "Adds a scene with its title, its narrative text and the Danbooru-style tags of its picture; shows it to the "
        "user. Answers its scene_id and position.",
    ),
    CodexTool(
        "update_scene",
        "Edit a scene",
        "Changes the fields given (title, text, scene tags, negative tags, characters, seed); the others stay.",
        idempotent=True,
    ),
    CodexTool(
        "lock_sub_prompt",
        "Lock a sub-prompt",
        "Makes the scene's pictures use this sub-prompt of a category (list_categories) instead of the one the prompt "
        "engine would pick.",
        idempotent=True,
    ),
    CodexTool("unlock_category", "Unlock a category", "Removes the scene's locked sub-prompt of a category.", idempotent=True),
    CodexTool("move_scene", "Move a scene", "Moves a scene to another position (1-based) of its story.", idempotent=True),
    CodexTool("duplicate_scene", "Duplicate a scene", "Inserts a copy of the scene after it (text, tags, pictures)."),
    CodexTool(
        "delete_scene",
        "Delete a scene",
        "Deletes a scene (its pictures stay in the outputs). Destructive: ask the user first, and only call it with "
        "user_confirmed true after the user said yes in this conversation.",
        destructive=True,
    ),
    CodexTool(
        "generate_scene",
        "Illustrate a scene",
        "Generates a new picture of the scene with the user's model, prompt board and characters, on the user's GPU "
        "(up to a minute or more). Waits for the picture. Only when the user asks for pictures.",
        timeout_s=GENERATION_TOOL_TIMEOUT_S,
    ),
    CodexTool(
        "generate_missing_scenes",
        "Illustrate the missing scenes",
        "Generates a picture for every scene of the story that has none, one after the other (long). Only when the "
        "user asks for pictures.",
        timeout_s=GENERATION_TOOL_TIMEOUT_S,
    ),
)

TOOLS_BY_NAME: dict[str, CodexTool] = {tool.name: tool for tool in CODEX_TOOLS}
assert set(TOOLS_BY_NAME) == set(CODEX_TOOL_ARGUMENTS), "every tool needs its arguments model and its description"
