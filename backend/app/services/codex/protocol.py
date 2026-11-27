"""THE reading of Codex app-server items (protocol v2 `ThreadItem`s, from item/started, item/completed and the thread
history) as conversation entries. Pure functions: the service feeds them the JSON Codex sends.

Entries keep the item ids. A user message drops its <app-context> block; an app tool call (an `mcpToolCall` of the
prompt_weaver server) shows what the frontend reported (the `_meta` activity of its result), else nothing more than its
tool; other items (reasoning, plans, ...) are not shown, and neither are the tools of other servers (the co-writer's
Codex runs with the app's server only).
"""

from __future__ import annotations

from typing import Any

from ...schemas import CodexEntry, CodexEntryStatus
from .instructions import strip_app_context

APP_MCP_SERVER = "prompt_weaver"
# Where a tool result carries what people read about it (the frontend's summary and target): CallToolResult._meta.
ACTIVITY_META_KEY = "prompt_weaver/activity"

STOPPED_NOTICE = "Stopped."


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def user_message_text(content: Any) -> str:
    """The user's own words of a userMessage item (its text inputs, without the app context, whether Codex kept it
    as an input of its own or merged it into the text)."""
    parts = [
        strip_app_context(_text(part.get("text")))
        for part in (content if isinstance(content, list) else [])
        if isinstance(part, dict) and part.get("type") == "text"
    ]
    return "\n".join(part for part in parts if part).strip()


def activity_of(result: Any) -> dict[str, Any] | None:
    """The frontend's report of a tool call ({ok, summary, story_id, scene_id}) carried by its result."""
    meta = result.get("_meta") if isinstance(result, dict) else None
    activity = meta.get(ACTIVITY_META_KEY) if isinstance(meta, dict) else None
    return activity if isinstance(activity, dict) else None


def result_text(result: Any) -> str:
    content = result.get("content") if isinstance(result, dict) else None
    texts = [_text(item.get("text")) for item in (content if isinstance(content, list) else []) if isinstance(item, dict)]
    return "\n".join(text for text in texts if text)


def _ref(value: Any, prefix: str) -> str | None:
    return value if isinstance(value, str) and value.startswith(prefix) else None


def tool_entry(item: dict[str, Any], fallback: dict[str, Any] | None = None) -> CodexEntry | None:
    """An app tool call item as a tool entry (None for another server's tool). `fallback`: the activity reported for
    this call when the item's result does not carry it."""
    if item.get("server") != APP_MCP_SERVER:
        return None
    arguments = item.get("arguments") if isinstance(item.get("arguments"), dict) else {}
    result = item.get("result")
    activity = activity_of(result) or fallback
    error = item.get("error")
    error_message = _text(error.get("message")) if isinstance(error, dict) else ""
    state = item.get("status")
    status: CodexEntryStatus
    if state == "inProgress":
        status = "running"
    elif state == "failed" or error_message or (activity is not None and activity.get("ok") is False):
        status = "failed"
    else:
        status = "completed"
    if status == "running":
        text = ""
    elif activity is not None and _text(activity.get("summary")):
        text = _text(activity.get("summary"))
    else:
        text = error_message or (result_text(result) if status == "failed" else "")
    source = activity or {}
    return CodexEntry(
        id=str(item.get("id")),
        kind="tool",
        text=text,
        status=status,
        tool=_text(item.get("tool")) or None,
        story_id=_ref(source.get("story_id"), "sty-") or _ref(arguments.get("story_id"), "sty-"),
        scene_id=_ref(source.get("scene_id"), "scn-") or _ref(arguments.get("scene_id"), "scn-"),
    )


def entry_of(item: Any, *, completed: bool, fallback: dict[str, Any] | None = None, users: bool = True) -> CodexEntry | None:
    """The entry of a ThreadItem (None when it is not shown). `completed`: the item ended (item/completed, history).
    `users`: show user messages (history; live, the service adds the user's entry itself)."""
    if not isinstance(item, dict) or not isinstance(item.get("id"), str):
        return None
    kind = item.get("type")
    if kind == "agentMessage":
        return CodexEntry(id=item["id"], kind="assistant", text=_text(item.get("text")), status="completed" if completed else "running")
    if kind == "userMessage" and users:
        text = user_message_text(item.get("content"))
        return CodexEntry(id=item["id"], kind="user", text=text) if text else None
    if kind == "mcpToolCall":
        return tool_entry(item, fallback)
    return None


def turn_error_message(turn: Any) -> str | None:
    """The message of a failed turn (None when it did not fail)."""
    if not isinstance(turn, dict) or turn.get("status") != "failed":
        return None
    error = turn.get("error")
    return _text(error.get("message")) if isinstance(error, dict) and _text(error.get("message")) else "Codex could not answer."


def is_unauthorized(error: Any) -> bool:
    """A turn error saying the user is not signed in (codexErrorInfo 'unauthorized')."""
    info = error.get("codexErrorInfo") if isinstance(error, dict) else None
    return info == "unauthorized" or (isinstance(info, dict) and "unauthorized" in info)


def entries_of_turns(turns: Any) -> list[CodexEntry]:
    """A thread's history (turns with their items, oldest first) as entries."""
    entries: list[CodexEntry] = []
    for turn in turns if isinstance(turns, list) else []:
        if not isinstance(turn, dict):
            continue
        for item in turn.get("items") or []:
            entry = entry_of(item, completed=True)
            if entry is not None:
                if entry.status == "running":
                    entry = entry.model_copy(update={"status": "failed"})
                entries.append(entry)
        turn_id = _text(turn.get("id")) or str(len(entries))
        message = turn_error_message(turn)
        if message:
            entries.append(CodexEntry(id=f"{turn_id}:error", kind="error", text=message))
        elif turn.get("status") == "interrupted":
            entries.append(CodexEntry(id=f"{turn_id}:stopped", kind="notice", text=STOPPED_NOTICE))
    return entries
