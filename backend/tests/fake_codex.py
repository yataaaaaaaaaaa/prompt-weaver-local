"""A scripted stand-in for `codex app-server` (the co-writer's Codex), for the backend tests and the e2e backend. Never
imported by the app; stdlib only. It speaks the subset of the app-server protocol (v2, JSON-RPC lines over stdio) the
co-writer uses, with the real CLI's shapes, and reaches the app's MCP server over HTTP like the real Codex does.

    python tests/fake_codex.py app-server [-c key=value]... [--disable feature]...

Environment:
- FAKE_CODEX_SCENARIO: a JSON scenario file (read at every start; see Scenario below);
- FAKE_CODEX_HOME: the fake's folder: threads.json (the saved threads, so resume works across restarts) and
  calls.jsonl (one line per start and per request, for the tests to read: never the MCP token itself);
- the MCP token, in the variable named by `-c mcp_servers.prompt_weaver.bearer_token_env_var="..."`.

Like the real CLI it refuses to start with `--disable <unknown feature>` or `-c mcp_servers.<unknown>.enabled=false`.

Scenario (every key optional):
    {"account": "chatgpt" | "apiKey" | null (signed out), "version": "0.169.0-fake", "model": "gpt-fake",
     "models": [{"id": "gpt-fake", "name": "GPT Fake"}], "mcp_servers": {"node_repl": {}}, "features":
     [{"name": "shell_tool", "enabled": true}], "fail_start": "<stderr line>", "delta_delay_ms": 10,
     "rules": [{"match": "<regex on the user's words>", "steps": [...]}], "default_steps": [...]}
Steps: {"say": "text"} (streamed word by word), {"tool": "add_scenes", "arguments": {...}, "as": "name"} (an MCP
tools/call; "as" keeps its result under that name), {"sleep_ms": 500}, {"crash": true} (exit 3), {"fail": "message",
"info": "unauthorized"} (a failed turn), {"request_approval": "command"} (a server request; its decision is said).
Strings in "say" and "arguments" may use {context.story_id}, {context.scene_id}, {last.story_id}, {last.scene_id},
{last.character_id}, {last.summary}, {last.text}, {last.images} (how many pictures the result showed), {turns} (earlier
turns of the thread), {user}, the same fields of a named result ({name.story_id}, ...), and a value of the JSON text of
the last or a named result by its path: {last.json.scenes.0.scene_id}, {cast.json.character_id}. A placeholder that is
a whole argument and names a JSON value that is not a string (a list, a number) is replaced by that value.
"""

from __future__ import annotations

import json
import os
import re
import sys
import threading
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

APP_SERVER = "prompt_weaver"
DEFAULT_SCENARIO: dict[str, Any] = {
    "account": "chatgpt",
    "version": "0.169.0-fake",
    "model": "gpt-fake",
    "models": [{"id": "gpt-fake", "name": "GPT Fake"}, {"id": "gpt-fake-mini", "name": "GPT Fake Mini"}],
    "mcp_servers": {},
    "features": [],
    "delta_delay_ms": 0,
    "rules": [],
    "default_steps": [{"say": "Hello from the fake Codex."}],
}


