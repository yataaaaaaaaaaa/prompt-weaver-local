"""Finding the user's Codex (services/codex/discovery.py): the configured path (a file, a folder, gone), PATH (an npm
shim resolves to its package's native executable or its bin script), the OpenAI Codex desktop app (newest package),
the npm global install; and the order between them. No real Codex is ever looked for."""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

import pytest

from app.services.codex import discovery
from app.services.codex.discovery import CodexDiscovery, CodexInstall, install_at


def touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"MZ")
    return path


def source(*installs: CodexInstall, label: str = "fake source"):  # type: ignore[no-untyped-def]
    def find(searched: list[str]) -> Iterable[CodexInstall]:
        searched.append(label)
        yield from installs

    return find


def test_a_configured_executable_wins(tmp_path: Path) -> None:
    executable = touch(tmp_path / "codex.exe")
    other = CodexInstall(argv=("other",), path="other", source="path")

    found = CodexDiscovery(sources=(source(other),)).locate(str(executable))

    assert found.install == CodexInstall(argv=(str(executable),), path=str(executable), source="configured")
    assert (found.searched, found.configured_missing) == ([str(executable)], False)


def test_a_configured_folder_holds_codex_or_the_desktop_apps_resources(tmp_path: Path) -> None:
    executable = touch(tmp_path / "package" / "app" / "resources" / "codex.exe")

    assert install_at(tmp_path / "package", "configured") == CodexInstall(argv=(str(executable),), path=str(executable), source="configured")
    assert install_at(tmp_path / "package" / "app" / "resources", "configured").path == str(executable)  # type: ignore[union-attr]
    assert install_at(tmp_path / "empty-folder-that-is-missing", "configured") is None


def test_a_configured_path_that_is_gone_falls_back_and_says_so(tmp_path: Path) -> None:
    fallback = CodexInstall(argv=("codex",), path="codex", source="windows_app")

    found = CodexDiscovery(sources=(source(label="nothing"), source(fallback, label="app"))).locate(str(tmp_path / "old" / "codex.exe"))

    assert found.install == fallback
    assert found.configured_missing is True
    assert found.searched == [str(tmp_path / "old" / "codex.exe"), "nothing", "app"]


def test_nothing_found(tmp_path: Path) -> None:
    found = CodexDiscovery(sources=(source(label="a"), source(label="b"))).locate(None)

    assert (found.install, found.searched, found.configured_missing) == (None, ["a", "b"], False)


def test_a_failing_source_is_skipped() -> None:
    def broken(_searched: list[str]) -> Iterable[CodexInstall]:
        raise OSError("boom")

    fallback = CodexInstall(argv=("x",), path="x", source="npm")

    assert CodexDiscovery(sources=(broken, source(fallback))).locate(None).install == fallback


@pytest.mark.skipif(discovery.os.name != "nt", reason="npm shims are .cmd files on Windows")
def test_an_npm_shim_on_path_resolves_to_the_native_executable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    shim = touch(tmp_path / "npm" / "codex.cmd")
    native = touch(tmp_path / "npm" / "node_modules" / "@openai" / "codex" / "vendor" / "x86_64-pc-windows-msvc" / "codex" / "codex.exe")
    monkeypatch.setattr(discovery.shutil, "which", lambda name: str(shim) if name == "codex" else None)

    searched: list[str] = []
    (found,) = list(discovery.find_on_path(searched))

    assert found == CodexInstall(argv=(str(native),), path=str(native), source="path")
    assert searched == ["codex on PATH"]


@pytest.mark.skipif(discovery.os.name != "nt", reason="npm shims are .cmd files on Windows")
def test_an_npm_shim_without_native_executable_runs_its_script_with_node(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    shim = touch(tmp_path / "npm" / "codex.cmd")
    script = touch(tmp_path / "npm" / "node_modules" / "@openai" / "codex" / "bin" / "codex.js")
    node = str(tmp_path / "node.exe")
    monkeypatch.setattr(discovery.shutil, "which", lambda name: {"codex": str(shim), "node": node}.get(name))

    assert install_at(shim, "path") == CodexInstall(argv=(node, str(script)), path=str(script), source="path")


def test_a_platform_package_holds_the_native_executable(tmp_path: Path) -> None:
    name = "codex.exe" if discovery.os.name == "nt" else "codex"
    native = touch(tmp_path / "node_modules" / "@openai" / "codex-win32-x64" / "vendor" / "x86_64-pc-windows-msvc" / "codex" / name)

    assert discovery._npm_install(tmp_path / "node_modules", "npm") == CodexInstall(argv=(str(native),), path=str(native), source="npm")


@pytest.mark.skipif(discovery.os.name != "nt", reason="the desktop app is a Windows package")
def test_the_newest_desktop_app_package_is_used(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    old = touch(tmp_path / "OpenAI.Codex_26.900.1.0_x64" / "app" / "resources" / "codex.exe")
    new = touch(tmp_path / "OpenAI.Codex_26.1111.2228.0_x64" / "app" / "resources" / "codex.exe")
    touch(tmp_path / "broken" / "nothing.txt")
    packages = [("26.900.1.0", old.parents[2]), ("26.1111.2228.0", new.parents[2]), ("27.0.0.0", tmp_path / "broken")]
    monkeypatch.setattr(discovery, "windows_app_packages", lambda: packages)

    searched: list[str] = []
    found = list(discovery.find_windows_app(searched))

    assert [install.path for install in found] == [str(new), str(old)]
    assert {install.source for install in found} == {"windows_app"}
    assert searched == ["the OpenAI Codex app (OpenAI.Codex)"]


@pytest.mark.skipif(discovery.os.name != "nt", reason="Get-AppxPackage is Windows only")
def test_appx_packages_are_read_from_powershell(monkeypatch: pytest.MonkeyPatch) -> None:
    class Completed:
        stdout = b'[{"Version":"26.1111.2228.0","InstallLocation":"C:\\\\Program Files\\\\WindowsApps\\\\OpenAI.Codex_26"}]'

    calls: list[list[str]] = []

    def run(command: list[str], **_kwargs: object) -> Completed:
        calls.append(command)
        return Completed()

    monkeypatch.setattr(discovery.subprocess, "run", run)

    assert discovery.windows_app_packages() == [("26.1111.2228.0", Path(r"C:\Program Files\WindowsApps\OpenAI.Codex_26"))]
    assert calls[0][0] == "powershell.exe" and "Get-AppxPackage -Name 'OpenAI.Codex'" in calls[0][-1]


def test_the_default_order() -> None:
    assert discovery.DEFAULT_SOURCES == (discovery.find_on_path, discovery.find_windows_app, discovery.find_npm_global)
