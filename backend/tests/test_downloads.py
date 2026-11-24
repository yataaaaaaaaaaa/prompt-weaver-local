"""services/downloads.py DownloadManager: streaming, verification, retries/resume, cancel, dedupe, progress.

The network is tests/support.FakeHttp (bodies are chunk generators; Gate-blocked generators keep a download
running) plus one real-socket test against a local ThreadingHTTPServer with the production HTTP client.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections.abc import Callable, Iterable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import httpx
import pytest

from app.schemas import DownloadTaskEvent
from app.services.downloads import PART_SUFFIX, DownloadManager, DownloadSpec, part_path
from app.services.http import USER_AGENT, default_http_client
from support import FakeHttp, RecordingTaskHub, sha256_of, wait_until

URL = "https://files.example/models/model.safetensors"
CONTENT = bytes(range(40))
TITLE = "Test model - v1"
TERMINAL = {"complete", "error", "cancelled"}
TASK_ID = re.compile(r"^download-[0-9a-f]{12}$")


def pieces(data: bytes, size: int = 10) -> Iterator[bytes]:
    for index in range(0, len(data), size):
        yield data[index : index + size]


def events_of(hub: RecordingTaskHub, task_id: str) -> list[DownloadTaskEvent]:
    return [event for event in list(hub.published) if isinstance(event, DownloadTaskEvent) and event.task_id == task_id]


def stages_of(hub: RecordingTaskHub, task_id: str) -> list[str]:
    return [event.stage for event in events_of(hub, task_id)]


def wait_terminal(hub: RecordingTaskHub, task_id: str) -> DownloadTaskEvent:
    wait_until(lambda: any(stage in TERMINAL for stage in stages_of(hub, task_id)))
    return events_of(hub, task_id)[-1]


class Gate:
    """Chunk generator factory whose bodies block before chunk `block_at` until released (5 s at most)."""

    def __init__(self) -> None:
        self.reached = threading.Event()
        self.released = threading.Event()

    def body(self, data: bytes = CONTENT, *, block_at: int = 1, size: int = 10) -> Iterator[bytes]:
        for index, chunk in enumerate(pieces(data, size)):
            if index == block_at:
                self.reached.set()
                self.released.wait(5)
            yield chunk

    def release(self) -> None:
        self.released.set()


@pytest.fixture()
def hub() -> RecordingTaskHub:
    return RecordingTaskHub()


@pytest.fixture()
def gates() -> list[Gate]:
    return []


@pytest.fixture()
def make_gate(gates: list[Gate]) -> Callable[[], Gate]:
    def make() -> Gate:
        gate = Gate()
        gates.append(gate)
        return gate

    return make


@pytest.fixture()
def make_manager(
    hub: RecordingTaskHub, fake_http: FakeHttp, gates: list[Gate]
) -> Iterator[Callable[..., DownloadManager]]:
    managers: list[DownloadManager] = []

    def make(**overrides: object) -> DownloadManager:
        options: dict[str, object] = {
            "tasks": hub,
            "client_factory": fake_http.client_factory,
            "chunk_size": 4,
            "retry_delay_s": 0,
            "progress_interval_s": 0,
        }
        options.update(overrides)
        manager = DownloadManager(**options)  # type: ignore[arg-type]
        managers.append(manager)
        return manager

    yield make
    for gate in gates:
        gate.release()
    for manager in managers:
        manager.shutdown(timeout=5)


@pytest.fixture()
def dest(tmp_path: Path) -> Path:
    return tmp_path / "models" / "loras" / "model.safetensors"


def serve(fake_http: FakeHttp, data: bytes = CONTENT, *, url: str = URL, headers: dict[str, str] | None = None) -> None:
    fake_http.add("GET", url, handler=lambda request: httpx.Response(200, content=pieces(data), headers=headers))


def serve_gated(fake_http: FakeHttp, gate: Gate, *, url: str = URL) -> None:
    fake_http.add("GET", url, handler=lambda request: httpx.Response(200, content=gate.body()))


def spec_for(dest: Path, **values: object) -> DownloadSpec:
    return DownloadSpec(url=str(values.pop("url", URL)), dest=dest, title=TITLE, **values)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Success and progress
# ---------------------------------------------------------------------------


def test_downloads_verifies_renames_and_reports_progress(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    serve(fake_http)
    calls: list[tuple[Path, str, list[str]]] = []
    manager = make_manager()

    task_id = manager.start(
        spec_for(dest, headers={"X-Test": "1"}, expected_sha256=sha256_of(CONTENT).upper(), expected_size=len(CONTENT)),
        on_complete=lambda path, digest: calls.append((path, digest, stages_of(hub, task_id))),
    )
    final = wait_terminal(hub, task_id)

    assert TASK_ID.match(task_id)
    assert final.stage == "complete", final.message
    assert (final.current, final.total) == (len(CONTENT), len(CONTENT))
    assert dest.read_bytes() == CONTENT
    assert not part_path(dest).exists()
    assert part_path(dest).name == dest.name + PART_SUFFIX
    # The callback ran once with the verified hash, before the "complete" event.
    assert len(calls) == 1
    assert calls[0][:2] == (dest, sha256_of(CONTENT))
    assert "complete" not in calls[0][2]

    events = events_of(hub, task_id)
    stages = [event.stage for event in events]
    assert stages[0] == "queued"
    assert set(stages[1:-1]) == {"downloading"}
    assert all(event.title == TITLE for event in events)
    progress = [event for event in events if event.stage == "downloading"]
    assert progress[0].current == 0
    assert progress[-1].current == len(CONTENT)
    assert [event.current for event in progress] == sorted(event.current for event in progress)
    assert all(event.total == len(CONTENT) for event in progress)
    assert not manager.is_active(task_id)
    assert fake_http.requests[0].headers["X-Test"] == "1"
    assert "Range" not in fake_http.requests[0].headers


def test_total_comes_from_content_length_else_zero(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, tmp_path: Path
) -> None:
    manager = make_manager()
    serve(fake_http, url="https://files.example/a", headers={"Content-Length": str(len(CONTENT))})
    serve(fake_http, url="https://files.example/b")
    with_length = manager.start(spec_for(tmp_path / "a.bin", url="https://files.example/a"))
    without_length = manager.start(spec_for(tmp_path / "b.bin", url="https://files.example/b"))

    assert wait_terminal(hub, with_length).stage == "complete"
    assert wait_terminal(hub, without_length).stage == "complete"
    assert {event.total for event in events_of(hub, with_length) if event.stage == "downloading"} == {len(CONTENT)}
    assert {event.total for event in events_of(hub, without_length) if event.stage == "downloading"} == {0}


def test_progress_events_are_throttled_but_first_and_last_are_sent(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    serve(fake_http)
    manager = make_manager(progress_interval_s=3600)

    task_id = manager.start(spec_for(dest, expected_size=len(CONTENT)))
    assert wait_terminal(hub, task_id).stage == "complete"

    progress = [event.current for event in events_of(hub, task_id) if event.stage == "downloading"]
    assert progress == [0, len(CONTENT)]


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"expected_sha256": "0" * 64}, "SHA-256 mismatch"),
        ({"expected_size": len(CONTENT) + 1}, "Size mismatch"),
    ],
)
def test_verification_failure_leaves_no_file(
    make_manager: Callable[..., DownloadManager],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    dest: Path,
    values: dict[str, object],
    message: str,
) -> None:
    serve(fake_http)
    calls: list[Path] = []
    manager = make_manager()

    task_id = manager.start(spec_for(dest, **values), on_complete=lambda path, _digest: calls.append(path))
    final = wait_terminal(hub, task_id)

    assert final.stage == "error"
    assert final.message.startswith(message)
    assert not dest.exists()
    assert not part_path(dest).exists()
    assert calls == []
    assert len(fake_http.requests) == 1  # verification failures are not retried


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


def test_cancel_while_streaming(
    make_manager: Callable[..., DownloadManager],
    make_gate: Callable[[], Gate],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    dest: Path,
) -> None:
    gate = make_gate()
    serve_gated(fake_http, gate)
    calls: list[Path] = []
    manager = make_manager()

    task_id = manager.start(spec_for(dest), on_complete=lambda path, _digest: calls.append(path))
    assert gate.reached.wait(5)
    assert manager.is_active(task_id)
    assert manager.cancel(task_id) is True
    assert not manager.is_active(task_id)
    gate.release()
    final = wait_terminal(hub, task_id)

    assert final.stage == "cancelled"
    assert stages_of(hub, task_id).count("cancelled") == 1
    assert [stage for stage in stages_of(hub, task_id) if stage in TERMINAL] == ["cancelled"]
    assert not dest.exists()
    assert not part_path(dest).exists()
    assert calls == []
    assert manager.cancel(task_id) is False  # finished


def test_cancel_while_queued_never_requests(
    make_manager: Callable[..., DownloadManager],
    make_gate: Callable[[], Gate],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    tmp_path: Path,
) -> None:
    gate = make_gate()
    serve_gated(fake_http, gate, url="https://files.example/first")
    serve(fake_http, url="https://files.example/second")
    manager = make_manager(max_concurrent=1)

    first = manager.start(spec_for(tmp_path / "first.bin", url="https://files.example/first"))
    assert gate.reached.wait(5)
    second = manager.start(spec_for(tmp_path / "second.bin", url="https://files.example/second"))
    assert stages_of(hub, second) == ["queued"]
    assert manager.cancel(second) is True
    # Published right away, not when a worker becomes free.
    assert stages_of(hub, second) == ["queued", "cancelled"]
    gate.release()

    assert wait_terminal(hub, first).stage == "complete"
    manager.shutdown(timeout=5)
    assert stages_of(hub, second) == ["queued", "cancelled"]
    assert fake_http.requests_to("https://files.example/second") == []
    assert not (tmp_path / "second.bin").exists()


def test_cancel_unknown_task_returns_false(make_manager: Callable[..., DownloadManager]) -> None:
    manager = make_manager()
    assert manager.cancel("download-unknown") is False
    assert manager.is_active("download-unknown") is False


def test_restart_after_cancel_queues_a_new_job_that_waits_for_the_old_one(
    make_manager: Callable[..., DownloadManager],
    make_gate: Callable[[], Gate],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    dest: Path,
) -> None:
    gate = make_gate()
    bodies = iter([gate.body(), pieces(CONTENT)])
    fake_http.add("GET", URL, handler=lambda request: httpx.Response(200, content=next(bodies)))
    manager = make_manager()

    first = manager.start(spec_for(dest))
    assert gate.reached.wait(5)
    assert manager.cancel(first)
    second = manager.start(spec_for(dest))
    assert second != first
    time.sleep(0.05)
    assert len(fake_http.requests) == 1  # the new job waits until the cancelled one has cleaned up
    gate.release()

    assert wait_terminal(hub, first).stage == "cancelled"
    assert wait_terminal(hub, second).stage == "complete"
    assert dest.read_bytes() == CONTENT
    assert not part_path(dest).exists()


# ---------------------------------------------------------------------------
# Retries and resume
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", [500, 503, 429])
def test_retries_server_errors(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path, status: int
) -> None:
    answers = iter([httpx.Response(status), httpx.Response(200, content=pieces(CONTENT))])
    fake_http.add("GET", URL, handler=lambda request: next(answers))
    manager = make_manager()

    task_id = manager.start(spec_for(dest, expected_sha256=sha256_of(CONTENT)))
    final = wait_terminal(hub, task_id)

    assert final.stage == "complete", final.message
    assert dest.read_bytes() == CONTENT
    assert len(fake_http.requests) == 2
    assert "Range" not in fake_http.requests[1].headers  # nothing was written before the error
    messages = [event.message for event in events_of(hub, task_id)]
    assert f"HTTP {status}, retrying (attempt 2 of 3)" in messages


def test_network_errors_are_retried_then_fail(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    fake_http.add("GET", URL, handler=refuse)
    manager = make_manager(max_attempts=3)

    task_id = manager.start(spec_for(dest))
    final = wait_terminal(hub, task_id)

    assert final.stage == "error"
    assert final.message == "Could not connect to the server (gave up after 3 attempts)"
    assert len(fake_http.requests) == 3
    assert not dest.exists()
    assert not part_path(dest).exists()


def test_retry_delay_is_interrupted_by_cancel(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    fake_http.add("GET", URL, status=500)
    manager = make_manager(retry_delay_s=60)

    task_id = manager.start(spec_for(dest))
    wait_until(lambda: any("retrying" in event.message for event in events_of(hub, task_id)))
    started = time.monotonic()
    assert manager.cancel(task_id)

    assert wait_terminal(hub, task_id).stage == "cancelled"
    assert time.monotonic() - started < 5
    assert len(fake_http.requests) == 1


def interrupted_body(data: bytes, *, after: int) -> Iterator[bytes]:
    """Yields `after` bytes of data, then fails like a dropped connection."""
    yield from pieces(data[:after])
    raise httpx.ReadError("connection reset by peer")


def requested_offset(request: httpx.Request) -> int:
    match = re.fullmatch(r"bytes=(\d+)-", request.headers.get("Range", ""))
    assert match, f"expected a Range request, got {request.headers.get('Range')!r}"
    return int(match.group(1))


def test_resumes_with_a_range_request(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if len(fake_http.requests) == 1:
            return httpx.Response(200, content=interrupted_body(CONTENT, after=24))
        offset = requested_offset(request)
        rest = CONTENT[offset:]
        return httpx.Response(
            206,
            content=pieces(rest),
            headers={
                "Content-Range": f"bytes {offset}-{len(CONTENT) - 1}/{len(CONTENT)}",
                "Content-Length": str(len(rest)),
            },
        )

    fake_http.add("GET", URL, handler=handler)
    digests: list[str] = []
    manager = make_manager()

    task_id = manager.start(
        spec_for(dest, expected_sha256=sha256_of(CONTENT)), on_complete=lambda _path, digest: digests.append(digest)
    )
    final = wait_terminal(hub, task_id)

    assert final.stage == "complete", final.message
    assert dest.read_bytes() == CONTENT
    assert digests == [sha256_of(CONTENT)]
    assert len(fake_http.requests) == 2
    offset = requested_offset(fake_http.requests[1])
    assert 0 < offset <= 24
    # The resumed attempt reports its progress from the resume offset, with the full size as total.
    resumed = [event for event in events_of(hub, task_id) if event.message == "Downloading"]
    assert any(event.current == offset and event.total == len(CONTENT) for event in resumed)


def test_restarts_from_zero_when_the_server_ignores_the_range(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if len(fake_http.requests) == 1:
            return httpx.Response(200, content=interrupted_body(CONTENT, after=24))
        requested_offset(request)
        return httpx.Response(200, content=pieces(CONTENT))

    fake_http.add("GET", URL, handler=handler)
    manager = make_manager()

    task_id = manager.start(spec_for(dest, expected_sha256=sha256_of(CONTENT), expected_size=len(CONTENT)))
    final = wait_terminal(hub, task_id)

    assert final.stage == "complete", final.message
    assert dest.read_bytes() == CONTENT


def test_restarts_from_zero_on_an_unexpected_content_range(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        count = len(fake_http.requests)
        if count == 1:
            return httpx.Response(200, content=interrupted_body(CONTENT, after=24))
        if count == 2:
            wrong_range = {"Content-Range": f"bytes 4-39/{len(CONTENT)}"}
            return httpx.Response(206, content=pieces(CONTENT[4:]), headers=wrong_range)
        assert "Range" not in request.headers
        return httpx.Response(200, content=pieces(CONTENT))

    fake_http.add("GET", URL, handler=handler)
    manager = make_manager(max_attempts=3)

    task_id = manager.start(spec_for(dest, expected_sha256=sha256_of(CONTENT)))

    assert wait_terminal(hub, task_id).stage == "complete"
    assert dest.read_bytes() == CONTENT
    assert len(fake_http.requests) == 3


# ---------------------------------------------------------------------------
# HTTP errors that are not retried
# ---------------------------------------------------------------------------


def test_not_found_is_not_retried(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    fake_http.add("GET", URL, status=404, content=b"not found")
    manager = make_manager()

    task_id = manager.start(spec_for(dest, auth_hint="Add a token"))
    final = wait_terminal(hub, task_id)

    assert (final.stage, final.message) == ("error", "HTTP 404")
    assert len(fake_http.requests) == 1
    assert not part_path(dest).exists()


@pytest.mark.parametrize(
    ("status", "hint", "message"),
    [(401, "This download requires an API token.", "This download requires an API token."), (403, None, "HTTP 403")],
)
def test_auth_errors_use_the_auth_hint(
    make_manager: Callable[..., DownloadManager],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    dest: Path,
    status: int,
    hint: str | None,
    message: str,
) -> None:
    fake_http.add("GET", URL, status=status)
    manager = make_manager()

    task_id = manager.start(spec_for(dest, auth_hint=hint))
    final = wait_terminal(hub, task_id)

    assert (final.stage, final.message) == ("error", message)
    assert len(fake_http.requests) == 1


# ---------------------------------------------------------------------------
# Idempotence: dedupe and existing files
# ---------------------------------------------------------------------------


def test_concurrent_starts_for_one_dest_share_one_download(
    make_manager: Callable[..., DownloadManager],
    make_gate: Callable[[], Gate],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    dest: Path,
) -> None:
    gate = make_gate()
    serve_gated(fake_http, gate)
    manager = make_manager()
    callers = 8
    barrier = threading.Barrier(callers)
    task_ids: list[str] = []
    completions: list[int] = []
    lock = threading.Lock()

    def call(index: int) -> None:
        barrier.wait()
        # Same file, spelled differently: the dedupe key is the normalized absolute path.
        target = dest if index % 2 else dest.parent / "." / dest.name
        task_id = manager.start(spec_for(target), on_complete=lambda _path, _digest: completions.append(index))
        with lock:
            task_ids.append(task_id)

    threads = [threading.Thread(target=call, args=(index,)) for index in range(callers)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(5)
    gate.release()

    assert len(set(task_ids)) == 1
    final = wait_terminal(hub, task_ids[0])
    assert final.stage == "complete"
    assert len(fake_http.requests) == 1
    assert sorted(completions) == list(range(callers))  # every caller's callback ran once
    assert stages_of(hub, task_ids[0]).count("queued") == 1
    assert dest.read_bytes() == CONTENT


def test_existing_dest_with_the_expected_hash_completes_without_request(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    dest.parent.mkdir(parents=True)
    dest.write_bytes(CONTENT)
    part_path(dest).write_bytes(b"stale part of an earlier run")
    calls: list[tuple[Path, str]] = []
    manager = make_manager()

    task_id = manager.start(
        spec_for(dest, expected_sha256=sha256_of(CONTENT)), on_complete=lambda path, digest: calls.append((path, digest))
    )
    final = wait_terminal(hub, task_id)

    assert (final.stage, final.message) == ("complete", "Already downloaded")
    assert (final.current, final.total) == (len(CONTENT), len(CONTENT))
    assert stages_of(hub, task_id) == ["queued", "complete"]
    assert calls == [(dest, sha256_of(CONTENT))]
    assert fake_http.requests == []
    assert not part_path(dest).exists()
    assert dest.read_bytes() == CONTENT


@pytest.mark.parametrize(
    "values",
    [{"expected_sha256": sha256_of(b"other content")}, {"expected_size": len(CONTENT) + 1}],
)
def test_existing_different_file_is_never_overwritten(
    make_manager: Callable[..., DownloadManager],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    dest: Path,
    values: dict[str, object],
) -> None:
    dest.parent.mkdir(parents=True)
    dest.write_bytes(CONTENT)
    manager = make_manager()

    task_id = manager.start(spec_for(dest, **values))
    final = wait_terminal(hub, task_id)

    assert final.stage == "error"
    assert final.message.startswith("A different file already exists")
    assert dest.read_bytes() == CONTENT
    assert fake_http.requests == []


def test_existing_dest_without_hash_matches_by_size(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    dest.parent.mkdir(parents=True)
    dest.write_bytes(CONTENT)
    digests: list[str] = []
    manager = make_manager()

    task_id = manager.start(
        spec_for(dest, expected_size=len(CONTENT)), on_complete=lambda _path, digest: digests.append(digest)
    )

    assert wait_terminal(hub, task_id).stage == "complete"
    assert digests == [sha256_of(CONTENT)]
    assert fake_http.requests == []


# ---------------------------------------------------------------------------
# Concurrency limit and completion callback
# ---------------------------------------------------------------------------


def test_at_most_max_concurrent_downloads_run(
    make_manager: Callable[..., DownloadManager],
    make_gate: Callable[[], Gate],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    tmp_path: Path,
) -> None:
    lock = threading.Lock()
    running = [0]
    peak = [0]

    def counted(body: Iterable[bytes]) -> Iterator[bytes]:
        with lock:
            running[0] += 1
            peak[0] = max(peak[0], running[0])
        try:
            yield from body
        finally:
            with lock:
                running[0] -= 1

    gates = [make_gate() for _ in range(4)]
    for index, gate in enumerate(gates):
        fake_http.add(
            "GET",
            f"https://files.example/{index}",
            handler=lambda request, gate=gate: httpx.Response(200, content=counted(gate.body())),
        )
    manager = make_manager(max_concurrent=2)

    task_ids = [
        manager.start(spec_for(tmp_path / f"{index}.bin", url=f"https://files.example/{index}")) for index in range(4)
    ]
    wait_until(lambda: sum(gate.reached.is_set() for gate in gates) == 2)
    time.sleep(0.1)
    assert len(fake_http.requests) == 2
    latest = sorted(stages_of(hub, task_id)[-1] for task_id in task_ids)
    assert latest == ["downloading", "downloading", "queued", "queued"]
    assert all(manager.is_active(task_id) for task_id in task_ids)
    for gate in gates:
        gate.release()

    assert [wait_terminal(hub, task_id).stage for task_id in task_ids] == ["complete"] * 4
    assert peak[0] == 2
    assert len(fake_http.requests) == 4


def test_failing_completion_callback_fails_the_task(
    make_manager: Callable[..., DownloadManager], hub: RecordingTaskHub, fake_http: FakeHttp, dest: Path
) -> None:
    serve(fake_http)

    def explode(_path: Path, _digest: str) -> None:
        raise RuntimeError("library is read-only")

    manager = make_manager()
    task_id = manager.start(spec_for(dest), on_complete=explode)
    final = wait_terminal(hub, task_id)

    assert final.stage == "error"
    assert "recording it failed: library is read-only" in final.message
    assert dest.read_bytes() == CONTENT  # the verified file is kept
    assert [stage for stage in stages_of(hub, task_id) if stage in TERMINAL] == ["error"]


# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------


def test_headers_and_signed_urls_never_reach_events_or_logs(
    make_manager: Callable[..., DownloadManager],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    token = "tok-SECRET-123"
    url = "https://files.example/models/secret.safetensors?sig=SIGNED-SECRET"

    def handler(request: httpx.Request) -> httpx.Response:
        count = len(fake_http.requests)
        if count == 1:
            raise httpx.ConnectError(f"cannot reach {request.url}", request=request)
        if count == 2:
            return httpx.Response(500)
        return httpx.Response(401)

    fake_http.add("GET", url, handler=handler)
    serve(fake_http, url="https://files.example/ok")
    manager = make_manager(max_attempts=3)
    headers = {"Authorization": f"Bearer {token}"}
    spec = DownloadSpec(url=url, dest=tmp_path / "secret.bin", title=TITLE, headers=headers)

    failed = manager.start(spec)
    assert wait_terminal(hub, failed).stage == "error"
    def explode(_path: Path, _digest: str) -> None:
        raise RuntimeError("boom")

    completed = manager.start(
        DownloadSpec(url="https://files.example/ok", dest=tmp_path / "ok.bin", title=TITLE, headers=headers),
        on_complete=explode,
    )
    assert wait_terminal(hub, completed).stage == "error"

    assert fake_http.requests[0].headers["Authorization"] == f"Bearer {token}"
    assert token not in repr(spec)
    payloads = [event.model_dump_json() for event in hub.published]
    assert payloads
    for payload in payloads:
        assert token not in payload
        assert "SIGNED-SECRET" not in payload
        assert "files.example" not in payload
    assert events_of(hub, failed)[-1].message == "HTTP 401"
    messages = [event.message for event in events_of(hub, failed)]
    assert any(message.startswith("Could not connect to the server, retrying") for message in messages)
    assert token not in caplog.text
    own_logs = [record.getMessage() for record in caplog.records if record.name == "app.services.downloads"]
    assert own_logs
    assert not any("SIGNED-SECRET" in message for message in own_logs)  # URLs are masked in our log lines


# ---------------------------------------------------------------------------
# Shutdown
# ---------------------------------------------------------------------------


def test_shutdown_without_any_job(hub: RecordingTaskHub, fake_http: FakeHttp) -> None:
    manager = DownloadManager(tasks=hub, client_factory=fake_http.client_factory)
    manager.shutdown()
    manager.shutdown(timeout=0)
    assert hub.published == []


def test_shutdown_cancels_a_running_download(
    make_manager: Callable[..., DownloadManager],
    make_gate: Callable[[], Gate],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    dest: Path,
) -> None:
    gate = make_gate()
    serve_gated(fake_http, gate)
    manager = make_manager()
    task_id = manager.start(spec_for(dest))
    assert gate.reached.wait(5)

    releaser = threading.Timer(0.1, gate.release)
    releaser.start()
    started = time.monotonic()
    manager.shutdown(timeout=5)
    releaser.join()

    assert time.monotonic() - started < 4
    assert events_of(hub, task_id)[-1].stage == "cancelled"
    assert not part_path(dest).exists()
    assert not dest.exists()


def test_shutdown_returns_after_the_timeout_and_the_manager_stays_usable(
    make_manager: Callable[..., DownloadManager],
    make_gate: Callable[[], Gate],
    hub: RecordingTaskHub,
    fake_http: FakeHttp,
    tmp_path: Path,
) -> None:
    gate = make_gate()
    serve_gated(fake_http, gate, url="https://files.example/stalled")
    serve(fake_http)
    manager = make_manager()
    stalled = manager.start(spec_for(tmp_path / "stalled.bin", url="https://files.example/stalled"))
    assert gate.reached.wait(5)

    started = time.monotonic()
    manager.shutdown(timeout=0.2)
    assert time.monotonic() - started < 3
    assert not manager.is_active(stalled)
    gate.release()
    assert wait_terminal(hub, stalled).stage == "cancelled"

    after = manager.start(spec_for(tmp_path / "after.bin"))
    assert wait_terminal(hub, after).stage == "complete"


# ---------------------------------------------------------------------------
# Real sockets: local HTTP server + the production client
# ---------------------------------------------------------------------------

REAL_CONTENT = bytes(index % 251 for index in range(300_000))


class RangeServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), RangeHandler)
        self.ranges: list[str | None] = []
        self.user_agents: list[str | None] = []
        self.dropped = False

    @property
    def base_url(self) -> str:
        host, port = self.server_address[:2]
        return f"http://{host!s}:{port}"


class RangeHandler(BaseHTTPRequestHandler):
    """/api/download/1 redirects to /files/model.safetensors (like Civitai -> its storage). The first file
    request announces the full length but drops the connection halfway; later ones honor Range."""

    server: RangeServer

    def do_GET(self) -> None:  # noqa: N802 (http.server API)
        if self.path.startswith("/api/download/"):
            self.send_response(307)
            self.send_header("Location", "/files/model.safetensors?sig=abc")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        requested = self.headers.get("Range")
        self.server.ranges.append(requested)
        self.server.user_agents.append(self.headers.get("User-Agent"))
        if not self.server.dropped:
            self.server.dropped = True
            self.send_response(200)
            self.send_header("Content-Length", str(len(REAL_CONTENT)))
            self.end_headers()
            self.wfile.write(REAL_CONTENT[: len(REAL_CONTENT) // 2])
            self.wfile.flush()
            self.close_connection = True
            return
        match = re.fullmatch(r"bytes=(\d+)-", requested or "")
        if match is None:
            self.send_response(200)
            body = REAL_CONTENT
        else:
            start = int(match.group(1))
            body = REAL_CONTENT[start:]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{len(REAL_CONTENT) - 1}/{len(REAL_CONTENT)}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 (http.server API)
        pass


@pytest.fixture()
def range_server() -> Iterator[RangeServer]:
    server = RangeServer()
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(5)


def test_real_http_download_resumes_after_a_dropped_connection(
    hub: RecordingTaskHub, range_server: RangeServer, dest: Path
) -> None:
    manager = DownloadManager(
        tasks=hub, client_factory=default_http_client, chunk_size=8192, retry_delay_s=0, progress_interval_s=0
    )
    digests: list[str] = []
    try:
        task_id = manager.start(
            DownloadSpec(
                url=f"{range_server.base_url}/api/download/1",
                dest=dest,
                title=TITLE,
                expected_sha256=sha256_of(REAL_CONTENT),
                expected_size=len(REAL_CONTENT),
            ),
            on_complete=lambda _path, digest: digests.append(digest),
        )
        final = wait_terminal(hub, task_id)
    finally:
        manager.shutdown(timeout=5)

    assert final.stage == "complete", final.message
    assert dest.read_bytes() == REAL_CONTENT
    assert digests == [sha256_of(REAL_CONTENT)]
    assert not part_path(dest).exists()
    assert range_server.ranges[0] is None
    assert len(range_server.ranges) == 2
    resumed_at = int(re.fullmatch(r"bytes=(\d+)-", range_server.ranges[1] or "").group(1))  # type: ignore[union-attr]
    assert 0 < resumed_at <= len(REAL_CONTENT) // 2
    assert range_server.user_agents == [USER_AGENT, USER_AGENT]
    messages = [event.message for event in events_of(hub, task_id)]
    assert any(message.startswith("The connection was interrupted, retrying") for message in messages)


def test_httpx_never_logs_request_urls_at_info() -> None:
    # Signed storage URLs carry credentials in the query string (app/services/http.py).
    assert logging.getLogger("httpx").getEffectiveLevel() >= logging.WARNING
