"""Generation metadata of Civitai images ("meta" of GET /images?withMeta=true) -> ImageGenerationParams and the
ImageResource list. Pure functions that never raise on odd metadata: a value of an unexpected type reads as absent.
Real shapes: tests/fixtures/civitai/images_*.json (see civitai_images.py for the API facts).

unwrap_meta(raw): the generation dict. The unfiltered feed sends it flat; a gallery (modelId) wraps it as
{"id": <image id>, "meta": {...}}. null, a non-object or an empty object -> None.

parse_generation_params(meta): prompt, negativePrompt, sampler, steps, cfgScale, seed, width / height (else "Size":
"WxH"), clipSkip. A field of the wrong type is None; clean_prompt is the prompt without its inline LoRA tags
(diffusion_lora_runtime.prompt_lora.strip_prompt_lora_tags). None when the meta is None or publishes none of them.

parse_resources(meta): one ImageResource per model the image was made with, merged from five sources:
  a. civitaiResources [{type, weight, modelVersionId}] (images generated on Civitai): version_id + weight, no name;
     entries without a usable modelVersionId are skipped, repeated versions kept once;
  b. resources [{name, type, weight, hash}] (what Civitai parsed from the uploaded file; weight and hash may be
     null or absent);
  c. hashes {"model": h, "lora:<name>": h, "embed:<name>": h, "vae": h, ...} ("model" is the checkpoint named by
     meta "Model");
  d. meta "Model" + "Model hash": the checkpoint;
  e. the inline <lora:name:weight> tags of the prompt (diffusion_lora_runtime.prompt_lora.extract_prompt_lora_specs:
     the one owner of that syntax).
Rules:
- kind (case-insensitive type, or hashes key prefix): META_KINDS (checkpoint / model / diffusionmodel ->
  "checkpoint"; lora / locon / lycoris / dora -> "lora"; embed / embedding / textualinversion -> "embedding");
  anything else (vae, upscaler, controlnet, ...) is dropped.
- name-based sources (b-e) describe one model when the kind is the same and the names are equal (casefolded),
  or else the file hashes match (equal, or a short hash that is the prefix of a SHA-256: AutoV2 and the 12-digit
  SHA-256 prefix some tools publish). The first-seen name is kept.
- weight (LoRAs only; None for checkpoints and embeddings): the resources weight when not null, else the inline
  weight, else None. civitaiResources entries carry their own weight.
- hash: normalized with services/file_hashes.py normalize_file_hash (unusable -> None); a full SHA-256 wins over
  a short hash, else the first short hash seen.
- civitaiResources is authoritative for the kinds it lists: the name-based entries of those kinds are dropped
  (names cannot be matched to version ids).
- order: checkpoints, then LoRAs, then embeddings (ModelKind order); within a kind, first-seen order
  (civitaiResources, resources, hashes, Model / Model hash, inline tags).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, get_args

from diffusion_lora_runtime.prompt_lora import extract_prompt_lora_specs, strip_prompt_lora_tags

from ...schemas import ImageGenerationParams, ImageResource, ModelKind
from ..file_hashes import normalize_file_hash, normalize_sha256
from .civitai import (
    CIVITAI_KIND_TYPES,
    optional_float,
    optional_id,
    optional_int,
    optional_positive_int,
    optional_str,
)

# Casefolded resource types / hashes key prefixes of the image metadata -> app kind. The Civitai model types
# (CIVITAI_KIND_TYPES: Checkpoint, LORA, LoCon, DoRA, TextualInversion) plus the metadata spellings.
META_KINDS: dict[str, ModelKind] = {
    **{civitai_type.casefold(): kind for kind, types in CIVITAI_KIND_TYPES.items() for civitai_type in types},
    "model": "checkpoint",
    "diffusionmodel": "checkpoint",
    "lycoris": "lora",
    "embed": "embedding",
    "embedding": "embedding",
}
KIND_ORDER: tuple[ModelKind, ...] = get_args(ModelKind)
# Keys of the {"id", "meta"} wrapper of gallery (modelId) answers.
_WRAPPER_KEYS = frozenset({"id", "meta"})
_SIZE_RE = re.compile(r"\s*(\d+)\s*[xX×]\s*(\d+)\s*")


# ---------------------------------------------------------------------------
# Scalars
# ---------------------------------------------------------------------------


def _text(value: Any) -> str | None:
    """A string with visible content, surrounding whitespace removed; None otherwise."""
    return optional_str(value.strip()) if isinstance(value, str) else None


def _size(value: Any) -> tuple[int | None, int | None]:
    """(width, height) of an A1111 "Size" value "WxH"."""
    match = _SIZE_RE.fullmatch(value) if isinstance(value, str) else None
    if match is None:
        return None, None
    return optional_positive_int(int(match.group(1))), optional_positive_int(int(match.group(2)))


def _kind(value: Any) -> ModelKind | None:
    return META_KINDS.get(value.strip().casefold()) if isinstance(value, str) else None


def _file_hash(value: Any) -> str | None:
    return normalize_file_hash(value) if isinstance(value, str) else None


def _same_file(first: str, second: str) -> bool:
    """Whether two normalized file hashes designate the same file: equal, or a short hash that is the prefix of a
    SHA-256 (AutoV2 = the first 10 hex digits of the SHA-256)."""
    short, full = sorted((first, second), key=len)
    return short == full or (normalize_sha256(full) is not None and full.startswith(short))


def _preferred_hash(current: str | None, published: str | None) -> str | None:
    """The hash kept for a model: the first one published, replaced once by a full SHA-256."""
    if current is None or (normalize_sha256(current) is None and normalize_sha256(published) is not None):
        return published or current
    return current


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def unwrap_meta(raw: Any) -> dict[str, Any] | None:
    """The generation dict of an image's "meta": flat (feed) or wrapped {"id", "meta"} (gallery); None when there
    is none (null, not an object, empty)."""
    if not isinstance(raw, dict):
        return None
    inner = raw.get("meta")
    if isinstance(inner, dict):
        return inner or None
    if "meta" in raw and raw.keys() <= _WRAPPER_KEYS:  # the wrapper of an image without generation data
        return None
    return raw or None


def parse_generation_params(meta: dict[str, Any] | None) -> ImageGenerationParams | None:
    """The generation parameters of `meta` (see the module docstring); None when it publishes none."""
    if not isinstance(meta, dict):
        return None
    prompt = _text(meta.get("prompt"))
    size_width, size_height = _size(meta.get("Size"))
    width, height = optional_positive_int(meta.get("width")), optional_positive_int(meta.get("height"))
    params = ImageGenerationParams(
        prompt=prompt,
        clean_prompt=_text(strip_prompt_lora_tags(prompt)) if prompt is not None else None,
        negative_prompt=_text(meta.get("negativePrompt")),
        sampler=_text(meta.get("sampler")),
        steps=optional_positive_int(meta.get("steps")),
        cfg_scale=optional_float(meta.get("cfgScale")),
        seed=optional_int(meta.get("seed")),
        width=width if width is not None else size_width,
        height=height if height is not None else size_height,
        clip_skip=optional_positive_int(meta.get("clipSkip")),
    )
    return params if any(value is not None for value in params.model_dump().values()) else None


@dataclass
class _Entry:
    """One model being merged from the metadata sources."""

    kind: ModelKind
    name: str | None = None
    version_id: str | None = None
    hash: str | None = None
    resource_weight: float | None = None
    inline_weight: float | None = None

    def has_name(self, name: str | None) -> bool:
        return name is not None and self.name is not None and name.casefold() == self.name.casefold()

    def has_file(self, file_hash: str | None) -> bool:
        return file_hash is not None and self.hash is not None and _same_file(file_hash, self.hash)

    def merge(
        self, name: str | None, file_hash: str | None, resource_weight: float | None, inline_weight: float | None
    ) -> None:
        if self.name is None:
            self.name = name
        self.hash = _preferred_hash(self.hash, file_hash)
        if self.resource_weight is None:
            self.resource_weight = resource_weight
        if self.inline_weight is None:
            self.inline_weight = inline_weight

    def to_resource(self) -> ImageResource:
        weight = self.resource_weight if self.resource_weight is not None else self.inline_weight
        return ImageResource(
            kind=self.kind,
            name=self.name,
            weight=weight if self.kind == "lora" else None,
            version_id=self.version_id,
            hash=self.hash,
        )


class _NamedEntries:
    """The name-based entries (sources b-e) in first-seen order, merged by kind + name or file hash."""

    def __init__(self) -> None:
        self.entries: list[_Entry] = []

    def add(
        self,
        kind: ModelKind | None,
        name: Any,
        file_hash: str | None,
        *,
        resource_weight: float | None = None,
        inline_weight: float | None = None,
    ) -> None:
        name = _text(name)
        if kind is None or (name is None and file_hash is None):
            return
        same_kind = [entry for entry in self.entries if entry.kind == kind]
        existing = next((entry for entry in same_kind if entry.has_name(name)), None) or next(
            (entry for entry in same_kind if entry.has_file(file_hash)), None
        )
        if existing is None:
            existing = _Entry(kind=kind)
            self.entries.append(existing)
        existing.merge(name, file_hash, resource_weight, inline_weight)


def _civitai_resources(meta: dict[str, Any]) -> list[_Entry]:
    """Source a: civitaiResources entries with a usable kind and modelVersionId (repeated versions kept once)."""
    entries: list[_Entry] = []
    raw_entries = meta.get("civitaiResources")
    for raw in raw_entries if isinstance(raw_entries, list) else []:
        if not isinstance(raw, dict):
            continue
        kind, version_id = _kind(raw.get("type")), optional_id(raw.get("modelVersionId"))
        if kind is None or version_id is None or any(entry.version_id == version_id for entry in entries):
            continue
        entries.append(_Entry(kind=kind, version_id=version_id, resource_weight=optional_float(raw.get("weight"))))
    return entries


def _named_resources(meta: dict[str, Any]) -> list[_Entry]:
    """Sources b-e merged (see the module docstring)."""
    named = _NamedEntries()
    checkpoint_name = meta.get("Model")

    raw_resources = meta.get("resources")
    for raw in raw_resources if isinstance(raw_resources, list) else []:
        if isinstance(raw, dict):
            named.add(
                _kind(raw.get("type")),
                raw.get("name"),
                _file_hash(raw.get("hash")),
                resource_weight=optional_float(raw.get("weight")),
            )

    hashes = meta.get("hashes")
    for key, value in hashes.items() if isinstance(hashes, dict) else ():
        if not isinstance(key, str):
            continue
        prefix, _, name = key.partition(":")
        kind = _kind(prefix)
        # "model" names no model: it is the checkpoint of meta "Model".
        named.add(kind, checkpoint_name if kind == "checkpoint" and not name.strip() else name, _file_hash(value))

    named.add("checkpoint", checkpoint_name, _file_hash(meta.get("Model hash")))

    prompt = meta.get("prompt")
    for name, weight in extract_prompt_lora_specs(prompt) if isinstance(prompt, str) else ():
        named.add("lora", name, None, inline_weight=weight)
    return named.entries


def parse_resources(meta: dict[str, Any] | None) -> list[ImageResource]:
    """The models `meta` publishes, merged and ordered (see the module docstring); [] when there is no meta."""
    if not isinstance(meta, dict):
        return []
    authoritative = _civitai_resources(meta)
    authoritative_kinds = {entry.kind for entry in authoritative}
    entries = authoritative + [entry for entry in _named_resources(meta) if entry.kind not in authoritative_kinds]
    return [entry.to_resource() for kind in KIND_ORDER for entry in entries if entry.kind == kind]
