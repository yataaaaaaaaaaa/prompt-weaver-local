"""Image generation orchestration (runtime port -> output repository -> task events)."""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Protocol

from PIL import Image

from ..schemas import GenerateRequest, GenerationStage, GenerationTaskEvent, OutputRecord
from ..settings import AppPaths
from .outputs import OutputRepository
from .task_hub import TaskHub

logger = logging.getLogger(__name__)

StepCallback = Callable[[int, int], None]


@dataclass
class GeneratedImage:
    image: Image.Image
    seed: int
    prompt: str
    """Prompt actually used after runtime prompt resolution."""
    negative_prompt: str


class GenerationFailed(RuntimeError):
    """Runtime/model/LoRA/prompt-resolution error (HTTP 409)."""


class GenerationCancelledError(RuntimeError):
    """The generation was cancelled (HTTP 409)."""


class GeneratorPort(Protocol):
    """What the app needs from diffusion-lora-runtime. Tests inject a fake; runtime_adapter has the real one."""

    def generate(
        self,
        request: GenerateRequest,
        *,
        prompt_lora_dir: Path,
        prompt_embedding_dir: Path,
        on_step: StepCallback,
    ) -> GeneratedImage:
        """Raise GenerationFailed or GenerationCancelledError on failure."""
        ...

    def cancel(self) -> None: ...

    def unload(self) -> None: ...


GeneratorFactory = Callable[[], GeneratorPort]


class GenerationService:
    def __init__(
        self,
        *,
        paths: AppPaths,
        outputs: OutputRepository,
        tasks: TaskHub,
        generator_factory: GeneratorFactory,
    ) -> None:
        """The generator is created lazily on first use (importing torch takes ~25 s)."""
        self._paths = paths
        self._outputs = outputs
        self._tasks = tasks
        self._generator_factory = generator_factory
        self._generator: GeneratorPort | None = None
        self._generator_lock = threading.Lock()
        # Serializes output id allocation + save so concurrent requests never share an id.
        self._save_lock = threading.Lock()

    def generate(self, request: GenerateRequest) -> OutputRecord:
        """Publish generation task events (loading_model, sampling steps, saving, complete | error | cancelled),
        save the output and return its record. Raises GenerationFailed / GenerationCancelledError."""
        model = request.model
        requested_lora_ids = [spec.id for spec in request.loras]
        _log_preflight(request, requested_lora_ids)

        self._publish("loading_model", f"Loading model and LoRAs for {model.name}")
        try:
            generator = self._ensure_generator()
            result = generator.generate(
                request,
                prompt_lora_dir=self._paths.prompt_lora_dir,
                prompt_embedding_dir=self._paths.prompt_embedding_dir,
                on_step=lambda current, total: self._publish(
                    "sampling", f"Sampling step {current}/{total}", current=current, total=total
                ),
            )
        except GenerationFailed as exc:
            self._publish("error", str(exc))
            raise
        except GenerationCancelledError as exc:
            self._publish("cancelled", str(exc) or "Generation cancelled")
            raise
        except Exception as exc:
            # Not mapped by the runtime adapter: still end the task so the UI never shows a stuck progress.
            logger.exception("Generation failed unexpectedly")
            self._publish("error", f"Unexpected generation error: {exc}")
            raise

        self._publish("saving", "Saving output")
        try:
            with self._save_lock:
                output_id = self._outputs.next_id()
                record = self._outputs.save(
                    result.image,
                    {
                        "output_id": output_id,
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                        "prompt": result.prompt,
                        "negative_prompt": result.negative_prompt,
                        "seed": result.seed,
                        "prompt_seed": request.prompt_seed,
                        "image_seed": result.seed,
                        "width": request.width,
                        "height": request.height,
                        "steps": request.steps,
                        "guidance_scale": request.guidance_scale,
                        "model_id": model.id,
                        "active_lora_ids": requested_lora_ids,
                        "selections": [selection.model_dump(mode="json") for selection in request.selections],
                    },
                )
        except Exception as exc:
            logger.exception("Saving the generated output failed")
            message = f"Saving the output failed: {exc}"
            self._publish("error", message)
            raise GenerationFailed(message) from exc

        self._publish("complete", "Complete", current=request.steps, total=request.steps)
        return record

    def cancel(self) -> None:
        """Cancel the running generation (no-op when the generator was never created)."""
        generator = self._generator
        if generator is None:
            return
        generator.cancel()
        self._publish("cancelled", "Cancelling current generation")

    def shutdown(self) -> None:
        """cancel() + unload() when the generator exists."""
        generator = self._generator
        if generator is None:
            return
        generator.cancel()
        generator.unload()

    def _ensure_generator(self) -> GeneratorPort:
        """The generator, created on first use. Factory errors become GenerationFailed."""
        with self._generator_lock:
            if self._generator is None:
                try:
                    self._generator = self._generator_factory()
                except Exception as exc:
                    logger.exception("Creating the diffusion generator failed")
                    raise GenerationFailed(f"Could not start the diffusion runtime: {exc}") from exc
            return self._generator

    def _publish(self, stage: GenerationStage, message: str, *, current: int = 0, total: int = 0) -> None:
        self._tasks.publish(GenerationTaskEvent(stage=stage, message=message, current=current, total=total))


def _log_preflight(request: GenerateRequest, requested_lora_ids: list[str]) -> None:
    message = (
        "[Prompt Weaver Local] Generation preflight\n"
        f"  prompt={request.prompt!r}\n"
        f"  negative_prompt={request.negative_prompt!r}\n"
        f"  selected_loras={requested_lora_ids}\n"
        f"  model_path={request.model.path!r}\n"
        f"  ksample=width={request.width} height={request.height} steps={request.steps} "
        f"cfg={request.guidance_scale} seed={request.seed}"
    )
    print(message, flush=True)
    logger.info(message)
