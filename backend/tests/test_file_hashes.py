"""File SHA-256 + persistent hash cache (app/services/file_hashes.py)."""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Callable
from pathlib import Path

import pytest

from app.services import file_hashes
from app.services.file_hashes import (
    CACHE_FORMAT_VERSION,
    FileHashCache,
    normalize_file_hash,
    normalize_sha256,
    path_key,
    sha256_file,
)
from app.settings import AppPaths
from support import sha256_of

HELLO_SHA256 = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"  # sha256(b"hello world")


@pytest.fixture()
def cache_file(app_paths: AppPaths) -> Path:
    return app_paths.cache_dir / "file_hashes.json"


@pytest.fixture()
def cache(cache_file: Path) -> FileHashCache:
    return FileHashCache(cache_file)


@pytest.fixture()
def make_file(tmp_path: Path) -> Callable[..., Path]:
    def make(name: str, content: bytes = b"hello world") -> Path:
        path = tmp_path / "files" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        return path

    return make


def bump_mtime(path: Path, delta_ns: int = 5_000_000_000) -> None:
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + delta_ns))


def test_sha256_file_streams_the_content(make_file: Callable[..., Path]) -> None:
    path = make_file("hello.bin")
    assert sha256_file(path) == HELLO_SHA256
    assert sha256_file(path, chunk_size=3) == HELLO_SHA256
    assert sha256_file(make_file("empty.bin", b"")) == sha256_of(b"")


def test_a_cache_hit_does_not_hash_again(
    cache: FileHashCache, make_file: Callable[..., Path], hash_calls: list[Path]
) -> None:
    path = make_file("model.safetensors")
    assert cache.cached_sha256(path) is None
    assert hash_calls == []

    assert cache.sha256(path) == HELLO_SHA256
    assert cache.sha256(path) == HELLO_SHA256
    assert cache.cached_sha256(path) == HELLO_SHA256
    assert hash_calls == [path]


def test_entries_are_invalidated_by_size_and_mtime_changes(
    cache: FileHashCache, make_file: Callable[..., Path], hash_calls: list[Path]
) -> None:
    path = make_file("model.safetensors")
    cache.sha256(path)

    bump_mtime(path)  # same size and content, other mtime
    assert cache.cached_sha256(path) is None
    assert cache.sha256(path) == HELLO_SHA256
    assert len(hash_calls) == 2

    stat = path.stat()
    path.write_bytes(b"hello world, longer")
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))  # same mtime, other size
    assert cache.cached_sha256(path) is None
    assert cache.sha256(path) == sha256_of(b"hello world, longer")
    assert len(hash_calls) == 3


def test_the_cache_persists_across_instances(
    cache: FileHashCache, cache_file: Path, make_file: Callable[..., Path], hash_calls: list[Path]
) -> None:
    path = make_file("model.safetensors")
    cache.sha256(path)

    payload = json.loads(cache_file.read_text(encoding="utf-8"))
    stat = path.stat()
    assert payload == {
        "version": CACHE_FORMAT_VERSION,
        "entries": {
            os.path.abspath(path): {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "sha256": HELLO_SHA256}
        },
    }

    reloaded = FileHashCache(cache_file)
    assert reloaded.cached_sha256(path) == HELLO_SHA256
    assert reloaded.sha256(path) == HELLO_SHA256
    assert reloaded.paths_with_hash(HELLO_SHA256) == [path]
    assert hash_calls == [path]


def test_constructing_the_cache_performs_no_io(cache_file: Path) -> None:
    FileHashCache(cache_file)
    assert not cache_file.parent.exists()


@pytest.mark.parametrize(
    "content",
    [
        "{not json",
        "[]",
        json.dumps({"version": 99, "entries": {}}),
        json.dumps({"version": CACHE_FORMAT_VERSION, "entries": []}),
    ],
)
def test_a_corrupt_or_unknown_cache_reads_as_empty(
    cache_file: Path, make_file: Callable[..., Path], content: str
) -> None:
    path = make_file("model.safetensors")
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(content, encoding="utf-8")

    cache = FileHashCache(cache_file)
    assert cache.cached_sha256(path) is None
    assert cache.sha256(path) == HELLO_SHA256
    # Rewritten in the current format.
    assert FileHashCache(cache_file).cached_sha256(path) == HELLO_SHA256


def test_invalid_entries_are_skipped(cache_file: Path, make_file: Callable[..., Path]) -> None:
    good, bad = make_file("good.bin"), make_file("bad.bin")
    good_stat, bad_stat = good.stat(), bad.stat()
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(
        json.dumps(
            {
                "version": CACHE_FORMAT_VERSION,
                "entries": {
                    str(good): {"size": good_stat.st_size, "mtime_ns": good_stat.st_mtime_ns, "sha256": HELLO_SHA256},
                    str(bad): {"size": bad_stat.st_size, "mtime_ns": bad_stat.st_mtime_ns, "sha256": "NOT-A-HASH"},
                    "": {"size": 1, "mtime_ns": 1, "sha256": HELLO_SHA256},
                },
            }
        ),
        encoding="utf-8",
    )

    cache = FileHashCache(cache_file)
    assert cache.cached_sha256(good) == HELLO_SHA256
    assert cache.cached_sha256(bad) is None


