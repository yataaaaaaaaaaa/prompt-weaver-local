"""Per-LoRA weights end to end on the backend: GenerateRequest.loras weights (default, range), the weights handed
to the generator (runtime_adapter passes spec.weight to the runtime LoRASpec; tests never import it: it loads torch),
the output metadata `active_loras`, and the migration of legacy `active_lora_ids` output files."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.schemas import LORA_WEIGHT_DEFAULTS, GenerateRequest, LoraWeight, OutputRecord
from app.settings import AppPaths

from support import CountingFactory, FakeGenerator, load_fixture, write_json_file

MODEL: dict[str, Any] = {
    "id": "example-model-safetensors",
    "name": "ExampleModel_v50.safetensors",
    "path": "C:/models/checkpoints/ExampleModel_v50.safetensors",
    "default_width": 1024,
    "default_height": 1024,
    "torch_dtype": "float16",
}


def lora(lora_id: str, **extra: Any) -> dict[str, Any]:
    return {"id": lora_id, "name": f"{lora_id}.safetensors", "path": f"C:/models/loras/{lora_id}.safetensors", **extra}


def generate_payload(*loras: dict[str, Any]) -> dict[str, Any]:
    return {"model": MODEL, "loras": list(loras), "prompt": "1girl", "width": 64, "height": 64, "steps": 2, "seed": 7}


def write_output(app_paths: AppPaths, output_id: str, payload: dict[str, Any]) -> None:
    """<output_id>.png + .json in the output dir, the metadata being `payload` as is."""
    app_paths.output_dir.mkdir(parents=True, exist_ok=True)
    (app_paths.output_dir / f"{output_id}.png").write_bytes(b"png")
    write_json_file(app_paths.output_dir / f"{output_id}.json", {**payload, "output_id": output_id})


# ---------------------------------------------------------------------------
# Request weights
# ---------------------------------------------------------------------------


def test_the_default_weight_is_one() -> None:
    assert LORA_WEIGHT_DEFAULTS.weight == 1.0
    assert (LORA_WEIGHT_DEFAULTS.min, LORA_WEIGHT_DEFAULTS.max) == (-10.0, 10.0)


def test_a_lora_without_weight_gets_the_default_weight() -> None:
    request = GenerateRequest.model_validate(generate_payload(lora("plain"), lora("weighted", weight=0.6)))

    assert [(spec.id, spec.weight) for spec in request.loras] == [("plain", 1.0), ("weighted", 0.6)]


def test_the_weights_reach_the_generator(client: TestClient, fake_generator: FakeGenerator) -> None:
    payload = generate_payload(lora("detail", weight=0.6), lora("grain", weight=-1.25), lora("plain"))

    client.post("/api/generate", json=payload).raise_for_status()

    (call,) = fake_generator.calls
    assert [(spec.id, spec.path, spec.weight) for spec in call.request.loras] == [
        ("detail", "C:/models/loras/detail.safetensors", 0.6),
        ("grain", "C:/models/loras/grain.safetensors", -1.25),
        ("plain", "C:/models/loras/plain.safetensors", 1.0),
    ]


@pytest.mark.parametrize("weight", [LORA_WEIGHT_DEFAULTS.min, 0.0, LORA_WEIGHT_DEFAULTS.max])
def test_weights_at_the_bounds_are_accepted(client: TestClient, fake_generator: FakeGenerator, weight: float) -> None:
    assert client.post("/api/generate", json=generate_payload(lora("edge", weight=weight))).status_code == 200
    assert fake_generator.calls[0].request.loras[0].weight == weight


@pytest.mark.parametrize("weight", [LORA_WEIGHT_DEFAULTS.max + 0.01, LORA_WEIGHT_DEFAULTS.min - 0.01, 1e9, "heavy", None])
def test_out_of_range_or_invalid_weights_are_422(
    client: TestClient, generator_factory: CountingFactory, weight: Any
) -> None:
    response = client.post("/api/generate", json=generate_payload(lora("ok", weight=0.5), lora("bad", weight=weight)))

    assert response.status_code == 422
    (error,) = response.json()["detail"]
    assert error["loc"] == ["body", "loras", 1, "weight"]
    assert generator_factory.calls == 0
    assert client.get("/api/outputs").json() == {"ids": []}


def test_the_preflight_log_lists_the_loras_with_their_weights(
    client: TestClient, capsys: pytest.CaptureFixture[str]
) -> None:
    client.post("/api/generate", json=generate_payload(lora("detail", weight=0.6), lora("plain"))).raise_for_status()

    assert "selected_loras=[('detail', 0.6), ('plain', 1.0)]" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Output metadata
# ---------------------------------------------------------------------------


def test_the_metadata_file_and_the_response_hold_active_loras_with_weights(
    client: TestClient, app_paths: AppPaths
) -> None:
    response = client.post("/api/generate", json=generate_payload(lora("detail", weight=0.6), lora("plain")))

    expected = [{"id": "detail", "weight": 0.6}, {"id": "plain", "weight": 1.0}]
    body = response.json()
    assert body["active_loras"] == expected
    assert "active_lora_ids" not in body
    on_disk = json.loads((app_paths.output_dir / f"{body['output_id']}.json").read_text(encoding="utf-8"))
    assert on_disk["active_loras"] == expected
    assert "active_lora_ids" not in on_disk
    assert client.get(f"/api/outputs/{body['output_id']}").json()["active_loras"] == expected


def test_an_output_with_weights_loads_as_written(client: TestClient, app_paths: AppPaths) -> None:
    write_output(app_paths, "0000000002", load_fixture("outputs/metadata_lora_weights.json"))

    body = client.get("/api/outputs/0000000002").json()

    assert body["active_loras"] == [{"id": "add-detail", "weight": 0.6}, {"id": "film-grain", "weight": -1.25}]


def test_a_legacy_output_with_active_lora_ids_loads_with_the_default_weight(
    client: TestClient, app_paths: AppPaths
) -> None:
    legacy = load_fixture("outputs/metadata_legacy_lora_ids.json")
    assert legacy["active_lora_ids"] == ["a", "b"] and "active_loras" not in legacy
    write_output(app_paths, "0000000003", legacy)

    response = client.get("/api/outputs/0000000003")

    assert response.status_code == 200
    body = response.json()
    assert body["active_loras"] == [{"id": "a", "weight": 1.0}, {"id": "b", "weight": 1.0}]
    assert "active_lora_ids" not in body
    # The legacy file itself is never rewritten.
    on_disk = json.loads((app_paths.output_dir / "0000000003.json").read_text(encoding="utf-8"))
    assert on_disk["active_lora_ids"] == ["a", "b"]


def test_active_loras_wins_when_both_keys_exist(client: TestClient, app_paths: AppPaths) -> None:
    payload = {**load_fixture("outputs/metadata_lora_weights.json"), "active_lora_ids": ["legacy-only"]}
    write_output(app_paths, "0000000004", payload)

    body = client.get("/api/outputs/0000000004").json()

    assert body["active_loras"] == [{"id": "add-detail", "weight": 0.6}, {"id": "film-grain", "weight": -1.25}]


@pytest.mark.parametrize(
    ("legacy_ids", "expected_ids"),
    [
        (["a", 3, None, {"id": "x"}, ["y"], "b"], ["a", "b"]),
        ([], []),
        (None, []),
        ("a", []),
    ],
)
def test_legacy_ids_that_are_not_strings_are_dropped(legacy_ids: Any, expected_ids: list[str]) -> None:
    payload = {**load_fixture("outputs/metadata_legacy_lora_ids.json"), "active_lora_ids": legacy_ids}

    record = OutputRecord.model_validate(payload)

    assert record.active_loras == [LoraWeight(id=lora_id, weight=LORA_WEIGHT_DEFAULTS.weight) for lora_id in expected_ids]


def test_a_record_without_any_lora_key_has_no_active_loras() -> None:
    payload = load_fixture("outputs/metadata_legacy_lora_ids.json")
    del payload["active_lora_ids"]

    assert OutputRecord.model_validate(payload).active_loras == []
