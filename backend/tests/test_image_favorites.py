"""Image library favorites (app/services/image_favorites.py): <data dir>/image_favorites.json, newest first."""

from __future__ import annotations

import json
import logging
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from app.schemas import FavoriteImage
from app.services import image_favorites
from app.services.image_favorites import FAVORITES_FORMAT_VERSION, ImageFavoritesStore
from app.settings import AppPaths
from support import remote_image, write_json_file


@pytest.fixture()
def favorites_file(app_paths: AppPaths) -> Path:
    return app_paths.image_favorites_file


@pytest.fixture()
def store(favorites_file: Path) -> ImageFavoritesStore:
    return ImageFavoritesStore(favorites_file)


def read_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def ids(favorites: list[FavoriteImage]) -> list[str]:
    return [favorite.image.id for favorite in favorites]


def test_a_missing_file_means_no_favorites(store: ImageFavoritesStore, favorites_file: Path) -> None:
    assert store.list() == []
    assert not favorites_file.exists()  # reading never creates the file


def test_construction_reads_nothing_until_first_use(favorites_file: Path) -> None:
    store = ImageFavoritesStore(favorites_file)
    favorite = FavoriteImage(image=remote_image("7"), saved_at=datetime(2026, 1, 2, tzinfo=UTC))
    write_json_file(favorites_file, {"version": 1, "items": [favorite.model_dump(mode="json")]})

    assert store.list() == [favorite]
    assert repr(store) == f"ImageFavoritesStore(favorites_file={str(favorites_file)!r})"


def test_add_saves_the_image_first_with_the_time_in_utc(store: ImageFavoritesStore, favorites_file: Path) -> None:
    before = datetime.now(UTC)
    favorite = store.add(remote_image("1"))
    after = datetime.now(UTC)

    assert favorite.image == remote_image("1")
    assert favorite.saved_at.tzinfo is not None
    assert before <= favorite.saved_at <= after
    assert store.list() == [favorite]
    assert read_file(favorites_file) == {
        "version": FAVORITES_FORMAT_VERSION,
        "items": [favorite.model_dump(mode="json")],
    }


def test_newest_first_and_saving_again_replaces_and_moves_to_the_front(store: ImageFavoritesStore) -> None:
    store.add(remote_image("1"))
    store.add(remote_image("2"))
    store.add(remote_image("3", provider="other"))
    assert ids(store.list()) == ["3", "2", "1"]

    refreshed = remote_image("1", prompt="a new snapshot")
    store.add(refreshed)

    favorites = store.list()
    assert ids(favorites) == ["1", "3", "2"]
    assert favorites[0].image == refreshed
    assert favorites[0].saved_at >= favorites[1].saved_at


def test_the_key_is_provider_and_image_id(store: ImageFavoritesStore) -> None:
    store.add(remote_image("1"))
    store.add(remote_image("1", provider="other"))

    assert [(favorite.image.provider, favorite.image.id) for favorite in store.list()] == [("other", "1"), ("stub", "1")]


def test_remove(store: ImageFavoritesStore, favorites_file: Path) -> None:
    store.add(remote_image("1"))
    store.add(remote_image("2"))

    assert store.remove("stub", "1") is True
    assert ids(store.list()) == ["2"]
    assert [item["image"]["id"] for item in read_file(favorites_file)["items"]] == ["2"]

    assert store.remove("stub", "1") is False
    assert store.remove("other", "2") is False
    assert ids(store.list()) == ["2"]


def test_removing_from_an_empty_collection_writes_nothing(store: ImageFavoritesStore, favorites_file: Path) -> None:
    assert store.remove("stub", "1") is False
    assert not favorites_file.exists()


def test_favorites_persist_across_instances(store: ImageFavoritesStore, favorites_file: Path) -> None:
    store.add(remote_image("1"))
    store.add(remote_image("2", prompt=None))
    store.remove("stub", "1")
    store.add(remote_image("3"))

    reloaded = ImageFavoritesStore(favorites_file)

    assert reloaded.list() == store.list()
    assert ids(reloaded.list()) == ["3", "2"]
    assert reloaded.list()[1].image.params is None


