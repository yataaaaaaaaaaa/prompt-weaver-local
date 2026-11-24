"""Characters (app/services/characters.py): <data dir>/characters/characters.json (version 1) and the character
images (<data dir>/characters/images/<image id>.png)."""

from __future__ import annotations

import io
import json
import logging
import re
import shutil
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest
from PIL import Image
from pydantic import ValidationError

from app.schemas import (
    CHARACTER_ID_PATTERN,
    CHARACTER_IMAGE_ID_PATTERN,
    REFERENCE_DEFAULTS,
    Character,
    CharacterCollection,
    CharacterCreateRequest,
    CharacterDraft,
    CharacterImageCopySource,
    CharacterImageSource,
    FileImageSource,
    LoraWeight,
    OutputImageSource,
    UrlImageSource,
)
from app.services import characters as characters_module
from app.services.characters import (
    CHARACTERS_FORMAT_VERSION,
    REFERENCE_IMAGE_MAX_SIDE,
    THUMBNAIL_MAX_SIDE,
    CharacterImageError,
    CharacterImageFetchError,
    CharacterImageNotFound,
    CharacterNotFound,
    CharactersFileError,
    CharacterSourceNotFound,
    CharacterStore,
    TooManyReferenceImages,
)
from app.services.outputs import OutputRepository
from app.settings import AppPaths
from support import FIXTURES_DIR, FakeHttp, OutputFactory, write_json_file

IMAGE_URL = "https://images.example/42/original.jpeg"
SECRET = "very-secret-signature"


@pytest.fixture()
def store(app_paths: AppPaths, fake_http: FakeHttp) -> CharacterStore:
    return CharacterStore(paths=app_paths, outputs=OutputRepository(app_paths), http_client_factory=fake_http.client_factory)


@pytest.fixture()
def pictures(tmp_path: Path) -> Path:
    """A folder of local image files (outside the data dir, like the user's pictures)."""
    folder = tmp_path / "pictures"
    folder.mkdir()
    return folder


def image_bytes(size: tuple[int, int] = (64, 32), *, format: str = "PNG", mode: str = "RGB", **save: Any) -> bytes:
    buffer = io.BytesIO()
    Image.new(mode, size, (200, 30, 30) if mode == "RGB" else (200, 30, 30, 128)).save(buffer, format=format, **save)
    return buffer.getvalue()


def image_file(folder: Path, name: str, size: tuple[int, int] = (64, 32), **kwargs: Any) -> Path:
    path = folder / name
    path.write_bytes(image_bytes(size, **kwargs))
    return path


def from_file(path: Path) -> FileImageSource:
    return FileImageSource(kind="file", path=str(path))


def from_output(output_id: str) -> OutputImageSource:
    return OutputImageSource(kind="output", output_id=output_id)


def from_url(url: str = IMAGE_URL) -> UrlImageSource:
    return UrlImageSource(kind="url", url=url)


def from_character_image(image_id: str) -> CharacterImageCopySource:
    return CharacterImageCopySource(kind="character_image", image_id=image_id)


def create_request(*sources: CharacterImageSource, name: str = "Aria", **fields: Any) -> CharacterCreateRequest:
    return CharacterCreateRequest(name=name, reference_sources=list(sources), **fields)


