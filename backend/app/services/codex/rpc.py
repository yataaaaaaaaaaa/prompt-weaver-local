"""JSON-RPC over the stdio of a child process: the transport of `codex app-server` (one JSON message per line, the
JSON-RPC 2.0 shapes without the "jsonrpc" member, as the app-server protocol defines them).

- request(method, params) waits for its response (from any thread); notify() sends a notification;
- the reader thread hands notifications to `on_notification(method, params)` and server requests to
  `on_request(method, params)`, whose return value is the result (an RpcError is answered as an error). Both run on the
  reader thread: they must be quick and never call request() (the reader would wait for itself);
- when the process ends, every pending request fails with ProcessGone and `on_exit(code, stderr_tail)` runs once;
- the last lines of stderr are kept for error messages (they never reach the logs above debug level: Codex may print
  anything there).
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any

from .discovery import NO_WINDOW_FLAGS

logger = logging.getLogger(__name__)

NotificationHandler = Callable[[str, Any], None]
RequestHandler = Callable[[str, Any], Any]
ExitHandler = Callable[[int | None, str], None]

METHOD_NOT_FOUND = -32601
_STDERR_LINES = 40


class RpcError(Exception):
    """A JSON-RPC error answer (or one to send)."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


class ProcessGone(Exception):
    """The process ended (or could not start) before the answer."""


class _Pending:
    def __init__(self) -> None:
        self.event = threading.Event()
        self.result: Any = None
        self.error: BaseException | None = None


class RpcProcess:
    def __init__(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        env: Mapping[str, str],
        on_notification: NotificationHandler,
        on_request: RequestHandler,
        on_exit: ExitHandler,
    ) -> None:
        self._argv = list(argv)
        self._cwd = cwd
        self._env = dict(env)
        self._on_notification = on_notification
        self._on_request = on_request
        self._on_exit = on_exit
        self._process: subprocess.Popen[bytes] | None = None
        self._write_lock = threading.Lock()
        self._pending: dict[int, _Pending] = {}
        self._pending_lock = threading.Lock()
        self._next_id = 0
        self._stderr: deque[str] = deque(maxlen=_STDERR_LINES)
        self._exited = threading.Event()
        self._closing = False

    @property
    def alive(self) -> bool:
        return self._process is not None and not self._exited.is_set()

    @property
    def closing(self) -> bool:
        return self._closing

    def stderr_tail(self) -> str:
        return "\n".join(self._stderr)

    def start(self) -> None:
        """Starts the process and its reader threads. Raises ProcessGone when it cannot start."""
        try:
            self._process = subprocess.Popen(
                self._argv,
                cwd=self._cwd,
                env=self._env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=NO_WINDOW_FLAGS,
            )
        except OSError as exc:
            raise ProcessGone(f"Codex could not start: {exc.strerror or exc}") from exc
        threading.Thread(target=self._read_stdout, name="codex-rpc-stdout", daemon=True).start()
        threading.Thread(target=self._read_stderr, name="codex-rpc-stderr", daemon=True).start()

    # --- outgoing ---

    def _write(self, message: dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None or self._exited.is_set():
            raise ProcessGone("Codex is not running")
        data = (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
        with self._write_lock:
            try:
                process.stdin.write(data)
                process.stdin.flush()
            except (OSError, ValueError) as exc:
                raise ProcessGone("Codex stopped") from exc

    def request(self, method: str, params: Any = None, *, timeout: float = 60.0) -> Any:
        with self._pending_lock:
            self._next_id += 1
            request_id = self._next_id
            pending = self._pending[request_id] = _Pending()
        try:
            self._write({"id": request_id, "method": method, "params": params if params is not None else {}})
            if not pending.event.wait(timeout):
                raise TimeoutError(f"Codex did not answer {method} within {timeout:g} s")
        finally:
            with self._pending_lock:
                self._pending.pop(request_id, None)
        if pending.error is not None:
            raise pending.error
        return pending.result

    def notify(self, method: str, params: Any = None) -> None:
        message: dict[str, Any] = {"method": method}
        if params is not None:
            message["params"] = params
        self._write(message)

    # --- incoming ---

    def _read_stdout(self) -> None:
        process = self._process
        assert process is not None and process.stdout is not None
        try:
            for raw in process.stdout:
                line = raw.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except ValueError:
                    logger.debug("Codex wrote a line that is not JSON")
                    continue
                if isinstance(message, dict):
                    self._dispatch(message)
        except Exception:
            logger.debug("Reading Codex failed", exc_info=True)
        finally:
            self._finish()

    def _read_stderr(self) -> None:
        process = self._process
        assert process is not None and process.stderr is not None
        try:
            for raw in process.stderr:
                text = raw.decode("utf-8", errors="replace").rstrip()
                if text:
                    self._stderr.append(text)
        except Exception:
            logger.debug("Reading Codex's stderr failed", exc_info=True)

    def _dispatch(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        has_id = "id" in message
        if isinstance(method, str) and has_id:
            self._answer(message["id"], method, message.get("params"))
        elif isinstance(method, str):
            try:
                self._on_notification(method, message.get("params"))
            except Exception:
                logger.exception("Handling the Codex notification %s failed", method)
        elif has_id:
            self._resolve(message)

    def _answer(self, request_id: Any, method: str, params: Any) -> None:
        try:
            response: dict[str, Any] = {"id": request_id, "result": self._on_request(method, params)}
        except RpcError as exc:
            error: dict[str, Any] = {"code": exc.code, "message": exc.message}
            if exc.data is not None:
                error["data"] = exc.data
            response = {"id": request_id, "error": error}
        except Exception:
            logger.exception("Handling the Codex request %s failed", method)
            response = {"id": request_id, "error": {"code": -32603, "message": "Internal error"}}
        try:
            self._write(response)
        except ProcessGone:
            pass

    def _resolve(self, message: dict[str, Any]) -> None:
        request_id = message.get("id")
        with self._pending_lock:
            pending = self._pending.get(request_id) if isinstance(request_id, int) else None
        if pending is None:
            return
        error = message.get("error")
        if isinstance(error, dict):
            pending.error = RpcError(int(error.get("code", -32603)), str(error.get("message", "Codex error")), error.get("data"))
        else:
            pending.result = message.get("result")
        pending.event.set()

    def _finish(self) -> None:
        if self._exited.is_set():
            return
        process = self._process
        code: int | None = None
        if process is not None:
            try:
                code = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                code = None
        self._exited.set()
        with self._pending_lock:
            pending = list(self._pending.values())
        for item in pending:
            item.error = ProcessGone("Codex stopped")
            item.event.set()
        try:
            self._on_exit(code, self.stderr_tail())
        except Exception:
            logger.exception("Handling the end of Codex failed")

    # --- lifecycle ---

    def close(self, timeout: float = 3.0) -> None:
        """Ends the process: stdin closed (the app-server exits), then terminate, then kill."""
        self._closing = True
        process = self._process
        if process is None:
            return
        try:
            if process.stdin is not None:
                process.stdin.close()
        except OSError:
            pass
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        self._exited.wait(timeout=5)


def inherited_environment(extra: Mapping[str, str]) -> dict[str, str]:
    """The environment of a Codex process: the backend's (Codex finds its home and the user's login through it) plus
    `extra`."""
    return {**os.environ, **extra}
