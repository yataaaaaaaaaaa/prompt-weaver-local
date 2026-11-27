"""The co-writer end to end over the API, with the fake Codex app-server (tests/fake_codex.py) as the user's Codex:
discovery and login states, settings, streamed answers over /ws/tasks, the app's tools (MCP -> the frontend window ->
the result back to Codex), Stop, a crash and its restart, resuming a conversation after a restart, the conversation of
a story created by the co-writer, New conversation, and the restrictions Codex runs with."""

from __future__ import annotations

import json
import queue
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.factory import create_app
from app.services.codex.broker import NOT_CONNECTED_MESSAGE
from app.services.codex.instructions import APP_CONTEXT_OPEN
from app.services.codex.service import MCP_TOKEN_ENV, SIGNED_OUT_MESSAGE, CodexRuntime
from app.settings import AppPaths
from codex_support import FAKE_CODEX_SCRIPT, FakeCodex, no_codex_runtime
from support import CountingFactory, FakeGenerator, FakeHttp

CLIENT = "window-test-0001"
Message = dict[str, Any]


@pytest.fixture()
def fake_codex(tmp_path: Path) -> FakeCodex:
    return FakeCodex(tmp_path / "fake-codex")


@pytest.fixture()
def codex_runtime(fake_codex: FakeCodex) -> CodexRuntime:
    return fake_codex.runtime()


class Socket:
    """/ws/tasks of one window, read on a thread (so waits can time out)."""

    def __init__(self, client: TestClient, client_id: str = CLIENT) -> None:
        self._context = client.websocket_connect(f"/ws/tasks?client_id={client_id}")
        self._socket = self._context.__enter__()
        self.messages: queue.Queue[Message] = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self) -> None:
        try:
            while True:
                self.messages.put(self._socket.receive_json())
        except Exception:
            return

    def close(self) -> None:
        self._context.__exit__(None, None, None)

    def codex_events(self, until: Callable[[Message], bool], timeout: float = 20.0) -> list[Message]:
        """The codex events up to the first one `until` accepts."""
        events: list[Message] = []
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                message = self.messages.get(timeout=0.1)
            except queue.Empty:
                continue
            if message.get("type") == "codex":
                events.append(message)
                if until(message):
                    return events
        raise AssertionError(f"Timed out; codex events so far: {[event['kind'] for event in events]}")


def turn_ended(event: Message) -> bool:
    return event["kind"] == "conversation" and not event["conversation"]["running"] and len(event["conversation"]["entries"]) > 1


@pytest.fixture()
def socket(client: TestClient) -> Iterator[Socket]:
    connected = Socket(client)
    yield connected
    connected.close()


def create_story(client: TestClient, title: str = "The harbor") -> dict[str, Any]:
    response = client.post("/api/stories", json={"title": title})
    assert response.status_code == 200, response.text
    return response.json()


def send(client: TestClient, text: str, story_id: str | None = None, client_id: str = CLIENT, scene_id: str | None = None) -> Any:
    response = client.post("/api/codex/turns", json={"story_id": story_id, "scene_id": scene_id, "text": text, "client_id": client_id})
    assert response.status_code == 200, response.text
    return response.json()


def entries(conversation: Message) -> list[tuple[str, str, str]]:
    return [(entry["kind"], entry["status"], entry["text"]) for entry in conversation["entries"]]


def answer_tools(client: TestClient, socket: Socket, results: Callable[[Message], Message], until: Callable[[Message], bool] = turn_ended) -> list[Message]:
    """Plays the frontend: answers every tool call with `results(call)` until the turn ended."""

    def step(event: Message) -> bool:
        if event["kind"] == "tool_call":
            call = event["call"]
            response = client.post(f"/api/codex/tool-calls/{call['call_id']}/result", json=results(call))
            assert response.status_code == 200, response.text
        return until(event)

    return socket.codex_events(step)


# ---------------------------------------------------------------------------
# Status, discovery, login, settings
# ---------------------------------------------------------------------------


