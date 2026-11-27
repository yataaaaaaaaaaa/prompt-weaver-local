"""The co-writer's conversations (services/codex/conversations.py: one per story, the draft, adoption, New
conversation, the saved index), the reading of Codex items as entries (services/codex/protocol.py), the app context
(services/codex/instructions.py), the tool broker's routing (services/codex/broker.py) and the launch options."""

from __future__ import annotations

import dataclasses
import json
import threading
import time
from pathlib import Path
from typing import Any

import app.services.codex.broker as broker_module
from app.schemas import CodexEntry, CodexToolResult, Story
from app.services.codex.broker import NOT_RUNNING_MESSAGE, WINDOW_CLOSED_MESSAGE, ToolBroker, ToolTurn
from app.services.codex.conversations import ConversationRegistry
from app.services.codex.instructions import app_context, strip_app_context
from app.services.codex.protocol import entries_of_turns, entry_of, is_unauthorized, tool_entry
from app.services.codex.service import _account_of, launch_arguments
from app.services.codex.tools import TOOLS_BY_NAME

STORY = "sty-000000000001"
OTHER = "sty-000000000002"
SCENE = "scn-000000000001"


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------


def test_one_conversation_per_story_and_a_draft(tmp_path: Path) -> None:
    registry = ConversationRegistry(tmp_path / "conversations.json")

    story = registry.for_story(STORY)
    draft = registry.for_story(None)

    assert registry.for_story(STORY) is story
    assert registry.for_story(None) is draft
    assert (story.story_ids, story.draft, draft.story_ids, draft.draft) == ([STORY], False, [], True)
    assert story.id.startswith("cnv-") and story.id != draft.id
    registry.save()
    assert json.loads((tmp_path / "conversations.json").read_text(encoding="utf-8")) == {"version": 1, "conversations": []}


def test_conversations_with_a_thread_are_saved_and_read_back(tmp_path: Path) -> None:
    path = tmp_path / "conversations.json"
    registry = ConversationRegistry(path)
    story = registry.for_story(STORY)
    story.thread_id = "thread-1"
    story.entries.append(CodexEntry(id="u1", kind="user", text="hi"))
    registry.save()

    reread = ConversationRegistry(path).for_story(STORY)

    assert (reread.id, reread.thread_id, reread.story_ids, reread.entries, reread.history_loaded) == (story.id, "thread-1", [STORY], [], False)


def test_an_unreadable_or_other_version_file_reads_as_empty(tmp_path: Path) -> None:
    path = tmp_path / "conversations.json"
    path.write_text('{"version": 2, "conversations": [{"id": "cnv-000000000001", "thread_id": "t"}]}', encoding="utf-8")
    assert ConversationRegistry(path).all() == []
    path.write_text('{"version": 1, "conversations": [{"id": "bad"}, {"id": "cnv-000000000001", "thread_id": "t", "story_ids": ["nope", "sty-000000000001"]}]}', encoding="utf-8")
    (item,) = ConversationRegistry(path).all()
    assert (item.id, item.story_ids) == ("cnv-000000000001", [STORY])


def test_a_story_created_in_a_conversation_joins_it(tmp_path: Path) -> None:
    registry = ConversationRegistry(tmp_path / "conversations.json")
    draft = registry.for_story(None)
    draft.thread_id = "thread-1"

    assert registry.adopt(draft, STORY) is True
    assert registry.adopt(draft, STORY) is False
    assert (draft.story_ids, draft.draft) == ([STORY], False)
    assert registry.for_story(STORY) is draft
    assert registry.for_story(None) is not draft
    registry.adopt(draft, OTHER)
    assert registry.for_story(OTHER) is draft


def test_the_empty_conversation_a_new_story_got_meanwhile_goes(tmp_path: Path) -> None:
    registry = ConversationRegistry(tmp_path / "conversations.json")
    writing = registry.for_story(STORY)
    writing.thread_id = "thread-1"
    meanwhile = registry.for_story(OTHER)  # the window showed the new story before the tool's result came back

    registry.adopt(writing, OTHER)

    assert meanwhile not in registry.all()
    assert registry.for_story(OTHER) is writing


def test_new_conversation_detaches_the_story(tmp_path: Path) -> None:
    registry = ConversationRegistry(tmp_path / "conversations.json")
    shared = registry.for_story(STORY)
    shared.thread_id = "thread-1"
    registry.adopt(shared, OTHER)

    previous, fresh = registry.reset(STORY)

    assert previous is shared and shared.story_ids == [OTHER]
    assert (fresh.story_ids, fresh.thread_id, fresh.entries) == ([STORY], None, [])
    assert registry.for_story(STORY) is fresh
    _previous, again = registry.reset(OTHER)
    assert shared not in registry.all()  # no story left
    assert registry.for_story(OTHER) is again


def test_deleted_stories_leave_their_conversations(tmp_path: Path) -> None:
    registry = ConversationRegistry(tmp_path / "conversations.json")
    conversation = registry.for_story(STORY)
    registry.adopt(conversation, OTHER)

    registry.forget_stories({OTHER})

    assert conversation.story_ids == [OTHER]