def read_file(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def stored_files(paths: AppPaths) -> list[str]:
    folder = paths.character_images_dir
    return sorted(path.name for path in folder.iterdir()) if folder.exists() else []


def png_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as image:
        assert (image.format, image.mode) == ("PNG", "RGB")
        return image.size


# ---------------------------------------------------------------------------
# Collection, persistence and file format
# ---------------------------------------------------------------------------


def test_a_missing_file_means_no_characters(store: CharacterStore, app_paths: AppPaths) -> None:
    assert store.collection() == CharacterCollection(items=[], active_id=None)
    assert not app_paths.characters_dir.exists()  # reading never creates anything


def test_construction_reads_nothing_until_first_use(app_paths: AppPaths, fake_http: FakeHttp) -> None:
    store = CharacterStore(
        paths=app_paths, outputs=OutputRepository(app_paths), http_client_factory=fake_http.client_factory
    )
    write_json_file(app_paths.characters_file, {"version": 1, "active_id": None, "items": []})

    assert store.collection().items == []
    assert repr(store) == f"CharacterStore(characters_file={str(app_paths.characters_file)!r})"


def test_create_get_update_delete_round_trip(store: CharacterStore, app_paths: AppPaths, fake_http: FakeHttp) -> None:
    before = datetime.now(UTC)
    created = store.create(
        create_request(
            name="  Aria  ",
            identity_tags=[" 1girl ", "silver hair", "  "],
            outfit_tags=["black hoodie"],
            negative_tags=["blue eyes"],
            loras=[LoraWeight(id="aria-lora", weight=0.8)],
            seed=718043937,
            seed_locked=True,
            reference_strength=0.75,
            reference_focus="general",
        )
    )
    after = datetime.now(UTC)

    assert re.fullmatch(CHARACTER_ID_PATTERN, created.id)
    assert (created.name, created.identity_tags, created.outfit_tags) == ("Aria", ["1girl", "silver hair"], ["black hoodie"])
    assert created.negative_tags == ["blue eyes"]
    assert created.loras == [LoraWeight(id="aria-lora", weight=0.8)]
    assert (created.seed, created.seed_locked) == (718043937, True)
    assert (created.reference_strength, created.reference_focus) == (0.75, "general")
    assert (created.reference_images, created.thumbnail) == ([], None)
    assert created.created_at == created.updated_at
    assert created.created_at.tzinfo is not None and before <= created.created_at <= after
    assert store.get(created.id) == created
    assert read_file(app_paths.characters_file) == {
        "version": CHARACTERS_FORMAT_VERSION,
        "active_id": None,
        "items": [created.model_dump(mode="json")],
    }

    updated = store.update(created.id, CharacterDraft(name="Aria v2", identity_tags=["1girl"], seed=1))

    assert updated.model_dump(exclude={"updated_at"}) == {
        **created.model_dump(exclude={"updated_at"}),
        **CharacterDraft(name="Aria v2", identity_tags=["1girl"], seed=1).model_dump(),
    }
    assert updated.updated_at >= created.updated_at
    assert store.get(created.id) == updated
    # A new store reads the same collection back from the file.
    reloaded = CharacterStore(
        paths=app_paths, outputs=OutputRepository(app_paths), http_client_factory=fake_http.client_factory
    )
    assert reloaded.collection() == CharacterCollection(items=[updated], active_id=None)

    store.delete(created.id)

    assert store.collection().items == []
    assert read_file(app_paths.characters_file) == {"version": 1, "active_id": None, "items": []}
    with pytest.raises(CharacterNotFound):
        store.get(created.id)


def test_characters_keep_their_creation_order(store: CharacterStore) -> None:
    names = ["Aria", "Bob", "Cleo"]
    for name in names:
        store.create(create_request(name=name))

    assert [character.name for character in store.collection().items] == names


def test_unknown_characters_raise_not_found(store: CharacterStore, pictures: Path) -> None:
    unknown = "chr-000000000000"
    with pytest.raises(CharacterNotFound, match=unknown):
        store.get(unknown)
    with pytest.raises(CharacterNotFound):
        store.update(unknown, CharacterDraft(name="x"))
    with pytest.raises(CharacterNotFound):
        store.delete(unknown)
    with pytest.raises(CharacterNotFound):
        store.add_reference_image(unknown, from_file(image_file(pictures, "a.png")))
    with pytest.raises(CharacterNotFound):
        store.remove_reference_image(unknown, "img-000000000000")
    with pytest.raises(CharacterNotFound):
        store.set_thumbnail(unknown, from_file(image_file(pictures, "a.png")))
    with pytest.raises(CharacterNotFound):
        store.clear_thumbnail(unknown)
    with pytest.raises(CharacterNotFound):
        store.image_path(unknown, "img-000000000000")


def test_a_version_1_file_loads_skipping_invalid_entries_and_a_stale_active_id(
    store: CharacterStore, app_paths: AppPaths, fake_http: FakeHttp, caplog: pytest.LogCaptureFixture
) -> None:
    app_paths.characters_dir.mkdir(parents=True)
    shutil.copyfile(FIXTURES_DIR / "characters" / "characters_v1.json", app_paths.characters_file)

    with caplog.at_level(logging.WARNING, logger=characters_module.__name__):
        collection = store.collection()

    # "Broken" (seed_locked without a seed) is skipped; the active id named it, so no character is active.
    assert [character.name for character in collection.items] == ["Aria", "Bob the knight"]
    assert collection.active_id is None
    assert "Skipping invalid character #1" in caplog.text
    assert "Ignoring the active character 'chr-ffffffffffff'" in caplog.text
    aria, bob = collection.items
    assert aria.id == "chr-1a2b3c4d5e6f"
    assert aria.identity_tags == ["1girl", "long silver hair", "red eyes", "small mole under eye"]
    assert (aria.outfit_tags, aria.negative_tags) == (["black hoodie", "pleated skirt"], ["short hair", "blue eyes"])
    assert aria.loras == [
        LoraWeight(id="aria-character-safetensors", weight=0.8),
        LoraWeight(id="anime-lineart-safetensors", weight=1.0),
    ]
    assert (aria.seed, aria.seed_locked, aria.reference_strength, aria.reference_focus) == (718043937, True, 0.7, "face")
    assert [image.source for image in aria.reference_images] == [
        from_output("0000000012"),
        from_url("https://image.civitai.com/xG1nkqKTMzGDvpLrqFT7WA/0b6d2a1c/original=true/aria.jpeg"),
    ]
    assert aria.thumbnail is not None and aria.thumbnail.source == from_character_image("img-0a1b2c3d4e5f")
    assert aria.created_at == datetime(2026, 11, 20, 9, 15, 2, 701233, tzinfo=UTC)
    assert (bob.reference_focus, bob.reference_images) == ("general", [])
    assert bob.thumbnail is not None and bob.thumbnail.source == from_file(Path("C:\\Users\\me\\Pictures\\bob.webp"))
    # The image files are not in this data dir: no reference image to apply.
    assert store.reference_image_paths(aria) == []

    # The next write keeps the valid entries unchanged (and drops the invalid one).
    store.set_active(bob.id)

    assert read_file(app_paths.characters_file) == {
        "version": 1,
        "active_id": bob.id,
        "items": [aria.model_dump(mode="json"), bob.model_dump(mode="json")],
    }
    reloaded = CharacterStore(
        paths=app_paths, outputs=OutputRepository(app_paths), http_client_factory=fake_http.client_factory
    )
    assert reloaded.collection() == CharacterCollection(items=[aria, bob], active_id=bob.id)


def test_duplicate_ids_keep_the_first_entry(store: CharacterStore, app_paths: AppPaths) -> None:
    now = datetime(2026, 11, 1, tzinfo=UTC)
    first = Character(id="chr-aaaaaaaaaaaa", name="First", created_at=now, updated_at=now)
    second = first.model_copy(update={"name": "Second"})
    write_json_file(
        app_paths.characters_file,
        {"version": 1, "active_id": first.id, "items": [first.model_dump(mode="json"), second.model_dump(mode="json")]},
    )

    assert store.collection() == CharacterCollection(items=[first], active_id=first.id)


@pytest.mark.parametrize(
    "content",
    [
        b"{ not json",
        json.dumps({"version": 2, "active_id": None, "items": []}).encode(),
        json.dumps({"active_id": None, "items": []}).encode(),
        json.dumps([]).encode(),
        json.dumps({"version": 1, "active_id": None, "items": "nope"}).encode(),
    ],
    ids=["invalid-json", "other-version", "no-version", "not-an-object", "items-not-a-list"],
)
def test_an_unusable_file_is_refused_on_every_call_and_never_written(
    store: CharacterStore, app_paths: AppPaths, make_output: OutputFactory, content: bytes
) -> None:
    make_output("0000000001")
    app_paths.characters_dir.mkdir(parents=True)
    app_paths.characters_file.write_bytes(content)
    some_id = "chr-000000000000"
    calls = [
        store.collection,
        lambda: store.get(some_id),
        lambda: store.create(create_request(from_output("0000000001"))),
        lambda: store.update(some_id, CharacterDraft(name="x")),
        lambda: store.delete(some_id),
        lambda: store.set_active(None),
        lambda: store.add_reference_image(some_id, from_output("0000000001")),
        lambda: store.remove_reference_image(some_id, "img-000000000000"),
        lambda: store.set_thumbnail(some_id, from_output("0000000001")),
        lambda: store.clear_thumbnail(some_id),
        lambda: store.image_path(some_id, "img-000000000000"),
    ]

    for call in calls:
        with pytest.raises(CharactersFileError, match=re.escape(str(app_paths.characters_file))):
            call()

    assert app_paths.characters_file.read_bytes() == content
    assert sorted(path.name for path in app_paths.characters_dir.iterdir()) == ["characters.json"]


def test_a_failed_write_changes_nothing(
    store: CharacterStore, app_paths: AppPaths, make_output: OutputFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    make_output("0000000001")
    plain = store.create(create_request(name="Plain"))
    pictured = store.create(create_request(from_output("0000000001"), name="Pictured"))
    files_before = stored_files(app_paths)
    file_before = app_paths.characters_file.read_bytes()

    def failing_write(*_args: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(characters_module, "write_json_atomic", failing_write)
    attempts = [
        lambda: store.create(create_request(from_output("0000000001"), from_output("0000000001"))),
        lambda: store.update(plain.id, CharacterDraft(name="Renamed")),
        lambda: store.delete(pictured.id),
        lambda: store.set_active(plain.id),
        lambda: store.add_reference_image(plain.id, from_output("0000000001")),
        lambda: store.remove_reference_image(pictured.id, pictured.reference_images[0].id),
        lambda: store.set_thumbnail(pictured.id, from_output("0000000001")),
        lambda: store.clear_thumbnail(pictured.id),
    ]
    for attempt in attempts:
        with pytest.raises(OSError, match="disk full"):
            attempt()

    assert store.collection() == CharacterCollection(items=[plain, pictured], active_id=None)
    assert app_paths.characters_file.read_bytes() == file_before
    # Files written for the failed changes were deleted; files of the unchanged characters were kept.
    assert stored_files(app_paths) == files_before


def test_concurrent_creations_are_all_saved(store: CharacterStore, app_paths: AppPaths) -> None:
    names = [f"Character {index}" for index in range(8)]
    threads = [threading.Thread(target=store.create, args=(create_request(name=name),)) for name in names]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(character.name for character in store.collection().items) == names
    assert len(read_file(app_paths.characters_file)["items"]) == len(names)


# ---------------------------------------------------------------------------
# Active character
# ---------------------------------------------------------------------------


def test_set_active_and_its_reset_when_the_active_character_is_deleted(
    store: CharacterStore, app_paths: AppPaths
) -> None:
    aria = store.create(create_request(name="Aria"))
    bob = store.create(create_request(name="Bob"))

    assert store.set_active(aria.id) == CharacterCollection(items=[aria, bob], active_id=aria.id)
    assert read_file(app_paths.characters_file)["active_id"] == aria.id
    assert store.set_active(None).active_id is None
    with pytest.raises(CharacterNotFound):
        store.set_active("chr-000000000000")
    assert store.collection().active_id is None

    store.set_active(bob.id)
    store.delete(aria.id)  # not the active one: bob stays active
    assert store.collection() == CharacterCollection(items=[bob], active_id=bob.id)

    store.delete(bob.id)
    assert store.collection() == CharacterCollection(items=[], active_id=None)
    assert read_file(app_paths.characters_file)["active_id"] is None


# ---------------------------------------------------------------------------
# Image imports
# ---------------------------------------------------------------------------


def test_import_from_an_output_also_makes_the_thumbnail(
    store: CharacterStore, app_paths: AppPaths, make_output: OutputFactory
) -> None:
    make_output("0000000007")  # a 4x6 PNG

    character = store.create(create_request(from_output("0000000007")))

    (reference,) = character.reference_images
    assert re.fullmatch(CHARACTER_IMAGE_ID_PATTERN, reference.id)
    assert (reference.width, reference.height, reference.source) == (4, 6, from_output("0000000007"))
    assert reference.added_at.tzinfo is not None
    thumbnail = character.thumbnail
    assert thumbnail is not None and thumbnail.id != reference.id
    assert (thumbnail.width, thumbnail.height) == (4, 6)
    assert thumbnail.source == from_character_image(reference.id)
    assert stored_files(app_paths) == sorted([f"{reference.id}.png", f"{thumbnail.id}.png"])
    with Image.open(store.image_path(character.id, reference.id)) as image:
        assert image.getpixel((0, 0)) == (10, 20, 30)


def test_import_from_an_unknown_output_is_source_not_found(store: CharacterStore, make_output: OutputFactory) -> None:
    make_output("0000000001", png=False)

    with pytest.raises(CharacterSourceNotFound, match="0000000001"):
        store.create(create_request(from_output("0000000001")))
    with pytest.raises(CharacterSourceNotFound):
        store.create(create_request(from_output("0000000099")))
    assert store.collection().items == []


def test_import_from_files(store: CharacterStore, pictures: Path) -> None:
    landscape_exif = Image.Exif()
    landscape_exif[0x0112] = 6  # Orientation: rotate 90 degrees clockwise to display
    jpeg = image_file(pictures, "photo.jpg", (40, 20), format="JPEG", exif=landscape_exif.tobytes())
    png = image_file(pictures, "transparent.png", (30, 10), mode="RGBA")
    webp = image_file(pictures, "picture.webp", (12, 8), format="WEBP")
    bmp = image_file(pictures, "picture.bmp", (8, 12), format="BMP")

    character = store.create(create_request(from_file(jpeg), from_file(png), from_file(webp), from_file(bmp)))

    # The EXIF orientation is applied; every image is stored as an RGB PNG.
    assert [(image.width, image.height) for image in character.reference_images] == [(20, 40), (30, 10), (12, 8), (8, 12)]
    assert [image.source for image in character.reference_images] == [
        from_file(jpeg),
        from_file(png),
        from_file(webp),
        from_file(bmp),
    ]
    for image in character.reference_images:
        assert png_size(store.image_path(character.id, image.id)) == (image.width, image.height)


def test_import_from_files_refuses_missing_and_unusable_files(
    store: CharacterStore, pictures: Path, app_paths: AppPaths
) -> None:
    text = pictures / "notes.png"
    text.write_text("not an image", encoding="utf-8")
    gif = image_file(pictures, "anim.gif", format="GIF")

    with pytest.raises(CharacterSourceNotFound, match="missing.png"):
        store.create(create_request(from_file(pictures / "missing.png")))
    with pytest.raises(CharacterSourceNotFound):
        store.create(create_request(from_file(pictures)))  # a folder is not an image file
    with pytest.raises(CharacterImageError, match="not a readable image"):
        store.create(create_request(from_file(text)))
    with pytest.raises(CharacterImageError, match="GIF"):
        store.create(create_request(from_file(gif)))
    assert store.collection().items == []
    assert stored_files(app_paths) == []


def test_import_from_a_url(store: CharacterStore, fake_http: FakeHttp) -> None:
    fake_http.add("GET", IMAGE_URL, content=image_bytes((50, 70), format="JPEG"), headers={"Content-Type": "image/jpeg"})
    url = f"{IMAGE_URL}?sig={SECRET}"

    character = store.create(create_request(from_url(url)))

    (reference,) = character.reference_images
    assert (reference.width, reference.height, reference.source) == (50, 70, from_url(url))
    (request,) = fake_http.requests_to(IMAGE_URL)
    assert request.url.params["sig"] == SECRET


def test_url_download_errors_never_quote_the_query(store: CharacterStore, fake_http: FakeHttp) -> None:
    url = f"{IMAGE_URL}?sig={SECRET}"
    fake_http.add("GET", IMAGE_URL, status=404, content=b"gone")

    with pytest.raises(CharacterImageFetchError) as not_found:
        store.create(create_request(from_url(url)))

    assert str(not_found.value) == f"Downloading {IMAGE_URL} failed: HTTP 404."

    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.url}", request=request)

    fake_http.add("GET", IMAGE_URL, handler=unreachable)

    with pytest.raises(CharacterImageFetchError) as network:
        store.create(create_request(from_url(f"https://user:{SECRET}@images.example/42/original.jpeg?sig={SECRET}")))

    assert str(network.value) == f"Downloading {IMAGE_URL} failed: Could not connect to the server."
    assert SECRET not in str(network.value)
    assert store.collection().items == []


def test_url_bodies_must_be_small_images(
    store: CharacterStore, fake_http: FakeHttp, monkeypatch: pytest.MonkeyPatch, app_paths: AppPaths
) -> None:
    monkeypatch.setattr(characters_module, "MAX_IMAGE_DOWNLOAD_BYTES", 1000)
    big = image_bytes((64, 64), format="BMP")  # > 1000 bytes
    assert len(big) > 1000

    fake_http.add("GET", IMAGE_URL, content=big)
    with pytest.raises(CharacterImageError, match="larger than"):
        store.create(create_request(from_url()))

    # Without a Content-Length (chunked), the limit applies to the bytes received.
    fake_http.add("GET", IMAGE_URL, content=iter([big[:600], big[600:]]))
    with pytest.raises(CharacterImageError, match="larger than"):
        store.create(create_request(from_url()))

    fake_http.add("GET", IMAGE_URL, content=b"<html>login</html>")
    with pytest.raises(CharacterImageError, match="not a readable image"):
        store.create(create_request(from_url()))
    assert store.collection().items == []
    assert stored_files(app_paths) == []


def test_character_image_sources_copy_an_image_of_the_same_character(
    store: CharacterStore, pictures: Path, app_paths: AppPaths
) -> None:
    character = store.create(create_request(from_file(image_file(pictures, "a.png", (40, 30)))))
    other = store.create(create_request(from_file(image_file(pictures, "b.png")), name="Other"))
    reference = character.reference_images[0]
    old_thumbnail = character.thumbnail
    assert old_thumbnail is not None

    updated = store.set_thumbnail(character.id, from_character_image(reference.id))

    thumbnail = updated.thumbnail
    assert thumbnail is not None and thumbnail.id not in (reference.id, old_thumbnail.id)
    assert (thumbnail.width, thumbnail.height, thumbnail.source) == (40, 30, from_character_image(reference.id))
    assert not (app_paths.character_images_dir / f"{old_thumbnail.id}.png").exists()  # replaced
    # The image of another character, or an unknown one, cannot be copied.
    with pytest.raises(CharacterSourceNotFound):
        store.set_thumbnail(character.id, from_character_image(other.reference_images[0].id))
    with pytest.raises(CharacterSourceNotFound):
        store.add_reference_image(character.id, from_character_image("img-000000000000"))
    # A new character has no image yet.
    with pytest.raises(CharacterImageError):
        store.create(create_request(from_character_image(reference.id), name="Copy"))
    assert [item.name for item in store.collection().items] == [character.name, other.name]


@pytest.mark.parametrize(
    ("size", "reference_size", "thumbnail_size"),
    [
        ((2048, 1024), (REFERENCE_IMAGE_MAX_SIDE, 512), (THUMBNAIL_MAX_SIDE, 192)),
        ((600, 1200), (512, REFERENCE_IMAGE_MAX_SIDE), (192, THUMBNAIL_MAX_SIDE)),
        ((200, 100), (200, 100), (200, 100)),  # never upscaled
    ],
)
def test_images_are_downscaled_keeping_the_aspect_ratio(
    store: CharacterStore,
    pictures: Path,
    size: tuple[int, int],
    reference_size: tuple[int, int],
    thumbnail_size: tuple[int, int],
) -> None:
    source = from_file(image_file(pictures, "big.png", size))

    character = store.create(create_request(source))

    (reference,) = character.reference_images
    thumbnail = character.thumbnail
    assert thumbnail is not None
    assert (reference.width, reference.height) == reference_size
    assert (thumbnail.width, thumbnail.height) == thumbnail_size
    assert png_size(store.image_path(character.id, reference.id)) == reference_size
    assert png_size(store.image_path(character.id, thumbnail.id)) == thumbnail_size
    # set_thumbnail downscales to the thumbnail size directly.
    replaced = store.set_thumbnail(character.id, source).thumbnail
    assert replaced is not None and (replaced.width, replaced.height) == thumbnail_size


def test_create_is_all_or_nothing(
    store: CharacterStore, pictures: Path, app_paths: AppPaths, fake_http: FakeHttp
) -> None:
    good = from_file(image_file(pictures, "good.png"))
    fake_http.add("GET", IMAGE_URL, status=500)

    with pytest.raises(CharacterSourceNotFound):
        store.create(create_request(good, from_file(pictures / "missing.png")))
    with pytest.raises(CharacterImageFetchError):
        store.create(create_request(good, from_url()))

    assert store.collection().items == []
    assert stored_files(app_paths) == []


# ---------------------------------------------------------------------------
# Reference images and thumbnail
# ---------------------------------------------------------------------------


def test_reference_images_are_appended_up_to_the_maximum(
    store: CharacterStore, pictures: Path, app_paths: AppPaths
) -> None:
    character = store.create(create_request())
    assert character.thumbnail is None
    sources = [from_file(image_file(pictures, f"{index}.png", (10 + index, 10))) for index in range(5)]

    first = store.add_reference_image(character.id, sources[0])

    # The first reference image also becomes the thumbnail of a character without one.
    (reference,) = first.reference_images
    assert first.thumbnail is not None and first.thumbnail.source == from_character_image(reference.id)
    assert first.updated_at >= character.updated_at
    for source in sources[1 : REFERENCE_DEFAULTS.max_images]:
        latest = store.add_reference_image(character.id, source)
        assert latest.thumbnail == first.thumbnail  # kept
    assert [image.width for image in latest.reference_images] == [10, 11, 12, 13]
    files = stored_files(app_paths)

    with pytest.raises(TooManyReferenceImages, match=str(REFERENCE_DEFAULTS.max_images)):
        store.add_reference_image(character.id, sources[-1])

    assert store.get(character.id) == latest
    assert stored_files(app_paths) == files
    # The create request holds at most max_images sources (validated by the schema).
    with pytest.raises(ValidationError):
        create_request(*sources)


def test_remove_reference_image_deletes_its_file_and_keeps_the_thumbnail(
    store: CharacterStore, pictures: Path, app_paths: AppPaths
) -> None:
    character = store.create(
        create_request(from_file(image_file(pictures, "a.png")), from_file(image_file(pictures, "b.png")))
    )
    first, second = character.reference_images
    thumbnail = character.thumbnail
    assert thumbnail is not None

    updated = store.remove_reference_image(character.id, first.id)

    assert updated.reference_images == [second]
    assert updated.thumbnail == thumbnail
    assert stored_files(app_paths) == sorted([f"{second.id}.png", f"{thumbnail.id}.png"])
    with pytest.raises(CharacterImageNotFound):
        store.remove_reference_image(character.id, first.id)
    with pytest.raises(CharacterImageNotFound):
        store.remove_reference_image(character.id, thumbnail.id)  # the thumbnail is not a reference image


def test_clear_thumbnail(store: CharacterStore, pictures: Path, app_paths: AppPaths) -> None:
    character = store.create(create_request(from_file(image_file(pictures, "a.png"))))
    thumbnail = character.thumbnail
    assert thumbnail is not None

    cleared = store.clear_thumbnail(character.id)

    assert cleared.thumbnail is None
    assert cleared.reference_images == character.reference_images
    assert stored_files(app_paths) == [f"{character.reference_images[0].id}.png"]
    assert store.clear_thumbnail(character.id) == cleared  # nothing to clear
    with pytest.raises(CharacterImageNotFound):
        store.image_path(character.id, thumbnail.id)


def test_delete_removes_every_image_file(store: CharacterStore, pictures: Path, app_paths: AppPaths) -> None:
    kept = store.create(create_request(from_file(image_file(pictures, "kept.png")), name="Kept"))
    deleted = store.create(
        create_request(from_file(image_file(pictures, "a.png")), from_file(image_file(pictures, "b.png")))
    )
    kept_files = stored_files(app_paths)
    assert len(kept_files) == 5

    store.delete(deleted.id)

    assert stored_files(app_paths) == sorted(
        f"{image.id}.png" for image in [*kept.reference_images, kept.thumbnail] if image is not None
    )


def test_image_path_serves_references_and_the_thumbnail(
    store: CharacterStore, pictures: Path, app_paths: AppPaths
) -> None:
    character = store.create(create_request(from_file(image_file(pictures, "a.png"))))
    (reference,) = character.reference_images
    assert character.thumbnail is not None

    assert store.image_path(character.id, reference.id) == app_paths.character_images_dir / f"{reference.id}.png"
    assert store.image_path(character.id, character.thumbnail.id) == (
        app_paths.character_images_dir / f"{character.thumbnail.id}.png"
    )
    with pytest.raises(CharacterImageNotFound):
        store.image_path(character.id, "img-000000000000")

    (app_paths.character_images_dir / f"{reference.id}.png").unlink()  # deleted behind the app's back

    with pytest.raises(CharacterImageNotFound, match="missing"):
        store.image_path(character.id, reference.id)


def test_reference_image_paths_are_in_order_and_skip_missing_files(
    store: CharacterStore, pictures: Path, app_paths: AppPaths
) -> None:
    character = store.create(
        create_request(*(from_file(image_file(pictures, f"{index}.png")) for index in range(3)))
    )
    paths = [app_paths.character_images_dir / f"{image.id}.png" for image in character.reference_images]

    assert store.reference_image_paths(character) == paths

    paths[1].unlink()

    assert store.reference_image_paths(character) == [paths[0], paths[2]]
