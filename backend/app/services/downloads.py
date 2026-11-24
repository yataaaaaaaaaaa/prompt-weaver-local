"""Generic download manager (model installs today; any later feature that needs a file from the web).

Contract:
- start(spec) streams spec.url into "<dest>.part" next to spec.dest, then atomically renames it to spec.dest
  (os.replace) once complete and verified: size == expected_size (when set) and SHA-256 == expected_sha256
  (when set; always computed while streaming). A mismatch deletes the .part file and fails the task.
- Idempotent and concurrency-safe: start() for a dest that already has a running job returns that job's
  task id (one download per destination, whatever the number of callers/threads). A dest that already exists
  with the expected hash (or size, without a hash) completes immediately without any request.
- Runs on worker threads (at most `max_concurrent` downloads at once; the others wait in stage "queued").
- Progress: DownloadTaskEvent(task_id, title, stage, message, current=bytes, total=bytes or 0) through
  TaskHub.publish: "queued" -> "downloading" (throttled to one event per progress_interval_s, plus the first
  and the last) -> exactly one terminal event "complete" | "error" | "cancelled".
- Retries: network errors and HTTP 5xx/429 are retried up to max_attempts (retry_delay_s apart), resuming
  the .part file with a Range request when the server answers 206 (restarting from zero on 200).
  HTTP 4xx are not retried; 401/403 fail with spec.auth_hint when set.
- cancel(task_id) stops the job at the next chunk (or before it starts), deletes the .part file and
  publishes "cancelled". Returns False for unknown or finished tasks.
- on_complete(dest, sha256) runs on the worker thread after the rename and BEFORE the "complete" event, so
  callers can record the verified file before clients see the completion. Its exceptions fail the task.
- Secrets: spec.headers may carry credentials. They are only sent with the request (httpx drops
  Authorization on cross-host redirects) and never logged nor put in an event message.
- shutdown() (app lifespan) cancels every job and waits for the workers.

Details:
- Task ids are "download-<12 hex>". A cancelled job stops being "active" (is_active() is False, start() for
  its dest queues a new job) as soon as cancel() returns; the new job waits until the cancelled one has ended
  before touching the files, so two jobs never write the same .part file.
- Callers joining a running job (same dest) add their on_complete; every callback runs once, in start order.
- A dest that exists when the job starts is never overwritten: it completes ("Already downloaded", its
  callbacks get the hash computed from the file) when it matches expected_sha256 (or expected_size without a
  hash, or anything when neither is set), else the task fails with "A different file already exists ...".
- A stale "<dest>.part" (left by a crashed run) is deleted when the job starts; resuming only happens between
  the attempts of one job.
- Cancellation is checked between chunks of `chunk_size` bytes: a stalled connection only ends with the read
  timeout of the HTTP client (services/http.py), and shutdown() waits at most `timeout` seconds for it.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import threading
import time
import uuid
from collections.abc import Callable, Mapping
from concurrent import futures
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from ..schemas import DownloadStage, DownloadTaskEvent
from .file_hashes import normalize_sha256, sha256_file
from .files import remove_quietly
from .http import HttpClientFactory, describe_http_error
from .task_hub import TaskHub

logger = logging.getLogger(__name__)

PART_SUFFIX = ".part"

CompletionCallback = Callable[[Path, str], None]

QUEUED_MESSAGE = "Waiting for a download slot"
DOWNLOADING_MESSAGE = "Downloading"
COMPLETE_MESSAGE = "Download complete"
ALREADY_PRESENT_MESSAGE = "Already downloaded"
CANCELLED_MESSAGE = "Download cancelled"

_CONTENT_RANGE_START = re.compile(r"^\s*bytes\s+(\d+)-", re.IGNORECASE)
_URL = re.compile(r"\S+://\S*")


@dataclass(frozen=True)
class DownloadSpec:
    url: str
    dest: Path
    title: str
    headers: Mapping[str, str] = field(default_factory=dict, repr=False)
    expected_sha256: str | None = None
    expected_size: int | None = None
    # User-facing message when the server answers 401/403.
    auth_hint: str | None = None


def part_path(dest: Path) -> Path:
    """The temporary file a download of `dest` streams into ("<dest>.part")."""
    return dest.with_name(dest.name + PART_SUFFIX)


def _dest_key(dest: Path) -> str:
    return os.path.normcase(os.path.abspath(dest))


@dataclass(frozen=True)
class _Outcome:
    """How a job ends: its terminal event ("complete" | "error" | "cancelled")."""

    stage: DownloadStage
    message: str
    current: int = 0
    total: int = 0


@dataclass(eq=False)
class _Job:
    task_id: str
    spec: DownloadSpec
    key: str
    # Earlier jobs for the same dest that have not ended yet (cancelled, or verified and finishing): waited for
    # before this job touches any file.
    predecessors: tuple[_Job, ...]
    callbacks: list[CompletionCallback] = field(default_factory=list)
    cancel_requested: threading.Event = field(default_factory=threading.Event)
    # Set once the terminal event is published; the job never touches its files afterwards.
    ended: threading.Event = field(default_factory=threading.Event)
    # Guarded by DownloadManager._lock:
    started: bool = False
    finalizing: bool = False  # verified, being moved into place and recorded: can no longer be cancelled
    future: futures.Future[None] | None = None


class _Cancelled(Exception):
    """The job was cancelled (checked between chunks and during the retry delay)."""


class _DownloadFailed(Exception):
    """Ends the job with this message (safe to show: never contains URLs or headers)."""


class _RetryableError(Exception):
    """A failed attempt worth retrying (network error, HTTP 5xx/429). Same message rules as _DownloadFailed."""


class _Progress:
    """'downloading' events of one job, throttled to one per interval_s (forced events always go out)."""

    def __init__(self, publish: Callable[[str, int, int], None], interval_s: float) -> None:
        self._publish = publish
        self._interval_s = interval_s
        self.current = 0
        self.total = 0
        self._sent_at: float | None = None
        self._sent: tuple[int, int] | None = None

    def report(
        self, current: int, *, total: int | None = None, message: str = DOWNLOADING_MESSAGE, force: bool = False
    ) -> None:
        self.current = current
        if total is not None:
            self.total = total
        now = time.monotonic()
        if force or self._sent_at is None or now - self._sent_at >= self._interval_s:
            self._send(message, now)

    def flush(self) -> None:
        """Sends the latest values unless they were the last ones sent."""
        if self._sent != (self.current, self.total):
            self._send(DOWNLOADING_MESSAGE, time.monotonic())

    def _send(self, message: str, now: float) -> None:
        self._sent_at = now
        self._sent = (self.current, self.total)
        self._publish(message, self.current, self.total)


class DownloadManager:
    def __init__(
        self,
        *,
        tasks: TaskHub,
        client_factory: HttpClientFactory,
        max_concurrent: int = 2,
        max_attempts: int = 3,
        retry_delay_s: float = 2.0,
        chunk_size: int = 1024 * 1024,
        progress_interval_s: float = 0.25,
    ) -> None:
        if max_concurrent < 1 or max_attempts < 1 or chunk_size < 1:
            raise ValueError("max_concurrent, max_attempts and chunk_size must be at least 1")
        self._tasks = tasks
        self._client_factory = client_factory
        self._max_concurrent = max_concurrent
        self._max_attempts = max_attempts
        self._retry_delay_s = retry_delay_s
        self._chunk_size = chunk_size
        self._progress_interval_s = progress_interval_s
        self._lock = threading.Lock()
        # Every job whose terminal event is not published yet, in start order (by task id).
        self._jobs: dict[str, _Job] = {}
        # Dest key -> the job a new start() for that dest joins (not cancelled, not finalizing).
        self._joinable: dict[str, _Job] = {}
        self._executor: futures.ThreadPoolExecutor | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self, spec: DownloadSpec, *, on_complete: CompletionCallback | None = None) -> str:
        """Queues the download (or joins the running one for spec.dest) and returns its task id."""
        key = _dest_key(spec.dest)
        with self._lock:
            running = self._joinable.get(key)
            if running is not None:
                if on_complete is not None and on_complete not in running.callbacks:
                    running.callbacks.append(on_complete)
                return running.task_id
            job = _Job(
                task_id=f"download-{uuid.uuid4().hex[:12]}",
                spec=spec,
                key=key,
                predecessors=tuple(other for other in self._jobs.values() if other.key == key),
                callbacks=[on_complete] if on_complete is not None else [],
            )
            self._jobs[job.task_id] = job
            self._joinable[key] = job
            self._publish(job, "queued", QUEUED_MESSAGE, 0, spec.expected_size or 0)
            try:
                job.future = self._executor_locked().submit(self._run, job)
            except Exception as exc:
                logger.exception("Could not schedule download %s", job.task_id)
                self._end_locked(job, _Outcome("error", f"Could not start the download ({type(exc).__name__})."))
                raise
            return job.task_id

    def cancel(self, task_id: str) -> bool:
        """Requests the cancellation of a queued or running download. False for unknown or finished tasks
        (including a download already verified and being recorded, which completes)."""
        with self._lock:
            job = self._jobs.get(task_id)
            if job is None or job.finalizing:
                return False
            job.cancel_requested.set()
            if self._joinable.get(job.key) is job:
                del self._joinable[job.key]
            if not job.started:
                # Still waiting for a worker: it will never send a request.
                if job.future is not None:
                    job.future.cancel()
                self._end_locked(job, _Outcome("cancelled", CANCELLED_MESSAGE))
            return True

    def is_active(self, task_id: str) -> bool:
        """True while the task is queued or downloading."""
        with self._lock:
            job = self._jobs.get(task_id)
            return job is not None and not job.cancel_requested.is_set()

    def shutdown(self, timeout: float | None = 10.0) -> None:
        """Cancels every job and waits (up to `timeout` seconds) for the worker threads."""
        with self._lock:
            jobs = list(self._jobs.values())
            executor, self._executor = self._executor, None
        for job in jobs:
            self.cancel(job.task_id)
        pending = [job.future for job in jobs if job.future is not None]
        if pending:
            _done, not_done = futures.wait(pending, timeout=timeout)
            if not_done:
                logger.warning("%d download(s) still stopping after the shutdown timeout", len(not_done))
        if executor is not None:
            # Jobs that raced with this shutdown still run (and end) on the old workers.
            executor.shutdown(wait=False)

    # ------------------------------------------------------------------
    # Job table
    # ------------------------------------------------------------------

    def _executor_locked(self) -> futures.ThreadPoolExecutor:
        if self._executor is None:
            self._executor = futures.ThreadPoolExecutor(max_workers=self._max_concurrent, thread_name_prefix="download")
        return self._executor

    def _end_locked(self, job: _Job, outcome: _Outcome) -> None:
        """Publishes the job's terminal event (once) and forgets the job. Caller holds self._lock."""
        if job.ended.is_set():
            return
        self._jobs.pop(job.task_id, None)
        if self._joinable.get(job.key) is job:
            del self._joinable[job.key]
        try:
            self._publish(job, outcome.stage, outcome.message, outcome.current, outcome.total)
        finally:
            job.ended.set()

    def _claim_completion(self, job: _Job) -> list[CompletionCallback] | None:
        """Last cancellation point before the file is put in place: None when cancelled, else the callbacks
        to run (later start() calls for the dest queue a new job, which finds the finished file)."""
        with self._lock:
            if job.cancel_requested.is_set():
                return None
            job.finalizing = True
            if self._joinable.get(job.key) is job:
                del self._joinable[job.key]
            return list(job.callbacks)

    def _publish(self, job: _Job, stage: DownloadStage, message: str, current: int, total: int) -> None:
        self._tasks.publish(
            DownloadTaskEvent(
                task_id=job.task_id,
                title=job.spec.title,
                stage=stage,
                message=message,
                current=current,
                total=total,
            )
        )

    # ------------------------------------------------------------------
    # Worker
    # ------------------------------------------------------------------

    def _run(self, job: _Job) -> None:
        for previous in job.predecessors:
            previous.ended.wait()
        with self._lock:
            if job.ended.is_set():
                return  # cancelled while queued: its terminal event is already out
            job.started = True
        try:
            outcome = self._execute(job)
        except Exception as exc:
            logger.exception("Download %s failed unexpectedly", job.task_id)
            remove_quietly(part_path(job.spec.dest))
            outcome = _Outcome("error", f"Unexpected download error ({type(exc).__name__}).")
        with self._lock:
            self._end_locked(job, outcome)

    def _execute(self, job: _Job) -> _Outcome:
        spec = job.spec
        part = part_path(spec.dest)
        progress = _Progress(
            lambda message, current, total: self._publish(job, "downloading", message, current, total),
            self._progress_interval_s,
        )
        try:
            spec.dest.parent.mkdir(parents=True, exist_ok=True)
            part.unlink(missing_ok=True)
            if spec.dest.exists():
                return self._adopt_existing(job)
            sha256, size = self._fetch(job, part, progress)
            _verify(spec, sha256, size)
        except _Cancelled:
            remove_quietly(part)
            return _Outcome("cancelled", CANCELLED_MESSAGE, progress.current, progress.total)
        except _DownloadFailed as exc:
            remove_quietly(part)
            return _Outcome("error", str(exc), progress.current, progress.total)
        except OSError as exc:
            remove_quietly(part)
            logger.warning("Download %s: file error: %s", job.task_id, exc)
            return _Outcome("error", f"File error: {exc}", progress.current, progress.total)
        except BaseException:
            remove_quietly(part)
            raise
        return self._install(job, part, sha256, size)

    def _adopt_existing(self, job: _Job) -> _Outcome:
        """spec.dest exists before anything was downloaded: complete with it when it is the expected file,
        never overwrite it."""
        spec = job.spec
        dest = spec.dest
        expected_sha256 = _normalized_sha256(spec.expected_sha256)
        size = dest.stat().st_size
        if expected_sha256 is None and spec.expected_size is not None and size != spec.expected_size:
            return _different_file(dest)
        sha256 = sha256_file(dest)
        if expected_sha256 is not None and sha256 != expected_sha256:
            return _different_file(dest)
        callbacks = self._claim_completion(job)
        if callbacks is None:
            return _Outcome("cancelled", CANCELLED_MESSAGE)
        return self._run_callbacks(job, callbacks, sha256, size, ALREADY_PRESENT_MESSAGE)

    def _install(self, job: _Job, part: Path, sha256: str, size: int) -> _Outcome:
        """Moves the verified .part file to spec.dest, then runs the completion callbacks."""
        dest = job.spec.dest
        callbacks = self._claim_completion(job)
        if callbacks is None:
            remove_quietly(part)
            return _Outcome("cancelled", CANCELLED_MESSAGE, size, size)
        try:
            if dest.exists():
                # Appeared while downloading (another process): never overwrite it.
                remove_quietly(part)
                if sha256_file(dest) != sha256:
                    return _different_file(dest)
            else:
                os.replace(part, dest)
        except OSError as exc:
            remove_quietly(part)
            logger.warning("Download %s: moving the file into place failed: %s", job.task_id, exc)
            return _Outcome("error", f"Could not move the downloaded file into place: {exc}", size, size)
        return self._run_callbacks(job, callbacks, sha256, size, COMPLETE_MESSAGE)

    def _run_callbacks(
        self, job: _Job, callbacks: list[CompletionCallback], sha256: str, size: int, message: str
    ) -> _Outcome:
        for callback in callbacks:
            try:
                callback(job.spec.dest, sha256)
            except Exception as exc:
                logger.exception("Download %s: the completion callback failed", job.task_id)
                return _Outcome("error", f"The file was downloaded but recording it failed: {exc}", size, size)
        return _Outcome("complete", message, size, size)

    def _fetch(self, job: _Job, part: Path, progress: _Progress) -> tuple[str, int]:
        """Downloads spec.url into `part` (with retries). Returns (sha256, size) of the complete .part file."""
        attempt = 1
        with self._client_factory() as client:
            while True:
                try:
                    return self._attempt(job, client, part, progress)
                except _RetryableError as exc:
                    if attempt >= self._max_attempts:
                        raise _DownloadFailed(f"{exc} (gave up after {attempt} attempts)") from None
                    attempt += 1
                    logger.info("Download %s: retrying (attempt %d of %d)", job.task_id, attempt, self._max_attempts)
                    progress.report(
                        progress.current,
                        message=f"{exc}, retrying (attempt {attempt} of {self._max_attempts})",
                        force=True,
                    )
                    if job.cancel_requested.wait(self._retry_delay_s):
                        raise _Cancelled from None

    def _attempt(self, job: _Job, client: httpx.Client, part: Path, progress: _Progress) -> tuple[str, int]:
        if job.cancel_requested.is_set():
            raise _Cancelled
        spec = job.spec
        offset = part.stat().st_size if part.exists() else 0
        headers = dict(spec.headers)
        if offset:
            headers["Range"] = f"bytes={offset}-"
        try:
            with client.stream("GET", spec.url, headers=headers) as response:
                return self._receive(job, response, part, offset, progress)
        except httpx.TransportError as exc:
            logger.warning("Download %s: %s", job.task_id, _loggable(exc))
            raise _RetryableError(describe_http_error(exc)) from None
        except httpx.HTTPError as exc:
            logger.warning("Download %s: %s", job.task_id, _loggable(exc))
            raise _DownloadFailed(describe_http_error(exc)) from None

    def _receive(
        self, job: _Job, response: httpx.Response, part: Path, offset: int, progress: _Progress
    ) -> tuple[str, int]:
        spec = job.spec
        status = response.status_code
        resume = False
        if offset and status == 416:
            # The partial file cannot be continued (e.g. it already holds every byte): start over.
            part.unlink(missing_ok=True)
            raise _RetryableError("HTTP 416")
        if offset and status == 206:
            if _content_range_start(response.headers.get("Content-Range")) != offset:
                part.unlink(missing_ok=True)
                raise _RetryableError("The server answered an unexpected byte range")
            resume = True
        elif status in (401, 403):
            raise _DownloadFailed(spec.auth_hint or f"HTTP {status}")
        elif status == 429 or status >= 500:
            raise _RetryableError(f"HTTP {status}")
        elif not 200 <= status < 300:
            raise _DownloadFailed(f"HTTP {status}")

        if resume:
            with part.open("rb") as existing:
                hasher = hashlib.file_digest(existing, "sha256")
            received = offset
        else:
            hasher = hashlib.sha256()
            received = 0
        length = _content_length(response)
        if spec.expected_size is not None:
            total = spec.expected_size
        elif length is not None:
            total = length + received
        else:
            total = 0
        progress.report(received, total=total, force=True)
        with part.open("ab" if resume else "wb") as file:
            for chunk in response.iter_bytes(self._chunk_size):
                if job.cancel_requested.is_set():
                    raise _Cancelled
                file.write(chunk)
                hasher.update(chunk)
                received += len(chunk)
                progress.report(received)
        progress.flush()
        return hasher.hexdigest(), received


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _verify(spec: DownloadSpec, sha256: str, size: int) -> None:
    if spec.expected_size is not None and size != spec.expected_size:
        raise _DownloadFailed(f"Size mismatch: expected {spec.expected_size} bytes, received {size}.")
    expected_sha256 = _normalized_sha256(spec.expected_sha256)
    if expected_sha256 is not None and sha256 != expected_sha256:
        raise _DownloadFailed("SHA-256 mismatch: the downloaded file is not the expected one.")


def _normalized_sha256(value: str | None) -> str | None:
    """The expected hash of a spec; an unusable value can never match (never skips the verification)."""
    if not value:
        return None
    return normalize_sha256(value) or value


def _different_file(dest: Path) -> _Outcome:
    return _Outcome("error", f"A different file already exists at {dest}; it was left untouched.")


def _loggable(exc: httpx.HTTPError) -> str:
    """Exception type and text for the log, with URLs (possibly signed) masked."""
    return f"{type(exc).__name__}: {_URL.sub('<url>', str(exc))}"


def _content_length(response: httpx.Response) -> int | None:
    value = response.headers.get("Content-Length", "").strip()
    return int(value) if value.isdigit() else None


def _content_range_start(value: str | None) -> int | None:
    match = _CONTENT_RANGE_START.match(value or "")
    return int(match.group(1)) if match else None

