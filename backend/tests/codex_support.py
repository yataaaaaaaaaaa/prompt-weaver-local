"""The co-writer's test doubles: the fake Codex app-server (tests/fake_codex.py) as an install the app finds, its
scenario and home folder, and the records it writes. Used by the codex tests and the e2e backend (tests/e2e/server.py),
which must never find the user's real Codex: their discovery only knows the fake."""

from __future__ import annotations

import json
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from app.schemas import CodexSource
from app.services.codex.discovery import CodexDiscovery, CodexInstall, install_at
from app.services.codex.service import CodexRuntime

FAKE_CODEX_SCRIPT = Path(__file__).resolve().parent / "fake_codex.py"


def fake_install(source: CodexSource = "path") -> CodexInstall:
    """The fake app-server, run with this interpreter."""
    return CodexInstall(argv=(sys.executable, str(FAKE_CODEX_SCRIPT)), path=str(FAKE_CODEX_SCRIPT), source=source)


def resolve_path_with_fake(path: Path, source: CodexSource) -> CodexInstall | None:
    """A user-given path: the fake when it names a .py file (the fake), else the app's own rule."""
    if path.suffix == ".py" and path.is_file():
        return CodexInstall(argv=(sys.executable, str(path)), path=str(path), source=source)
    return install_at(path, source)


def fake_discovery(*, installed: bool = True) -> CodexDiscovery:
    """Finds the fake 'on PATH' (installed) or nothing; a configured path may name the fake."""

    def on_path(searched: list[str]) -> Iterable[CodexInstall]:
        searched.append("codex on PATH")
        if installed:
            yield fake_install()

    return CodexDiscovery(sources=(on_path,), resolve_path=resolve_path_with_fake)


def no_codex_runtime() -> CodexRuntime:
    """A runtime that never finds any Codex (the default of the test app)."""
    return CodexRuntime(discovery=CodexDiscovery(sources=(), resolve_path=lambda _path, _source: None))


class FakeCodex:
    """The fake's scenario and home folder (threads, call records) for one app."""

    def __init__(self, home: Path, scenario: dict[str, Any] | None = None, *, installed: bool = True) -> None:
        self.home = home
        self.home.mkdir(parents=True, exist_ok=True)
        self.scenario_file = home / "scenario.json"
        self.installed = installed
        self.set_scenario(scenario or {})

    def set_scenario(self, scenario: dict[str, Any]) -> None:
        self.scenario_file.write_text(json.dumps(scenario), encoding="utf-8")

    def update_scenario(self, **changes: Any) -> None:
        self.set_scenario({**json.loads(self.scenario_file.read_text(encoding="utf-8")), **changes})

    def runtime(self, **options: Any) -> CodexRuntime:
        return CodexRuntime(
            discovery=fake_discovery(installed=self.installed),
            environment={"FAKE_CODEX_SCENARIO": str(self.scenario_file), "FAKE_CODEX_HOME": str(self.home)},
            **{"probe_timeout_s": 20.0, "request_timeout_s": 20.0, **options},
        )

    def records(self) -> list[dict[str, Any]]:
        path = self.home / "calls.jsonl"
        if not path.is_file():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]

    def requests(self, method: str) -> list[dict[str, Any]]:
        return [record["params"] for record in self.records() if record.get("method") == method]

    def starts(self) -> list[list[str]]:
        return [record["start"] for record in self.records() if "start" in record]

    def threads(self) -> dict[str, Any]:
        path = self.home / "threads.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
