"""Test doubles and helpers shared by the backend tests (fixtures live in conftest.py)."""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

from app.schemas import GenerateRequest
from app.services.generation import GeneratedImage, StepCallback
from app.services.task_hub import TaskEventModel, TaskHub

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

# make_output fixture: (output_id, *, in_trash=False, png=True, metadata=True) -> metadata dict
OutputFactory = Callable[..., dict[str, Any]]


@dataclass
class GenerateCall:
    request: GenerateRequest
    prompt_lora_dir: Path
    prompt_embedding_dir: Path


@dataclass
class FakeGenerator:
    """GeneratorPort test double: records calls, reports `reported_steps` sampling steps, returns a small image.

    Set `error` to raise it (after the reported steps) instead of returning an image, or `on_generate` to run
    code in the middle of a generation (e.g. publish from the worker thread or block until released)."""

    reported_steps: int = 2
    seed: int = 4242
    error: Exception | None = None
    on_generate: Callable[[], None] | None = None
    calls: list[GenerateCall] = field(default_factory=list)
    cancel_calls: int = 0
    unload_calls: int = 0

    def generate(
        self,
        request: GenerateRequest,
        *,
        prompt_lora_dir: Path,
        prompt_embedding_dir: Path,
        on_step: StepCallback,
    ) -> GeneratedImage:
        self.calls.append(GenerateCall(request, prompt_lora_dir, prompt_embedding_dir))
        for step in range(1, self.reported_steps + 1):
            on_step(step, request.steps)
        if self.on_generate is not None:
            self.on_generate()
        if self.error is not None:
            raise self.error
        return GeneratedImage(
            image=Image.new("RGB", (request.width // 64 or 1, request.height // 64 or 1), (200, 30, 30)),
            seed=request.seed if request.seed is not None else self.seed,
            prompt=f"resolved({request.prompt})",
            negative_prompt=f"resolved({request.negative_prompt})",
        )

    def cancel(self) -> None:
        self.cancel_calls += 1

    def unload(self) -> None:
        self.unload_calls += 1


@dataclass
class CountingFactory:
    """GeneratorFactory returning `generator` and counting how often it was called."""

    generator: FakeGenerator
    calls: int = 0

    def __call__(self) -> FakeGenerator:
        self.calls += 1
        return self.generator


class RecordingTaskHub(TaskHub):
    """TaskHub remembering every event published after construction (in order)."""

    def __init__(self) -> None:
        self.published: list[TaskEventModel] = []
        super().__init__()
        self.published.clear()  # drop the initial idle event

    def publish(self, event: TaskEventModel) -> None:
        self.published.append(event)
        super().publish(event)

    def stages(self) -> list[str]:
        return [getattr(event, "stage") for event in self.published]


def load_fixture(relative_path: str) -> Any:
    return json.loads((FIXTURES_DIR / relative_path).read_text(encoding="utf-8"))


def write_json_file(path: Path, payload: Any) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path
