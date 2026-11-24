"""Install rules shared by every model provider (services/model_providers/base.py) and the registry."""

from __future__ import annotations

import pytest

from app.schemas import RemoteFile, RemoteModelVersion
from app.services.model_providers import ModelProviderRegistry, UnknownProviderError
from app.services.model_providers.base import complete_version, default_file, unavailable_reason
from support import StubProvider, remote_file


def version(files: list[RemoteFile], *, architecture: str | None = "sdxl") -> RemoteModelVersion:
    return RemoteModelVersion(
        id="1",
        name="v1",
        base_model="Illustrious" if architecture else "Flux.1 D",
        architecture=architecture,  # type: ignore[arg-type]
        trigger_words=[],
        published_at=None,
        images=[],
        files=files,
        page_url=None,
        default_file_id=None,
        unavailable_reason=None,
    )


def test_default_file_prefers_the_primary_downloadable_file() -> None:
    assert default_file([remote_file(file_id="a", primary=False), remote_file(file_id="b")]).id == "b"  # type: ignore[union-attr]
    assert default_file([remote_file(file_id="a", downloadable=False), remote_file(file_id="b", primary=False)]).id == "b"  # type: ignore[union-attr]
    assert default_file([remote_file(file_id="a", downloadable=False)]) is None
    assert default_file([]) is None


def test_unavailable_reason() -> None:
    assert unavailable_reason(version([remote_file(file_id="a")])) is None
    assert "not supported" in (unavailable_reason(version([remote_file(file_id="a")], architecture=None)) or "")
    assert "No downloadable file" in (unavailable_reason(version([remote_file(file_id="a", downloadable=False)])) or "")


def test_complete_version_fills_the_derived_fields() -> None:
    completed = complete_version(version([remote_file(file_id="a", primary=False), remote_file(file_id="b")]))
    assert (completed.default_file_id, completed.unavailable_reason) == ("b", None)

    blocked = complete_version(version([remote_file(file_id="a", downloadable=False)]))
    assert blocked.default_file_id is None
    assert blocked.unavailable_reason is not None


def test_registry_finds_providers_by_id_and_rejects_duplicates() -> None:
    first, second = StubProvider(provider_id="civitai"), StubProvider(provider_id="huggingface")
    registry = ModelProviderRegistry([first, second])  # type: ignore[list-item]

    assert registry.get("huggingface") is second
    assert registry.all() == [first, second]
    with pytest.raises(UnknownProviderError):
        registry.get("nope")
    with pytest.raises(ValueError):
        ModelProviderRegistry([first, StubProvider(provider_id="civitai")])  # type: ignore[list-item]