def test_invalid_entries_are_skipped_and_valid_ones_kept(
    favorites_file: Path, caplog: pytest.LogCaptureFixture
) -> None:
    valid = FavoriteImage(image=remote_image("1"), saved_at=datetime(2026, 3, 4, 5, 6, 7, tzinfo=UTC))
    duplicate = FavoriteImage(image=remote_image("1", prompt="older"), saved_at=datetime(2026, 1, 1, tzinfo=UTC))
    other = FavoriteImage(image=remote_image("2"), saved_at=datetime(2026, 2, 1, tzinfo=UTC))
    payload = {
        "version": 1,
        "items": [
            valid.model_dump(mode="json"),
            {"image": {"id": "broken"}, "saved_at": "2026-01-01T00:00:00Z"},
            "not an object",
            duplicate.model_dump(mode="json"),
            {"image": other.image.model_dump(mode="json")},  # no saved_at
            other.model_dump(mode="json"),
        ],
    }
    write_json_file(favorites_file, payload)
    store = ImageFavoritesStore(favorites_file)

    with caplog.at_level(logging.WARNING, logger=image_favorites.__name__):
        assert store.list() == [valid, other]

    assert len(caplog.records) == 4
    assert read_file(favorites_file) == payload  # only the next add / remove rewrites the file

    store.add(remote_image("3"))
    assert [item["image"]["id"] for item in read_file(favorites_file)["items"]] == ["3", "1", "2"]


@pytest.mark.parametrize(
    "content",
    [
        "{not json",
        json.dumps({"version": 2, "items": []}),
        json.dumps({"items": []}),
        json.dumps({"version": 1, "items": {"1": {}}}),
        json.dumps([1, 2, 3]),
    ],
)
def test_an_unusable_file_reads_as_empty_and_is_replaced_by_the_next_change(
    favorites_file: Path, caplog: pytest.LogCaptureFixture, content: str
) -> None:
    favorites_file.parent.mkdir(parents=True, exist_ok=True)
    favorites_file.write_text(content, encoding="utf-8")
    store = ImageFavoritesStore(favorites_file)

    with caplog.at_level(logging.WARNING, logger=image_favorites.__name__):
        assert store.list() == []
    assert caplog.records

    store.add(remote_image("1"))
    assert read_file(favorites_file)["version"] == FAVORITES_FORMAT_VERSION
    assert ids(ImageFavoritesStore(favorites_file).list()) == ["1"]


def test_a_newer_sidecar_copy_is_recovered(store: ImageFavoritesStore, favorites_file: Path) -> None:
    """A crash between writing image_favorites.json.new and the swap (services/json_files.py) loses nothing."""
    store.add(remote_image("1"))
    store.add(remote_image("2"))
    newest = favorites_file.read_text(encoding="utf-8")
    favorites_file.with_name(f"{favorites_file.name}.new").write_text(newest, encoding="utf-8")
    favorites_file.write_text("{truncated", encoding="utf-8")

    assert ids(ImageFavoritesStore(favorites_file).list()) == ["2", "1"]


def test_a_failed_write_keeps_the_collection_unchanged(
    store: ImageFavoritesStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    store.add(remote_image("1"))

    def fail(path: Path, payload: Any) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(image_favorites, "write_json_atomic", fail)

    with pytest.raises(OSError):
        store.add(remote_image("2"))
    with pytest.raises(OSError):
        store.remove("stub", "1")
    assert ids(store.list()) == ["1"]


def test_concurrent_changes_are_all_kept(store: ImageFavoritesStore, favorites_file: Path) -> None:
    count = 12
    start = threading.Barrier(count)

    def add(index: int) -> None:
        start.wait(timeout=5)
        store.add(remote_image(str(index)))

    threads = [threading.Thread(target=add, args=(index,)) for index in range(count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert sorted(ids(store.list()), key=int) == [str(index) for index in range(count)]
    assert ids(ImageFavoritesStore(favorites_file).list()) == ids(store.list())
