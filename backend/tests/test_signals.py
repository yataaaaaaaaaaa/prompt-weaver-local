"""SIGINT/SIGTERM handlers installed by the lifespan (handlers are invoked directly, no real signal is sent)."""

from __future__ import annotations

import os
import signal
import threading
from collections.abc import Iterator
from typing import Any

import pytest

from app.services import signals


@pytest.fixture()
def previous_handler() -> Iterator[list[int]]:
    """Install a recording SIGINT handler (restored afterwards) that the cancel handler must chain to."""
    received: list[int] = []
    original_int = signal.getsignal(signal.SIGINT)
    original_term = signal.getsignal(signal.SIGTERM)
    signal.signal(signal.SIGINT, lambda signum, _frame: received.append(signum))
    try:
        yield received
    finally:
        signal.signal(signal.SIGINT, original_int)
        signal.signal(signal.SIGTERM, original_term)


@pytest.fixture()
def exits(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    codes: list[int] = []
    monkeypatch.setattr(os, "_exit", codes.append)
    return codes


def test_first_signal_cancels_and_chains_the_previous_handler(previous_handler: list[int], exits: list[int]) -> None:
    cancels: list[str] = []
    restore = signals.install_cancel_signal_handlers(lambda: cancels.append("cancel"))
    try:
        handler: Any = signal.getsignal(signal.SIGINT)
        handler(signal.SIGINT, None)
    finally:
        restore()

    assert cancels == ["cancel"]
    assert previous_handler == [signal.SIGINT]
    assert exits == []


def test_second_signal_forces_the_exit(previous_handler: list[int], exits: list[int]) -> None:
    restore = signals.install_cancel_signal_handlers(lambda: None)
    try:
        handler: Any = signal.getsignal(signal.SIGINT)
        handler(signal.SIGINT, None)
        handler(signal.SIGINT, None)
    finally:
        restore()

    assert exits == [signals.FORCED_EXIT_CODE]


def test_a_failing_cancel_does_not_break_the_handler(previous_handler: list[int], exits: list[int]) -> None:
    def broken_cancel() -> None:
        raise RuntimeError("runtime gone")

    restore = signals.install_cancel_signal_handlers(broken_cancel)
    try:
        handler: Any = signal.getsignal(signal.SIGINT)
        handler(signal.SIGINT, None)
    finally:
        restore()

    assert previous_handler == [signal.SIGINT]


def test_restore_reinstalls_the_previous_handlers(previous_handler: list[int]) -> None:
    before_int = signal.getsignal(signal.SIGINT)
    before_term = signal.getsignal(signal.SIGTERM)

    restore = signals.install_cancel_signal_handlers(lambda: None)
    assert signal.getsignal(signal.SIGINT) is not before_int
    assert signal.getsignal(signal.SIGTERM) is not before_term
    restore()

    assert signal.getsignal(signal.SIGINT) is before_int
    assert signal.getsignal(signal.SIGTERM) is before_term


def test_outside_the_main_thread_it_is_a_no_op(previous_handler: list[int]) -> None:
    before = signal.getsignal(signal.SIGINT)
    results: list[Any] = []

    thread = threading.Thread(target=lambda: results.append(signals.install_cancel_signal_handlers(lambda: None)))
    thread.start()
    thread.join()

    assert signal.getsignal(signal.SIGINT) is before
    results[0]()  # the returned restore function is callable and harmless
    assert signal.getsignal(signal.SIGINT) is before
