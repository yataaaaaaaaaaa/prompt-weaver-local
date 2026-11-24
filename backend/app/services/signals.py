"""SIGINT/SIGTERM handling: first signal cancels the running generation, second exits (130)."""

from __future__ import annotations

import logging
import os
import signal
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)

FORCED_EXIT_CODE = 130
_SIGNALS = (signal.SIGINT, signal.SIGTERM)


def install_cancel_signal_handlers(on_signal: Callable[[], None]) -> Callable[[], None]:
    """Install handlers calling on_signal (then chaining the previous handler). Returns a restore function.
    Must tolerate being called outside the main thread (no-op)."""
    if threading.current_thread() is not threading.main_thread():
        return lambda: None

    previous_handlers: dict[int, Any] = {}
    interrupt_count = 0
    count_lock = threading.Lock()

    def make_handler(previous: Any) -> Callable[[int, Any], None]:
        def handler(received_signum: int, frame: Any) -> None:
            nonlocal interrupt_count
            try:
                on_signal()
            except Exception:
                logger.exception("Cancelling the generation on signal %s failed", received_signum)
            with count_lock:
                interrupt_count += 1
                count = interrupt_count
            if count >= 2:
                os._exit(FORCED_EXIT_CODE)
            if callable(previous):
                previous(received_signum, frame)

        return handler

    for signum in _SIGNALS:
        try:
            previous = signal.getsignal(signum)
            signal.signal(signum, make_handler(previous))
        except (OSError, ValueError, RuntimeError):
            continue
        previous_handlers[signum] = previous

    def restore() -> None:
        for signum, previous in list(previous_handlers.items()):
            try:
                signal.signal(signum, previous)
            except (OSError, ValueError, RuntimeError, TypeError):
                pass
        previous_handlers.clear()

    return restore
