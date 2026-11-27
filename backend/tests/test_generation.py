"""Generation: GenerationService (with a fake GeneratorPort) and POST /api/generate, /api/generate/cancel."""

import json
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.factory import create_app
from app.schemas import GenerateRequest, GenerationTaskEvent, OutputRecord
from app.services.generation import GenerationCancelledError, GenerationFailed, GenerationService
from app.services.outputs import OutputRepository
from app.settings import AppPaths

from support import (
    GENERATE_REQUEST,
    LEGACY_METADATA_KEYS,
    CountingFactory,
    FakeGenerator,
    OutputFactory,
    RecordingTaskHub,
)



@pytest.fixture()
def hub() -> RecordingTaskHub:
    return RecordingTaskHub()


@pytest.fixture()
def service(
    app_paths: AppPaths, hub: RecordingTaskHub, generator_factory: CountingFactory
) -> GenerationService:
    return GenerationService(
        paths=app_paths,
        outputs=OutputRepository(app_paths),
        tasks=hub,
        generator_factory=generator_factory,
    )


def request(**overrides: Any) -> GenerateRequest:
    return GenerateRequest.model_validate({**GENERATE_REQUEST, **overrides})


# ---------------------------------------------------------------------------
# GenerationService
# ---------------------------------------------------------------------------


def test_generate_saves_the_output_with_the_legacy_metadata(
    service: GenerationService, app_paths: AppPaths, fake_generator: FakeGenerator
) -> None:
    record = service.generate(request())

    metadata_path = app_paths.output_dir / "0000000001.json"
    image_path = app_paths.output_dir / "0000000001.png"
    on_disk = json.loads(metadata_path.read_text(encoding="utf-8"))
    assert set(on_disk) == LEGACY_METADATA_KEYS
    assert on_disk["output_id"] == "0000000001"
    assert datetime.fromisoformat(on_disk["generated_at"]).utcoffset().total_seconds() == 0
    # prompt / negative prompt are the ones resolved by the runtime.
    assert on_disk["prompt"] == f"resolved({GENERATE_REQUEST['prompt']})"
    assert on_disk["negative_prompt"] == "resolved(worst quality)"
    assert on_disk["seed"] == on_disk["image_seed"] == 718043937
    assert on_disk["prompt_seed"] == 290912999
    assert (on_disk["width"], on_disk["height"], on_disk["steps"], on_disk["guidance_scale"]) == (128, 192, 12, 3.5)
    assert on_disk["model_id"] == "example-model-safetensors"
    assert on_disk["active_loras"] == [{"id": "kept-lora", "weight": 0.6}, {"id": "other-lora", "weight": 1.0}]
    assert "active_lora_ids" not in on_disk
    assert on_disk["selections"] == [
        {"category_name": "Main", "prompt_text": "masterpiece", "locked": True, "induced_lora_ids": ["kept-lora"]},
        {"category_name": "Subject", "prompt_text": "1girl", "locked": False, "induced_lora_ids": []},
    ]
    assert on_disk["image_path"] == str(image_path)
    assert on_disk["metadata_path"] == str(metadata_path)
    assert record == OutputRecord.model_validate(on_disk)
    with Image.open(image_path) as image:
        assert image.size == (2, 3)


def test_generate_passes_the_request_and_prompt_asset_dirs(
    service: GenerationService, app_paths: AppPaths, fake_generator: FakeGenerator
) -> None:
    service.generate(request())

    (call,) = fake_generator.calls
    assert call.request == request()
    assert [(spec.id, spec.weight) for spec in call.request.loras] == [("kept-lora", 0.6), ("other-lora", 1.0)]
    assert call.prompt_lora_dir == app_paths.prompt_lora_dir
    assert call.prompt_embedding_dir == app_paths.prompt_embedding_dir


def test_random_seed_uses_the_seed_returned_by_the_runtime(service: GenerationService) -> None:
    record = service.generate(request(seed=None, prompt_seed=None))

    assert record.seed == record.image_seed == 4242
    assert record.prompt_seed is None