class Fake:
    def __init__(self, argv: list[str]) -> None:
        self.scenario = {**DEFAULT_SCENARIO, **_read_json(os.environ.get("FAKE_CODEX_SCENARIO"), {})}
        self.home = Path(os.environ.get("FAKE_CODEX_HOME") or Path.cwd() / ".fake-codex")
        self.home.mkdir(parents=True, exist_ok=True)
        self.overrides, self.disabled = _parse_arguments(argv)
        self.write_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.next_request = 1000
        self.pending: dict[int, dict[str, Any]] = {}
        self.pending_events: dict[int, threading.Event] = {}
        self.loaded: set[str] = set()
        self.running: dict[str, dict[str, Any]] = {}  # thread id -> {"turn_id", "stop"}
        self.mcp_tools: list[str] = []
        # Set once the thread's MCP servers started (turns wait for it, like the real Codex).
        self.mcp_ready: dict[str, threading.Event] = {}
        self.log({"start": argv, "token_set": bool(self.token())})

    # --- io ---

    def log(self, record: dict[str, Any]) -> None:
        with self.state_lock, (self.home / "calls.jsonl").open("a", encoding="utf-8") as file:
            file.write(json.dumps(record) + "\n")

    def send(self, message: dict[str, Any]) -> None:
        with self.write_lock:
            sys.stdout.buffer.write((json.dumps(message) + "\n").encode("utf-8"))
            sys.stdout.buffer.flush()

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.send({"method": method, "params": params})

    def server_request(self, method: str, params: dict[str, Any]) -> Any:
        with self.state_lock:
            self.next_request += 1
            request_id = self.next_request
            event = self.pending_events[request_id] = threading.Event()
        self.send({"id": request_id, "method": method, "params": params})
        event.wait(10)
        return self.pending.pop(request_id, {})

    # --- threads ---

    def threads(self) -> dict[str, Any]:
        return _read_json(str(self.home / "threads.json"), {})

    def save_thread(self, thread_id: str) -> None:
        """A started thread is saved at once (the real Codex writes its rollout as it goes)."""
        with self.state_lock:
            threads = self.threads()
            threads.setdefault(thread_id, {"turns": []})
            (self.home / "threads.json").write_text(json.dumps(threads), encoding="utf-8")

    def save_turn(self, thread_id: str, turn: dict[str, Any]) -> None:
        with self.state_lock:
            threads = self.threads()
            threads.setdefault(thread_id, {"turns": []})["turns"].append(turn)
            (self.home / "threads.json").write_text(json.dumps(threads), encoding="utf-8")

    def thread_payload(self, thread_id: str) -> dict[str, Any]:
        return {"id": thread_id, "sessionId": thread_id, "preview": "", "ephemeral": False, "turns": [], "status": {"type": "idle"}}

    # --- MCP (the app's tools) ---

    def mcp_url(self) -> str | None:
        return self.overrides.get(f"mcp_servers.{APP_SERVER}.url")

    def token(self) -> str | None:
        name = self.overrides.get(f"mcp_servers.{APP_SERVER}.bearer_token_env_var")
        return os.environ.get(name) if name else None

    def mcp(self, method: str, params: dict[str, Any] | None = None, *, notification: bool = False) -> Any:
        url = self.mcp_url()
        assert url, "no MCP server configured"
        message: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        if not notification:
            message["id"] = uuid.uuid4().hex
        request = urllib.request.Request(
            url,
            data=json.dumps(message).encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Authorization": f"Bearer {self.token() or ''}",
                "MCP-Protocol-Version": "2025-06-18",
            },
        )
        with urllib.request.urlopen(request, timeout=3600) as response:
            body = response.read()
            if notification:
                return response.status
            answer = json.loads(body)
        if "error" in answer:
            raise RuntimeError(answer["error"]["message"])
        return answer["result"]

    def start_mcp(self, thread_id: str) -> None:
        ready = self.mcp_ready[thread_id] = threading.Event()

        def connect() -> None:
            try:
                self.connect_mcp(thread_id)
            finally:
                ready.set()

        threading.Thread(target=connect, daemon=True).start()

    def connect_mcp(self, thread_id: str) -> None:
        if not self.mcp_url():
            return
        self.notify("mcpServer/startupStatus/updated", {"threadId": thread_id, "name": APP_SERVER, "status": "starting", "error": None, "failureReason": None})
        try:
            self.mcp("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "fake-codex", "version": "0"}})
            self.mcp("notifications/initialized", notification=True)
            self.mcp_tools = [tool["name"] for tool in self.mcp("tools/list", {})["tools"]]
            self.log({"mcp_tools": self.mcp_tools})
            self.notify("mcpServer/startupStatus/updated", {"threadId": thread_id, "name": APP_SERVER, "status": "ready", "error": None, "failureReason": None})
        except (OSError, RuntimeError, urllib.error.URLError) as exc:
            self.notify("mcpServer/startupStatus/updated", {"threadId": thread_id, "name": APP_SERVER, "status": "failed", "error": str(exc), "failureReason": None})

    # --- requests ---

    def handle(self, message: dict[str, Any]) -> None:
        if "method" not in message:
            request_id = message.get("id")
            if isinstance(request_id, int) and request_id in self.pending_events:
                self.pending[request_id] = message.get("result") or message.get("error") or {}
                self.pending_events.pop(request_id).set()
            return
        method, params = message["method"], message.get("params") or {}
        if "id" not in message:
            return  # notifications (initialized)
        self.log({"method": method, "params": params})
        try:
            result = self.dispatch(method, params)
        except LookupError as exc:
            self.send({"id": message["id"], "error": {"code": -32600, "message": str(exc)}})
            return
        except NotImplementedError:
            self.send({"id": message["id"], "error": {"code": -32601, "message": f"method not found: {method}"}})
            return
        self.send({"id": message["id"], "result": result})

    def dispatch(self, method: str, params: dict[str, Any]) -> Any:
        scenario = self.scenario
        if method == "initialize":
            return {"userAgent": f"{params['clientInfo']['name']}/{scenario['version']} (Fake)", "codexHome": str(self.home), "platformFamily": "windows", "platformOs": "windows"}
        if method == "account/read":
            kind = scenario["account"]
            account = None if kind is None else {"type": kind, "email": None, "planType": "plus", "workspaceName": None} if kind == "chatgpt" else {"type": kind}
            return {"account": account, "userId": None, "requiresOpenaiAuth": True}
        if method == "config/read":
            return {"config": {"model": scenario["model"], "mcp_servers": scenario["mcp_servers"]}, "origins": {}, "layers": None}
        if method == "experimentalFeature/list":
            return {"data": scenario["features"], "nextCursor": None}
        if method == "model/list":
            return {"data": [{"id": item["id"], "model": item["id"], "displayName": item["name"], "hidden": False} for item in scenario["models"]], "nextCursor": None}
        if method == "thread/start":
            thread_id = str(uuid.uuid4())
            self.loaded.add(thread_id)
            self.save_thread(thread_id)
            self.notify("thread/started", {"thread": self.thread_payload(thread_id)})
            self.start_mcp(thread_id)
            return {"thread": self.thread_payload(thread_id), "model": params.get("model") or scenario["model"], "cwd": params.get("cwd")}
        if method == "thread/resume":
            thread_id = params["threadId"]
            if thread_id not in self.threads() and thread_id not in self.loaded:
                raise LookupError(f"thread not found: {thread_id}")
            self.loaded.add(thread_id)
            self.start_mcp(thread_id)
            return {"thread": self.thread_payload(thread_id), "model": params.get("model") or scenario["model"]}
        if method == "thread/turns/list":
            turns = self.threads().get(params["threadId"], {}).get("turns", [])
            start = int(params.get("cursor") or 0)
            limit = int(params.get("limit") or 50)
            page = turns[start : start + limit]
            next_cursor = str(start + limit) if start + limit < len(turns) else None
            return {"data": page, "nextCursor": next_cursor, "backwardsCursor": None}
        if method == "turn/start":
            thread_id = params["threadId"]
            if thread_id not in self.loaded:
                raise LookupError(f"thread not loaded: {thread_id}")
            turn_id = str(uuid.uuid4())
            state = {"turn_id": turn_id, "stop": threading.Event()}
            self.running[thread_id] = state
            threading.Thread(target=self.run_turn, args=(thread_id, turn_id, params, state), daemon=True).start()
            return {"turn": {"id": turn_id, "items": [], "status": "inProgress", "error": None}}
        if method == "turn/interrupt":
            state = self.running.get(params["threadId"])
            if state and state["turn_id"] == params["turnId"]:
                state["stop"].set()
            return {}
        raise NotImplementedError(method)

    # --- turns ---

    def run_turn(self, thread_id: str, turn_id: str, params: dict[str, Any], state: dict[str, Any]) -> None:
        ready = self.mcp_ready.get(thread_id)
        if ready is not None:
            ready.wait(10)
        texts = [part.get("text", "") for part in params.get("input", []) if part.get("type") == "text"]
        context = "\n".join(text for text in texts if text.startswith("<app-context>"))
        user = "\n".join(text for text in texts if not text.startswith("<app-context>"))
        values: dict[str, str] = {"user": user, "turns": str(len(self.threads().get(thread_id, {}).get("turns", [])))}
        for key, pattern in (("context.story_id", r"story_id: (sty-[0-9a-f]{12})"), ("context.scene_id", r"scene_id: (scn-[0-9a-f]{12})")):
            match = re.search(pattern, context)
            values[key] = match.group(1) if match else ""
        user_item = {"type": "userMessage", "id": f"msg-{uuid.uuid4().hex[:8]}", "clientId": None, "content": params.get("input", [])}
        items: list[dict[str, Any]] = [user_item]
        self.notify("turn/started", {"threadId": thread_id, "turn": {"id": turn_id, "items": [], "status": "inProgress", "error": None}})
        self.notify("item/started", {"threadId": thread_id, "turnId": turn_id, "item": user_item, "startedAtMs": 0})
        self.notify("item/completed", {"threadId": thread_id, "turnId": turn_id, "item": user_item, "completedAtMs": 0})
        status, error = "completed", None
        stop: threading.Event = state["stop"]
        for step in self.steps_for(user):
            if stop.is_set():
                status = "interrupted"
                break
            outcome = self.run_step(step, thread_id, turn_id, values, items, stop)
            if outcome == "interrupted":
                status = "interrupted"
                break
            if isinstance(outcome, dict):
                status, error = "failed", outcome
                break
        turn = {"id": turn_id, "items": items, "status": status, "error": error}
        self.save_turn(thread_id, turn)
        self.running.pop(thread_id, None)
        self.notify("turn/completed", {"threadId": thread_id, "turn": {**turn, "items": []}})

    def steps_for(self, user: str) -> list[dict[str, Any]]:
        for rule in self.scenario["rules"]:
            if re.search(rule["match"], user, re.IGNORECASE):
                return list(rule["steps"])
        return list(self.scenario["default_steps"])

    def run_step(self, step: dict[str, Any], thread_id: str, turn_id: str, values: dict[str, str], items: list[dict[str, Any]], stop: threading.Event) -> Any:
        base = {"threadId": thread_id, "turnId": turn_id}
        if "sleep_ms" in step:
            stop.wait(step["sleep_ms"] / 1000)
            return "interrupted" if stop.is_set() else None
        if step.get("crash"):
            sys.stdout.flush()
            os._exit(3)
        if "fail" in step:
            return {"message": step["fail"], "codexErrorInfo": step.get("info"), "additionalDetails": None}
        if "request_approval" in step:
            answer = self.server_request("item/commandExecution/requestApproval", {**base, "itemId": "cmd-1", "command": "dir", "cwd": "."})
            step = {"say": f"Approval: {answer.get('decision')}"}
        if "say" in step:
            item_id = f"msg-{uuid.uuid4().hex[:8]}"
            text = _fill(step["say"], values)
            self.notify("item/started", {**base, "item": {"type": "agentMessage", "id": item_id, "text": "", "phase": None}, "startedAtMs": 0})
            delay = self.scenario["delta_delay_ms"] / 1000
            sent = ""
            for word in re.findall(r"\S+\s*", text):
                if stop.is_set():
                    break
                self.notify("item/agentMessage/delta", {**base, "itemId": item_id, "delta": word})
                sent += word
                if delay:
                    stop.wait(delay)
            item = {"type": "agentMessage", "id": item_id, "text": sent, "phase": None}
            items.append(item)
            self.notify("item/completed", {**base, "item": item, "completedAtMs": 0})
            return "interrupted" if stop.is_set() else None
        if "tool" in step:
            item_id = f"tool-{uuid.uuid4().hex[:8]}"
            arguments = _fill(step.get("arguments", {}), values)
            item: dict[str, Any] = {"type": "mcpToolCall", "id": item_id, "server": APP_SERVER, "tool": step["tool"], "status": "inProgress", "arguments": arguments, "result": None, "error": None}
            self.notify("item/started", {**base, "item": item, "startedAtMs": 0})
            try:
                result = self.mcp("tools/call", {"name": step["tool"], "arguments": arguments})
                activity = (result.get("_meta") or {}).get("prompt_weaver/activity") or {}
                content = result.get("content", [])
                text = content[0].get("text", "") if content and content[0].get("type") == "text" else ""
                found = {
                    "story_id": activity.get("story_id") or "",
                    "scene_id": activity.get("scene_id") or "",
                    "character_id": activity.get("character_id") or "",
                    "summary": activity.get("summary") or "",
                    "text": text,
                    "images": str(sum(1 for part in content if part.get("type") == "image")),
                }
                for prefix in ("last", *([step["as"]] if step.get("as") else [])):
                    values.update({f"{prefix}.{key}": value for key, value in found.items()})
                self.log({"tool_result": step["tool"], "ok": not result.get("isError"), "content_types": [part.get("type") for part in content]})
                item = {**item, "status": "failed" if result.get("isError") else "completed", "result": {"content": result.get("content", []), "structuredContent": None, "_meta": result.get("_meta")}}
            except (OSError, RuntimeError, urllib.error.URLError) as exc:
                item = {**item, "status": "failed", "error": {"message": str(exc)}}
            items.append(item)
            self.notify("item/completed", {**base, "item": item, "completedAtMs": 0})
            return "interrupted" if stop.is_set() else None
        return None


_PLACEHOLDER = re.compile(r"\{([a-z_][a-z0-9_.]*)\}")


def _lookup(key: str, values: dict[str, str]) -> Any:
    """The value of a placeholder: a saved value, or a path into the JSON text of a saved result ('last.json.a.0.b');
    None when there is none."""
    if key in values:
        return values[key]
    name, marker, path = key.partition(".json.")
    if not marker or f"{name}.text" not in values:
        return None
    try:
        node: Any = json.loads(values[f"{name}.text"])
    except ValueError:
        return None
    for part in path.split("."):
        if isinstance(node, list) and part.isdigit() and int(part) < len(node):
            node = node[int(part)]
        elif isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    return node


def _fill(value: Any, values: dict[str, str]) -> Any:
    if isinstance(value, str):
        whole = _PLACEHOLDER.fullmatch(value)
        if whole is not None:
            found = _lookup(whole.group(1), values)
            if found is not None and not isinstance(found, str):
                return found

        def replace(match: re.Match[str]) -> str:
            found = _lookup(match.group(1), values)
            if found is None:
                return match.group(0)
            return found if isinstance(found, str) else json.dumps(found)

        return _PLACEHOLDER.sub(replace, value)
    if isinstance(value, list):
        return [_fill(item, values) for item in value]
    if isinstance(value, dict):
        return {key: _fill(item, values) for key, item in value.items()}
    return value


def _read_json(path: str | None, fallback: Any) -> Any:
    if not path or not Path(path).is_file():
        return fallback
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except ValueError:
        return fallback


def _parse_arguments(argv: list[str]) -> tuple[dict[str, str], list[str]]:
    overrides: dict[str, str] = {}
    disabled: list[str] = []
    index = 0
    while index < len(argv):
        if argv[index] == "-c" and index + 1 < len(argv):
            key, _, value = argv[index + 1].partition("=")
            overrides[key] = value[1:-1] if value.startswith('"') and value.endswith('"') else value
            index += 2
        elif argv[index] == "--disable" and index + 1 < len(argv):
            disabled.append(argv[index + 1])
            index += 2
        else:
            index += 1
    return overrides, disabled


def main(argv: list[str]) -> int:
    if not argv or argv[0] != "app-server":
        sys.stderr.write("usage: fake_codex.py app-server [options]\n")
        return 2
    fake = Fake(argv[1:])
    if fake.scenario.get("fail_start"):
        sys.stderr.write(str(fake.scenario["fail_start"]) + "\n")
        return 1
    known_features = {feature["name"] for feature in fake.scenario["features"]}
    for feature in fake.disabled:
        if feature not in known_features:
            sys.stderr.write(f"Error: Unknown feature flag: {feature}\n")
            return 1
    for key in fake.overrides:
        match = re.fullmatch(r"mcp_servers\.([^.]+)\.enabled", key)
        if match and match.group(1) not in fake.scenario["mcp_servers"]:
            sys.stderr.write(f"Error: invalid transport\nin `mcp_servers.{match.group(1)}`\n")
            return 1
    for raw in sys.stdin.buffer:
        line = raw.decode("utf-8", errors="replace").strip()
        if line:
            try:
                message = json.loads(line)
            except ValueError:
                continue
            threading.Thread(target=fake.handle, args=(message,), daemon=True).start() if message.get("method") == "turn/start" else fake.handle(message)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
