"""Image generation orchestration (runtime port -> output repository -> task events).

Characters: GenerateRequest.character_id names the active character. Its tags, negative tags, LoRAs and seed lock
are already in the request (the frontend prompt engine injects them); this service only adds what the backend owns:
its reference images (CharacterLookup) applied through the IP-Adapter resolved for the model and the character's
focus (IpAdapterResolver = services/ip_adapters.py), passed to the runtime as a ReferenceInput, and the
OutputRecord.character record (applied or the reason why not).
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Protocol

from PIL import Image

from ..schemas import (
    Character,
    GenerateRequest,
    GenerationStage,
    GenerationTaskEvent,
    ModelArchitecture,
    OutputCharacter,
    OutputRecord,
    OutputReference,
    ReferenceFocus,
)
from ..settings import AppPaths
from .characters import CharactersFileError
from .outputs import OutputRepository
from .task_hub import TaskHub

if TYPE_CHECKING:
    from .ip_adapters import IpAdapterResolution

logger = logging.getLogger(__name__)

StepCallback = Callable[[int, int], None]

# OutputReference.reason when the character's reference images cannot be applied for a reason the IP-Adapter
# resolver does not report (services/ip_adapters.py owns the reasons about the model and the IP-Adapter files).
NO_REFERENCE_IMAGES_REASON = "The character has no reference images."
NO_IP_ADAPTERS_REASON = "IP-Adapters are not available."
IP_ADAPTER_NOT_READY_REASON = "The IP-Adapter is not ready."


@dataclass
class GeneratedImage:
    image: Image.Image
    seed: int
    prompt: str
    """Prompt actually used after runtime prompt resolution."""
    negative_prompt: str


@dataclass(frozen=True)
class ReferenceInput:
    """The active character's reference images applied through an IP-Adapter (runtime_adapter.py maps it to the
    runtime's IPAdapterSpec)."""

    adapter_path: Path
    image_encoder_path: Path
    image_paths: tuple[Path, ...]
    strength: float
    architecture: ModelArchitecture


class CharacterLookup(Protocol):
    """What generation reads from the characters collection (services/characters.py CharacterStore)."""

    def get(self, character_id: str) -> Character: ...

    def reference_image_paths(self, character: Character) -> list[Path]: ...


