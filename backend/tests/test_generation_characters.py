"""Generation with a character (GenerateRequest.character_id): its reference images go to the generator through the
IP-Adapter resolved for the model + the character's focus, and the output records OutputRecord.character.

Unit tests use fakes for the CharacterLookup and IpAdapterResolver ports; the API tests use the real CharacterStore
with a patched IpAdapterService.resolve (implemented and tested in services/ip_adapters.py)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.schemas import (
    Character,
    CharacterImage,
    GenerateRequest,
    GenerationTaskEvent,
    OutputCharacter,
    OutputImageSource,
    OutputReference,
    ReferenceFocus,
    ReferenceSupport,
)
from app.services.characters import CharacterNotFound, CharactersFileError
from app.services.generation import (
    NO_IP_ADAPTERS_REASON,
    NO_REFERENCE_IMAGES_REASON,
    GenerationFailed,
    GenerationService,
    ReferenceInput,
)
from app.services.ip_adapters import IpAdapterResolution
from app.services.outputs import OutputRepository
from app.settings import AppPaths
from support import (
    GENERATE_REQUEST,
    LEGACY_METADATA_KEYS,
    SDXL_MODEL,
    TINY_CATALOG,
    TINY_ENCODER,
    TINY_FACE,
    CountingFactory,
    FakeGenerator,
    OutputFactory,
    RecordingTaskHub,
    fake_architecture_of,
    put_tiny,
)

NOW = datetime(2026, 11, 20, 9, 15, tzinfo=UTC)
ADAPTER = Path("C:/models/ipadapter/ip-adapter-plus-face_sdxl_vit-h.safetensors")
IMAGE_ENCODER = Path("C:/models/clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors")
NOT_INSTALLED = "Install the SDXL face IP-Adapter to apply reference images."


def reference_image(image_id: str) -> CharacterImage:
    return CharacterImage(
        id=image_id, width=8, height=8, source=OutputImageSource(kind="output", output_id="0000000001"), added_at=NOW
    )


ARIA = Character(
    id="chr-1a2b3c4d5e6f",
    name="Aria",
    identity_tags=["1girl", "silver hair"],
    reference_strength=0.7,
    reference_focus="face",
    reference_images=[reference_image("img-000000000001"), reference_image("img-000000000002")],
    created_at=NOW,
    updated_at=NOW,
)


def ready(focus: ReferenceFocus = "face") -> IpAdapterResolution:
    return IpAdapterResolution(
        support=ReferenceSupport(focus=focus, variant_id=f"sdxl-{focus}", ready=True, reason=None),
        architecture="sdxl",
        adapter_path=ADAPTER,
        image_encoder_path=IMAGE_ENCODER,
    )


def not_ready(reason: str = NOT_INSTALLED) -> IpAdapterResolution:
    return IpAdapterResolution(
        support=ReferenceSupport(focus="face", variant_id="sdxl-face", ready=False, reason=reason),
        architecture="sdxl",
        adapter_path=None,
        image_encoder_path=None,
    )


@dataclass
class FakeCharacters:
    """CharacterLookup double: `paths` per character id answer reference_image_paths; `error` is raised by get()."""

    characters: dict[str, Character] = field(default_factory=dict)
    paths: dict[str, list[Path]] = field(default_factory=dict)
    error: Exception | None = None

    def get(self, character_id: str) -> Character:
        if self.error is not None:
            raise self.error
        try:
            return self.characters[character_id]
        except KeyError:
            raise CharacterNotFound(f"Unknown character {character_id}.") from None

    def reference_image_paths(self, character: Character) -> list[Path]:
        return list(self.paths.get(character.id, []))


@dataclass
class FakeResolver:
    """IpAdapterResolver double answering `resolution` and recording the (model_path, focus) calls."""

    resolution: IpAdapterResolution = field(default_factory=ready)
    calls: list[tuple[str, ReferenceFocus]] = field(default_factory=list)

    def resolve(self, model_path: str, focus: ReferenceFocus) -> IpAdapterResolution:
        self.calls.append((model_path, focus))
        return self.resolution


@pytest.fixture()
def hub() -> RecordingTaskHub:
    return RecordingTaskHub()


@pytest.fixture()
def reference_paths(tmp_path: Path) -> list[Path]:
    """Aria's reference image files (named by image id, like the CharacterStore's)."""
    folder = tmp_path / "character-images"
    folder.mkdir()
    return [folder / f"{image.id}.png" for image in ARIA.reference_images]


@pytest.fixture()
def characters(reference_paths: list[Path]) -> FakeCharacters:
    return FakeCharacters(characters={ARIA.id: ARIA}, paths={ARIA.id: reference_paths})


@pytest.fixture()
def resolver() -> FakeResolver:
    return FakeResolver()


@pytest.fixture()
def service(
    app_paths: AppPaths,
    hub: RecordingTaskHub,
    generator_factory: CountingFactory,
    characters: FakeCharacters,
    resolver: FakeResolver,
) -> GenerationService:
    return GenerationService(
        paths=app_paths,
        outputs=OutputRepository(app_paths),
        tasks=hub,
        generator_factory=generator_factory,
        characters=characters,
        ip_adapters=resolver,
    )


def request(**overrides: Any) -> GenerateRequest:
    return GenerateRequest.model_validate({**GENERATE_REQUEST, **overrides})


def metadata_on_disk(paths: AppPaths, output_id: str) -> dict[str, Any]:
    return json.loads((paths.output_dir / f"{output_id}.json").read_text(encoding="utf-8"))


def test_ready_references_go_to_the_generator_and_are_recorded(
    service: GenerationService,
    app_paths: AppPaths,
    fake_generator: FakeGenerator,
    resolver: FakeResolver,
    hub: RecordingTaskHub,
    reference_paths: list[Path],
) -> None:
    record = service.generate(request(character_id=ARIA.id))

    assert resolver.calls == [(GENERATE_REQUEST["model"]["path"], "face")]
    assert fake_generator.calls[-1].reference == ReferenceInput(
        adapter_path=ADAPTER,
        image_encoder_path=IMAGE_ENCODER,
        image_paths=tuple(reference_paths),
        strength=0.7,
        architecture="sdxl",
    )
    expected = OutputCharacter(
        id=ARIA.id,
        name="Aria",
        reference=OutputReference(
            applied=True,
            variant_id="sdxl-face",
            strength=0.7,
            image_ids=["img-000000000001", "img-000000000002"],
            reason=None,
        ),
    )
    on_disk = metadata_on_disk(app_paths, record.output_id)
    assert set(on_disk) == LEGACY_METADATA_KEYS | {"character"}
    assert on_disk["character"] == expected.model_dump(mode="json")
    assert record.character == expected
    assert hub.published[0] == GenerationTaskEvent(
        stage="loading_model", message="Loading model, LoRAs and IP-Adapter for ExampleModel_v50.safetensors"
    )
    assert hub.stages()[-1] == "complete"


def test_the_characters_focus_picks_the_variant(
    service: GenerationService, characters: FakeCharacters, resolver: FakeResolver, fake_generator: FakeGenerator
) -> None:
    general = ARIA.model_copy(update={"reference_focus": "general", "reference_strength": 0.35})
    characters.characters[ARIA.id] = general
    resolver.resolution = ready("general")

    record = service.generate(request(character_id=ARIA.id))

    assert resolver.calls == [(GENERATE_REQUEST["model"]["path"], "general")]
    reference = fake_generator.calls[-1].reference
    assert reference is not None and reference.strength == 0.35
    assert record.character is not None
    assert (record.character.reference.variant_id, record.character.reference.strength) == ("sdxl-general", 0.35)


def test_references_not_ready_are_not_applied_and_the_reason_is_recorded(
    service: GenerationService,
    app_paths: AppPaths,
    fake_generator: FakeGenerator,
    resolver: FakeResolver,
    hub: RecordingTaskHub,
) -> None:
    resolver.resolution = not_ready()

    record = service.generate(request(character_id=ARIA.id))

    assert fake_generator.calls[-1].reference is None
    expected = OutputReference(applied=False, variant_id=None, strength=None, image_ids=[], reason=NOT_INSTALLED)
    assert record.character == OutputCharacter(id=ARIA.id, name="Aria", reference=expected)
    assert metadata_on_disk(app_paths, record.output_id)["character"]["reference"] == expected.model_dump(mode="json")
    assert hub.published[0].message == "Loading model and LoRAs for ExampleModel_v50.safetensors"


def test_a_character_without_reference_images(
    service: GenerationService,
    characters: FakeCharacters,
    resolver: FakeResolver,
    fake_generator: FakeGenerator,
) -> None:
    characters.paths[ARIA.id] = []

    record = service.generate(request(character_id=ARIA.id))

    assert resolver.calls == []
    assert fake_generator.calls[-1].reference is None
    assert record.character is not None
    assert record.character.reference == OutputReference(
        applied=False, variant_id=None, strength=None, image_ids=[], reason=NO_REFERENCE_IMAGES_REASON
    )


def test_reference_files_missing_on_disk_are_not_recorded_as_used(
    service: GenerationService,
    characters: FakeCharacters,
    fake_generator: FakeGenerator,
    reference_paths: list[Path],
) -> None:
    characters.paths[ARIA.id] = reference_paths[1:]  # the lookup skipped the first (missing) file

    record = service.generate(request(character_id=ARIA.id))

    reference = fake_generator.calls[-1].reference
    assert reference is not None and reference.image_paths == (reference_paths[1],)
    assert record.character is not None and record.character.reference.image_ids == ["img-000000000002"]


def test_without_ip_adapters_references_are_not_applied(
    app_paths: AppPaths,
    hub: RecordingTaskHub,
    generator_factory: CountingFactory,
    characters: FakeCharacters,
    fake_generator: FakeGenerator,
) -> None:
    service = GenerationService(
        paths=app_paths,
        outputs=OutputRepository(app_paths),
        tasks=hub,
        generator_factory=generator_factory,
        characters=characters,
    )

    record = service.generate(request(character_id=ARIA.id))

    assert fake_generator.calls[-1].reference is None
    assert record.character is not None and record.character.reference.reason == NO_IP_ADAPTERS_REASON


def test_an_unknown_character_fails_before_loading_anything(
    service: GenerationService,
    hub: RecordingTaskHub,
    generator_factory: CountingFactory,
    resolver: FakeResolver,
    app_paths: AppPaths,
) -> None:
    with pytest.raises(GenerationFailed, match="Unknown character chr-000000000000"):
        service.generate(request(character_id="chr-000000000000"))

    assert hub.published == [GenerationTaskEvent(stage="error", message="Unknown character chr-000000000000.")]
    assert (generator_factory.calls, resolver.calls) == (0, [])
    assert OutputRepository(app_paths).list_ids() == []


def test_a_character_fails_without_the_characters_service(
    app_paths: AppPaths, hub: RecordingTaskHub, generator_factory: CountingFactory
) -> None:
    service = GenerationService(
        paths=app_paths, outputs=OutputRepository(app_paths), tasks=hub, generator_factory=generator_factory
    )

    with pytest.raises(GenerationFailed, match="Unknown character"):
        service.generate(request(character_id=ARIA.id))

    assert hub.stages() == ["error"]
    assert generator_factory.calls == 0


def test_an_unreadable_characters_file_fails_the_generation(
    service: GenerationService, characters: FakeCharacters, hub: RecordingTaskHub
) -> None:
    characters.error = CharactersFileError("characters.json is not valid JSON; it is left untouched.")

    with pytest.raises(GenerationFailed, match="characters.json"):
        service.generate(request(character_id=ARIA.id))

    assert hub.published[-1].stage == "error"


def test_without_a_character_nothing_changes(
    service: GenerationService, app_paths: AppPaths, fake_generator: FakeGenerator, resolver: FakeResolver
) -> None:
    record = service.generate(request())

    assert fake_generator.calls[-1].reference is None
    assert resolver.calls == []
    assert record.character is None
    # The metadata file keeps the legacy key set: no `character` key.
    assert set(metadata_on_disk(app_paths, record.output_id)) == LEGACY_METADATA_KEYS


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.fixture()
def patched_resolver(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> FakeResolver:
    """The app's IpAdapterService.resolve replaced by a FakeResolver (ready by default)."""
    fake = FakeResolver()
    monkeypatch.setattr(client.app.state.services.ip_adapters, "resolve", fake.resolve)  # type: ignore[attr-defined]
    return fake


