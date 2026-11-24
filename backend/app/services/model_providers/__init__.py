"""Registries of the online providers (services/container.py builds them; Civitai is the only provider today).

- ModelProviderRegistry: model catalogs (base.ModelProvider) used by the model library and to resolve the
  resources of online images.
- ImageProviderRegistry: image galleries (base.ImageProvider) used by the image library. An image provider has
  the id of the model provider that resolves its images' resources.

To add a provider (e.g. Hugging Face diffusers repos): implement base.ModelProvider (and base.ImageProvider when it
has an image gallery) in a new module of this package and add the instances in container.build_services. Nothing
else changes: the API, the frontend stores and the views take the provider ids from the API.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Generic, Protocol, TypeVar

from .base import (
    DownloadSource,
    ImageFeedRequest,
    ImageProvider,
    ModelProvider,
    ProviderAuthError,
    ProviderError,
    ProviderNotFoundError,
    UnknownProviderError,
)

__all__ = [
    "DownloadSource",
    "ImageFeedRequest",
    "ImageProvider",
    "ImageProviderRegistry",
    "ModelProvider",
    "ModelProviderRegistry",
    "ProviderAuthError",
    "ProviderError",
    "ProviderNotFoundError",
    "ProviderRegistry",
    "UnknownProviderError",
]


class _Identified(Protocol):
    @property
    def id(self) -> str: ...


ProviderT = TypeVar("ProviderT", bound=_Identified)


class ProviderRegistry(Generic[ProviderT]):
    """Providers by id, in registration order. `label` names the kind in errors ("Unknown <label> 'x'.")."""

    label = "provider"

    def __init__(self, providers: Iterable[ProviderT]) -> None:
        self._providers: dict[str, ProviderT] = {}
        for provider in providers:
            if provider.id in self._providers:
                raise ValueError(f"Duplicate {self.label} id {provider.id!r}.")
            self._providers[provider.id] = provider

    def get(self, provider_id: str) -> ProviderT:
        try:
            return self._providers[provider_id]
        except KeyError:
            raise UnknownProviderError(f"Unknown {self.label} '{provider_id}'.") from None

    def all(self) -> list[ProviderT]:
        """Providers in registration order."""
        return list(self._providers.values())


class ModelProviderRegistry(ProviderRegistry[ModelProvider]):
    label = "model provider"


class ImageProviderRegistry(ProviderRegistry[ImageProvider]):
    label = "image provider"