def test_status_reports_the_found_codex_its_version_login_and_models(client: TestClient) -> None:
    status = client.get("/api/codex/status").json()

    assert status == {
        "state": "ready",
        "message": "",
        "path": str(FAKE_CODEX_SCRIPT),
        "source": "path",
        "version": "0.169.0-fake",
        "configured_path": None,
        "searched": [],
        "account": "chatgpt",
        "default_model": "gpt-fake",
        "model": None,
        "models": [{"id": "gpt-fake", "name": "GPT Fake"}, {"id": "gpt-fake-mini", "name": "GPT Fake Mini"}],
        "running": False,
    }


def test_status_without_codex_says_where_it_looked(app_paths: AppPaths) -> None:
    app = create_app(paths=app_paths, generator_factory=CountingFactory(FakeGenerator()), http_client_factory=FakeHttp().client_factory, codex_runtime=no_codex_runtime(), install_signal_handlers=False)
    with TestClient(app) as client:
        status = client.get("/api/codex/status").json()
        assert (status["state"], status["path"]) == ("not_found", None)
        assert "Codex was not found" in status["message"]
        refused = client.post("/api/codex/turns", json={"text": "hello", "client_id": CLIENT})
        assert refused.status_code == 409
        assert "Codex was not found" in refused.json()["detail"]


def test_not_found_then_the_user_sets_the_path(tmp_path: Path, app_paths: AppPaths) -> None:
    fake = FakeCodex(tmp_path / "fake", installed=False)
    app = create_app(paths=app_paths, generator_factory=CountingFactory(FakeGenerator()), http_client_factory=FakeHttp().client_factory, codex_runtime=fake.runtime(), install_signal_handlers=False)
    with TestClient(app) as client:
        status = client.get("/api/codex/status").json()
        assert (status["state"], status["searched"]) == ("not_found", ["codex on PATH"])

        missing = client.put("/api/codex/settings", json={"path": str(tmp_path / "gone" / "codex.exe")}).json()
        assert missing["state"] == "not_found"
        assert missing["message"].startswith(f"The Codex path you set was not found: {tmp_path / 'gone' / 'codex.exe'}.")
        assert missing["searched"] == [str(tmp_path / "gone" / "codex.exe"), "codex on PATH"]

        found = client.put("/api/codex/settings", json={"path": str(FAKE_CODEX_SCRIPT)}).json()
        assert (found["state"], found["source"], found["configured_path"]) == ("ready", "configured", str(FAKE_CODEX_SCRIPT))

        cleared = client.put("/api/codex/settings", json={"path": None}).json()
        assert (cleared["state"], cleared["configured_path"]) == ("not_found", None)
    saved = json.loads(app_paths.settings_file.read_text(encoding="utf-8"))
    assert saved == {"version": 1, "provider_tokens": {}}