def test_generate_endpoint_applies_the_characters_references(
    client: TestClient,
    make_output: OutputFactory,
    patched_resolver: FakeResolver,
    fake_generator: FakeGenerator,
    app_paths: AppPaths,
) -> None:
    make_output("0000000001")
    created = client.post(
        "/api/characters",
        json={
            "name": "Aria",
            "reference_strength": 0.55,
            "reference_sources": [{"kind": "output", "output_id": "0000000001"}],
        },
    ).json()
    (reference,) = created["reference_images"]

    response = client.post("/api/generate", json={**GENERATE_REQUEST, "character_id": created["id"]})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["character"] == {
        "id": created["id"],
        "name": "Aria",
        "reference": {
            "applied": True,
            "variant_id": "sdxl-face",
            "strength": 0.55,
            "image_ids": [reference["id"]],
            "reason": None,
        },
    }
    assert patched_resolver.calls == [(GENERATE_REQUEST["model"]["path"], "face")]
    passed = fake_generator.calls[-1].reference
    assert passed is not None
    assert passed.image_paths == (app_paths.character_images_dir / f"{reference['id']}.png",)
    assert (passed.adapter_path, passed.image_encoder_path, passed.strength) == (ADAPTER, IMAGE_ENCODER, 0.55)
    assert client.get(f"/api/outputs/{body['output_id']}").json() == body


