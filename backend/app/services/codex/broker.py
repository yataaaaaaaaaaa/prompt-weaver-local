"""The way of a co-writer tool call: Codex calls a tool of the MCP server (mcp_server.py) -> the broker validates its
arguments and sends it to the frontend window that sent the message (a CodexToolCallEvent over /ws/tasks) -> that
window runs it with the story store's actions (src/stores/coWriterTools.ts) and posts the result
(POST /api/codex/tool-calls/{call_id}/result) -> the broker answers Codex. One path per action: the backend never
changes a story itself, and the UI shows every change because it made it.

A call fails at once, with a message Codex can relay, when no turn runs, when that window is not connected (closed,
reloaded) or when the arguments are invalid; it fails when its time runs out, when the window goes away and when the
turn is stopped (the window then stops what it runs: CodexToolCancelEvent).
"""

from __future__ import annotations

import logging
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from ...schemas import (
    CODEX_TOOL_CALL_MODELS,
    CodexEventModel,
    CodexToolCallEvent,
    CodexToolCancelEvent,
    CodexToolResult,
)
from .protocol import ACTIVITY_META_KEY
from .tools import TOOLS_BY_NAME

logger = logging.getLogger(__name__)

NOT_RUNNING_MESSAGE = "No co-writer turn is running: the app's tools only work while the user talks to you."
NOT_CONNECTED_MESSAGE = (
    "The Prompt Weaver window that sent the message is not connected any more (closed or reloaded), so the app cannot "
    "run this tool. Ask the user to send the request again from the Story section."
)
WINDOW_CLOSED_MESSAGE = "The Prompt Weaver window running this tool was closed."


@dataclass(frozen=True)
class ToolTurn:
    """The turn a tool call belongs to: its conversation and the window that runs its tools."""

    conversation_id: str
    client_id: str


@dataclass
class _Call:
    call_id: str
    tool: str
    turn: ToolTurn
    done: threading.Event = field(default_factory=threading.Event)
    result: CodexToolResult | None = None


@dataclass(frozen=True)
class ToolOutcome:
    """A finished call: what Codex reads and what the conversation shows."""

    tool: str
    # The arguments as Codex sent them (they identify the call in Codex's item of it).
    arguments: dict[str, Any]
    result: CodexToolResult

    def call_tool_result(self) -> dict[str, Any]:
        """The MCP CallToolResult."""
        return {
            "content": [{"type": "text", "text": self.result.text}],
            "isError": not self.result.ok,
            "_meta": {ACTIVITY_META_KEY: activity(self.result)},
        }


def activity(result: CodexToolResult) -> dict[str, Any]:
    return {"ok": result.ok, "summary": result.summary, "story_id": result.story_id, "scene_id": result.scene_id}


def failure(text: str, summary: str | None = None) -> CodexToolResult:
    return CodexToolResult(ok=False, text=text, summary=summary or text[:500])


class ToolBroker:
    def __init__(
        self,
        *,
        publish: Callable[[CodexEventModel], None],
        is_connected: Callable[[str], bool],
        current_turn: Callable[[], ToolTurn | None],
        on_outcome: Callable[[ToolTurn, ToolOutcome], None],
    ) -> None:
        self._publish = publish
        self._is_connected = is_connected
        self._current_turn = current_turn
        self._on_outcome = on_outcome
        self._lock = threading.Lock()
        self._calls: dict[str, _Call] = {}

    def call(self, tool: str, raw_arguments: dict[str, Any]) -> ToolOutcome:
        """Runs one tool call through the frontend (blocking: the MCP server's request thread waits). Raises KeyError
        for an unknown tool."""
        definition = TOOLS_BY_NAME[tool]
        try:
            arguments = definition.arguments.model_validate(raw_arguments)
        except ValidationError as exc:
            problems = "; ".join(f"{'.'.join(str(part) for part in error['loc']) or 'arguments'}: {error['msg']}" for error in exc.errors())
            return ToolOutcome(tool, raw_arguments, failure(f"Invalid arguments for {tool}: {problems}", f"{definition.title}: invalid arguments"))
        turn = self._current_turn()
        if turn is None:
            return ToolOutcome(tool, raw_arguments, failure(NOT_RUNNING_MESSAGE))
        if not self._is_connected(turn.client_id):
            outcome = ToolOutcome(tool, raw_arguments, failure(NOT_CONNECTED_MESSAGE, "The app window is not connected"))
            self._on_outcome(turn, outcome)
            return outcome
        call = _Call(call_id=f"call-{uuid.uuid4().hex}", tool=tool, turn=turn)
        with self._lock:
            self._calls[call.call_id] = call
        try:
            model = CODEX_TOOL_CALL_MODELS[tool]
            self._publish(
                CodexToolCallEvent(
                    call=model(  # type: ignore[call-arg]
                        call_id=call.call_id,
                        client_id=turn.client_id,
                        conversation_id=turn.conversation_id,
                        tool=tool,
                        arguments=arguments,
                    )
                )
            )
            if not call.done.wait(definition.timeout_s):
                self._cancel(call, f"{definition.title} took longer than {definition.timeout_s:g} s and was abandoned.")
        finally:
            with self._lock:
                self._calls.pop(call.call_id, None)
        result = call.result or failure(f"{definition.title} did not finish.")
        outcome = ToolOutcome(tool, raw_arguments, result)
        self._on_outcome(turn, outcome)
        return outcome

    def resolve(self, call_id: str, result: CodexToolResult) -> bool:
        """The frontend's result of a call; False when the call is unknown or already over."""
        with self._lock:
            call = self._calls.get(call_id)
            if call is None or call.done.is_set():
                return False
            call.result = result
            call.done.set()
        return True

    def _cancel(self, call: _Call, reason: str) -> None:
        with self._lock:
            if call.done.is_set():
                return
            call.result = failure(reason)
            call.done.set()
        self._publish(CodexToolCancelEvent(call_id=call.call_id, client_id=call.turn.client_id))

    def _matching(self, predicate: Callable[[_Call], bool]) -> list[_Call]:
        with self._lock:
            return [call for call in self._calls.values() if predicate(call)]

    def cancel_conversation(self, conversation_id: str, reason: str) -> None:
        for call in self._matching(lambda item: item.turn.conversation_id == conversation_id):
            self._cancel(call, reason)

    def cancel_client(self, client_id: str) -> None:
        for call in self._matching(lambda item: item.turn.client_id == client_id):
            self._cancel(call, WINDOW_CLOSED_MESSAGE)

    def cancel_all(self, reason: str) -> None:
        for call in self._matching(lambda _item: True):
            self._cancel(call, reason)

    def pending(self) -> int:
        with self._lock:
            return len(self._calls)
