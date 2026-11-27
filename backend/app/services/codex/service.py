"""The co-writer: the user's installed Codex CLI embedded in the Story section. THE owner of the Codex process and of
the conversations.

Process model: one `codex app-server` process (JSON-RPC over stdio, protocol v2: rpc.py), started lazily by the first
message (or by the first conversation whose history must be read), with the user's own Codex login (nothing here reads
Codex's files or credentials), stopped with the app, started again by the next message after a crash. The status
(GET /api/codex/status) comes from a short-lived probe process: initialize, account/read (signed in?), config/read (the
default model, the other MCP servers), experimentalFeature/list (which features exist), model/list.

What Codex may do: it runs with a read-only sandbox, no approvals (every command or file change it might request is
declined), no web search, the shell and the other feature tools that exist in the installed version disabled, the
user's other MCP servers disabled, in an empty working directory (<data dir>/codex/workspace), and the developer
instructions of instructions.py. Its only way to act is the app's MCP server (mcp_server.py, 127.0.0.1, a random
token): every tool call goes through broker.py to the frontend window that sent the message, which runs it with the
story store's actions.

A conversation's entries are built from Codex's notifications (protocol.py) and streamed to every window over
/ws/tasks (CodexEvent); one turn runs at a time (the tool calls belong to it). Conversations: conversations.py.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import threading
import uuid
from collections import deque
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ...schemas import (
    CodexAccount,
    CodexConversation,
    CodexConversationEvent,
    CodexDeltaEvent,
    CodexEntry,
    CodexEntryEvent,
    CodexEventModel,
    CodexModelOption,
    CodexSettingsUpdate,
    CodexState,
    CodexStatus,
    CodexStatusEvent,
    CodexToolResult,
    CodexTurnRequest,
)
from ...settings import AppPaths
from ..backend_settings import BackendSettingsStore
from ..stories import StoryStore
from ..task_hub import TaskHub
from .broker import ToolBroker, ToolOutcome, ToolTurn, activity
from .conversations import Conversation, ConversationRegistry
from .discovery import CodexDiscovery, CodexInstall
from .instructions import DEVELOPER_INSTRUCTIONS, app_context
from .mcp_server import McpServer
from .protocol import APP_MCP_SERVER, STOPPED_NOTICE, entries_of_turns, entry_of, is_unauthorized, turn_error_message
from .rpc import METHOD_NOT_FOUND, ProcessGone, RpcError, RpcProcess, inherited_environment
from .tools import CODEX_TOOLS, GENERATION_TOOL_TIMEOUT_S, TOOLS_BY_NAME

logger = logging.getLogger(__name__)

# The environment variable that hands the MCP token to the Codex process (named in its config, never on a command line).
MCP_TOKEN_ENV = "PROMPT_WEAVER_MCP_TOKEN"
CLIENT_INFO = {"name": "prompt_weaver_local", "title": "Prompt Weaver Local", "version": "0.2.0"}
# Features of the installed Codex that give the model tools other than the app's (disabled when they exist and are on).
RESTRICTED_FEATURES = (
    "shell_tool",
    "unified_exec",
    "apply_patch_freeform",
    "view_image",
    "plugins",
    "remote_plugin",
    "apps",
    "multi_agent",
    "multi_agent_v2",
    "image_generation",
    "memories",
    "goals",
    "tool_suggest",
    "in_app_browser",
    "js_repl",
)
_SIMPLE_NAME = re.compile(r"^[A-Za-z0-9_-]+$")
_VERSION = re.compile(r"/(\d+\.\d+\.\d+[^\s()]*)")
_STOP_WATCHDOG_S = 15.0

NOT_FOUND_MESSAGE = (
    "Codex was not found. Install the OpenAI Codex app (or the Codex CLI) and sign in, or enter the path of "
    "codex.exe, then select Retry."
)
SIGNED_OUT_MESSAGE = (
    "Codex is not signed in. Open the OpenAI Codex app, sign in with your ChatGPT account, then select Retry."
)
BUSY_MESSAGE = "Codex is still answering. Stop it or wait for its answer."
CRASH_MESSAGE = "Codex stopped unexpectedly{code}. It starts again with your next message."
TOOLS_UNAVAILABLE_MESSAGE = "The app's tools could not connect to Codex: {error}"
RESUME_FAILED_NOTICE = "The earlier conversation could not be found in Codex: your next message starts a new one."


class CodexUnavailable(Exception):
    """The co-writer cannot work now (not found, not signed in, cannot start): HTTP 409, the message says why."""


class CodexBusy(Exception):
    """A turn is running (HTTP 409)."""


class ConversationNotFound(LookupError):
    """HTTP 404."""


@dataclass(frozen=True)
class CodexRuntime:
    """How the co-writer finds and starts Codex (create_app injects it; tests use a fake app-server)."""

    discovery: CodexDiscovery = field(default_factory=CodexDiscovery)
    # Added to the environment of every Codex process (tests: the fake's scenario).
    environment: Mapping[str, str] = field(default_factory=dict)
    probe_timeout_s: float = 30.0
    request_timeout_s: float = 120.0


@dataclass
class _Probe:
    state: CodexState
    message: str = ""
    install: CodexInstall | None = None
    searched: list[str] = field(default_factory=list)
    version: str | None = None
    account: CodexAccount | None = None
    default_model: str | None = None
    models: list[CodexModelOption] = field(default_factory=list)
    other_mcp_servers: list[str] = field(default_factory=list)
    enabled_features: set[str] = field(default_factory=set)


@dataclass
class _Turn:
    client_id: str
    thread_id: str
    turn_id: str | None = None
    stop_requested: bool = False


def launch_arguments(mcp_url: str, *, other_mcp_servers: list[str], enabled_features: set[str]) -> list[str]:
    """The app-server options of the co-writer's Codex (see the module docstring)."""
    server = f"mcp_servers.{APP_MCP_SERVER}"
    arguments = [
        "-c", 'sandbox_mode="read-only"',
        "-c", 'approval_policy="never"',
        "-c", 'web_search="disabled"',
        "-c", f'{server}.url="{mcp_url}"',
        "-c", f'{server}.bearer_token_env_var="{MCP_TOKEN_ENV}"',
        "-c", f"{server}.startup_timeout_sec=30",
        "-c", f"{server}.tool_timeout_sec={int(GENERATION_TOOL_TIMEOUT_S) + 60}",
        "-c", f'{server}.default_tools_approval_mode="approve"',
    ]  # fmt: skip
    for name in other_mcp_servers:
        if _SIMPLE_NAME.match(name) and name != APP_MCP_SERVER:
            arguments += ["-c", f"mcp_servers.{name}.enabled=false"]
    for feature in RESTRICTED_FEATURES:
        if feature in enabled_features:
            arguments += ["--disable", feature]
    return arguments


