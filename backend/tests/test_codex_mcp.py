"""The co-writer's MCP server (services/codex/mcp_server.py) over real HTTP on 127.0.0.1 - its security checks and its
protocol - and the tool catalog it lists (services/codex/tools.py)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Iterator
from typing import Any, get_args

import pytest

from app.schemas import CODEX_TOOL_ARGUMENTS, CodexToolName
from app.services.codex.mcp_server import McpServer
from app.services.codex.tools import CODEX_TOOLS, GENERATION_TOOL_TIMEOUT_S, TOOLS_BY_NAME, inline_refs

TOKEN = "test-token-0123456789"


class Handler:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def list_tools(self) -> list[dict[str, Any]]:
        return [tool.descriptor() for tool in CODEX_TOOLS]

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name not in TOOLS_BY_NAME:
            raise KeyError(name)
        self.calls.append((name, arguments))
        return {"content": [{"type": "text", "text": f"ran {name}"}], "isError": False}


@pytest.fixture()
def handler() -> Handler:
    return Handler()


@pytest.fixture()
def server(handler: Handler) -> Iterator[McpServer]:
    mcp = McpServer(handler, TOKEN, version="1.2.3")
    mcp.start()
    yield mcp
    mcp.stop()


def post(url: str, body: Any, headers: dict[str, str] | None = None, *, token: str | None = TOKEN) -> tuple[int, Any, dict[str, str]]:
    data = json.dumps(body).encode("utf-8") if not isinstance(body, bytes) else body
    request_headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", **(headers or {})}
    if token is not None:
        request_headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=data, method="POST", headers=request_headers)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None, dict(response.headers)
    except urllib.error.HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None, dict(error.headers)


def rpc(method: str, params: Any = None, request_id: Any = 1) -> dict[str, Any]:
    message: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id, "method": method}
    if params is not None:
        message["params"] = params
    return message


def test_it_listens_on_loopback_only(server: McpServer) -> None:
    assert server.url.startswith("http://127.0.0.1:")
    assert server.url.endswith("/mcp")
    assert server.start() == server.url  # idempotent


@pytest.mark.parametrize(
    ("headers", "token", "status"),
    [
        ({}, None, 401),
        ({}, "wrong-token", 401),
        ({"Authorization": "Basic dGVzdA=="}, None, 401),
        ({"Origin": "http://evil.example"}, TOKEN, 403),
        ({"Host": "evil.example:80"}, TOKEN, 403),
    ],
    ids=["no-token", "wrong-token", "other-scheme", "browser-origin", "other-host"],
)
def test_requests_without_the_token_or_from_a_web_page_are_refused(
    server: McpServer, handler: Handler, headers: dict[str, str], token: str | None, status: int
) -> None:
    code, _body, _headers = post(server.url, rpc("tools/call", {"name": "list_stories", "arguments": {}}), headers, token=token)

    assert code == status
    assert handler.calls == []


def test_other_paths_and_methods(server: McpServer) -> None:
    code, _body, _headers = post(server.url.replace("/mcp", "/other"), rpc("ping"))
    assert code == 404
    request = urllib.request.Request(server.url, method="GET", headers={"Authorization": f"Bearer {TOKEN}"})
    with pytest.raises(urllib.error.HTTPError) as raised:
        urllib.request.urlopen(request, timeout=5)
    assert raised.value.code == 405
    assert raised.value.headers["Allow"] == "POST"


def test_initialize_negotiates_the_protocol_version(server: McpServer) -> None:
    code, body, _headers = post(server.url, rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}))
    assert code == 200
    assert body["result"]["protocolVersion"] == "2025-03-26"
    assert body["result"]["capabilities"] == {"tools": {"listChanged": False}}
    assert body["result"]["serverInfo"] == {"name": "prompt-weaver-local", "title": "Prompt Weaver Local", "version": "1.2.3"}

    _code, newer, _headers = post(server.url, rpc("initialize", {"protocolVersion": "2099-01-01"}))
    assert newer["result"]["protocolVersion"] == "2025-06-18"


def test_notifications_are_accepted_without_a_body(server: McpServer) -> None:
    code, body, _headers = post(server.url, {"jsonrpc": "2.0", "method": "notifications/initialized"})

    assert (code, body) == (202, None)


def test_tools_list_and_call(server: McpServer, handler: Handler) -> None:
    _code, listed, _headers = post(server.url, rpc("tools/list"))
    tools = listed["result"]["tools"]
    assert [tool["name"] for tool in tools] == list(get_args(CodexToolName))
    assert all("$ref" not in json.dumps(tool["inputSchema"]) for tool in tools)

    code, called, _headers = post(server.url, rpc("tools/call", {"name": "get_story", "arguments": {"story_id": "sty-000000000001"}}, 7))
    assert code == 200
    assert called == {"jsonrpc": "2.0", "id": 7, "result": {"content": [{"type": "text", "text": "ran get_story"}], "isError": False}}
    assert handler.calls == [("get_story", {"story_id": "sty-000000000001"})]


def test_protocol_errors(server: McpServer) -> None:
    assert post(server.url, rpc("tools/call", {"name": "rm_rf", "arguments": {}}))[1]["error"]["code"] == -32602
    assert post(server.url, rpc("tools/call", {"arguments": {}}))[1]["error"]["code"] == -32602
    assert post(server.url, rpc("resources/list"))[1]["error"] == {"code": -32601, "message": "Method not found: resources/list"}
    assert post(server.url, b"{not json")[0] == 400
    assert post(server.url, rpc("ping"))[1]["result"] == {}


def test_a_batch_answers_its_requests(server: McpServer) -> None:
    _code, answers, _headers = post(server.url, [rpc("ping", request_id=1), {"jsonrpc": "2.0", "method": "notifications/initialized"}, rpc("ping", request_id=2)])

    assert [answer["id"] for answer in answers] == [1, 2]


def test_stop_releases_the_port(handler: Handler) -> None:
    mcp = McpServer(handler, TOKEN)
    url = mcp.start()
    mcp.stop()

    with pytest.raises(urllib.error.URLError):
        post(url, rpc("ping"))


# ---------------------------------------------------------------------------
# The catalog
# ---------------------------------------------------------------------------


def test_every_tool_name_has_its_arguments_and_its_description() -> None:
    assert list(TOOLS_BY_NAME) == list(get_args(CodexToolName)) == list(CODEX_TOOL_ARGUMENTS)
    assert all(tool.description and tool.title for tool in CODEX_TOOLS)
    assert [tool.name for tool in CODEX_TOOLS if tool.read_only] == [
        "list_stories", "get_story", "list_characters", "list_categories", "list_loras", "get_generation_setup", "preview_scenes",
        "consistency_report", "view_images",
    ]  # fmt: skip
    assert [tool.name for tool in CODEX_TOOLS if tool.destructive] == ["delete_story", "delete_scenes", "delete_character"]
    assert [tool.name for tool in CODEX_TOOLS if tool.timeout_s == GENERATION_TOOL_TIMEOUT_S] == ["generate_scenes"]


def test_tool_schemas_are_self_contained_and_strict() -> None:
    schema = TOOLS_BY_NAME["update_scenes"].input_schema()

    assert schema["additionalProperties"] is False
    assert schema["required"] == ["story_id", "changes"]
    change = schema["properties"]["changes"]["items"]
    assert change["additionalProperties"] is False
    assert change["properties"]["characters"]["anyOf"][0] == {"const": "story", "type": "string"}
    assert TOOLS_BY_NAME["delete_scenes"].input_schema()["required"] == ["story_id", "scene_ids", "user_confirmed"]
    assert TOOLS_BY_NAME["delete_scenes"].descriptor()["annotations"]["destructiveHint"] is True


def test_inline_refs() -> None:
    schema = {"$defs": {"A": {"type": "object", "properties": {"b": {"$ref": "#/$defs/B"}}}, "B": {"type": "string"}}, "properties": {"a": {"$ref": "#/$defs/A", "description": "an A"}}}

    assert inline_refs(schema) == {"properties": {"a": {"type": "object", "properties": {"b": {"type": "string"}}, "description": "an A"}}}
