"""GET /api/bootstrap and the legacy app_state.json / library.json service."""

from collections.abc import Callable

from fastapi.testclient import TestClient

from app.schemas import AppState, LibraryState
from app.services.legacy_state import (
    DEFAULT_LIBRARY,
    DEFAULT_STATE,
    LegacyStateService,
    strip_missing_lora_references,
)
from app.settings import AppPaths

from support import OutputFactory, load_fixture, write_json_file

# ---------------------------------------------------------------------------
# LegacyStateService
# ---------------------------------------------------------------------------


def test_defaults_when_the_legacy_files_are_missing(app_paths: AppPaths) -> None:
    service = LegacyStateService(app_paths)

    assert service.load_state() == AppState.model_validate(DEFAULT_STATE)
    assert service.load_library() == LibraryState.model_validate(DEFAULT_LIBRARY)
    assert not app_paths.root.exists()


def test_reads_the_real_legacy_formats(app_paths: AppPaths, install_legacy_files: Callable[[], None]) -> None:
    install_legacy_files()
    service = LegacyStateService(app_paths)

    state = service.load_state()
    library = service.load_library()

    main, day_moment = state.categories
    assert main.locked_prompt_id == "style-1"
    assert main.prompts[1].skipped is True
    assert day_moment.muted is True
    assert day_moment.activation_text == "sunrise"
    assert state.forbidden_rules[0].right.contains_text == "sunrise"
    assert state.image_seed_behavior == "increment"
    # The "used" pane is absent from the real file: filled with its default layout.
    assert state.workspace.used.width == 790
    assert [model.id for model in library.models] == ["example-model-safetensors"]
    assert [lora.id for lora in library.loras] == ["kept-lora"]


def test_json_null_files_fall_back_to_the_defaults(app_paths: AppPaths) -> None:
    write_json_file(app_paths.state_file, None)
    write_json_file(app_paths.library_file, None)
    service = LegacyStateService(app_paths)

    assert service.load_state().categories[0].id == "subject"
    assert service.load_library().models == []


def test_load_state_recovers_from_an_interrupted_write(app_paths: AppPaths) -> None:
    write_json_file(app_paths.state_file.with_name("app_state.json.new"), {"width": 1536})

    assert LegacyStateService(app_paths).load_state().width == 1536
    assert app_paths.state_file.exists()


def test_bootstrap_state_strips_lora_ids_missing_from_the_library(
    app_paths: AppPaths, install_legacy_files: Callable[[], None]
) -> None:
    install_legacy_files()
    service = LegacyStateService(app_paths)

    state = service.load_state_for_bootstrap()

    assert state.last_lora_ids == ["kept-lora"]
    assert state.categories[0].prompts[0].extra_lora_ids == ["kept-lora"]
    assert state.categories[1].prompts[0].extra_lora_ids == []
    # The file itself is left untouched.
    assert service.load_state().last_lora_ids == ["deleted-lora", "kept-lora"]


def test_strip_missing_lora_references_keeps_order_and_does_not_mutate() -> None:
    state = AppState.model_validate(
        {
            "last_lora_ids": ["b", "x", "a"],
            "categories": [{"id": "c", "name": "C", "prompts": [{"text": "t", "extra_lora_ids": ["x", "a", "b"]}]}],
        }
    )
    library = LibraryState.model_validate(
        {"loras": [{"id": "a", "name": "a", "path": "a"}, {"id": "b", "name": "b", "path": "b"}]}
    )

    stripped = strip_missing_lora_references(state, library)

    assert stripped.last_lora_ids == ["b", "a"]
    assert stripped.categories[0].prompts[0].extra_lora_ids == ["a", "b"]
    assert state.last_lora_ids == ["b", "x", "a"]
    assert state.categories[0].prompts[0].extra_lora_ids == ["x", "a", "b"]


# ---------------------------------------------------------------------------
# GET /api/bootstrap
# ---------------------------------------------------------------------------


def test_bootstrap_on_an_empty_data_dir(client: TestClient, app_paths: AppPaths) -> None:
    body = client.get("/api/bootstrap").json()

    assert body["data_dir"] == str(app_paths.root)
    assert body["legacy_state"] == AppState.model_validate(DEFAULT_STATE).model_dump(mode="json")
    assert body["legacy_library"] == {"models": [], "loras": []}
    assert body["persisted_stores"] == []
    assert body["output_ids"] == []
    assert body["current_output_id"] is None


def test_bootstrap_with_legacy_files_stores_and_outputs(
    client: TestClient,
    app_paths: AppPaths,
    install_legacy_files: Callable[[], None],
    make_output: OutputFactory,
) -> None:
    install_legacy_files()
    for output_id in ("0000000001", "0000000002", "0000000003"):
        make_output(output_id)
    write_json_file(app_paths.stores_dir / "current-image-store" / "state.json", {"state": {"currentName": None}, "version": 0})
    write_json_file(app_paths.stores_dir / "settings-store" / "state.json", None)
    (app_paths.stores_dir / "outputs-store").mkdir(parents=True)

    body = client.get("/api/bootstrap").json()

    assert body["legacy_state"]["last_lora_ids"] == ["kept-lora"]
    assert body["legacy_state"]["categories"][0]["prompts"][0]["extra_lora_ids"] == ["kept-lora"]
    assert body["legacy_library"] == load_fixture("legacy/library.json")
    assert body["persisted_stores"] == ["current-image-store"]
    assert body["output_ids"] == ["0000000001", "0000000002", "0000000003"]
    # app_state.json's last_output_id still exists: preferred over the latest output.
    assert body["current_output_id"] == "0000000002"


def test_bootstrap_falls_back_to_the_latest_output(
    client: TestClient,
    app_paths: AppPaths,
    install_legacy_files: Callable[[], None],
    make_output: OutputFactory,
) -> None:
    install_legacy_files()  # last_output_id = 0000000002
    make_output("0000000001")
    make_output("0000000002", png=False)  # incomplete: not an output anymore
    make_output("0000000005")

    body = client.get("/api/bootstrap").json()

    assert body["output_ids"] == ["0000000001", "0000000005"]
    assert body["current_output_id"] == "0000000005"
