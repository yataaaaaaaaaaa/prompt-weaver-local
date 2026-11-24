"""GeneratorPort backed by diffusion-lora-runtime. Imported lazily: importing it loads torch.

This is the only module importing diffusion_lora_runtime (factory._default_generator_factory imports it on
the first generation). Tests never import it; they inject a fake GeneratorPort instead.
"""

from __future__ import annotations

from pathlib import Path

from diffusion_lora_runtime import (
    AdapterLoadError,
    DiffusionGenerator,
    GenerationCancelled,
    KSampleConfig,
    LoRASpec as RuntimeLoRASpec,
    PromptEmbeddingResolutionError,
    PromptLoRAResolutionError,
)

from ..schemas import GenerateRequest
from .generation import (
    GeneratedImage,
    GenerationCancelledError,
    GenerationFailed,
    GeneratorPort,
    StepCallback,
)

_FAILURES = (
    RuntimeError,
    ValueError,
    AdapterLoadError,
    PromptLoRAResolutionError,
    PromptEmbeddingResolutionError,
)


class RuntimeGenerator:
    """GeneratorPort over one long-lived DiffusionGenerator (keeps the model and LoRAs loaded between calls)."""

    def __init__(self, generator: DiffusionGenerator) -> None:
        self._generator = generator

    def generate(
        self,
        request: GenerateRequest,
        *,
        prompt_lora_dir: Path,
        prompt_embedding_dir: Path,
        on_step: StepCallback,
    ) -> GeneratedImage:
        model = request.model
        try:
            result = self._generator.generate(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                model_path=model.path,
                model_id=model.id,
                model_name=model.name,
                loras=[
                    RuntimeLoRASpec(id=spec.id, name=spec.name, path=spec.path, weight=spec.weight)
                    for spec in request.loras
                ],
                ksample=KSampleConfig(
                    width=request.width,
                    height=request.height,
                    steps=request.steps,
                    cfg=request.guidance_scale,
                    seed=request.seed,
                ),
                torch_dtype=model.torch_dtype,
                prompt_lora_dir=prompt_lora_dir,
                prompt_embedding_dir=prompt_embedding_dir,
                progress_callback=on_step,
            )
        # GenerationCancelled is a RuntimeError: it must be matched first.
        except GenerationCancelled as exc:
            raise GenerationCancelledError(str(exc)) from exc
        except _FAILURES as exc:
            raise GenerationFailed(str(exc)) from exc
        return GeneratedImage(
            image=result.image,
            seed=result.seed,
            prompt=result.prompt,
            negative_prompt=result.negative_prompt,
        )

    def cancel(self) -> None:
        # DiffusionGenerator only exposes generate/unload; cancellation goes through its runtime hook.
        cancel = getattr(getattr(self._generator, "runtime", None), "cancel_current_generation", None)
        if callable(cancel):
            cancel()

    def unload(self) -> None:
        self._generator.unload()


def create_runtime_generator() -> GeneratorPort:
    """Build the real DiffusionGenerator-backed GeneratorPort (maps runtime exceptions to
    GenerationFailed / GenerationCancelledError; each LoRA keeps its GenerateRequest weight)."""
    return RuntimeGenerator(DiffusionGenerator())