def test_generate_endpoint_records_why_references_were_not_applied(
    client: TestClient, patched_resolver: FakeResolver, fake_generator: FakeGenerator
) -> None:
    created = client.post("/api/characters", json={"name": "Bob"}).json()

    body = client.post("/api/generate", json={**GENERATE_REQUEST, "character_id": created["id"]}).json()

    assert body["character"]["reference"] == {
        "applied": False,
        "variant_id": None,
        "strength": None,
        "image_ids": [],
        "reason": NO_REFERENCE_IMAGES_REASON,
    }
    assert fake_generator.calls[-1].reference is None
    assert client.get(f"/api/outputs/{body['output_id']}").json()["character"] == body["character"]


def test_generate_endpoint_with_an_unknown_character_is_409(
    client: TestClient, patched_resolver: FakeResolver, generator_factory: CountingFactory
) -> None:
    response = client.post("/api/generate", json={**GENERATE_REQUEST, "character_id": "chr-000000000000"})

    assert response.status_code == 409
    assert response.json() == {"detail": "Unknown character chr-000000000000."}
    (event,) = client.get("/api/tasks").json()["events"]
    assert (event["stage"], event["message"]) == ("error", "Unknown character chr-000000000000.")
    assert generator_factory.calls == 0
    assert client.get("/api/outputs").json() == {"ids": []}