def test_generate_publishes_the_task_events_in_order(service: GenerationService, hub: RecordingTaskHub) -> None:
    service.generate(request())

    assert hub.published == [
        GenerationTaskEvent(stage="loading_model", message="Loading model and LoRAs for ExampleModel_v50.safetensors"),
        GenerationTaskEvent(stage="sampling", message="Sampling step 1/12", current=1, total=12),
        GenerationTaskEvent(stage="sampling", message="Sampling step 2/12", current=2, total=12),
        GenerationTaskEvent(stage="saving", message="Saving output"),
        GenerationTaskEvent(stage="complete", message="Complete", current=12, total=12),
    ]
    assert hub.snapshot().events == [hub.published[-1]]


def test_generator_is_created_lazily_and_once(
    service: GenerationService, generator_factory: CountingFactory
) -> None:
    service.cancel()
    service.shutdown()
    assert generator_factory.calls == 0

    service.generate(request())
    service.generate(request())

    assert generator_factory.calls == 1


def test_consecutive_generations_get_increasing_ids_and_skip_trashed_ones(
    service: GenerationService, make_output: OutputFactory
) -> None:
    make_output("0000000004", in_trash=True)

    first = service.generate(request())
    second = service.generate(request())

    assert (first.output_id, second.output_id) == ("0000000005", "0000000006")


def test_runtime_failure_publishes_error_and_raises(
    service: GenerationService, hub: RecordingTaskHub, fake_generator: FakeGenerator, app_paths: AppPaths
) -> None:
    fake_generator.error = GenerationFailed("LoRA 'x' could not be loaded")

    with pytest.raises(GenerationFailed):
        service.generate(request())

    assert hub.stages() == ["loading_model", "sampling", "sampling", "error"]
    assert hub.published[-1].message == "LoRA 'x' could not be loaded"
    assert not app_paths.output_dir.exists() or list(app_paths.output_dir.iterdir()) == []


def test_cancellation_publishes_cancelled_and_raises(
    service: GenerationService, hub: RecordingTaskHub, fake_generator: FakeGenerator
) -> None:
    fake_generator.error = GenerationCancelledError("Generation cancelled by user")

    with pytest.raises(GenerationCancelledError):
        service.generate(request())

    assert hub.published[-1] == GenerationTaskEvent(stage="cancelled", message="Generation cancelled by user")


def test_generator_factory_failure_becomes_generation_failed(
    app_paths: AppPaths, hub: RecordingTaskHub
) -> None:
    def broken_factory() -> FakeGenerator:
        raise RuntimeError("CUDA is not available")

    service = GenerationService(
        paths=app_paths, outputs=OutputRepository(app_paths), tasks=hub, generator_factory=broken_factory
    )

    with pytest.raises(GenerationFailed, match="CUDA is not available"):
        service.generate(request())
    assert hub.stages() == ["loading_model", "error"]


def test_unexpected_errors_still_end_the_task(
    service: GenerationService, hub: RecordingTaskHub, fake_generator: FakeGenerator
) -> None:
    fake_generator.error = TypeError("boom")

    with pytest.raises(TypeError):
        service.generate(request())

    assert hub.published[-1].stage == "error"
    assert "boom" in hub.published[-1].message


