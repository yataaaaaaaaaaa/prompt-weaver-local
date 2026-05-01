from __future__ import annotations

from devlauncher import LauncherApp, http_ready, open_browser, repo_root, require, service

BACKEND_HEALTH_URL = "http://{host}:{backend_port}/api/health"
FRONTEND_URL = "http://{host}:{frontend_port}"

app = LauncherApp(
    name="prompt-weaver-local",
    root=repo_root(markers=["backend/pyproject.toml", "frontend/package.json"]),
    defaults={
        "host": "127.0.0.1",
        "backend_port": 8000,
        "frontend_port": 5173,
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
            env={"VITE_DEV_SERVER_URL": FRONTEND_URL},
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
