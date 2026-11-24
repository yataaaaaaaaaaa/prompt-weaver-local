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
    IPAdapterSpec,
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
    ReferenceInput,
    StepCallback,
)

# Every runtime failure a generation can raise, reported as GenerationFailed. IP-Adapter failures are covered: a
# missing/unreadable reference image is a ReferenceImageError (ValueError); missing weights, a bad image encoder,
# an adapter made for another model family or any Diffusers error while loading/scaling/unloading the adapter is an
# AdapterLoadError (RuntimeError).
_FAILURES = (
    RuntimeError,
    ValueError,
    AdapterLoadError,
    PromptLoRAResolutionError,
    PromptEmbeddingResolutionError,
)


class RuntimeGenerator:
    """GeneratorPort over one long-lived DiffusionGenerator. The model stays loaded between calls; LoRA and IP-Adapter
    changes are applied to it in place (only a model, dtype or sampler change reloads it)."""

    def __init__(self, generator: DiffusionGenerator) -> None:
        self._generator = generator

    def generate(
        self,
        request: GenerateRequest,
        *,
        prompt_lora_dir: Path,
        prompt_embedding_dir: Path,
        on_step: StepCallback,
        reference: ReferenceInput | None = None,
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
                ip_adapter=_ip_adapter_spec(reference),
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


def _ip_adapter_spec(reference: ReferenceInput | None) -> IPAdapterSpec | None:
    """The runtime's IP-Adapter request for the character's reference images (None: no IP-Adapter)."""
    if reference is None:
        return None
    return IPAdapterSpec(
        adapter_path=str(reference.adapter_path),
        image_encoder_path=str(reference.image_encoder_path),
        image_paths=tuple(str(path) for path in reference.image_paths),
        scale=reference.strength,
        architecture=reference.architecture,
    )


def create_runtime_generator() -> GeneratorPort:
    """Build the real DiffusionGenerator-backed GeneratorPort (maps runtime exceptions to
    GenerationFailed / GenerationCancelledError; each LoRA keeps its GenerateRequest weight)."""
    return RuntimeGenerator(DiffusionGenerator())