# ---------------------------------------------------------------------------
# Codex items -> entries
# ---------------------------------------------------------------------------

CONTEXT = app_context(None, None, 0)


def test_user_messages_drop_the_app_context() -> None:
    separate = {"type": "userMessage", "id": "u", "content": [{"type": "text", "text": CONTEXT}, {"type": "text", "text": "Write it"}]}
    merged = {"type": "userMessage", "id": "u", "content": [{"type": "text", "text": f"{CONTEXT}\nWrite it"}]}

    assert entry_of(separate, completed=True) == CodexEntry(id="u", kind="user", text="Write it")
    assert entry_of(merged, completed=True) == CodexEntry(id="u", kind="user", text="Write it")
    assert entry_of(separate, completed=True, users=False) is None
    assert strip_app_context(CONTEXT) == ""


def test_agent_messages_and_ignored_items() -> None:
    assert entry_of({"type": "agentMessage", "id": "a", "text": "Hi"}, completed=False) == CodexEntry(id="a", kind="assistant", text="Hi", status="running")
    assert entry_of({"type": "reasoning", "id": "r", "summary": []}, completed=True) is None
    assert entry_of({"type": "commandExecution", "id": "c"}, completed=True) is None
    assert entry_of({"no": "id"}, completed=True) is None


def tool_item(**changes: Any) -> dict[str, Any]:
    return {"type": "mcpToolCall", "id": "t", "server": "prompt_weaver", "tool": "update_scene", "status": "inProgress", "arguments": {"story_id": STORY, "scene_id": SCENE}, "result": None, "error": None, **changes}


def test_app_tool_calls_show_what_the_frontend_reported() -> None:
    meta = {"prompt_weaver/activity": {"ok": True, "summary": "Edited The storm", "story_id": STORY, "scene_id": SCENE}}

    assert tool_entry(tool_item()) == CodexEntry(id="t", kind="tool", text="", status="running", tool="update_scene", story_id=STORY, scene_id=SCENE)
    done = tool_entry(tool_item(status="completed", result={"content": [{"type": "text", "text": "{}"}], "_meta": meta}))
    assert (done.status, done.text) == ("completed", "Edited The storm")  # type: ignore[union-attr]
    failed = tool_entry(tool_item(status="completed", result={"content": [], "_meta": {"prompt_weaver/activity": {"ok": False, "summary": "No such scene"}}}))
    assert (failed.status, failed.text) == ("failed", "No such scene")  # type: ignore[union-attr]
    errored = tool_entry(tool_item(status="failed", error={"message": "timed out"}))
    assert (errored.status, errored.text) == ("failed", "timed out")  # type: ignore[union-attr]
    fallback = tool_entry(tool_item(status="completed", result={"content": []}), {"ok": True, "summary": "From the broker", "story_id": OTHER})
    assert (fallback.text, fallback.story_id) == ("From the broker", OTHER)  # type: ignore[union-attr]
    assert tool_entry(tool_item(server="other")) is None


def test_a_thread_history_becomes_entries() -> None:
    turns = [
        {"id": "t1", "status": "completed", "items": [
            {"type": "userMessage", "id": "u1", "content": [{"type": "text", "text": CONTEXT}, {"type": "text", "text": "Hello"}]},
            {"type": "reasoning", "id": "r1"},
            {"type": "agentMessage", "id": "a1", "text": "Hi!"},
        ]},
        {"id": "t2", "status": "interrupted", "items": [tool_item(id="x1")]},
        {"id": "t3", "status": "failed", "error": {"message": "Rate limited"}, "items": []},
    ]  # fmt: skip

    assert [(entry.kind, entry.status, entry.text) for entry in entries_of_turns(turns)] == [
        ("user", "completed", "Hello"),
        ("assistant", "completed", "Hi!"),
        ("tool", "failed", ""),
        ("notice", "completed", "Stopped."),
        ("error", "completed", "Rate limited"),
    ]


def test_unauthorized_errors() -> None:
    assert is_unauthorized({"codexErrorInfo": "unauthorized"})
    assert not is_unauthorized({"codexErrorInfo": "usageLimitExceeded"})
    assert not is_unauthorized(None)


def test_the_app_context_names_the_story_and_scene_shown() -> None:
    story = Story.model_validate({
        "id": STORY, "title": "Rain", "character_ids": [], "created_at": "2026-11-27T00:00:00Z", "updated_at": "2026-11-27T00:00:00Z",
        "scenes": [{"id": SCENE, "title": "Platform", "text": "", "created_at": "2026-11-27T00:00:00Z", "updated_at": "2026-11-27T00:00:00Z"}],
    })  # fmt: skip

    assert app_context(story, SCENE, 3).splitlines() == [
        "<app-context>",
        f'Story shown: "Rain" (story_id: {STORY}), 1 scenes.',
        f'Scene selected: "Platform" (scene_id: {SCENE}), position 1.',
        "</app-context>",
    ]
    assert app_context(story, None, 3).splitlines()[2] == "No scene is selected."
    assert app_context(None, None, 1).splitlines()[1] == "No story is shown. The user has 1 story."