def _account_of(payload: Any) -> tuple[CodexAccount | None, bool]:
    """(the account kind, signed in) of an account/read answer."""
    account = payload.get("account") if isinstance(payload, dict) else None
    if isinstance(account, dict):
        kind = account.get("type")
        return ("chatgpt" if kind == "chatgpt" else "api_key" if kind == "apiKey" else "other"), True
    requires_auth = not isinstance(payload, dict) or payload.get("requiresOpenaiAuth", True) is not False
    return None, not requires_auth


def _canonical(arguments: Any) -> str:
    return json.dumps(arguments, sort_keys=True, ensure_ascii=False, default=str)


class CodexService:
    def __init__(
        self, *, paths: AppPaths, settings: BackendSettingsStore, stories: StoryStore, tasks: TaskHub, runtime: CodexRuntime
    ) -> None:
        self._paths = paths
        self._settings = settings
        self._stories = stories
        self._tasks = tasks
        self._runtime = runtime
        self._registry = ConversationRegistry(paths.codex_conversations_file)
        self._turns: dict[str, _Turn] = {}
        self._broker = ToolBroker(
            publish=self._publish,
            is_connected=tasks.is_client_connected,
            current_turn=self._tool_turn,
            on_outcome=self._on_tool_outcome,
        )
        tasks.add_client_listener(self._broker.cancel_client)
        self._token = secrets.token_urlsafe(32)
        self._mcp = McpServer(self, self._token, version=str(CLIENT_INFO["version"]))
        self._process_lock = threading.RLock()
        self._process: RpcProcess | None = None
        self._loaded_threads: set[str] = set()
        self._status_lock = threading.Lock()
        self._history_lock = threading.Lock()
        self._probe: _Probe | None = None
        self._outcomes: deque[tuple[str, str, dict[str, Any]]] = deque(maxlen=64)
        self._shutting_down = False

    # ------------------------------------------------------------------
    # Status and settings
    # ------------------------------------------------------------------

    def status(self, *, refresh: bool = False) -> CodexStatus:
        with self._status_lock:
            if refresh or self._probe is None:
                self._probe = self._run_probe()
            return self._status_of(self._probe)

    def _status_of(self, probe: _Probe) -> CodexStatus:
        settings = self._settings.codex()
        return CodexStatus(
            state=probe.state,
            message=probe.message,
            path=probe.install.path if probe.install else None,
            source=probe.install.source if probe.install else None,
            version=probe.version,
            configured_path=settings.path,
            searched=probe.searched if probe.state == "not_found" else [],
            account=probe.account,
            default_model=probe.default_model,
            model=settings.model,
            models=probe.models,
            running=self._process is not None and self._process.alive,
        )

    def _publish_status(self) -> None:
        with self._status_lock:
            probe = self._probe
        if probe is not None:
            self._publish(CodexStatusEvent(status=self._status_of(probe)))

    def _set_probe_state(self, state: CodexState, message: str) -> None:
        with self._status_lock:
            if self._probe is not None:
                self._probe.state = state
                self._probe.message = message
        self._publish_status()

    def update_settings(self, update: CodexSettingsUpdate) -> CodexStatus:
        changes: dict[str, str | None] = {name: getattr(update, name) for name in ("path", "model") if name in update.model_fields_set}
        if "path" in changes and self._registry.running() is not None:
            raise CodexBusy(BUSY_MESSAGE)
        self._settings.update_codex(**changes)
        if "path" in changes:
            self._stop_process()
            status = self.status(refresh=True)
        else:
            status = self.status()
        self._publish(CodexStatusEvent(status=status))
        return status

    def _run_probe(self) -> _Probe:
        settings = self._settings.codex()
        found = self._runtime.discovery.locate(settings.path)
        if found.install is None:
            missing = f"The Codex path you set was not found: {settings.path}. " if found.configured_missing else ""
            return _Probe(state="not_found", message=missing + NOT_FOUND_MESSAGE, searched=found.searched)
        install = found.install
        workspace = self._workspace()
        process = RpcProcess(
            [*install.argv, "app-server"],
            cwd=workspace,
            env=inherited_environment(dict(self._runtime.environment)),
            on_notification=lambda _method, _params: None,
            on_request=_refuse_request,
            on_exit=lambda _code, _tail: None,
        )
        timeout = self._runtime.probe_timeout_s
        try:
            process.start()
            init = process.request("initialize", {"clientInfo": CLIENT_INFO, "capabilities": {"experimentalApi": False}}, timeout=timeout)
            process.notify("initialized")
            account_payload = process.request("account/read", {"refreshToken": False}, timeout=timeout)
            account, signed_in = _account_of(account_payload)
            config = _tolerant(lambda: process.request("config/read", {}, timeout=timeout)) or {}
            features = self._enabled_features(process, timeout)
            models = self._models(process, timeout) if signed_in else []
        except (ProcessGone, TimeoutError, RpcError) as exc:
            detail = process.stderr_tail().strip().splitlines()[-1:] or [str(exc)]
            return _Probe(state="error", message=f"Codex could not start: {detail[0]}", install=install)
        finally:
            process.close(timeout=2)
        user_agent = init.get("userAgent") if isinstance(init, dict) else None
        version_match = _VERSION.search(user_agent) if isinstance(user_agent, str) else None
        effective = config.get("config") if isinstance(config, dict) else None
        effective = effective if isinstance(effective, dict) else {}
        servers = effective.get("mcp_servers") if isinstance(effective.get("mcp_servers"), dict) else {}
        default_model = effective.get("model")
        return _Probe(
            state="ready" if signed_in else "signed_out",
            message="" if signed_in else SIGNED_OUT_MESSAGE,
            install=install,
            version=version_match.group(1) if version_match else None,
            account=account,
            default_model=default_model if isinstance(default_model, str) else None,
            models=models,
            other_mcp_servers=[
                name for name, server in servers.items() if not (isinstance(server, dict) and server.get("enabled") is False)
            ],
            enabled_features=features,
        )

    @staticmethod
    def _enabled_features(process: RpcProcess, timeout: float) -> set[str]:
        enabled: set[str] = set()
        cursor: str | None = None
        for _page in range(20):
            page = _tolerant(lambda: process.request("experimentalFeature/list", {"cursor": cursor}, timeout=timeout))
            if not isinstance(page, dict):
                break
            for feature in page.get("data") or []:
                if isinstance(feature, dict) and feature.get("enabled") is True and isinstance(feature.get("name"), str):
                    enabled.add(feature["name"])
            cursor = page.get("nextCursor")
            if not cursor:
                break
        return enabled

    @staticmethod
    def _models(process: RpcProcess, timeout: float) -> list[CodexModelOption]:
        page = _tolerant(lambda: process.request("model/list", {}, timeout=timeout))
        items = page.get("data") if isinstance(page, dict) else None
        return [
            CodexModelOption(id=str(item.get("model") or item["id"]), name=str(item.get("displayName") or item.get("model") or item["id"]))
            for item in items or []
            if isinstance(item, dict) and isinstance(item.get("id"), str) and not item.get("hidden")
        ]

    def _workspace(self) -> Path:
        workspace = self._paths.codex_workspace_dir
        workspace.mkdir(parents=True, exist_ok=True)
        return workspace

    # ------------------------------------------------------------------
    # The Codex process
    # ------------------------------------------------------------------

    def _ensure_process(self) -> RpcProcess:
        with self._process_lock:
            if self._process is not None and self._process.alive:
                return self._process
            if self._shutting_down:
                raise CodexUnavailable("Prompt Weaver is closing.")
            status = self.status()
            with self._status_lock:
                probe = self._probe
            if status.state != "ready" or probe is None or probe.install is None:
                raise CodexUnavailable(status.message or NOT_FOUND_MESSAGE)
            url = self._mcp.start()
            argv = [
                *probe.install.argv,
                "app-server",
                *launch_arguments(url, other_mcp_servers=probe.other_mcp_servers, enabled_features=probe.enabled_features),
            ]
            holder: dict[str, RpcProcess] = {}
            process = RpcProcess(
                argv,
                cwd=self._workspace(),
                env=inherited_environment({**self._runtime.environment, MCP_TOKEN_ENV: self._token}),
                on_notification=self._on_notification,
                on_request=self._on_server_request,
                on_exit=lambda code, tail: self._on_exit(holder["process"], code, tail),
            )
            holder["process"] = process
            try:
                process.start()
                process.request(
                    "initialize", {"clientInfo": CLIENT_INFO, "capabilities": {"experimentalApi": False}}, timeout=self._runtime.probe_timeout_s
                )
                process.notify("initialized")
            except (ProcessGone, TimeoutError, RpcError) as exc:
                detail = process.stderr_tail().strip().splitlines()[-1:] or [str(exc)]
                process.close(timeout=2)
                self._set_probe_state("error", f"Codex could not start: {detail[0]}")
                raise CodexUnavailable(f"Codex could not start: {detail[0]}") from exc
            self._process = process
            self._loaded_threads = set()
        self._publish_status()
        return process

    def _stop_process(self) -> None:
        with self._process_lock:
            process, self._process = self._process, None
            self._loaded_threads = set()
        if process is not None:
            process.close()

    def _on_exit(self, process: RpcProcess, code: int | None, _stderr_tail: str) -> None:
        with self._process_lock:
            if self._process is process:
                self._process = None
                self._loaded_threads = set()
        if process.closing or self._shutting_down:
            return
        logger.warning("Codex stopped unexpectedly (exit code %s)", code)
        message = CRASH_MESSAGE.format(code=f" (exit code {code})" if code is not None else "")
        self._broker.cancel_all("Codex stopped.")
        for conversation in self._finish_all_turns():
            self._add_entry(conversation, CodexEntry(id=_entry_id("error"), kind="error", text=message))
            self._publish_conversation(conversation)
        self._publish_status()

    def _finish_all_turns(self) -> list[Conversation]:
        with self._registry.lock:
            finished = []
            for conversation_id in list(self._turns):
                conversation = self._registry.get(conversation_id)
                self._turns.pop(conversation_id, None)
                if conversation is not None:
                    self._end_turn_locked(conversation)
                    finished.append(conversation)
            return finished

    def shutdown(self) -> None:
        """Ends the Codex process and the MCP server (app shutdown)."""
        self._shutting_down = True
        self._broker.cancel_all("Prompt Weaver is closing.")
        self._stop_process()
        self._mcp.stop()

    # ------------------------------------------------------------------
    # Conversations and turns
    # ------------------------------------------------------------------

    def conversation(self, story_id: str | None) -> CodexConversation:
        """The conversation of a story (None: the draft); its history is read from Codex when it was not yet."""
        if story_id is not None:
            self._stories.get(story_id)
        self._registry.forget_stories({story.id for story in self._stories.collection().items})
        conversation = self._registry.for_story(story_id)
        if not conversation.history_loaded and conversation.thread_id and self.status().state == "ready":
            try:
                self._load_history(conversation)
            except CodexUnavailable:
                pass
        return conversation.snapshot()

    def reset(self, story_id: str | None) -> CodexConversation:
        """New conversation for a story (None: the draft)."""
        if story_id is not None:
            self._stories.get(story_id)
        if self._registry.for_story(story_id).running:
            raise CodexBusy(BUSY_MESSAGE)
        previous, fresh = self._registry.reset(story_id)
        if previous is not None:
            self._publish_conversation(previous)
        self._publish_conversation(fresh)
        return fresh.snapshot()

    def _load_history(self, conversation: Conversation) -> None:
        with self._history_lock:
            if conversation.history_loaded or not conversation.thread_id:
                return
            process = self._ensure_process()
            thread_id = conversation.thread_id
            try:
                self._resume(process, thread_id)
                turns = self._read_turns(process, thread_id)
                entries = entries_of_turns(turns)
            except RpcError:
                logger.info("A co-writer thread could not be resumed", exc_info=True)
                entries = [CodexEntry(id=_entry_id("notice"), kind="notice", text=RESUME_FAILED_NOTICE)]
                conversation.thread_id = None
                self._registry.save()
            except (ProcessGone, TimeoutError) as exc:
                raise CodexUnavailable(f"Codex could not read the conversation: {exc}") from exc
            with self._registry.lock:
                conversation.entries = entries + [entry for entry in conversation.entries if entry.id not in {item.id for item in entries}]
                conversation.history_loaded = True
                conversation.changed()
        self._publish_conversation(conversation)

    def _thread_settings(self) -> dict[str, Any]:
        settings: dict[str, Any] = {
            "cwd": str(self._workspace()),
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "developerInstructions": DEVELOPER_INSTRUCTIONS,
        }
        model = self._settings.codex().model
        if model:
            settings["model"] = model
        return settings

    def _resume(self, process: RpcProcess, thread_id: str) -> None:
        if thread_id in self._loaded_threads:
            return
        process.request(
            "thread/resume", {"threadId": thread_id, **self._thread_settings(), "excludeTurns": True}, timeout=self._runtime.request_timeout_s
        )
        self._loaded_threads.add(thread_id)

    def _read_turns(self, process: RpcProcess, thread_id: str) -> list[Any]:
        turns: list[Any] = []
        cursor: str | None = None
        try:
            for _page in range(50):
                page = process.request(
                    "thread/turns/list",
                    {"threadId": thread_id, "cursor": cursor, "limit": 50, "sortDirection": "asc", "itemsView": "full"},
                    timeout=self._runtime.request_timeout_s,
                )
                turns += page.get("data") or [] if isinstance(page, dict) else []
                cursor = page.get("nextCursor") if isinstance(page, dict) else None
                if not cursor:
                    break
        except RpcError as exc:
            if exc.code != METHOD_NOT_FOUND:
                raise
            # An older app-server: the whole history in one read.
            thread = process.request("thread/read", {"threadId": thread_id, "includeTurns": True}, timeout=self._runtime.request_timeout_s)
            turns = (thread.get("thread") or {}).get("turns") or [] if isinstance(thread, dict) else []
        return turns

    def _ensure_thread(self, process: RpcProcess, conversation: Conversation) -> str:
        if conversation.thread_id:
            try:
                self._resume(process, conversation.thread_id)
                return conversation.thread_id
            except RpcError:
                logger.info("A co-writer thread could not be resumed", exc_info=True)
                self._add_entry(conversation, CodexEntry(id=_entry_id("notice"), kind="notice", text=RESUME_FAILED_NOTICE))
        result = process.request("thread/start", {**self._thread_settings(), "ephemeral": False}, timeout=self._runtime.request_timeout_s)
        thread_id = str(result["thread"]["id"])
        with self._registry.lock:
            conversation.thread_id = thread_id
            conversation.history_loaded = True
        self._loaded_threads.add(thread_id)
        return thread_id

    def send(self, request: CodexTurnRequest) -> CodexConversation:
        """Sends the user's message (a new turn); the answer streams as events. Raises CodexUnavailable / CodexBusy."""
        story = self._stories.get(request.story_id) if request.story_id else None
        status = self.status()
        if status.state != "ready":
            raise CodexUnavailable(status.message)
        with self._registry.lock:
            if self._registry.running() is not None:
                raise CodexBusy(BUSY_MESSAGE)
            conversation = self._registry.for_story(request.story_id)
            conversation.running = True
            conversation.changed()
        try:
            if not conversation.history_loaded and conversation.thread_id:
                self._load_history(conversation)
            process = self._ensure_process()
            thread_id = self._ensure_thread(process, conversation)
            with self._registry.lock:
                self._turns[conversation.id] = _Turn(client_id=request.client_id, thread_id=thread_id)
            self._add_entry(conversation, CodexEntry(id=_entry_id("user"), kind="user", text=request.text))
            self._publish_conversation(conversation)
            context = app_context(story, request.scene_id, len(self._stories.collection().items))
            params: dict[str, Any] = {
                "threadId": thread_id,
                "input": [
                    {"type": "text", "text": context, "text_elements": []},
                    {"type": "text", "text": request.text, "text_elements": []},
                ],
            }
            model = self._settings.codex().model
            if model:
                params["model"] = model
            result = process.request("turn/start", params, timeout=self._runtime.request_timeout_s)
        except (CodexUnavailable, ProcessGone, TimeoutError, RpcError) as exc:
            with self._registry.lock:
                self._turns.pop(conversation.id, None)
                self._end_turn_locked(conversation)
            message = str(exc) if isinstance(exc, CodexUnavailable) else f"Codex could not answer: {getattr(exc, 'message', exc)}"
            self._add_entry(conversation, CodexEntry(id=_entry_id("error"), kind="error", text=message))
            self._publish_conversation(conversation)
            return conversation.snapshot()
        turn_payload = result.get("turn") if isinstance(result, dict) else None
        turn_id = turn_payload.get("id") if isinstance(turn_payload, dict) else None
        stop_now = False
        with self._registry.lock:
            turn = self._turns.get(conversation.id)
            if turn is not None and turn.turn_id is None and isinstance(turn_id, str):
                turn.turn_id = turn_id
                stop_now = turn.stop_requested
        self._registry.save()
        if stop_now:
            self._send_interrupt(conversation.id)
        return conversation.snapshot()

    def interrupt(self, conversation_id: str) -> CodexConversation:
        """Stop: interrupts the running turn and abandons its tool calls (the window stops a running generation)."""
        conversation = self._registry.get(conversation_id)
        if conversation is None:
            raise ConversationNotFound(conversation_id)
        with self._registry.lock:
            turn = self._turns.get(conversation_id)
            if turn is None:
                return conversation.snapshot()
            turn.stop_requested = True
        # Codex first (it stops asking for tools), then the calls still running.
        self._send_interrupt(conversation_id, wait=True)
        self._broker.cancel_conversation(conversation_id, "Stopped by the user.")
        timer = threading.Timer(_STOP_WATCHDOG_S, self._force_stop, args=(conversation_id,))
        timer.daemon = True
        timer.start()
        return conversation.snapshot()

    def _send_interrupt(self, conversation_id: str, *, wait: bool = False) -> None:
        """turn/interrupt of the conversation's turn. `wait`: on the caller's thread (never the reader thread's)."""
        with self._registry.lock:
            turn = self._turns.get(conversation_id)
            target = (turn.thread_id, turn.turn_id) if turn is not None and turn.turn_id else None
        process = self._process
        if target is None:
            return  # the turn id is not known yet: sent as soon as it is (send / turn/started)
        if process is None or not process.alive:
            self._force_stop(conversation_id)
            return

        def interrupt() -> None:
            try:
                process.request("turn/interrupt", {"threadId": target[0], "turnId": target[1]}, timeout=10)
            except (ProcessGone, TimeoutError, RpcError):
                logger.info("Interrupting a co-writer turn failed", exc_info=True)
                self._force_stop(conversation_id)

        if wait:
            interrupt()
        else:
            # Not on the reader thread (turn/started): it would wait for its own answer.
            threading.Thread(target=interrupt, name="codex-interrupt", daemon=True).start()

    def _force_stop(self, conversation_id: str) -> None:
        """Ends a turn Codex did not end after Stop."""
        with self._registry.lock:
            turn = self._turns.pop(conversation_id, None)
            conversation = self._registry.get(conversation_id)
            if turn is None or conversation is None:
                return
            self._end_turn_locked(conversation)
        self._add_entry(conversation, CodexEntry(id=_entry_id("notice"), kind="notice", text=STOPPED_NOTICE))
        self._publish_conversation(conversation)

    def _end_turn_locked(self, conversation: Conversation) -> None:
        """The turn is over: running entries end (registry lock held)."""
        conversation.running = False
        conversation.changed()
        for index, entry in enumerate(conversation.entries):
            if entry.status == "running":
                conversation.entries[index] = entry.model_copy(update={"status": "completed" if entry.kind == "assistant" else "failed"})

    # ------------------------------------------------------------------
    # Codex notifications and requests (reader thread)
    # ------------------------------------------------------------------

    def _conversation_of(self, params: Any) -> Conversation | None:
        thread_id = params.get("threadId") if isinstance(params, dict) else None
        return self._registry.by_thread(thread_id) if isinstance(thread_id, str) else None

    def _on_notification(self, method: str, params: Any) -> None:
        if method == "account/updated":
            if isinstance(params, dict) and params.get("authMode") is None:
                self._set_probe_state("signed_out", SIGNED_OUT_MESSAGE)
            return
        conversation = self._conversation_of(params)
        if conversation is None:
            return
        if method == "turn/started":
            self._on_turn_started(conversation, params.get("turn"))
        elif method in {"item/started", "item/completed"}:
            self._on_item(conversation, params.get("item"), completed=method == "item/completed")
        elif method == "item/agentMessage/delta":
            self._on_delta(conversation, params)
        elif method == "turn/completed":
            self._on_turn_completed(conversation, params.get("turn"))
        elif method == "error":
            if params.get("willRetry") is not True:
                error = params.get("error")
                message = error.get("message") if isinstance(error, dict) else None
                self._add_turn_error(conversation, message or "Codex could not answer.", error)
        elif method == "mcpServer/startupStatus/updated":
            if params.get("name") == APP_MCP_SERVER and params.get("status") == "failed":
                text = TOOLS_UNAVAILABLE_MESSAGE.format(error=params.get("error") or "unknown error")
                self._add_entry(conversation, CodexEntry(id=_entry_id("error"), kind="error", text=text))

    def _on_turn_started(self, conversation: Conversation, turn: Any) -> None:
        turn_id = turn.get("id") if isinstance(turn, dict) else None
        stop_now = False
        with self._registry.lock:
            current = self._turns.get(conversation.id)
            if current is not None and current.turn_id is None and isinstance(turn_id, str):
                current.turn_id = turn_id
                stop_now = current.stop_requested
        if stop_now:
            self._send_interrupt(conversation.id)

    def _on_item(self, conversation: Conversation, item: Any, *, completed: bool) -> None:
        fallback = None
        if completed and isinstance(item, dict) and item.get("type") == "mcpToolCall":
            key = (str(item.get("tool")), _canonical(item.get("arguments")))
            fallback = next((found for tool, arguments, found in reversed(self._outcomes) if (tool, arguments) == key), None)
        entry = entry_of(item, completed=completed, fallback=fallback, users=False)
        if entry is None:
            return
        with self._registry.lock:
            index = conversation.entry_index(entry.id)
            if index is not None and entry.kind == "assistant" and not completed:
                return  # already streaming (the deltas came first)
        self._add_entry(conversation, entry)

    def _on_delta(self, conversation: Conversation, params: dict[str, Any]) -> None:
        item_id, delta = params.get("itemId"), params.get("delta")
        if not isinstance(item_id, str) or not isinstance(delta, str) or not delta:
            return
        with self._registry.lock:
            index = conversation.entry_index(item_id)
            if index is None:
                entry = CodexEntry(id=item_id, kind="assistant", text=delta, status="running")
                revision = conversation.upsert(entry)
                created = True
            else:
                conversation.entries[index] = conversation.entries[index].model_copy(
                    update={"text": conversation.entries[index].text + delta}
                )
                entry = conversation.entries[index]
                revision = conversation.changed()
                created = False
        if created:
            self._publish(CodexEntryEvent(conversation_id=conversation.id, entry=entry, revision=revision))
        else:
            self._publish(CodexDeltaEvent(conversation_id=conversation.id, entry_id=item_id, delta=delta, revision=revision))

    def _on_turn_completed(self, conversation: Conversation, turn: Any) -> None:
        status = turn.get("status") if isinstance(turn, dict) else None
        with self._registry.lock:
            current = self._turns.pop(conversation.id, None)
            if current is None and not conversation.running:
                return
            self._end_turn_locked(conversation)
        self._broker.cancel_conversation(conversation.id, "The turn ended.")
        if status == "interrupted":
            self._add_entry(conversation, CodexEntry(id=_entry_id("notice"), kind="notice", text=STOPPED_NOTICE))
        else:
            message = turn_error_message(turn)
            if message:
                self._add_turn_error(conversation, message, turn.get("error"))
        self._publish_conversation(conversation)

    def _add_turn_error(self, conversation: Conversation, message: str, error: Any) -> None:
        with self._registry.lock:
            if any(entry.kind == "error" and entry.text == message for entry in conversation.entries[-3:]):
                return
        self._add_entry(conversation, CodexEntry(id=_entry_id("error"), kind="error", text=message))
        if is_unauthorized(error):
            self._set_probe_state("signed_out", SIGNED_OUT_MESSAGE)

    def _on_server_request(self, method: str, params: Any) -> Any:
        """Approvals and questions from Codex: commands and file changes are declined (the co-writer acts through the
        app's tools only), the app's own MCP server is trusted, anything else is refused."""
        if method in {"item/commandExecution/requestApproval", "item/fileChange/requestApproval"}:
            return {"decision": "decline"}
        if method in {"execCommandApproval", "applyPatchApproval"}:
            return {"decision": {"denied": {"rejection": "The Prompt Weaver co-writer cannot run commands or change files."}}}
        if method == "mcpServer/elicitation/request":
            trusted = isinstance(params, dict) and params.get("serverName") == APP_MCP_SERVER
            return {"action": "accept" if trusted else "decline", "content": None, "_meta": None}
        return _refuse_request(method, params)

    # ------------------------------------------------------------------
    # Tools (MCP server -> broker -> frontend)
    # ------------------------------------------------------------------

    def list_tools(self) -> list[dict[str, Any]]:
        return [tool.descriptor() for tool in CODEX_TOOLS]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in TOOLS_BY_NAME:
            raise KeyError(name)
        return self._broker.call(name, arguments).call_tool_result()

    def resolve_tool_call(self, call_id: str, result: CodexToolResult) -> bool:
        return self._broker.resolve(call_id, result)

    def _tool_turn(self) -> ToolTurn | None:
        with self._registry.lock:
            for conversation_id, turn in self._turns.items():
                if not turn.stop_requested:
                    return ToolTurn(conversation_id=conversation_id, client_id=turn.client_id)
        return None

    def _on_tool_outcome(self, turn: ToolTurn, outcome: ToolOutcome) -> None:
        self._outcomes.append((outcome.tool, _canonical(outcome.arguments), activity(outcome.result)))
        story_id = outcome.result.story_id
        if outcome.tool == "create_story" and outcome.result.ok and story_id:
            conversation = self._registry.get(turn.conversation_id)
            if conversation is not None and self._registry.adopt(conversation, story_id):
                self._publish_conversation(conversation)

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def _publish(self, event: CodexEventModel) -> None:
        self._tasks.broadcast(event)

    def _publish_conversation(self, conversation: Conversation) -> None:
        with self._registry.lock:
            snapshot = conversation.snapshot()
        self._publish(CodexConversationEvent(conversation=snapshot))

    def _add_entry(self, conversation: Conversation, entry: CodexEntry) -> None:
        with self._registry.lock:
            revision = conversation.upsert(entry)
        self._publish(CodexEntryEvent(conversation_id=conversation.id, entry=entry, revision=revision))


def _entry_id(kind: str) -> str:
    return f"{kind}-{uuid.uuid4().hex[:12]}"


def _tolerant(call: Any) -> Any:
    """The answer of an optional request (None when this Codex version does not have it or it failed)."""
    try:
        return call()
    except (RpcError, TimeoutError):
        return None


def _refuse_request(method: str, _params: Any) -> Any:
    raise RpcError(METHOD_NOT_FOUND, f"{method} is not supported by Prompt Weaver Local")