def test_remember_records_a_hash_without_hashing(
    cache: FileHashCache, cache_file: Path, make_file: Callable[..., Path], hash_calls: list[Path]
) -> None:
    path = make_file("download.safetensors")
    cache.remember(path, HELLO_SHA256.upper())

    assert cache.sha256(path) == HELLO_SHA256
    assert FileHashCache(cache_file).cached_sha256(path) == HELLO_SHA256
    assert hash_calls == []

    with pytest.raises(ValueError):
        cache.remember(path, "abc")
    with pytest.raises(FileNotFoundError):
        cache.remember(path.with_name("missing.safetensors"), HELLO_SHA256)


def test_paths_with_hash_only_returns_existing_unchanged_files(
    cache: FileHashCache, make_file: Callable[..., Path], hash_calls: list[Path]
) -> None:
    first, second, other = make_file("a.bin"), make_file("b.bin"), make_file("c.bin", b"other")
    for path in (first, second, other):
        cache.sha256(path)
    hashed = len(hash_calls)

    assert sorted(cache.paths_with_hash(HELLO_SHA256)) == [first, second]
    assert cache.paths_with_hash(HELLO_SHA256.upper()) == cache.paths_with_hash(HELLO_SHA256)
    assert cache.paths_with_hash(sha256_of(b"unknown")) == []

    first.unlink()
    second.write_bytes(b"changed content")
    assert cache.paths_with_hash(HELLO_SHA256) == []
    assert cache.paths_with_hash(sha256_of(b"other")) == [other]
    assert len(hash_calls) == hashed


def test_a_file_changing_while_hashed_is_not_cached(
    cache: FileHashCache, make_file: Callable[..., Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    path = make_file("growing.safetensors")
    real = file_hashes.sha256_file

    def hash_then_append(target: Path, **kwargs: int) -> str:
        digest = real(target, **kwargs)
        with open(target, "ab") as handle:
            handle.write(b"more")
        return digest

    monkeypatch.setattr(file_hashes, "sha256_file", hash_then_append)
    assert cache.sha256(path) == HELLO_SHA256
    assert cache.cached_sha256(path) is None


def test_a_failing_cache_write_keeps_the_hash_in_memory(tmp_path: Path, make_file: Callable[..., Path]) -> None:
    blocker = tmp_path / "not-a-folder"
    blocker.write_text("file where the cache folder should be", encoding="utf-8")
    cache = FileHashCache(blocker / "file_hashes.json")
    path = make_file("model.safetensors")

    assert cache.sha256(path) == HELLO_SHA256
    assert cache.cached_sha256(path) == HELLO_SHA256


@pytest.mark.skipif(os.name != "nt", reason="Windows paths are case-insensitive")
def test_paths_match_case_insensitively_on_windows(cache: FileHashCache, make_file: Callable[..., Path]) -> None:
    path = make_file("Model.SafeTensors")
    cache.sha256(path)

    assert cache.cached_sha256(Path(str(path).upper())) == HELLO_SHA256
    assert cache.paths_with_hash(HELLO_SHA256) == [path]
    assert str(cache.paths_with_hash(HELLO_SHA256)[0]) == os.path.abspath(path)  # original case kept
    assert path_key(str(path).upper()) == path_key(path)


def test_concurrent_use_keeps_every_entry(
    cache: FileHashCache, cache_file: Path, make_file: Callable[..., Path]
) -> None:
    files = [make_file(f"file-{index}.bin", f"content {index}".encode()) for index in range(24)]
    barrier = threading.Barrier(8)
    errors: list[BaseException] = []

    def work(worker: int) -> None:
        try:
            barrier.wait()
            for index, path in enumerate(files):
                if index % 8 == worker:
                    cache.remember(path, sha256_of(path.read_bytes()))
                else:
                    cache.sha256(path)
        except BaseException as exc:  # pragma: no cover - reported below
            errors.append(exc)

    threads = [threading.Thread(target=work, args=(worker,)) for worker in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    reloaded = FileHashCache(cache_file)
    for path in files:
        assert reloaded.cached_sha256(path) == sha256_of(path.read_bytes())


def test_normalize_sha256_is_the_one_hash_normalization() -> None:
    assert normalize_sha256(f"  {HELLO_SHA256.upper()}\t") == HELLO_SHA256
    assert normalize_sha256(HELLO_SHA256) == HELLO_SHA256
    for unusable in (None, "", "   ", "abc", HELLO_SHA256 + "0", "g" * 64):
        assert normalize_sha256(unusable) is None
    # Short provider hashes are not SHA-256 digests.
    for short in ("2dae719f", "47aaaf0d29", "7c6bad76eb54"):
        assert normalize_sha256(short) is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("2DAE719F", "2dae719f"),  # AutoV1 / CRC32
        (" 47AAAF0D29 ", "47aaaf0d29"),  # AutoV2
        ("7C6BAD76EB54\n", "7c6bad76eb54"),  # AutoV3
        (HELLO_SHA256.upper(), HELLO_SHA256),  # SHA-256 / BLAKE3
        (None, None),
        ("", None),
        ("   ", None),
        ("abc", None),
        ("47aaaf0d2", None),  # 9
        ("47aaaf0d294", None),  # 11
        ("47aaaf0d2945c", None),  # 13
        (HELLO_SHA256[:63], None),
        (HELLO_SHA256 + "0", None),
        ("g" * 10, None),
        ("7c6bad76-eb54", None),
        ("0x6bad76eb54", None),
    ],
)
def test_normalize_file_hash_accepts_short_provider_hashes(value: str | None, expected: str | None) -> None:
    assert normalize_file_hash(value) == expected