class IpAdapterResolver(Protocol):
    """services/ip_adapters.py IpAdapterService.resolve: the IP-Adapter files for a model + focus, or why none."""

    def resolve(self, model_path: str, focus: ReferenceFocus) -> IpAdapterResolution: ...


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
        reference: ReferenceInput | None = None,
    ) -> GeneratedImage:
        """Raise GenerationFailed or GenerationCancelledError on failure. `reference`: apply these reference images
        through the IP-Adapter (None: no IP-Adapter; one loaded by an earlier call is unloaded)."""
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
        characters: CharacterLookup | None = None,
        ip_adapters: IpAdapterResolver | None = None,
    ) -> None:
        """The generator is created lazily on first use (importing torch takes ~25 s). `characters` / `ip_adapters`
        (wired by services/container.py) serve GenerateRequest.character_id: without `characters` a request naming a
        character fails, without `ip_adapters` its reference images are not applied (OutputReference.reason)."""
        self._paths = paths
        self._outputs = outputs
        self._tasks = tasks
        self._generator_factory = generator_factory
        self._characters = characters
        self._ip_adapters = ip_adapters
        self._generator: GeneratorPort | None = None
        self._generator_lock = threading.Lock()
        # Serializes output id allocation + save so concurrent requests never share an id.
        self._save_lock = threading.Lock()

    def generate(self, request: GenerateRequest) -> OutputRecord:
        """Publish generation task events (loading_model, sampling steps, saving, complete | error | cancelled),
        save the output and return its record. Raises GenerationFailed / GenerationCancelledError.

        With request.character_id: an unknown character fails (GenerationFailed); its reference images go to the
        generator when the IP-Adapter for the model + the character's focus is ready, and the saved metadata gets a
        `character` entry (OutputCharacter: applied, or the reason why not). Without it the metadata keeps the
        legacy key set (no `character` key)."""
        model = request.model
        _log_preflight(request)

        try:
            use = self._character_use(request)
            reference = use.reference if use is not None else None
            loading = "model, LoRAs and IP-Adapter" if reference is not None else "model and LoRAs"
            self._publish("loading_model", f"Loading {loading} for {model.name}")
            generator = self._ensure_generator()
            result = generator.generate(
                request,
                prompt_lora_dir=self._paths.prompt_lora_dir,
                prompt_embedding_dir=self._paths.prompt_embedding_dir,
                on_step=lambda current, total: self._publish(
                    "sampling", f"Sampling step {current}/{total}", current=current, total=total
                ),
                reference=reference,
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
        metadata: dict[str, Any] = {
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
            "active_loras": [{"id": spec.id, "weight": spec.weight} for spec in request.loras],
            "selections": [selection.model_dump(mode="json") for selection in request.selections],
        }
        if use is not None:
            metadata["character"] = use.record.model_dump(mode="json")
        try:
            with self._save_lock:
                record = self._outputs.save(result.image, {"output_id": self._outputs.next_id(), **metadata})
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

    def _character_use(self, request: GenerateRequest) -> _CharacterUse | None:
        """How the request's character (if any) takes part in the generation: its reference images through the
        IP-Adapter resolved for the model + the character's focus, or the reason why not. Raises GenerationFailed
        for an unknown character (or an unreadable collection)."""
        character_id = request.character_id
        if character_id is None:
            return None
        if self._characters is None:
            raise GenerationFailed(f"Unknown character {character_id}: characters are not available.")
        try:
            character = self._characters.get(character_id)
        except LookupError:
            raise GenerationFailed(f"Unknown character {character_id}.") from None
        except CharactersFileError as exc:
            raise GenerationFailed(str(exc)) from exc

        paths = self._characters.reference_image_paths(character)
        if not paths:
            return _CharacterUse.not_applied(character, NO_REFERENCE_IMAGES_REASON)
        if self._ip_adapters is None:
            return _CharacterUse.not_applied(character, NO_IP_ADAPTERS_REASON)
        resolution = self._ip_adapters.resolve(request.model.path, character.reference_focus)
        support = resolution.support
        if (
            not support.ready
            or resolution.adapter_path is None
            or resolution.image_encoder_path is None
            or resolution.architecture is None
        ):
            return _CharacterUse.not_applied(character, support.reason or IP_ADAPTER_NOT_READY_REASON)
        reference = ReferenceInput(
            adapter_path=resolution.adapter_path,
            image_encoder_path=resolution.image_encoder_path,
            image_paths=tuple(paths),
            strength=character.reference_strength,
            architecture=resolution.architecture,
        )
        return _CharacterUse(
            record=_output_character(
                character,
                OutputReference(
                    applied=True,
                    variant_id=support.variant_id,
                    strength=character.reference_strength,
                    # reference_image_paths skips missing files; its file names are the image ids (characters.py).
                    image_ids=[path.stem for path in paths],
                    reason=None,
                ),
            ),
            reference=reference,
        )

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


@dataclass(frozen=True)
class _CharacterUse:
    """The request's character in one generation: what the output records and what the generator applies."""

    record: OutputCharacter
    reference: ReferenceInput | None

    @classmethod
    def not_applied(cls, character: Character, reason: str) -> _CharacterUse:
        return cls(
            record=_output_character(
                character,
                OutputReference(applied=False, variant_id=None, strength=None, image_ids=[], reason=reason),
            ),
            reference=None,
        )


def _output_character(character: Character, reference: OutputReference) -> OutputCharacter:
    return OutputCharacter(id=character.id, name=character.name, reference=reference)


def _log_preflight(request: GenerateRequest) -> None:
    """Prints and logs what is about to be generated (LoRAs as (id, weight) pairs)."""
    message = (
        "[Prompt Weaver Local] Generation preflight\n"
        f"  prompt={request.prompt!r}\n"
        f"  negative_prompt={request.negative_prompt!r}\n"
        f"  selected_loras={[(spec.id, spec.weight) for spec in request.loras]}\n"
        f"  character_id={request.character_id!r}\n"
        f"  model_path={request.model.path!r}\n"
        f"  ksample=width={request.width} height={request.height} steps={request.steps} "
        f"cfg={request.guidance_scale} seed={request.seed}"
    )
    print(message, flush=True)
    logger.info(message)