# ---------------------------------------------------------------------------
# Launch options, account
# ---------------------------------------------------------------------------


def test_launch_arguments_disable_what_exists_only() -> None:
    arguments = launch_arguments("http://127.0.0.1:1/mcp", other_mcp_servers=["node_repl", "has.dot", "prompt_weaver"], enabled_features={"shell_tool", "sleep_tool"})

    assert arguments[-4:] == ["-c", "mcp_servers.node_repl.enabled=false", "--disable", "shell_tool"]
    assert not any("has.dot" in argument for argument in arguments)
    assert "mcp_servers.prompt_weaver.enabled=false" not in arguments
    assert [arguments[index + 1] for index, value in enumerate(arguments) if value == "--disable"] == ["shell_tool"]


def test_account_states() -> None:
    assert _account_of({"account": {"type": "chatgpt", "email": "x@example.com"}, "requiresOpenaiAuth": True}) == ("chatgpt", True)
    assert _account_of({"account": {"type": "apiKey"}, "requiresOpenaiAuth": True}) == ("api_key", True)
    assert _account_of({"account": None, "requiresOpenaiAuth": True}) == (None, False)
    assert _account_of({"account": None, "requiresOpenaiAuth": False}) == (None, True)


# ---------------------------------------------------------------------------
# Broker
# ---------------------------------------------------------------------------


class Recorder:
    def __init__(self) -> None:
        self.events: list[Any] = []
        self.outcomes: list[Any] = []
        self.connected = {"window-1"}
        self.turn: ToolTurn | None = ToolTurn(conversation_id="cnv-000000000001", client_id="window-1")

    def broker(self) -> ToolBroker:
        return ToolBroker(
            publish=self.events.append,
            is_connected=lambda client: client in self.connected,
            current_turn=lambda: self.turn,
            on_outcome=lambda _turn, outcome: self.outcomes.append(outcome),
        )


def call_in_thread(broker: ToolBroker, tool: str, arguments: dict[str, Any]) -> list[Any]:
    box: list[Any] = []
    thread = threading.Thread(target=lambda: box.append(broker.call(tool, arguments)))
    thread.start()
    return [thread, box]


def wait_for(predicate: Any) -> None:
    deadline = time.monotonic() + 5
    while not predicate():
        assert time.monotonic() < deadline
        time.sleep(0.01)


def test_a_call_waits_for_the_frontend() -> None:
    recorder = Recorder()
    broker = recorder.broker()
    thread, box = call_in_thread(broker, "get_story", {"story_id": STORY})
    wait_for(lambda: recorder.events)

    call = recorder.events[0].call
    assert (call.tool, call.client_id, call.arguments.story_id) == ("get_story", "window-1", STORY)
    assert broker.resolve(call.call_id, CodexToolResult(ok=True, text="{}", summary="Read Rain", story_id=STORY))
    thread.join(5)
    assert box[0].call_tool_result() == {
        "content": [{"type": "text", "text": "{}"}],
        "isError": False,
        "_meta": {"prompt_weaver/activity": {"ok": True, "summary": "Read Rain", "story_id": STORY, "scene_id": None, "character_id": None}},
    }
    assert broker.resolve(call.call_id, CodexToolResult(ok=True, text="", summary="")) is False
    assert broker.pending() == 0


def test_calls_without_a_turn_fail_at_once() -> None:
    recorder = Recorder()
    recorder.turn = None

    outcome = recorder.broker().call("list_stories", {})

    assert (outcome.result.ok, outcome.result.text) == (False, NOT_RUNNING_MESSAGE)
    assert recorder.events == []


def test_a_closed_window_fails_its_running_calls() -> None:
    recorder = Recorder()
    broker = recorder.broker()
    thread, box = call_in_thread(broker, "list_stories", {})
    wait_for(lambda: recorder.events)

    broker.cancel_client("window-1")
    thread.join(5)

    assert (box[0].result.ok, box[0].result.text) == (False, WINDOW_CLOSED_MESSAGE)
    assert recorder.events[-1].kind == "tool_cancel"


def test_a_call_that_takes_too_long_is_abandoned(monkeypatch: Any) -> None:
    recorder = Recorder()
    broker = recorder.broker()
    quick = dataclasses.replace(TOOLS_BY_NAME["list_stories"], timeout_s=0.05)
    monkeypatch.setitem(broker_module.TOOLS_BY_NAME, "list_stories", quick)

    outcome = broker.call("list_stories", {})

    assert (outcome.result.ok, outcome.result.text) == (False, "List stories took longer than 0.05 s and was abandoned.")
    assert [event.kind for event in recorder.events] == ["tool_call", "tool_cancel"]
    assert recorder.outcomes == [outcome]