def test_saving_failure_becomes_generation_failed(
    service: GenerationService, hub: RecordingTaskHub, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing_save(*_args: object, **_kwargs: object) -> OutputRecord:
        raise OSError("disk full")

    monkeypatch.setattr(OutputRepository, "save", failing_save)

    with pytest.raises(GenerationFailed, match="disk full"):
        service.generate(request())
    assert hub.stages()[-2:] == ["saving", "error"]


def test_cancel_cancels_the_generator_and_publishes(
    service: GenerationService, hub: RecordingTaskHub, fake_generator: FakeGenerator
) -> None:
    service.generate(request())
    hub.published.clear()

    service.cancel()

    assert fake_generator.cancel_calls == 1
    assert hub.published == [GenerationTaskEvent(stage="cancelled", message="Cancelling current generation")]


def test_shutdown_cancels_and_unloads(
    service: GenerationService, hub: RecordingTaskHub, fake_generator: FakeGenerator
) -> None:
    service.generate(request())
    hub.published.clear()

    service.shutdown()

    assert (fake_generator.cancel_calls, fake_generator.unload_calls) == (1, 1)
    assert hub.published == []


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def test_generate_endpoint_returns_the_saved_record(client: TestClient, app_paths: AppPaths) -> None:
    response = client.post("/api/generate", json=GENERATE_REQUEST)

    assert response.status_code == 200
    body = response.json()
    # The API answers every OutputRecord field: `character` and `story` are null without an active character or a
    # story scene (the metadata file on disk keeps the legacy keys, LEGACY_METADATA_KEYS).
    assert set(body) == LEGACY_METADATA_KEYS | {"character", "story"}
    assert (body["character"], body["story"]) == (None, None)
    assert body["output_id"] == "0000000001"
    assert client.get("/api/outputs").json() == {"ids": ["0000000001"]}
    assert client.get("/api/outputs/0000000001").json() == body
    assert client.get("/api/outputs/0000000001/image").headers["content-type"] == "image/png"


def test_generate_endpoint_task_events(client: TestClient) -> None:
    assert client.get("/api/tasks").json() == {
        "events": [
            {"type": "generation", "task_id": "generation", "stage": "idle", "message": "Idle", "current": 0, "total": 0}
        ]
    }
    with client.websocket_connect("/ws/tasks") as websocket:
        assert websocket.receive_json()["stage"] == "idle"

        client.post("/api/generate", json=GENERATE_REQUEST).raise_for_status()

        stages = [websocket.receive_json()["stage"] for _ in range(5)]
    assert stages == ["loading_model", "sampling", "sampling", "saving", "complete"]
    assert client.get("/api/tasks").json()["events"] == [
        {"type": "generation", "task_id": "generation", "stage": "complete", "message": "Complete", "current": 12, "total": 12}
    ]


@pytest.mark.parametrize(
    ("error", "stage"),
    [
        (GenerationFailed("Model file not found"), "error"),
        (GenerationCancelledError("Generation cancelled"), "cancelled"),
    ],
)
def test_generate_endpoint_failures_are_409(
    client: TestClient, fake_generator: FakeGenerator, error: Exception, stage: str
) -> None:
    fake_generator.error = error

    response = client.post("/api/generate", json=GENERATE_REQUEST)

    assert response.status_code == 409
    assert response.json() == {"detail": str(error)}
    (event,) = client.get("/api/tasks").json()["events"]
    assert (event["stage"], event["message"]) == (stage, str(error))
    assert client.get("/api/outputs").json() == {"ids": []}


def test_generate_endpoint_validates_the_request(client: TestClient, generator_factory: CountingFactory) -> None:
    assert client.post("/api/generate", json={"model": GENERATE_REQUEST["model"]}).status_code == 422
    assert generator_factory.calls == 0


def test_unexpected_generation_error_is_500(
    app_paths: AppPaths, generator_factory: CountingFactory, fake_generator: FakeGenerator
) -> None:
    fake_generator.error = TypeError("boom")
    app = create_app(paths=app_paths, generator_factory=generator_factory, install_signal_handlers=False)

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.post("/api/generate", json=GENERATE_REQUEST).status_code == 500
        assert client.get("/api/tasks").json()["events"][0]["stage"] == "error"


def test_cancel_endpoint(
    client: TestClient, generator_factory: CountingFactory, fake_generator: FakeGenerator
) -> None:
    # Nothing to cancel before the first generation: the runtime is not even created.
    assert client.post("/api/generate/cancel").json() == {"ok": True}
    assert generator_factory.calls == 0
    assert client.get("/api/tasks").json()["events"][0]["stage"] == "idle"

    client.post("/api/generate", json=GENERATE_REQUEST).raise_for_status()
    assert client.post("/api/generate/cancel").json() == {"ok": True}

    assert fake_generator.cancel_calls == 1
    (event,) = client.get("/api/tasks").json()["events"]
    assert (event["stage"], event["message"]) == ("cancelled", "Cancelling current generation")
