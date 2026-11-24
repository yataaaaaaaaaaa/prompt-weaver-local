from __future__ import annotations

import json
from pathlib import Path

from devlauncher import LauncherApp, http_ready, open_browser, repo_root, require, service

REPO_ROOT = Path(__file__).resolve().parents[3]
# Single source of the dev host/ports (also read by backend/run_backend.py and config/appConfig.cjs).
SHARED_CONFIG = json.loads((REPO_ROOT / "config" / "defaults.json").read_text(encoding="utf-8"))

BACKEND_URL = "http://{host}:{backend_port}"
BACKEND_HEALTH_URL = BACKEND_URL + "/api/health"
FRONTEND_URL = "http://{host}:{frontend_port}"
# Read by config/appConfig.cjs (Vite define + Electron) so --host/--backend-port reach the UI.
BACKEND_URL_ENV = {"PROMPT_WEAVER_BACKEND_URL": BACKEND_URL}

app = LauncherApp(
    name="prompt-weaver-local",
    root=repo_root(markers=["backend/pyproject.toml", "frontend/package.json"], start=REPO_ROOT),
    defaults={
        "host": SHARED_CONFIG["host"],
        "backend_port": SHARED_CONFIG["backendPort"],
        "frontend_port": SHARED_CONFIG["frontendPort"],
    },
    services=(
        service(
            "backend",
            cmd=["uv", "run", "python", "run_backend.py", "--host", "{host}", "--port", "{backend_port}"],
            cwd="backend",
            requires=(
                require.tool("uv"),
                require.file("backend/pyproject.toml"),
                require.port_free("{host}", "{backend_port}"),
            ),
            ready=http_ready(BACKEND_HEALTH_URL),
        ),
        service(
            "frontend",
            cmd=[
                "npm",
                "run",
                "dev",
                "--",
                "--host",
                "{host}",
                "--port",
                "{frontend_port}",
            ],
            cwd="frontend",
            env=BACKEND_URL_ENV,
            requires=(
                require.tool("npm"),
                require.file("frontend/package.json"),
                require.dir("frontend/node_modules", hint="Run: cd frontend && npm install"),
                require.port_free("{host}", "{frontend_port}"),
            ),
            ready=http_ready(FRONTEND_URL),
            depends_on=("backend",),
        ),
        service(
            "electron",
            cmd=["npm", "run", "electron:start"],
            cwd="frontend",
            env={"VITE_DEV_SERVER_URL": FRONTEND_URL, **BACKEND_URL_ENV},
            requires=(
                require.tool("npm"),
                require.file("frontend/package.json"),
                require.dir("frontend/node_modules", hint="Run: cd frontend && npm install"),
            ),
            depends_on=("frontend",),
            optional=True,
            enabled_by_default=True,
        ),
    ),
    actions=(
        open_browser(FRONTEND_URL, flag="--web"),
    ),
)


def main() -> int:
    return app.run()


if __name__ == "__main__":
    raise SystemExit(main())
