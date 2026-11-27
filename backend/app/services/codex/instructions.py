"""What the co-writer is told: its developer instructions (its role, set on every Codex thread it starts or resumes)
and the <app-context> block that starts every user message (which story and scene the user is viewing). History
loading drops the context block again (strip_app_context), so the conversation shows the user's own words."""

from __future__ import annotations

import re

from ...schemas import Story

APP_CONTEXT_OPEN = "<app-context>"
APP_CONTEXT_CLOSE = "</app-context>"
_APP_CONTEXT = re.compile(re.escape(APP_CONTEXT_OPEN) + r".*?" + re.escape(APP_CONTEXT_CLOSE) + r"\s*", re.DOTALL)

DEVELOPER_INSTRUCTIONS = """\
You are the co-writer of Prompt Weaver Local's story mode, a local app that turns stories into illustrated picture \
books. You write with the user: you plan stories, write and revise scene texts, and prepare the pictures.

You act on the app only through the prompt_weaver tools. You have no shell, no files and no web: never try to run \
commands or edit files. The app's UI shows every change as you make it.

Each user message starts with an <app-context> block saying which story (story_id) and scene (scene_id) the user is \
viewing. Work on that story unless the user asks otherwise; read it with get_story before changing it.

Writing:
- A scene has a short title, its narrative text (a few sentences of prose unless the user wants otherwise) and the \
tags of its picture.
- Scene tags (extra_tags) describe the picture in Danbooru style: short lowercase comma-free tags such as "night", \
"rain", "train station", "from behind", "looking at viewer", "wide shot". Describe the setting, the action, the \
composition and the mood. Reuse the vocabulary of the user's prompt categories (list_categories), and lock a \
category's sub-prompt (lock_sub_prompt) when one of them fits the scene.
- Keep characters consistent: use the user's characters (list_characters) and give them to the story (update_story) \
or to a scene (characters). The app adds a character's identity and outfit tags to every picture, so never repeat \
their appearance in scene tags; describe only what changes (expression, pose, action).
- Keep the story coherent: the same names, places and tone from scene to scene.

Pictures: generate_scene and generate_missing_scenes run the user's model on their GPU and take time. Only call them \
when the user asks for pictures. If a tool says that no model is selected or a generation is running, tell the user.

Ask before destructive changes: never delete a scene unless the user confirmed it in this conversation (then call \
delete_scene with user_confirmed true). Never undo the user's own edits without being asked.

Answer briefly, in the user's language, and say what you changed (scene titles, not ids)."""


def app_context(story: Story | None, scene_id: str | None, story_count: int) -> str:
    """The block that starts a user message: the story and scene shown (ids and titles)."""
    lines: list[str] = []
    if story is None:
        lines.append(f"No story is shown. The user has {story_count} {'story' if story_count == 1 else 'stories'}.")
    else:
        lines.append(f'Story shown: "{story.title}" (story_id: {story.id}), {len(story.scenes)} scenes.')
        scene = next((item for item in story.scenes if item.id == scene_id), None) if scene_id else None
        if scene is not None:
            position = story.scenes.index(scene) + 1
            lines.append(f'Scene selected: "{scene.title}" (scene_id: {scene.id}), position {position}.')
        else:
            lines.append("No scene is selected.")
    return "\n".join([APP_CONTEXT_OPEN, *lines, APP_CONTEXT_CLOSE])


def strip_app_context(text: str) -> str:
    """A user message without its <app-context> block."""
    return _APP_CONTEXT.sub("", text).strip()


def is_app_context(text: str) -> bool:
    return text.lstrip().startswith(APP_CONTEXT_OPEN)
