"""Finding the user's installed Codex CLI (the co-writer runs its `app-server`). THE discovery rule, in this order:

1. the path the user set (backend settings, Co-writer panel): a codex executable, or a folder holding one; when it no
   longer exists (a Microsoft Store update changes the versioned folder) the search goes on and says so;
2. `codex` on PATH (an npm shim `codex.cmd` resolves to the native executable of its package, or to its bin script
   run with node);
3. the "OpenAI Codex" desktop app (Microsoft Store package OpenAI.Codex_<version>_x64_...): the newest installed
   version's app/resources/codex.exe. The WindowsApps folder cannot be listed by a normal user, so the packages come
   from PowerShell's Get-AppxPackage (their InstallLocation), with a listing of the folder as a fallback;
4. the npm global install (%APPDATA%/npm/node_modules/@openai/codex...).

Sources are injectable (tests and the e2e backend never find the user's real Codex). Never reads Codex's own files
(its config or credentials): it only looks for the executable.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

from ...schemas import CodexSource

logger = logging.getLogger(__name__)

WINDOWS_APP_PACKAGE = "OpenAI.Codex"
WINDOWS_APP_EXECUTABLE = Path("app") / "resources" / "codex.exe"
EXECUTABLE_NAMES = ("codex.exe", "codex") if os.name == "nt" else ("codex",)
_POWERSHELL_TIMEOUT_S = 15
# CREATE_NO_WINDOW: helper processes never flash a console window from the desktop app.
NO_WINDOW_FLAGS = 0x08000000 if os.name == "nt" else 0


@dataclass(frozen=True)
class CodexInstall:
    """A codex CLI that can be started: `argv` runs it (the executable, or node + its bin script)."""

    argv: tuple[str, ...]
    path: str
    source: CodexSource


@dataclass(frozen=True)
class DiscoveryResult:
    install: CodexInstall | None
    searched: list[str] = field(default_factory=list)
    configured_missing: bool = False


# A source yields candidate installs (best first) and adds what it looked at to `searched`.
CodexSourceFinder = Callable[[list[str]], Iterable[CodexInstall]]


def _executable_in(folder: Path) -> Path | None:
    for name in EXECUTABLE_NAMES:
        candidate = folder / name
        if candidate.is_file():
            return candidate
    nested = folder / WINDOWS_APP_EXECUTABLE
    return nested if nested.is_file() else None


def install_at(path: Path, source: CodexSource) -> CodexInstall | None:
    """The install at a user-given path: an executable file, or a folder holding codex(.exe) (or the desktop app's
    app/resources/codex.exe); an npm shim resolves to its package."""
    if path.is_dir():
        found = _executable_in(path)
        return CodexInstall(argv=(str(found),), path=str(found), source=source) if found else None
    if not path.is_file():
        return None
    if path.suffix.lower() in {".cmd", ".bat", ".ps1"} or (os.name == "nt" and path.suffix == ""):
        return _npm_shim_install(path, source)
    return CodexInstall(argv=(str(path),), path=str(path), source=source)


def _npm_package_dirs(node_modules: Path) -> list[Path]:
    base = node_modules / "@openai"
    if not base.is_dir():
        return []
    # @openai/codex holds the bin script; the native executable is in it or in a platform package
    # (@openai/codex-win32-x64, nested or hoisted).
    return [base / "codex", *sorted(base.glob("codex-*")), *sorted((base / "codex" / "node_modules" / "@openai").glob("codex-*"))]


def _npm_install(node_modules: Path, source: CodexSource) -> CodexInstall | None:
    for package in _npm_package_dirs(node_modules):
        for executable in sorted(package.glob("vendor/*/codex/codex.exe" if os.name == "nt" else "vendor/*/codex/codex")):
            if executable.is_file():
                return CodexInstall(argv=(str(executable),), path=str(executable), source=source)
    script = node_modules / "@openai" / "codex" / "bin" / "codex.js"
    node = shutil.which("node")
    if script.is_file() and node:
        return CodexInstall(argv=(node, str(script)), path=str(script), source=source)
    return None


def _npm_shim_install(shim: Path, source: CodexSource) -> CodexInstall | None:
    """An npm shim (codex.cmd next to node_modules): the package's native executable, or its bin script with node."""
    return _npm_install(shim.parent / "node_modules", source)


