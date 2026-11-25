"""Seeds a fresh e2e data dir and model folders from the committed, synthetic fixture data.

fixtures/data/ is a template of the data dir (stores/<name>/state.json envelopes, output/<id>.json metadata,
characters/characters.json, image_favorites.json). Text files may use the placeholders {{DATA_DIR}} and
{{MODELS_ROOT}} (absolute, forward slashes) and {{SHA256:<synthetic Civitai file id>}} (the SHA-256 the synthetic
Civitai publishes for that file), replaced when copied. Then:
- E2EResetRequest.files are written (same placeholders);
- every output metadata file (output/ and trash/) without its PNG gets a generated picture of its width x height;
- every character image of characters/characters.json without its PNG gets a generated picture;
- E2EResetRequest.remove is deleted last (so generated pictures can be removed too);
- fixtures/models.json lists the model files to create under the model folders: "civitai_file_id" = the bytes of
  that synthetic Civitai file (fake_civitai.file_content: same size and SHA-256 as the catalog publishes, so the app
  finds it "on disk"), "architecture" = a minimal safetensors header of that family ("sdxl" / "sd15", what
  diffusion_lora_runtime.checkpoint_inspection reads), else "bytes" filler bytes.

Nothing here ever reads or writes outside the given directories.
"""

from __future__ import annotations

import json
import re
import shutil
import struct
from pathlib import Path
from typing import Any

from .fake_civitai import CHUNK_SIZE, file_content, file_sha256
from .images import picture
from .options import E2EResetRequest

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
DATA_TEMPLATE_DIR = FIXTURES_DIR / "data"
MODELS_MANIFEST = FIXTURES_DIR / "models.json"
TEXT_SUFFIXES = frozenset({".json", ".txt"})

# One tensor key per family: what checkpoint_inspection.detect_single_file_architecture looks for.
ARCHITECTURE_KEYS = {
    "sdxl": "conditioner.embedders.1.model.ln_final.weight",
    "sd15": "cond_stage_model.transformer.text_model.final_layer_norm.weight",
}


def _posix(path: Path) -> str:
    return path.resolve().as_posix()


SHA256_PLACEHOLDER = re.compile(r"\{\{SHA256:(\d+)\}\}")


class Placeholders:
    def __init__(self, data_dir: Path, models_root: Path, file_size: int) -> None:
        self._values = {"{{DATA_DIR}}": _posix(data_dir), "{{MODELS_ROOT}}": _posix(models_root)}
        self._file_size = file_size

    def apply(self, text: str) -> str:
        for key, value in self._values.items():
            text = text.replace(key, value)
        return SHA256_PLACEHOLDER.sub(lambda match: file_sha256(match.group(1), self._file_size), text)


def _inside(root: Path, relative: str) -> Path:
    target = (root / relative).resolve()
    if root.resolve() not in target.parents and target != root.resolve():
        raise ValueError(f"{relative!r} is outside the e2e data dir")
    return target


def minimal_safetensors(architecture: str) -> bytes:
    key = ARCHITECTURE_KEYS[architecture]
    header = json.dumps({key: {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]}}).encode()
    return struct.pack("<Q", len(header)) + header + b"\x00\x00"


def _copy_template(data_dir: Path, placeholders: Placeholders) -> None:
    for source in sorted(DATA_TEMPLATE_DIR.rglob("*")):
        if source.is_dir():
            continue
        target = data_dir / source.relative_to(DATA_TEMPLATE_DIR)
        target.parent.mkdir(parents=True, exist_ok=True)
        if source.suffix in TEXT_SUFFIXES:
            target.write_text(placeholders.apply(source.read_text(encoding="utf-8")), encoding="utf-8")
        else:
            shutil.copyfile(source, target)


def _write_files(data_dir: Path, request: E2EResetRequest, placeholders: Placeholders) -> None:
    for relative, value in request.files.items():
        target = _inside(data_dir, relative)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(placeholders.apply(json.dumps(value, indent=2)), encoding="utf-8")


def _remove(data_dir: Path, request: E2EResetRequest) -> None:
    for relative in request.remove:
        target = _inside(data_dir, relative)
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink(missing_ok=True)


def _output_pictures(data_dir: Path) -> None:
    for folder in (data_dir / "output", data_dir / "trash"):
        for metadata_file in sorted(folder.glob("*.json")) if folder.is_dir() else []:
            png = metadata_file.with_suffix(".png")
            if png.exists():
                continue
            metadata: dict[str, Any] = json.loads(metadata_file.read_text(encoding="utf-8"))
            output_id = metadata_file.stem
            picture(
                f"output:{output_id}",
                int(metadata.get("width", 512)),
                int(metadata.get("height", 512)),
                label=f"Output {int(output_id)}",
            ).save(png)


def _character_pictures(data_dir: Path) -> None:
    characters_file = data_dir / "characters" / "characters.json"
    if not characters_file.is_file():
        return
    images_dir = data_dir / "characters" / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    payload = json.loads(characters_file.read_text(encoding="utf-8"))
    for character in payload.get("items", []):
        images = list(character.get("reference_images") or [])
        if character.get("thumbnail"):
            images.append(character["thumbnail"])
        for image in images:
            target = images_dir / f"{image['id']}.png"
            if not target.exists():
                picture(f"character:{image['id']}", image.get("width", 512), image.get("height", 512)).save(target)


def _model_files(models_root: Path, file_size: int) -> None:
    for entry in json.loads(MODELS_MANIFEST.read_text(encoding="utf-8")):
        target = _inside(models_root, entry["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        if "civitai_file_id" in entry:
            target.write_bytes(file_content(str(entry["civitai_file_id"]), file_size))
        elif "architecture" in entry:
            target.write_bytes(minimal_safetensors(entry["architecture"]))
        else:
            target.write_bytes(b"\x00" * int(entry.get("bytes", 1024)))


def seed(data_dir: Path, models_root: Path, request: E2EResetRequest) -> None:
    """Creates `data_dir` and `models_root` (both must not exist yet) from the fixtures and the request."""
    file_size = request.network.download_chunks * CHUNK_SIZE
    data_dir.mkdir(parents=True)
    models_root.mkdir(parents=True)
    placeholders = Placeholders(data_dir, models_root, file_size)
    _copy_template(data_dir, placeholders)
    _write_files(data_dir, request, placeholders)
    _output_pictures(data_dir)
    _character_pictures(data_dir)
    _model_files(models_root, file_size)
    # Last, so a generated file can be removed too (e.g. 'output/0000000004.png': an output without its picture).
    _remove(data_dir, request)
