"""Local copies of provider files: download targets and "already downloaded" detection
(app/services/local_models.py). Model folders live in the temp data dir (app_paths fixture)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.schemas import ModelKind
from app.services.container import FILE_HASH_CACHE_NAME
from app.services.downloads import PART_SUFFIX
from app.services.file_hashes import FileHashCache
from app.services.local_models import LocalModelFiles, download_file_name, safe_file_name
from app.settings import AppPaths
from support import MODEL_CONTENT, OTHER_MODEL_CONTENT, put_file, remote_file

VERSION_ID = "200"


def snapshot(root: Path) -> dict[str, tuple[bool, int, int]]:
    """(is_dir, size, mtime_ns) of everything below `root`: any write, creation or deletion changes it."""
    if not root.exists():
        return {}
    entries = {".": (True, 0, root.stat().st_mtime_ns)}
    for path in root.rglob("*"):
        stat = path.stat()
        entries[path.relative_to(root).as_posix()] = (path.is_dir(), stat.st_size, stat.st_mtime_ns)
    return entries


@pytest.fixture()
def hashes(app_paths: AppPaths) -> FileHashCache:
    return FileHashCache(app_paths.cache_dir / FILE_HASH_CACHE_NAME)


@pytest.fixture()
def local_files(app_paths: AppPaths, hashes: FileHashCache) -> LocalModelFiles:
    return LocalModelFiles(paths=app_paths, hashes=hashes)


@pytest.fixture()
def loras(app_paths: AppPaths) -> Path:
    return app_paths.model_dir("lora")


# ---------------------------------------------------------------------------
# File names and download targets
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("pixel_style.safetensors", "pixel_style.safetensors"),
        ('my:lora<v2>|"x"?*.safetensors', "my_lora_v2___x___.safetensors"),
        ("folder/sub\\name.safetensors", "name.safetensors"),
        ("../../escape.safetensors", "escape.safetensors"),
        ("bell\x07tab\t.safetensors", "bell_tab_.safetensors"),
        ("trailing. . ", "trailing"),
        ("CON.safetensors", "_CON.safetensors"),
        ("con", "_con"),
        ("Lpt9.tar.safetensors", "_Lpt9.tar.safetensors"),
        ("nul .safetensors", "_nul .safetensors"),
        ("COM10.safetensors", "COM10.safetensors"),
        ("CONSOLE.safetensors", "CONSOLE.safetensors"),
        ("", ""),
        ("..", ""),
        ("dir/", ""),
    ],
)
def test_safe_file_name(name: str, expected: str) -> None:
    assert safe_file_name(name) == expected


def test_an_unusable_name_falls_back_to_the_file_id() -> None:
    assert download_file_name(remote_file(name=" . ", file_id="77")) == "77.safetensors"
    assert download_file_name(remote_file(name="a/..", file_id="77")) == "77.safetensors"


def test_target_path_uses_the_sanitized_name_in_the_kind_folder(
    local_files: LocalModelFiles, app_paths: AppPaths
) -> None:
    kinds: list[ModelKind] = ["checkpoint", "lora", "embedding"]
    for kind in kinds:
        target = local_files.target_path(kind, remote_file(name="a:b/CON.safetensors"), version_id=VERSION_ID)
        assert target == app_paths.model_dir(kind) / "_CON.safetensors"
    # Pure path logic: nothing was created.
    assert not app_paths.models_root.exists()


def test_target_path_reuses_the_name_when_it_already_holds_this_file(
    local_files: LocalModelFiles, loras: Path
) -> None:
    existing = put_file(loras / "pixel_style.safetensors")
    assert local_files.target_path("lora", remote_file(), version_id=VERSION_ID) == existing
    # Without a provider hash, the same size is enough.
    assert local_files.target_path("lora", remote_file(with_sha256=False), version_id=VERSION_ID) == existing


def test_target_path_suffixes_the_name_when_another_file_holds_it(local_files: LocalModelFiles, loras: Path) -> None:
    file = remote_file()
    put_file(loras / "pixel_style.safetensors", b"other size")
    assert local_files.target_path("lora", file, version_id=VERSION_ID) == loras / "pixel_style-200.safetensors"

    put_file(loras / "pixel_style-200.safetensors", OTHER_MODEL_CONTENT)  # same size, other hash
    assert local_files.target_path("lora", file, version_id=VERSION_ID) == loras / "pixel_style-200-11.safetensors"

    put_file(loras / "pixel_style-200-11.safetensors", b"x")
    assert local_files.target_path("lora", file, version_id=VERSION_ID) == loras / "pixel_style-200-11-2.safetensors"

    (loras / "pixel_style-200-11-2.safetensors").mkdir()
    assert local_files.target_path("lora", file, version_id=VERSION_ID) == loras / "pixel_style-200-11-3.safetensors"


def test_target_path_sanitizes_the_ids_of_suffixed_names(local_files: LocalModelFiles, loras: Path) -> None:
    put_file(loras / "model.safetensors", b"other size")
    file = remote_file(name="model.safetensors", file_id="f/1")
    target = local_files.target_path("lora", file, version_id="v:2")
    assert target == loras / "model-v_2.safetensors"


def test_target_path_skips_reserved_destinations(local_files: LocalModelFiles, loras: Path) -> None:
    reserved = [loras / "pixel_style.safetensors"]
    target = local_files.target_path("lora", remote_file(), version_id=VERSION_ID, reserved=reserved)
    assert target == loras / "pixel_style-200.safetensors"


# ---------------------------------------------------------------------------
# known_path: cheap, never hashes
# ---------------------------------------------------------------------------


def test_known_path_by_name_and_size(local_files: LocalModelFiles, loras: Path, hash_calls: list[Path]) -> None:
    path = put_file(loras / "pixel_style.safetensors")
    assert local_files.known_path("lora", remote_file()) == path
    assert local_files.known_path("lora", remote_file(with_sha256=False)) == path
    assert local_files.known_path("lora", remote_file(MODEL_CONTENT + b"!")) is None
    assert local_files.known_path("checkpoint", remote_file()) is None
    assert hash_calls == []


def test_known_path_ignores_a_named_file_whose_cached_hash_differs(
    local_files: LocalModelFiles, hashes: FileHashCache, loras: Path, hash_calls: list[Path]
) -> None:
    path = put_file(loras / "pixel_style.safetensors", OTHER_MODEL_CONTENT)
    hashes.sha256(path)
    hash_calls.clear()

    assert local_files.known_path("lora", remote_file()) is None
    assert hash_calls == []


def test_known_path_by_cached_hash_inside_the_kind_folder_only(
    local_files: LocalModelFiles, app_paths: AppPaths, loras: Path, tmp_path: Path, hash_calls: list[Path]
) -> None:
    file = remote_file()
    assert file.sha256 is not None
    outside = put_file(tmp_path / "elsewhere" / "copy.safetensors")
    in_checkpoints = put_file(app_paths.model_dir("checkpoint") / "copy.safetensors")
    local_files.remember(outside, file.sha256)
    local_files.remember(in_checkpoints, file.sha256)
    assert local_files.known_path("lora", file) is None

    renamed = put_file(loras / "styles" / "Pixel Style (civitai).safetensors")
    local_files.remember(renamed, file.sha256)
    assert local_files.known_path("lora", file) == renamed
    assert hash_calls == []


# ---------------------------------------------------------------------------
# locate: verified by hash
# ---------------------------------------------------------------------------


def test_locate_finds_a_renamed_file_in_a_sub_folder_by_hash(
    local_files: LocalModelFiles, loras: Path, hash_calls: list[Path]
) -> None:
    renamed = put_file(loras / "styles" / "pixelStyle_v20.safetensors")
    put_file(loras / "unrelated.safetensors", b"another size")

    assert local_files.locate("lora", remote_file()) == renamed
    assert hash_calls == [renamed]

    # Second check: answered from the hash cache.
    assert local_files.locate("lora", remote_file()) == renamed
    assert local_files.known_path("lora", remote_file()) == renamed
    assert hash_calls == [renamed]


def test_locate_verifies_the_target_named_file(
    local_files: LocalModelFiles, loras: Path, hash_calls: list[Path]
) -> None:
    named = put_file(loras / "pixel_style.safetensors")
    assert local_files.locate("lora", remote_file()) == named
    assert hash_calls == [named]


def test_locate_prefers_the_target_named_file(local_files: LocalModelFiles, loras: Path) -> None:
    put_file(loras / "aaa-copy.safetensors")
    named = put_file(loras / "zzz" / "pixel_style.safetensors")
    assert local_files.locate("lora", remote_file()) == named


def test_locate_rejects_a_same_size_file_with_another_hash(
    local_files: LocalModelFiles, loras: Path, hash_calls: list[Path]
) -> None:
    impostor = put_file(loras / "pixel_style.safetensors", OTHER_MODEL_CONTENT)
    assert local_files.locate("lora", remote_file()) is None
    assert hash_calls == [impostor]


def test_locate_never_hashes_files_of_another_size(
    local_files: LocalModelFiles, loras: Path, hash_calls: list[Path]
) -> None:
    put_file(loras / "pixel_style.safetensors", MODEL_CONTENT + b"tail")
    put_file(loras / "sub" / "big.safetensors", MODEL_CONTENT * 2)
    assert local_files.locate("lora", remote_file()) is None
    assert hash_calls == []


def test_locate_ignores_partial_downloads(local_files: LocalModelFiles, loras: Path, hash_calls: list[Path]) -> None:
    put_file(loras / f"pixel_style.safetensors{PART_SUFFIX}")
    put_file(loras / f"OTHER.SAFETENSORS{PART_SUFFIX.upper()}")
    assert local_files.locate("lora", remote_file()) is None
    assert hash_calls == []


def test_locate_without_a_provider_hash_needs_the_name_and_size(
    local_files: LocalModelFiles, loras: Path, hash_calls: list[Path]
) -> None:
    file = remote_file(with_sha256=False)
    put_file(loras / "renamed.safetensors")
    assert local_files.locate("lora", file) is None

    in_sub_folder = put_file(loras / "styles" / "pixel_style.safetensors")
    assert local_files.locate("lora", file) == in_sub_folder

    top_level = put_file(loras / "pixel_style.safetensors")
    assert local_files.locate("lora", file) == top_level
    assert hash_calls == []


def test_locate_without_a_provider_hash_finds_the_suffixed_download_target(
    local_files: LocalModelFiles, loras: Path
) -> None:
    file = remote_file(with_sha256=False)
    put_file(loras / "pixel_style.safetensors", b"another file with this name")
    suffixed = put_file(loras / "pixel_style-200.safetensors")

    assert local_files.locate("lora", file) is None  # without the version id only the plain name counts
    assert local_files.locate("lora", file, version_id=VERSION_ID) == suffixed


def test_locate_in_a_missing_folder(local_files: LocalModelFiles, app_paths: AppPaths) -> None:
    assert local_files.locate("checkpoint", remote_file()) is None
    assert local_files.locate("checkpoint", remote_file(with_sha256=False), version_id=VERSION_ID) is None
    assert not app_paths.models_root.exists()


def test_the_model_folders_are_never_written(
    local_files: LocalModelFiles, app_paths: AppPaths, loras: Path, tmp_path: Path
) -> None:
    put_file(loras / "pixel_style.safetensors", OTHER_MODEL_CONTENT)
    put_file(loras / "styles" / "renamed.safetensors")
    put_file(loras / f"pending.safetensors{PART_SUFFIX}")
    put_file(app_paths.model_dir("checkpoint") / "model.safetensors", b"checkpoint")
    before = snapshot(app_paths.models_root)

    file, unhashed = remote_file(), remote_file(with_sha256=False)
    for kind in ("checkpoint", "lora", "embedding"):
        local_files.locate(kind, file, version_id=VERSION_ID)
        local_files.locate(kind, unhashed, version_id=VERSION_ID)
        local_files.known_path(kind, file)
        local_files.target_path(kind, file, version_id=VERSION_ID)
    local_files.remember(loras / "styles" / "renamed.safetensors", file.sha256 or "")

    assert snapshot(app_paths.models_root) == before
    assert not app_paths.model_dir("embedding").exists()
