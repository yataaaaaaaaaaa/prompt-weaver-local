"""Health endpoint and application lifecycle (factory + lifespan)."""

import signal

from fastapi.testclient import TestClient

from app.factory import create_app
from app.routers import ROUTERS
from app.settings import AppPaths

from support import CountingFactory, FakeGenerator


def test_health(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_cors_allows_the_dev_frontend(client: TestClient) -> None:
    response = client.get("/api/health", headers={"Origin": "http://127.0.0.1:5173"})

    assert response.headers["access-control-allow-origin"] in ("*", "http://127.0.0.1:5173")


def test_create_app_does_no_io_and_the_lifespan_creates_the_data_dirs(app_paths: AppPaths) -> None:
    app = create_app(paths=app_paths, generator_factory=CountingFactory(FakeGenerator()), install_signal_handlers=False)
    assert not app_paths.root.exists()

    with TestClient(app):
        for directory in (app_paths.output_dir, app_paths.trash_dir, app_paths.stores_dir):
            assert directory.is_dir()


def test_every_registered_router_is_mounted(client: TestClient) -> None:
    mounted = {getattr(route, "path", None) for route in client.app.routes}

    for router in ROUTERS:
        for route in router.routes:
            assert route.path in mounted


def test_shutdown_does_not_create_the_generator(
    app_paths: AppPaths, generator_factory: CountingFactory, fake_generator: FakeGenerator
) -> None:
    app = create_app(paths=app_paths, generator_factory=generator_factory, install_signal_handlers=False)

    with TestClient(app) as client:
        client.get("/api/health")

    assert generator_factory.calls == 0
    assert fake_generator.unload_calls == 0


def test_shutdown_cancels_and_unloads_a_created_generator(
    app_paths: AppPaths, generator_factory: CountingFactory, fake_generator: FakeGenerator
) -> None:
    app = create_app(paths=app_paths, generator_factory=generator_factory, install_signal_handlers=False)

    with TestClient(app) as client:
        client.post(
            "/api/generate",
            json={"model": {"id": "m", "name": "M", "path": "m.safetensors"}, "width": 64, "height": 64},
        ).raise_for_status()

    assert fake_generator.cancel_calls == 1
    assert fake_generator.unload_calls == 1


def test_lifespan_with_signal_handlers_outside_the_main_thread_is_harmless(app_paths: AppPaths) -> None:
    before = signal.getsignal(signal.SIGINT)
    app = create_app(paths=app_paths, generator_factory=CountingFactory(FakeGenerator()), install_signal_handlers=True)

    with TestClient(app) as client:  # TestClient runs the lifespan in a worker thread
        assert client.get("/api/health").status_code == 200

    assert signal.getsignal(signal.SIGINT) is before
