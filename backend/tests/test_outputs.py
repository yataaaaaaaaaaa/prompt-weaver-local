"""Output files: OutputRepository and the /api/outputs + /api/trash endpoints."""

import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.schemas import OutputRecord
from app.services.outputs import OUTPUT_THUMBNAIL_MAX_SIDE, OutputNotFound, OutputRepository
from app.settings import AppPaths

from support import OutputFactory, load_fixture

# ---------------------------------------------------------------------------
# OutputRepository
# ---------------------------------------------------------------------------


def test_list_ids_keeps_complete_numeric_pairs_only(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000003")
    make_output("0000000001")
    make_output("0000000002", png=False)
    make_output("0000000004", metadata=False)
    (app_paths.output_dir / "notes.png").write_bytes(b"x")
    (app_paths.output_dir / "notes.json").write_text("{}", encoding="utf-8")
    (app_paths.output_dir / "123.png").write_bytes(b"x")
    (app_paths.output_dir / "123.json").write_text("{}", encoding="utf-8")
    (app_paths.output_dir / "0000000009.json.new").write_text("{}", encoding="utf-8")
    (app_paths.output_dir / "0000000010.png").mkdir()
    (app_paths.output_dir / "0000000010.json").write_text("{}", encoding="utf-8")

    repository = OutputRepository(app_paths)

    assert repository.list_ids() == ["0000000001", "0000000003"]
    assert repository.latest_id() == "0000000003"


def test_list_ids_reads_file_names_only(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")
    (app_paths.output_dir / "0000000001.json").write_text("{corrupt", encoding="utf-8")

    assert OutputRepository(app_paths).list_ids() == ["0000000001"]


def test_missing_output_dir_means_no_outputs(app_paths: AppPaths) -> None:
    repository = OutputRepository(app_paths)

    assert repository.list_ids() == []
    assert repository.latest_id() is None
    assert repository.next_id() == "0000000001"


def test_load_returns_the_metadata(app_paths: AppPaths, make_output: OutputFactory) -> None:
    expected = make_output("0000000007")

    record = OutputRepository(app_paths).load("0000000007")

    assert record == OutputRecord.model_validate(expected)
    assert record.selections[0].locked is True


def test_load_migrates_the_legacy_lora_ids_of_real_output_files(app_paths: AppPaths, make_output: OutputFactory) -> None:
    # make_output writes the real pre-weights format (`active_lora_ids: []`).
    assert make_output("0000000001")["active_lora_ids"] == []

    record = OutputRepository(app_paths).load("0000000001")

    assert record.active_loras == []
    assert "active_lora_ids" not in record.model_dump()


def test_save_and_load_keep_the_lora_weights(app_paths: AppPaths) -> None:
    metadata = load_fixture("outputs/metadata_lora_weights.json")
    del metadata["image_path"], metadata["metadata_path"]
    repository = OutputRepository(app_paths)

    saved = repository.save(Image.new("RGB", (3, 2)), metadata)

    expected = [("add-detail", 0.6), ("film-grain", -1.25)]
    assert [(item.id, item.weight) for item in saved.active_loras] == expected
    assert [(item.id, item.weight) for item in repository.load("0000000002").active_loras] == expected


def test_load_and_image_path_raise_output_not_found(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001", png=False)
    repository = OutputRepository(app_paths)

    with pytest.raises(OutputNotFound):
        repository.load("0000000002")
    with pytest.raises(OutputNotFound):
        repository.image_path("0000000001")


@pytest.mark.parametrize("bad_id", ["1", "../app_state", "000000000a", "00000000001"])
def test_repository_rejects_invalid_ids(app_paths: AppPaths, bad_id: str) -> None:
    with pytest.raises(ValueError):
        OutputRepository(app_paths).load(bad_id)


def test_next_id_accounts_for_trash_and_orphans(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000002")
    make_output("0000000009", in_trash=True)
    repository = OutputRepository(app_paths)
    assert repository.next_id() == "0000000010"

    make_output("0000000011", png=False)  # orphaned metadata must never be overwritten
    assert repository.next_id() == "0000000012"


def test_save_writes_png_and_metadata(app_paths: AppPaths) -> None:
    metadata = load_fixture("outputs/metadata.json")
    del metadata["image_path"], metadata["metadata_path"]
    metadata["output_id"] = "0000000042"
    repository = OutputRepository(app_paths)

    record = repository.save(Image.new("RGB", (3, 2)), metadata)

    image_path = app_paths.output_dir / "0000000042.png"
    metadata_path = app_paths.output_dir / "0000000042.json"
    assert record.image_path == str(image_path)
    assert record.metadata_path == str(metadata_path)
    with Image.open(image_path) as image:
        assert image.size == (3, 2)
    assert repository.load("0000000042") == record
    assert repository.list_ids() == ["0000000042"]


def test_trash_and_restore_move_both_files(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")
    repository = OutputRepository(app_paths)

    repository.trash("0000000001")
    assert repository.list_ids() == []
    assert sorted(path.name for path in app_paths.trash_dir.iterdir()) == ["0000000001.json", "0000000001.png"]

    repository.restore("0000000001")
    assert repository.list_ids() == ["0000000001"]
    assert list(app_paths.trash_dir.iterdir()) == []


def test_trash_moves_an_incomplete_pair(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001", metadata=False)

    OutputRepository(app_paths).trash("0000000001")

    assert [path.name for path in app_paths.trash_dir.iterdir()] == ["0000000001.png"]


def test_trash_and_restore_raise_when_nothing_to_move(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")
    repository = OutputRepository(app_paths)

    with pytest.raises(OutputNotFound):
        repository.trash("0000000002")
    with pytest.raises(OutputNotFound):
        repository.restore("0000000001")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


def test_list_outputs_endpoint(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000002")
    make_output("0000000001")
    make_output("0000000003", png=False)

    assert client.get("/api/outputs").json() == {"ids": ["0000000001", "0000000002"]}


def test_get_output_endpoint(client: TestClient, make_output: OutputFactory) -> None:
    expected = make_output("0000000001")

    response = client.get("/api/outputs/0000000001")

    assert response.status_code == 200
    assert response.json() == OutputRecord.model_validate(expected).model_dump(mode="json")


def test_get_unknown_output_is_404(client: TestClient) -> None:
    response = client.get("/api/outputs/0000000001")

    assert response.status_code == 404
    assert response.json() == {"detail": "Unknown output '0000000001'."}


def test_output_image_endpoint(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000001")

    response = client.get("/api/outputs/0000000001/image")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (4, 6)


def test_output_thumbnail_endpoint_serves_a_cached_webp(client: TestClient, app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")

    response = client.get("/api/outputs/0000000001/thumbnail")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.format == "WEBP"
        assert image.size == (4, 6)
    assert (app_paths.output_thumbnails_dir / "0000000001.webp").is_file()


def test_output_thumbnail_without_png_is_404(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000001", png=False)

    assert client.get("/api/outputs/0000000001/thumbnail").status_code == 404
    assert client.get("/api/outputs/123/thumbnail").status_code == 422


def test_thumbnail_is_downscaled_and_reused_while_the_picture_is_unchanged(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")
    picture = app_paths.output_dir / "0000000001.png"
    Image.new("RGB", (1024, 512), (200, 10, 10)).save(picture)
    repository = OutputRepository(app_paths)

    first = repository.thumbnail_path("0000000001")
    with Image.open(first) as thumbnail:
        assert thumbnail.size == (OUTPUT_THUMBNAIL_MAX_SIDE, OUTPUT_THUMBNAIL_MAX_SIDE // 2)
    written_at = first.stat().st_mtime_ns

    assert repository.thumbnail_path("0000000001") == first
    assert first.stat().st_mtime_ns == written_at
    assert not first.with_name(f"{first.name}.new").exists()


def test_thumbnail_is_rebuilt_when_the_picture_is_newer(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")
    repository = OutputRepository(app_paths)
    thumbnail = repository.thumbnail_path("0000000001")
    picture = app_paths.output_dir / "0000000001.png"
    Image.new("RGB", (300, 600), (0, 0, 0)).save(picture)
    later = thumbnail.stat().st_mtime_ns + 1_000_000_000
    os.utime(picture, ns=(later, later))

    with Image.open(repository.thumbnail_path("0000000001")) as rebuilt:
        assert rebuilt.size == (128, OUTPUT_THUMBNAIL_MAX_SIDE)


def test_trashed_output_has_no_thumbnail(app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001", in_trash=True)

    with pytest.raises(OutputNotFound):
        OutputRepository(app_paths).thumbnail_path("0000000001")


def test_output_image_without_png_is_404(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000001", png=False)

    assert client.get("/api/outputs/0000000001/image").status_code == 404


@pytest.mark.parametrize(
    "url",
    [
        "/api/outputs/123",
        "/api/outputs/00000000ab",
        "/api/outputs/123/image",
        "/api/outputs/123/trash",
        "/api/trash/123/restore",
    ],
)
def test_invalid_output_ids_are_rejected(client: TestClient, url: str) -> None:
    method = client.post if url.endswith(("trash", "restore")) else client.get

    assert method(url).status_code == 422


def test_trash_then_restore_endpoints(client: TestClient, app_paths: AppPaths, make_output: OutputFactory) -> None:
    make_output("0000000001")
    make_output("0000000002")

    assert client.post("/api/outputs/0000000002/trash").json() == {"ok": True}
    assert client.get("/api/outputs").json() == {"ids": ["0000000001"]}
    assert (app_paths.trash_dir / "0000000002.png").exists()
    assert (app_paths.trash_dir / "0000000002.json").exists()
    assert client.get("/api/outputs/0000000002").status_code == 404

    assert client.post("/api/trash/0000000002/restore").json() == {"ok": True}
    assert client.get("/api/outputs").json() == {"ids": ["0000000001", "0000000002"]}
    assert client.get("/api/outputs/0000000002").status_code == 200


def test_trash_and_restore_404s(client: TestClient, make_output: OutputFactory) -> None:
    make_output("0000000001")

    assert client.post("/api/outputs/0000000009/trash").status_code == 404
    response = client.post("/api/trash/0000000001/restore")
    assert response.status_code == 404
    assert response.json() == {"detail": "Output '0000000001' is not in the trash."}