def find_on_path(searched: list[str]) -> Iterable[CodexInstall]:
    found = shutil.which("codex")
    searched.append("codex on PATH")
    if found:
        install = install_at(Path(found), "path")
        if install:
            yield install


def _version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", version))


def windows_app_packages() -> list[tuple[str, Path]]:
    """(version, install folder) of the installed OpenAI.Codex packages, from Get-AppxPackage."""
    if os.name != "nt":
        return []
    command = (
        f"Get-AppxPackage -Name '{WINDOWS_APP_PACKAGE}' | Select-Object Version,InstallLocation | ConvertTo-Json -Compress"
    )
    try:
        completed = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True,
            timeout=_POWERSHELL_TIMEOUT_S,
            creationflags=NO_WINDOW_FLAGS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        logger.debug("Get-AppxPackage failed", exc_info=True)
        return []
    try:
        payload = json.loads(completed.stdout.decode("utf-8", errors="replace") or "null")
    except ValueError:
        return []
    items = payload if isinstance(payload, list) else [payload] if isinstance(payload, dict) else []
    return [
        (str(item.get("Version") or ""), Path(item["InstallLocation"]))
        for item in items
        if isinstance(item, dict) and isinstance(item.get("InstallLocation"), str)
    ]


def _windows_apps_folder_packages() -> list[tuple[str, Path]]:
    """Fallback: the OpenAI.Codex_<version>_* folders of WindowsApps (usually not listable)."""
    root = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "WindowsApps"
    try:
        folders = [entry for entry in root.glob(f"{WINDOWS_APP_PACKAGE}_*") if entry.is_dir()]
    except OSError:
        return []
    return [(entry.name.split("_")[1] if entry.name.count("_") >= 1 else "", entry) for entry in folders]


def find_windows_app(searched: list[str]) -> Iterable[CodexInstall]:
    if os.name != "nt":
        return
    searched.append(f"the OpenAI Codex app ({WINDOWS_APP_PACKAGE})")
    packages = windows_app_packages() or _windows_apps_folder_packages()
    for _version, folder in sorted(packages, key=lambda item: _version_key(item[0]), reverse=True):
        executable = folder / WINDOWS_APP_EXECUTABLE
        if executable.is_file():
            yield CodexInstall(argv=(str(executable),), path=str(executable), source="windows_app")


def _npm_global_roots() -> list[Path]:
    roots: list[Path] = []
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            roots.append(Path(appdata) / "npm" / "node_modules")
    else:
        roots += [Path("/usr/local/lib/node_modules"), Path("/usr/lib/node_modules"), Path.home() / ".npm-global" / "lib" / "node_modules"]
    prefix = os.environ.get("npm_config_prefix")
    if prefix:
        roots.append(Path(prefix) / ("node_modules" if os.name == "nt" else "lib/node_modules"))
    return roots


def find_npm_global(searched: list[str]) -> Iterable[CodexInstall]:
    for root in _npm_global_roots():
        searched.append(str(root / "@openai" / "codex"))
        install = _npm_install(root, "npm")
        if install:
            yield install


DEFAULT_SOURCES: tuple[CodexSourceFinder, ...] = (find_on_path, find_windows_app, find_npm_global)


PathResolver = Callable[[Path, CodexSource], "CodexInstall | None"]


class CodexDiscovery:
    """locate(configured_path): the Codex to start, by the precedence above. `resolve_path` turns the user's path into
    an install (install_at; the e2e backend also accepts its Python fake there)."""

    def __init__(self, sources: Sequence[CodexSourceFinder] = DEFAULT_SOURCES, resolve_path: PathResolver = install_at) -> None:
        self._sources = tuple(sources)
        self._resolve_path = resolve_path

    def locate(self, configured_path: str | None) -> DiscoveryResult:
        searched: list[str] = []
        configured_missing = False
        if configured_path:
            path = Path(os.path.expandvars(configured_path)).expanduser()
            searched.append(str(path))
            install = self._resolve_path(path, "configured")
            if install:
                return DiscoveryResult(install=install, searched=searched)
            configured_missing = True
        for source in self._sources:
            try:
                for install in source(searched):
                    return DiscoveryResult(install=install, searched=searched, configured_missing=configured_missing)
            except Exception:
                logger.debug("A Codex discovery source failed", exc_info=True)
        return DiscoveryResult(install=None, searched=searched, configured_missing=configured_missing)
