"""Generation metadata of Civitai images (app/services/model_providers/civitai_image_meta.py): unwrapping, generation
parameters and the merging of the resource sources (civitaiResources, resources, hashes, Model / Model hash,
inline <lora:name:weight> tags). The mapping of whole real answers is covered by test_civitai_images.py."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from app.schemas import ImageResource, ModelKind
from app.services.model_providers.civitai_image_meta import (
    META_KINDS,
    parse_generation_params,
    parse_resources,
    unwrap_meta,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
ADD_DETAIL_SHA256 = "47aaaf0d2945ca937151d61304946dd229b3f072140b85484bc93e38f2a6e2f7"
CHILLOUT_SHA256 = "fc2511737a54c5e80b89ab03e0ab4b98d051ab187f92860f3cd664dc9d08b271"


def resource(
    kind: ModelKind,
    name: str | None,
    *,
    weight: float | None = None,
    version_id: str | None = None,
    hash: str | None = None,
) -> ImageResource:
    return ImageResource(kind=kind, name=name, weight=weight, version_id=version_id, hash=hash)


def summary(meta: dict[str, Any]) -> list[tuple[str, str | None, float | None, str | None, str | None]]:
    return [(item.kind, item.name, item.weight, item.version_id, item.hash) for item in parse_resources(meta)]


# ---------------------------------------------------------------------------
# unwrap_meta
# ---------------------------------------------------------------------------


def test_unwrap_meta_reads_flat_and_wrapped_meta() -> None:
    flat = {"prompt": "castle", "steps": 20}

    assert unwrap_meta(flat) is flat
    assert unwrap_meta({"id": 148522541, "meta": flat}) is flat


@pytest.mark.parametrize(
    "raw",
    [None, "meta", 12, ["prompt"], {}, {"id": 1, "meta": None}, {"id": 1, "meta": {}}, {"meta": None}],
)
def test_unwrap_meta_without_generation_data(raw: Any) -> None:
    assert unwrap_meta(raw) is None


# ---------------------------------------------------------------------------
# parse_generation_params
# ---------------------------------------------------------------------------


def test_parses_every_generation_param() -> None:
    params = parse_generation_params(
        {
            "prompt": "  castle, <lora:add_detail:0.6>, sky  ",
            "negativePrompt": "lowres, bad hands",
            "sampler": "DPM++ 2M Karras",
            "steps": 25,
            "cfgScale": 7,
            "seed": 3748019926,
            "width": 512,
            "height": 768,
            "Size": "1024x1536",
            "clipSkip": 2,
        }
    )

    assert params is not None
    assert params.model_dump() == {
        "prompt": "castle, <lora:add_detail:0.6>, sky",
        "clean_prompt": "castle, sky",
        "negative_prompt": "lowres, bad hands",
        "sampler": "DPM++ 2M Karras",
        "steps": 25,
        "cfg_scale": 7.0,
        "seed": 3748019926,
        "width": 512,
        "height": 768,
        "clip_skip": 2,
    }


@pytest.mark.parametrize(
    ("meta", "size"),
    [
        ({"Size": "832x1216"}, (832, 1216)),
        ({"Size": " 832 X 1216 "}, (832, 1216)),
        ({"width": 640, "Size": "832x1216"}, (640, 1216)),
        ({"width": 640.0, "height": 960}, (640, 960)),
        ({"Size": "832x"}, (None, None)),
        ({"Size": "0x1216"}, (None, 1216)),
        ({"Size": 832}, (None, None)),
    ],
)
def test_size_falls_back_to_the_size_field(meta: dict[str, Any], size: tuple[int | None, int | None]) -> None:
    params = parse_generation_params({"sampler": "Euler a", **meta})

    assert params is not None
    assert (params.width, params.height) == size


def test_fields_of_the_wrong_type_read_as_absent() -> None:
    params = parse_generation_params(
        {
            "prompt": 12,
            "negativePrompt": ["lowres"],
            "sampler": "Euler a",
            "steps": "30",
            "cfgScale": True,
            "seed": 1.5,
            "width": -512,
            "height": 0,
            "clipSkip": None,
        }
    )

    assert params is not None
    assert {key: value for key, value in params.model_dump().items() if value is not None} == {"sampler": "Euler a"}


def test_numbers_are_normalized() -> None:
    params = parse_generation_params({"steps": 30.0, "cfgScale": 4.5, "seed": -1, "clipSkip": 2.0})

    assert params is not None
    assert (params.steps, params.cfg_scale, params.seed, params.clip_skip) == (30, 4.5, -1, 2)
    assert isinstance(params.steps, int)


def test_a_prompt_made_only_of_lora_tags_has_no_clean_prompt() -> None:
    params = parse_generation_params({"prompt": "<lora:add_detail:1>, <lora:broken:x:y>"})

    assert params is not None
    assert (params.prompt, params.clean_prompt) == ("<lora:add_detail:1>, <lora:broken:x:y>", None)


@pytest.mark.parametrize("meta", [None, {}, {"extra": {}, "workflow": "txt2img"}, {"prompt": "   "}])
def test_no_generation_params(meta: dict[str, Any] | None) -> None:
    assert parse_generation_params(meta) is None


# ---------------------------------------------------------------------------
# parse_resources: kinds
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("resource_type", "kind"),
    [
        ("checkpoint", "checkpoint"),
        ("Checkpoint", "checkpoint"),
        ("model", "checkpoint"),
        ("diffusionModel", "checkpoint"),
        ("lora", "lora"),
        ("LORA", "lora"),
        ("LoCon", "lora"),
        ("lycoris", "lora"),
        ("DoRA", "lora"),
        ("embed", "embedding"),
        ("Embedding", "embedding"),
        ("TextualInversion", "embedding"),
        (" lora ", "lora"),
    ],
)
def test_kinds_are_mapped_case_insensitively(resource_type: str, kind: ModelKind) -> None:
    resources = [{"name": "x", "type": resource_type, "hash": "7c6bad76eb54"}]
    on_site = [{"type": resource_type, "weight": 1, "modelVersionId": 7}]

    assert [item.kind for item in parse_resources({"resources": resources})] == [kind]
    assert [item.kind for item in parse_resources({"civitaiResources": on_site})] == [kind]


@pytest.mark.parametrize("resource_type", ["vae", "upscaler", "controlnet", "hypernetwork", "", None, 12])
def test_other_kinds_are_dropped(resource_type: Any) -> None:
    meta = {
        "resources": [{"name": "x", "type": resource_type, "hash": "7c6bad76eb54"}],
        "civitaiResources": [{"type": resource_type, "weight": 1, "modelVersionId": 7}],
        "hashes": {f"{resource_type}:x": "7c6bad76eb54", "vae": "42a404c885"},
    }

    assert parse_resources(meta) == []


def test_meta_kinds_cover_every_civitai_model_type() -> None:
    assert {META_KINDS[name] for name in ("checkpoint", "lora", "locon", "dora", "textualinversion")} == {
        "checkpoint",
        "lora",
        "embedding",
    }


# ---------------------------------------------------------------------------
# parse_resources: merging
# ---------------------------------------------------------------------------


def test_one_checkpoint_from_resources_hashes_and_model_fields() -> None:
    meta = {
        "Model": "chilloutmix_NiPrunedFp32Fix",
        "Model hash": "FC2511737A",
        "hashes": {"model": CHILLOUT_SHA256, "vae": "42a404c885"},
        "resources": [{"name": "chilloutmix_NiPrunedFp32Fix", "type": "model", "hash": "fc2511737a"}],
    }

    assert parse_resources(meta) == [resource("checkpoint", "chilloutmix_NiPrunedFp32Fix", hash=CHILLOUT_SHA256)]


def test_a_nameless_checkpoint_merges_by_hash() -> None:
    """Without "Model", hashes.model (SHA-256) and "Model hash" (its AutoV2 prefix) are the same file."""
    meta = {"hashes": {"model": CHILLOUT_SHA256}, "Model hash": "fc2511737a"}

    assert parse_resources(meta) == [resource("checkpoint", None, hash=CHILLOUT_SHA256)]


def test_entries_with_other_names_merge_when_their_hashes_match() -> None:
    meta = {
        "resources": [{"name": "add_detail", "type": "lora", "weight": 0.5, "hash": "47aaaf0d29"}],
        "hashes": {"lora:Detail Tweaker": ADD_DETAIL_SHA256, "lora:other": "1921d0925550"},
    }

    assert summary(meta) == [
        ("lora", "add_detail", 0.5, None, ADD_DETAIL_SHA256),
        ("lora", "other", None, None, "1921d0925550"),
    ]


def test_different_short_hashes_are_different_files() -> None:
    meta = {
        "resources": [
            {"type": "lora", "hash": "7c6bad76eb54"},
            {"type": "lora", "hash": "1921d0925550"},
            {"type": "lora", "hash": "7C6BAD76EB54"},
        ]
    }

    assert summary(meta) == [
        ("lora", None, None, None, "7c6bad76eb54"),
        ("lora", None, None, None, "1921d0925550"),
    ]


def test_names_merge_case_insensitively_and_keep_the_first_spelling() -> None:
    meta = {
        "prompt": "castle <lora:ADD_DETAIL:0.4>",
        "resources": [{"name": "Add_Detail", "type": "lora", "weight": 0.8}],
        "hashes": {"lora:add_detail": "7c6bad76eb54"},
    }

    assert parse_resources(meta) == [resource("lora", "Add_Detail", weight=0.8, hash="7c6bad76eb54")]


@pytest.mark.parametrize(
    ("resource_weight", "prompt", "weight"),
    [
        (0.6, "<lora:kim_v_1:0.3>", 0.6),  # the resources weight wins
        (None, "<lora:kim_v_1:0.3>", 0.3),  # else the inline weight
        (None, "<lora:kim_v_1>", 1.0),  # an inline tag without weight means 1.0
        (None, "no tag", None),  # else none is published
        (0, "<lora:kim_v_1:0.3>", 0.0),  # a published 0 is a weight
        ("0.6", "<lora:kim_v_1:-0.5>", -0.5),  # junk resources weight
    ],
)
def test_lora_weight_precedence(resource_weight: Any, prompt: str, weight: float | None) -> None:
    meta = {"prompt": prompt, "resources": [{"name": "kim_v_1", "type": "lora", "weight": resource_weight}]}

    assert summary(meta) == [("lora", "kim_v_1", weight, None, None)]


def test_a_full_sha256_wins_over_short_hashes_in_any_order() -> None:
    sha_first = {
        "hashes": {"lora:add_detail": ADD_DETAIL_SHA256.upper()},
        "resources": [{"name": "add_detail", "type": "lora", "hash": "7c6bad76eb54"}],
    }
    sha_last = {
        "resources": [{"name": "add_detail", "type": "lora", "hash": "7c6bad76eb54"}],
        "hashes": {"lora:add_detail": "47aaaf0d2945"},
        "prompt": "<lora:add_detail:1>",
    }
    sha_last_with_full = {**sha_last, "hashes": {"lora:add_detail": ADD_DETAIL_SHA256}}

    assert [item.hash for item in parse_resources(sha_first)] == [ADD_DETAIL_SHA256]
    assert [item.hash for item in parse_resources(sha_last)] == ["7c6bad76eb54"]  # first short hash kept
    assert [item.hash for item in parse_resources(sha_last_with_full)] == [ADD_DETAIL_SHA256]


@pytest.mark.parametrize("bad_hash", ["xyz", "12345", "7c6bad76eb5", "g" * 12, ADD_DETAIL_SHA256 + "0", 12, None])
def test_unusable_hashes_are_dropped_but_named_entries_kept(bad_hash: Any) -> None:
    meta = {
        "resources": [{"name": "add_detail", "type": "lora", "weight": 1, "hash": bad_hash}],
        "hashes": {"lora:other": bad_hash},
    }

    assert summary(meta) == [("lora", "add_detail", 1.0, None, None), ("lora", "other", None, None, None)]


def test_inline_tags_add_loras_in_prompt_order() -> None:
    meta = {
        "prompt": "a <lora:dfd1 v1:1.0> b <lora:KreaComics_V2:.5> <lora:no_weight> <lora:broken:x:y> c",
        "resources": [{"name": "KreaComics_V2", "type": "lora", "weight": None}],
    }

    assert summary(meta) == [
        ("lora", "KreaComics_V2", 0.5, None, None),
        ("lora", "dfd1 v1", 1.0, None, None),
        ("lora", "no_weight", 1.0, None, None),
    ]


def test_hashes_keys() -> None:
    meta = {
        "hashes": {
            "lora:": "7c6bad76eb54",  # no name: kept by hash
            "embed:EasyNegative": "c74b4e810b03",
            "lycoris:my style": "1921d0925550",
            "model": "b0f6031b98",  # the checkpoint, without "Model"
            12: "e762b626fbc9",
        }
    }

    assert summary(meta) == [
        ("checkpoint", None, None, None, "b0f6031b98"),
        ("lora", None, None, None, "7c6bad76eb54"),
        ("lora", "my style", None, None, "1921d0925550"),
        ("embedding", "EasyNegative", None, None, "c74b4e810b03"),
    ]


# ---------------------------------------------------------------------------
# parse_resources: civitaiResources
# ---------------------------------------------------------------------------


def test_civitai_resources_are_authoritative_for_their_kinds() -> None:
    meta = {
        "Model": "chilloutmix_NiPrunedFp32Fix",
        "Model hash": "fc2511737a",
        "prompt": "castle <lora:castlevania_style_offset:1>",
        "resources": [
            {"name": "castlevania_style_offset", "type": "lora", "weight": 1},
            {"name": "EasyNegative", "type": "embed"},
        ],
        "civitaiResources": [
            {"type": "lora", "weight": 0.8, "modelVersionId": 65537},
            {"type": "vae", "weight": 1, "modelVersionId": 9},
        ],
    }

    # LoRAs only from civitaiResources; the checkpoint and the embedding stay name-based.
    assert summary(meta) == [
        ("checkpoint", "chilloutmix_NiPrunedFp32Fix", None, None, "fc2511737a"),
        ("lora", None, 0.8, "65537", None),
        ("embedding", "EasyNegative", None, None, None),
    ]


def test_civitai_resources_entries() -> None:
    meta = {
        "civitaiResources": [
            {"type": "embed", "weight": 1, "modelVersionId": 106916},
            {"type": "lora", "weight": "0.7", "modelVersionId": "3116962"},  # junk weight, string id
            {"type": "lora", "weight": 0.5, "modelVersionId": 3116962},  # repeated version
            {"type": "lora", "weight": 1},  # no version id
            {"type": "lora", "weight": 1, "modelVersionId": "abc"},
            {"type": "lora", "weight": 1, "modelVersionId": True},
            "not an object",
            {"type": "checkpoint", "weight": 1, "modelVersionId": 2305821},
        ]
    }

    # Checkpoints first, embeddings last; weights only for LoRAs.
    assert summary(meta) == [
        ("checkpoint", None, None, "2305821", None),
        ("lora", None, None, "3116962", None),
        ("embedding", None, None, "106916", None),
    ]


def test_resources_order_checkpoints_then_loras_then_embeddings() -> None:
    meta = {
        "resources": [
            {"name": "EasyNegative", "type": "embed"},
            {"name": "b_lora", "type": "lora", "weight": 1},
            {"name": "ckpt", "type": "model", "hash": "fc2511737a"},
        ],
        "hashes": {"lora:a_lora": "7c6bad76eb54"},
    }

    assert [(item.kind, item.name) for item in parse_resources(meta)] == [
        ("checkpoint", "ckpt"),
        ("lora", "b_lora"),
        ("lora", "a_lora"),
        ("embedding", "EasyNegative"),
    ]


@pytest.mark.parametrize(
    "meta",
    [
        None,
        {},
        {"resources": "nope", "civitaiResources": {"type": "lora"}, "hashes": ["model"], "prompt": 12, "Model": 3},
        {"resources": [None, 12, {"type": "lora"}, {"type": "lora", "name": "  "}]},
    ],
)
def test_odd_meta_has_no_resources(meta: dict[str, Any] | None) -> None:
    assert parse_resources(meta) == []


# ---------------------------------------------------------------------------
# Import
# ---------------------------------------------------------------------------


def test_importing_the_image_modules_does_not_load_torch() -> None:
    """The inline LoRA syntax comes from diffusion_lora_runtime.prompt_lora, which must stay torch-free."""
    code = (
        "import sys\n"
        "import app.services.model_providers.civitai_image_meta\n"
        "import app.services.model_providers.civitai_images\n"
        "heavy = sorted(name for name in ('torch', 'diffusers', 'transformers') if name in sys.modules)\n"
        "assert not heavy, heavy\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=BACKEND_DIR, capture_output=True, text=True, timeout=120
    )

    assert result.returncode == 0, result.stderr
