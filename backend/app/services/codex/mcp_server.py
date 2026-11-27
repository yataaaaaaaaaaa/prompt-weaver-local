"""The app's tools as an MCP server (streamable HTTP transport, JSON answers) for the Codex process the co-writer
starts. Security model:

- it listens on 127.0.0.1 only, on a port of its own (never on the backend's host, which may be 0.0.0.0);
- every request needs `Authorization: Bearer <token>`, a random token made per backend process and given only to the
  Codex process (through an environment variable named by its config: never on a command line, never logged);
- requests that carry an Origin header (a web page) or name another Host are refused (DNS rebinding);
- it offers tools only (no resources, prompts or sampling), and a tool call only reaches the app while a co-writer
  turn runs (McpToolHandler.call_tool).

Protocol: POST /mcp with one JSON-RPC message or a batch; requests are answered with application/json, notifications
and responses with 202. GET (a server-sent event stream) and DELETE (sessions) answer 405: the server is stateless.
Methods: initialize, ping, tools/list, tools/call.
"""

from __future__ import annotations

import hmac
import json
import logging
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Protocol

logger = logging.getLogger(__name__)

MCP_PATH = "/mcp"
LOOPBACK_HOST = "127.0.0.1"
SERVER_NAME = "prompt-weaver-local"
SERVER_TITLE = "Prompt Weaver Local"
# Protocol versions this server speaks (newest first); a client asking for another one gets the newest.
SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
_MAX_BODY_BYTES = 4 * 1024 * 1024

INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
PARSE_ERROR = -32700


class McpToolHandler(Protocol):
    def list_tools(self) -> list[dict[str, Any]]: ...

    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """The CallToolResult ({content, isError, _meta?}); raises KeyError for an unknown tool."""
        ...


class McpServer:
    def __init__(self, handler: McpToolHandler, token: str, *, version: str = "0") -> None:
        self._handler = handler
        self._token = token
        self._version = version
        self._server: ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    @property
    def url(self) -> str:
        server = self._server
        if server is None:
            raise RuntimeError("The MCP server is not running")
        return f"http://{LOOPBACK_HOST}:{server.server_address[1]}{MCP_PATH}"

    def start(self) -> str:
        """Starts listening (idempotent); answers the URL."""
        with self._lock:
            if self._server is None:
                server = ThreadingHTTPServer((LOOPBACK_HOST, 0), _handler_class(self))
                server.daemon_threads = True
                self._server = server
                self._thread = threading.Thread(target=server.serve_forever, name="codex-mcp", daemon=True)
                self._thread.start()
            return self.url

    def stop(self) -> None:
        with self._lock:
            server, self._server = self._server, None
            thread, self._thread = self._thread, None
        if server is not None:
            server.shutdown()
            server.server_close()
        if thread is not None:
            thread.join(timeout=5)

    # --- request handling (one thread per request) ---

    def authorized(self, header: str | None) -> bool:
        scheme, _, value = (header or "").partition(" ")
        return scheme.lower() == "bearer" and hmac.compare_digest(value.strip().encode(), self._token.encode())

    def allowed_host(self, header: str | None) -> bool:
        server = self._server
        if server is None or not header:
            return False
        port = server.server_address[1]
        return header.lower() in {f"{LOOPBACK_HOST}:{port}", f"localhost:{port}"}

    def handle_message(self, message: Any) -> dict[str, Any] | None:
        """The answer to one JSON-RPC message (None for a notification or a response)."""
        if not isinstance(message, dict) or not isinstance(message.get("method"), str):
            if isinstance(message, dict) and "id" in message and ("result" in message or "error" in message):
                return None  # a response to a server request: this server sends none
            return _error(None, INVALID_REQUEST, "Invalid request")
        if "id" not in message:
            return None
        request_id = message["id"]
        method: str = message["method"]
        params = message.get("params") or {}
        try:
            return {"jsonrpc": "2.0", "id": request_id, "result": self._dispatch(method, params)}
        except _JsonRpcError as exc:
            return _error(request_id, exc.code, exc.message)
        except Exception:
            logger.exception("The MCP method %s failed", method)
            return _error(request_id, -32603, "Internal error")

    def _dispatch(self, method: str, params: dict[str, Any]) -> Any:
        if method == "initialize":
            requested = params.get("protocolVersion")
            version = requested if requested in SUPPORTED_PROTOCOL_VERSIONS else SUPPORTED_PROTOCOL_VERSIONS[0]
            return {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "title": SERVER_TITLE, "version": self._version},
                "instructions": "The tools of Prompt Weaver Local's story mode: read and edit the user's stories and "
                "scenes, and illustrate scenes.",
            }
        if method == "ping":
            return {}
        if method == "tools/list":
            return {"tools": self._handler.list_tools()}
        if method == "tools/call":
            name = params.get("name")
            arguments = params.get("arguments") or {}
            if not isinstance(name, str) or not isinstance(arguments, dict):
                raise _JsonRpcError(INVALID_PARAMS, "tools/call needs a tool name and an arguments object")
            try:
                return self._handler.call_tool(name, arguments)
            except KeyError as exc:
                raise _JsonRpcError(INVALID_PARAMS, f"Unknown tool: {name}") from exc
        raise _JsonRpcError(METHOD_NOT_FOUND, f"Method not found: {method}")


class _JsonRpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _handler_class(server: McpServer) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "PromptWeaverMcp"

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002 - BaseHTTPRequestHandler's signature
            logger.debug("MCP %s", format % args)

        def _reply(self, status: HTTPStatus, body: Any = None, headers: dict[str, str] | None = None) -> None:
            data = b"" if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            if body is not None:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if data:
                self.wfile.write(data)

        def _guard(self) -> bool:
            """Path, origin, host and token checks; replies and answers False when the request is refused."""
            if self.path.split("?", 1)[0] != MCP_PATH:
                self._reply(HTTPStatus.NOT_FOUND, {"error": "not found"})
                return False
            if self.headers.get("Origin") or not server.allowed_host(self.headers.get("Host")):
                self._reply(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
                return False
            if not server.authorized(self.headers.get("Authorization")):
                self._reply(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"}, {"WWW-Authenticate": "Bearer"})
                return False
            return True

        def do_POST(self) -> None:  # noqa: N802 - http.server naming
            if not self._guard():
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > _MAX_BODY_BYTES:
                self._reply(HTTPStatus.BAD_REQUEST, _error(None, INVALID_REQUEST, "Invalid request body"))
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
            except ValueError:
                self._reply(HTTPStatus.BAD_REQUEST, _error(None, PARSE_ERROR, "Parse error"))
                return
            if isinstance(payload, list):
                answers = [answer for answer in (server.handle_message(item) for item in payload) if answer is not None]
                self._reply(HTTPStatus.OK, answers) if answers else self._reply(HTTPStatus.ACCEPTED)
                return
            answer = server.handle_message(payload)
            self._reply(HTTPStatus.OK, answer) if answer is not None else self._reply(HTTPStatus.ACCEPTED)

        def do_GET(self) -> None:  # noqa: N802
            if self._guard():
                self._reply(HTTPStatus.METHOD_NOT_ALLOWED, None, {"Allow": "POST"})

        def do_DELETE(self) -> None:  # noqa: N802
            if self._guard():
                self._reply(HTTPStatus.METHOD_NOT_ALLOWED, None, {"Allow": "POST"})

    return Handler