def test_generate_endpoint_resolves_references_with_the_real_ip_adapter_service(
    client: TestClient,
    make_output: OutputFactory,
    fake_generator: FakeGenerator,
    app_paths: AppPaths,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The seam between generation and IpAdapterService.resolve, nothing patched but the catalog and the family
    detector: the reason of the real support rule while the files are missing, then the files on disk applied."""
    services = client.app.state.services  # type: ignore[attr-defined]
    monkeypatch.setattr(services.ip_adapters, "_catalog", TINY_CATALOG)
    monkeypatch.setattr(services.ip_adapters, "_architecture_of", fake_architecture_of)
    make_output("0000000001")
    created = client.post(
        "/api/characters", json={"name": "Aria", "reference_sources": [{"kind": "output", "output_id": "0000000001"}]}
    ).json()
    body = {**GENERATE_REQUEST, "model": {**GENERATE_REQUEST["model"], "path": SDXL_MODEL}, "character_id": created["id"]}

    missing = client.post("/api/generate", json=body).json()["character"]["reference"]
    assert missing == {
        "applied": False,
        "variant_id": None,
        "strength": None,
        "image_ids": [],
        "reason": "Download the IP-Adapter 'SDXL face' to use reference images.",
    }
    assert fake_generator.calls[-1].reference is None

    adapter = put_tiny(app_paths, TINY_FACE)
    encoder = put_tiny(app_paths, TINY_ENCODER)
    support = client.get("/api/ip-adapters", params={"model_path": SDXL_MODEL}).json()["support"]
    assert [(item["focus"], item["ready"]) for item in support] == [("face", True), ("general", False)]

    applied = client.post("/api/generate", json=body).json()["character"]["reference"]
    assert applied["applied"] is True
    assert applied["variant_id"] == "sdxl-face"
    passed = fake_generator.calls[-1].reference
    assert passed is not None
    assert (passed.adapter_path, passed.image_encoder_path, passed.architecture) == (adapter, encoder, "sdxl")
    assert passed.image_paths == (app_paths.character_images_dir / f"{created['reference_images'][0]['id']}.png",)