def test_signed_out_codex_asks_the_user_to_sign_in_through_the_app(client: TestClient, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(account=None)

    status = client.get("/api/codex/status?refresh=true").json()

    assert (status["state"], status["message"], status["account"], status["models"]) == ("signed_out", SIGNED_OUT_MESSAGE, None, [])
    assert status["version"] == "0.169.0-fake"
    assert client.post("/api/codex/turns", json={"text": "hello", "client_id": CLIENT}).status_code == 409

    fake_codex.update_scenario(account="chatgpt")
    assert client.get("/api/codex/status").json()["state"] == "signed_out"  # cached until Retry
    assert client.get("/api/codex/status?refresh=true").json()["state"] == "ready"


def test_a_codex_that_cannot_start_is_an_error_with_its_message(client: TestClient, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(fail_start="Error: this Codex build is broken")

    status = client.get("/api/codex/status").json()

    assert (status["state"], status["message"]) == ("error", "Codex could not start: Error: this Codex build is broken")


def test_the_model_setting_is_used_for_every_turn(client: TestClient, socket: Socket, fake_codex: FakeCodex, app_paths: AppPaths) -> None:
    status = client.put("/api/codex/settings", json={"model": "gpt-fake-mini"}).json()
    assert (status["model"], status["default_model"]) == ("gpt-fake-mini", "gpt-fake")

    send(client, "hello")
    socket.codex_events(turn_ended)

    assert [params.get("model") for params in fake_codex.requests("turn/start")] == ["gpt-fake-mini"]
    assert fake_codex.requests("thread/start")[0]["model"] == "gpt-fake-mini"
    assert json.loads(app_paths.settings_file.read_text(encoding="utf-8"))["codex"] == {"model": "gpt-fake-mini"}
    assert client.put("/api/codex/settings", json={"model": None}).json()["model"] is None


# ---------------------------------------------------------------------------
# Messages, streaming, restrictions
# ---------------------------------------------------------------------------


def test_a_message_streams_the_answer_to_every_window(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[{"say": "Once upon a time, a harbor."}])
    story = create_story(client)

    sent = send(client, "  Write the opening  ", story["id"])

    assert sent["story_ids"] == [story["id"]]
    assert sent["running"] is True
    assert entries(sent) == [("user", "completed", "Write the opening")]
    events = socket.codex_events(turn_ended)
    kinds = [event["kind"] for event in events]
    assert kinds.count("delta") >= 4
    deltas = "".join(event["delta"] for event in events if event["kind"] == "delta")
    first_assistant = next(event["entry"] for event in events if event["kind"] == "entry" and event["entry"]["kind"] == "assistant")
    assert first_assistant["text"] + deltas == "Once upon a time, a harbor."
    final = events[-1]["conversation"]
    assert entries(final) == [("user", "completed", "Write the opening"), ("assistant", "completed", "Once upon a time, a harbor.")]
    assert client.get(f"/api/codex/conversation?story_id={story['id']}").json() == final
    # Every change has its revision: the frontend orders the HTTP answers and the events by it.
    revisions = [event["conversation"]["revision"] if event["kind"] == "conversation" else event["revision"] for event in events if event["kind"] in {"conversation", "entry", "delta"}]
    assert revisions == sorted(revisions)
    assert sent["revision"] < final["revision"] == revisions[-1]


def test_codex_runs_restricted_to_the_apps_tools(client: TestClient, socket: Socket, fake_codex: FakeCodex, app_paths: AppPaths) -> None:
    fake_codex.update_scenario(
        features=[{"name": "shell_tool", "enabled": True}, {"name": "apps", "enabled": True}, {"name": "plugins", "enabled": False}, {"name": "sleep_tool", "enabled": True}],
        mcp_servers={"node_repl": {"command": "node"}, "off_server": {"enabled": False}},
    )
    story = create_story(client)
    scene = client.post(f"/api/stories/{story['id']}/scenes", json={"title": "Dock"}).json()["scenes"][0]

    send(client, "hello", story["id"], scene_id=scene["id"])
    socket.codex_events(turn_ended)

    probe, launched = fake_codex.starts()
    assert probe == []
    url = launched[7]
    assert url.startswith('mcp_servers.prompt_weaver.url="http://127.0.0.1:') and url.endswith('/mcp"')
    assert launched == [
        "-c", 'sandbox_mode="read-only"', "-c", 'approval_policy="never"', "-c", 'web_search="disabled"', "-c", url,
        "-c", f'mcp_servers.prompt_weaver.bearer_token_env_var="{MCP_TOKEN_ENV}"', "-c", "mcp_servers.prompt_weaver.startup_timeout_sec=30",
        "-c", "mcp_servers.prompt_weaver.tool_timeout_sec=1860", "-c", 'mcp_servers.prompt_weaver.default_tools_approval_mode="approve"',
        "-c", "mcp_servers.node_repl.enabled=false", "--disable", "shell_tool", "--disable", "apps",
    ]  # fmt: skip
    assert [record["token_set"] for record in fake_codex.records() if "start" in record] == [False, True]
    (thread,) = fake_codex.requests("thread/start")
    assert (thread["cwd"], thread["approvalPolicy"], thread["sandbox"]) == (str(app_paths.codex_workspace_dir), "never", "read-only")
    assert "co-writer of Prompt Weaver Local" in thread["developerInstructions"]
    assert list(app_paths.codex_workspace_dir.iterdir()) == []
    (turn,) = fake_codex.requests("turn/start")
    context, words = (part["text"] for part in turn["input"])
    assert context.startswith(APP_CONTEXT_OPEN)
    assert f'Story shown: "The harbor" (story_id: {story["id"]}), 1 scenes.' in context
    assert f'Scene selected: "Dock" (scene_id: {scene["id"]}), position 1.' in context
    assert words == "hello"
    tools = next(record["mcp_tools"] for record in fake_codex.records() if "mcp_tools" in record)
    assert len(tools) == 23 and "add_scenes" in tools and "generate_scenes" in tools and "view_images" in tools


def test_commands_codex_asks_to_run_are_declined(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[{"request_approval": "command"}])

    send(client, "list my files")
    final = socket.codex_events(turn_ended)[-1]["conversation"]

    assert entries(final)[-1] == ("assistant", "completed", "Approval: decline")


def test_one_answer_at_a_time(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[{"sleep_ms": 1500}, {"say": "Done."}])
    story = create_story(client)
    send(client, "first", story["id"])

    busy = client.post("/api/codex/turns", json={"text": "second", "client_id": CLIENT})
    assert busy.status_code == 409
    assert busy.json()["detail"] == "Codex is still answering. Stop it or wait for its answer."
    socket.codex_events(turn_ended)
    send(client, "second")


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

ADD_HARBOR = [
    {"say": "Adding it."},
    {"tool": "add_scenes", "arguments": {"story_id": "{context.story_id}", "scenes": [{"title": "Harbor", "text": "Boats sway."}]}},
    {"say": "Codex read: {last.text}"},
]


def test_a_tool_call_runs_in_the_window_that_sent_the_message(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=ADD_HARBOR)
    story = create_story(client)
    other_window = Socket(client, "window-test-0002")
    calls: list[Message] = []

    def frontend(call: Message) -> Message:
        calls.append(call)
        return {"ok": True, "text": '{"scene_id": "scn-00000000000a", "position": 1}', "summary": "Added Scene 1 · Harbor", "story_id": story["id"], "scene_id": "scn-00000000000a"}

    send(client, "add a harbor", story["id"])
    events = answer_tools(client, socket, frontend)

    (call,) = calls
    assert (call["tool"], call["client_id"], call["conversation_id"]) == ("add_scenes", CLIENT, events[-1]["conversation"]["id"])
    # Validated arguments, with their defaults.
    assert call["arguments"] == {
        "story_id": story["id"],
        "position": None,
        "scenes": [{
            "title": "Harbor", "beat": "", "text": "Boats sway.", "shot": "", "setting": "", "mood": "", "extra_tags": [], "negative_tags": [],
            "locks": [], "loras": [], "characters": "story", "seed": None,
        }],
    }  # fmt: skip
    tool_entries = [event["entry"] for event in events if event["kind"] == "entry" and event["entry"]["kind"] == "tool"]
    assert [(entry["status"], entry["text"], entry["tool"], entry["story_id"], entry["scene_id"]) for entry in tool_entries] == [
        ("running", "", "add_scenes", story["id"], None),
        ("completed", "Added Scene 1 · Harbor", "add_scenes", story["id"], "scn-00000000000a"),
    ]
    assert entries(events[-1]["conversation"])[-1] == ("assistant", "completed", 'Codex read: {"scene_id": "scn-00000000000a", "position": 1}')
    # The other window sees the conversation, and the call (for another window).
    seen = other_window.codex_events(turn_ended)
    assert any(event["kind"] == "tool_call" and event["call"]["client_id"] == CLIENT for event in seen)
    other_window.close()


def test_a_failed_tool_call_is_reported_to_codex_and_shown(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[*ADD_HARBOR[1:]])
    story = create_story(client)

    send(client, "add a harbor", story["id"])
    events = answer_tools(client, socket, lambda _call: {"ok": False, "text": "No model is selected.", "summary": "Could not add the scene: no model"})

    final = events[-1]["conversation"]
    assert entries(final)[1:] == [
        ("tool", "failed", "Could not add the scene: no model"),
        ("assistant", "completed", "Codex read: No model is selected."),
    ]


def test_invalid_tool_arguments_never_reach_the_frontend(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[{"tool": "reorder_scenes", "arguments": {"story_id": "nope", "scene_id": "scn-000000000001", "position": 0, "extra": 1}}, {"say": "{last.text}"}])

    send(client, "move it")
    events = socket.codex_events(turn_ended)

    assert not [event for event in events if event["kind"] == "tool_call"]
    final = events[-1]["conversation"]
    assert entries(final)[1] == ("tool", "failed", "Reorder scenes: invalid arguments")
    said = entries(final)[2][2]
    assert said.startswith("Invalid arguments for reorder_scenes: story_id: String should match pattern")
    assert "position: Input should be greater than or equal to 1" in said
    assert "extra: Extra inputs are not permitted" in said


def test_tools_fail_clearly_when_the_window_is_not_connected(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[*ADD_HARBOR[1:]])
    story = create_story(client)

    send(client, "add a harbor", story["id"], client_id="window-gone-0001")
    events = socket.codex_events(turn_ended)

    assert not [event for event in events if event["kind"] == "tool_call"]
    final = events[-1]["conversation"]
    assert entries(final)[1] == ("tool", "failed", "The app window is not connected")
    assert entries(final)[2] == ("assistant", "completed", f"Codex read: {NOT_CONNECTED_MESSAGE}")


def test_a_story_created_by_the_co_writer_joins_its_conversation(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[{"tool": "create_story", "arguments": {"title": "Rain"}}, {"say": "Created."}])
    draft = client.get("/api/codex/conversation").json()
    assert (draft["draft"], draft["story_ids"], draft["entries"]) == (True, [], [])
    story = create_story(client, "Rain")  # what the frontend's create_story does

    send(client, "write a rainy story")
    events = answer_tools(client, socket, lambda _call: {"ok": True, "text": "{}", "summary": "Created Rain", "story_id": story["id"]})

    final = events[-1]["conversation"]
    assert (final["id"], final["draft"], final["story_ids"]) == (draft["id"], False, [story["id"]])
    assert client.get(f"/api/codex/conversation?story_id={story['id']}").json()["id"] == draft["id"]
    fresh_draft = client.get("/api/codex/conversation").json()
    assert fresh_draft["id"] != draft["id"] and fresh_draft["entries"] == []


def test_a_deleted_story_leaves_its_conversation(client: TestClient, socket: Socket, app_paths: AppPaths) -> None:
    kept, deleted = create_story(client, "Kept"), create_story(client, "Deleted")
    send(client, "hello", deleted["id"])
    conversation = socket.codex_events(turn_ended)[-1]["conversation"]

    assert client.delete(f"/api/stories/{deleted['id']}").status_code == 200
    assert client.get(f"/api/codex/conversation?story_id={deleted['id']}").status_code == 404
    client.get(f"/api/codex/conversation?story_id={kept['id']}")

    saved = json.loads(app_paths.codex_conversations_file.read_text(encoding="utf-8"))
    assert saved == {"version": 1, "conversations": []}
    assert conversation["story_ids"] == [deleted["id"]]


def test_new_conversation(client: TestClient, socket: Socket) -> None:
    story = create_story(client)
    send(client, "hello", story["id"])
    first = socket.codex_events(turn_ended)[-1]["conversation"]

    fresh = client.post("/api/codex/conversation/reset", json={"story_id": story["id"]}).json()

    assert fresh["id"] != first["id"]
    assert (fresh["story_ids"], fresh["entries"], fresh["running"]) == ([story["id"]], [], False)
    assert client.get(f"/api/codex/conversation?story_id={story['id']}").json()["id"] == fresh["id"]
    assert client.post("/api/codex/conversation/reset", json={"story_id": "sty-000000000000"}).status_code == 404


# ---------------------------------------------------------------------------
# Stop, crash, resume
# ---------------------------------------------------------------------------


def test_stop_interrupts_the_answer(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(delta_delay_ms=200, default_steps=[{"say": " ".join(["word"] * 40)}])
    sent = send(client, "talk a lot")
    socket.codex_events(lambda event: event["kind"] == "delta")

    client.post(f"/api/codex/conversations/{sent['id']}/interrupt")
    final = socket.codex_events(lambda event: event["kind"] == "conversation" and not event["conversation"]["running"])[-1]["conversation"]

    assistant = final["entries"][1]
    assert assistant["kind"] == "assistant" and assistant["status"] == "completed"
    assert 0 < len(assistant["text"].split()) < 40
    assert entries(final)[-1] == ("notice", "completed", "Stopped.")
    assert client.post("/api/codex/conversations/cnv-000000000000/interrupt").status_code == 404


def test_stop_abandons_a_running_tool_call(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[{"tool": "generate_scenes", "arguments": {"story_id": "{context.story_id}", "scene_ids": ["scn-000000000001"]}}, {"say": "after"}])
    story = create_story(client)
    sent = send(client, "illustrate", story["id"])
    call = next(event for event in socket.codex_events(lambda event: event["kind"] == "tool_call") if event["kind"] == "tool_call")["call"]

    client.post(f"/api/codex/conversations/{sent['id']}/interrupt")
    events = socket.codex_events(lambda event: event["kind"] == "conversation" and not event["conversation"]["running"])

    assert {"type": "codex", "kind": "tool_cancel", "call_id": call["call_id"], "client_id": CLIENT} in events
    late = client.post(f"/api/codex/tool-calls/{call['call_id']}/result", json={"ok": True, "text": "done", "summary": "done"})
    assert late.status_code == 404
    final = events[-1]["conversation"]
    assert entries(final)[1] == ("tool", "failed", "Stopped by the user.")
    assert entries(final)[-1] == ("notice", "completed", "Stopped.")
    assert "after" not in [entry["text"] for entry in final["entries"]]


def test_a_crash_ends_the_turn_and_the_next_message_restarts_codex(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(rules=[{"match": "crash", "steps": [{"say": "Oops"}, {"crash": True}]}], default_steps=[{"say": "Back."}])
    story = create_story(client)

    send(client, "please crash", story["id"])
    final = socket.codex_events(lambda event: event["kind"] == "conversation" and not event["conversation"]["running"] and len(event["conversation"]["entries"]) > 2)[-1]["conversation"]
    assert entries(final)[-1] == ("error", "completed", "Codex stopped unexpectedly (exit code 3). It starts again with your next message.")
    assert client.get("/api/codex/status").json()["running"] is False

    send(client, "hello again", story["id"])
    again = socket.codex_events(lambda event: turn_ended(event) and event["conversation"]["entries"][-1]["text"] == "Back.")[-1]["conversation"]

    assert len(fake_codex.starts()) == 3  # the probe, the first process, the restarted one
    (thread_id,) = fake_codex.threads()
    assert [params["threadId"] for params in fake_codex.requests("thread/resume")] == [thread_id]
    assert [entry["text"] for entry in again["entries"] if entry["kind"] == "user"] == ["please crash", "hello again"]


def test_a_conversation_resumes_after_a_restart(tmp_path: Path, app_paths: AppPaths, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[{"say": "This thread had {turns} earlier turns."}])

    def make_app() -> FastAPI:
        return create_app(paths=app_paths, generator_factory=CountingFactory(FakeGenerator()), http_client_factory=FakeHttp().client_factory, codex_runtime=fake_codex.runtime(), install_signal_handlers=False)

    with TestClient(make_app()) as client:
        story = create_story(client)
        window = Socket(client)
        send(client, "first message", story["id"])
        first = window.codex_events(turn_ended)[-1]["conversation"]
        window.close()
    saved = json.loads(app_paths.codex_conversations_file.read_text(encoding="utf-8"))
    assert saved == {"version": 1, "conversations": [{"id": first["id"], "thread_id": next(iter(fake_codex.threads())), "story_ids": [story["id"]], "draft": False}]}

    with TestClient(make_app()) as client:
        restored = client.get(f"/api/codex/conversation?story_id={story['id']}").json()
        assert restored["id"] == first["id"]
        assert entries(restored) == [("user", "completed", "first message"), ("assistant", "completed", "This thread had 0 earlier turns.")]
        window = Socket(client)
        send(client, "second message", story["id"])
        final = window.codex_events(lambda event: turn_ended(event) and len(event["conversation"]["entries"]) == 4)[-1]["conversation"]
        window.close()
    assert entries(final)[2:] == [("user", "completed", "second message"), ("assistant", "completed", "This thread had 1 earlier turns.")]
    assert len(fake_codex.threads()) == 1


def test_a_thread_codex_lost_starts_over_with_a_notice(app_paths: AppPaths, fake_codex: FakeCodex) -> None:
    def make_app() -> FastAPI:
        return create_app(paths=app_paths, generator_factory=CountingFactory(FakeGenerator()), http_client_factory=FakeHttp().client_factory, codex_runtime=fake_codex.runtime(), install_signal_handlers=False)

    with TestClient(make_app()) as client:
        story = create_story(client)
        window = Socket(client)
        send(client, "first", story["id"])
        window.codex_events(turn_ended)
        window.close()
    (fake_codex.home / "threads.json").unlink()

    with TestClient(make_app()) as client:
        restored = client.get(f"/api/codex/conversation?story_id={story['id']}").json()
        assert entries(restored) == [("notice", "completed", "The earlier conversation could not be found in Codex: your next message starts a new one.")]


def test_an_unauthorized_turn_marks_codex_signed_out(client: TestClient, socket: Socket, fake_codex: FakeCodex) -> None:
    fake_codex.update_scenario(default_steps=[{"fail": "Your session expired. Sign in again.", "info": "unauthorized"}])

    send(client, "hello")
    events = socket.codex_events(turn_ended)

    assert entries(events[-1]["conversation"])[-1] == ("error", "completed", "Your session expired. Sign in again.")
    assert any(event["kind"] == "status" and event["status"]["state"] == "signed_out" for event in events)
    assert client.get("/api/codex/status").json()["state"] == "signed_out"


def test_shutdown_stops_codex(app_paths: AppPaths, fake_codex: FakeCodex) -> None:
    app = create_app(paths=app_paths, generator_factory=CountingFactory(FakeGenerator()), http_client_factory=FakeHttp().client_factory, codex_runtime=fake_codex.runtime(), install_signal_handlers=False)
    with TestClient(app) as client:
        window = Socket(client)
        send(client, "hello")
        window.codex_events(turn_ended)
        process = app.state.services.codex._process
        assert process is not None and process.alive
        window.close()
    assert not process.alive


def test_a_tool_shows_codex_pictures_and_links_a_character(client: TestClient, socket: Socket, fake_codex: FakeCodex, make_output: Any) -> None:
    make_output("0000000001")
    fake_codex.update_scenario(
        default_steps=[
            {"tool": "view_images", "arguments": {"story_id": "{context.story_id}"}, "as": "seen"},
            {"tool": "update_character", "arguments": {"character_id": "chr-000000000001", "outfit_tags": ["raincoat"]}},
            {"say": "Saw {seen.images}: {seen.json.shown.0}. {last.summary} ({last.character_id})."},
        ]
    )
    story = create_story(client)

    def frontend(call: Message) -> Message:
        if call["tool"] == "view_images":
            image = {"label": "Scene 1 · Dock, its picture", "output_id": "0000000001"}
            return {"ok": True, "text": '{"shown": ["Scene 1 · Dock, its picture"]}', "summary": "Looked at 1 picture", "story_id": story["id"], "images": [image]}
        return {"ok": True, "text": "{}", "summary": "Edited Mira (outfit tags)", "character_id": "chr-000000000001"}

    send(client, "look", story["id"])
    events = answer_tools(client, socket, frontend)

    final = events[-1]["conversation"]
    assert entries(final)[-1] == ("assistant", "completed", "Saw 1: Scene 1 · Dock, its picture. Edited Mira (outfit tags) (chr-000000000001).")
    tool_entries = [entry for entry in final["entries"] if entry["kind"] == "tool"]
    assert [(entry["tool"], entry["character_id"], entry["story_id"]) for entry in tool_entries] == [
        ("view_images", None, story["id"]),
        ("update_character", "chr-000000000001", None),
    ]
    # Codex received the picture as MCP image content, after its label.
    (seen,) = [record for record in fake_codex.records() if record.get("tool_result") == "view_images"]
    assert seen["content_types"] == ["text", "text", "image"]
